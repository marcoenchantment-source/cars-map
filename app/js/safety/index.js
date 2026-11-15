// Safety: emergency contacts + crash alert. Watches real GPS fixes (and the motion sensor where
// the phone allows it) for a crash, asks "Are you OK?", then alerts emergency contacts. Works even
// in Ghost mode: safety beats privacy here, and the alert only goes to contacts you chose.
import { createCrashDetector, crashMessage } from './crashDetect.js';
import { createCrashAlert } from './alert.js';
import { renderContactsSection } from '../assistant/contactsSettings.js';

const G = 9.81;

export async function init(ctx) {
  const { store, bus, ui, actions } = ctx;
  const contactsStore = actions.has('contactsStore') ? await actions.call('contactsStore') : null;
  const contacts = () => contactsStore?.all() ?? [];
  const enabled = () => store.get().settings.crashAlert === true;

  /** Automatic part: Crew-linked contacts get the alert as an encrypted Crew message. */
  async function send(info, list) {
    const text = crashMessage(info);
    const sent = [];
    const failed = [];
    for (const c of list.filter((x) => x.crew)) {
      try {
        if (!actions.has('sendCrewMessage')) throw new Error('Crew is offline');
        await actions.call('sendCrewMessage', c.crew, text);
        sent.push(c.name);
      } catch (err) {
        console.warn('[safety] crash alert not delivered', err?.message);
        failed.push(c.name);
      }
    }
    return { sent, failed };
  }

  const alert = createCrashAlert(ctx, { send, contacts });
  const detector = createCrashDetector({ onSuspect: (info) => enabled() && !alert.isOpen() && alert.open(info) });

  let simActive = false;
  bus.on('gps:sim', (p) => {
    simActive = !!p?.active;
    detector.reset();
  });
  bus.on('gps:fix', (fix) => {
    if (enabled() && !simActive) detector.update(fix);
  });

  // Motion sensor: a jolt (gravity removed) helps tell a crash from hard braking.
  let listening = false;
  function onMotion(e) {
    const a = e.acceleration;
    let v;
    if (a && Number.isFinite(a.x)) v = Math.hypot(a.x, a.y ?? 0, a.z ?? 0);
    else {
      const g = e.accelerationIncludingGravity;
      if (!g || !Number.isFinite(g.x)) return;
      v = Math.abs(Math.hypot(g.x, g.y ?? 0, g.z ?? 0) - G);
    }
    detector.motion(v, Date.now());
  }
  function listen() {
    if (listening || typeof window === 'undefined' || !('DeviceMotionEvent' in window)) return;
    listening = true;
    window.addEventListener('devicemotion', onMotion);
  }
  /** iPhone asks permission for motion; it must come from a tap (the switch). */
  async function askMotion() {
    try {
      if (typeof DeviceMotionEvent?.requestPermission === 'function') {
        const answer = await DeviceMotionEvent.requestPermission();
        if (answer !== 'granted') return;
      }
      listen();
    } catch (err) {
      console.warn('[safety] motion sensor unavailable', err?.message);
    }
  }
  if (enabled() && typeof DeviceMotionEvent?.requestPermission !== 'function') listen();

  ui.registerSettingsSection({
    id: 'emergency', title: 'Emergency contacts', order: 15,
    render(c) {
      const setOn = (v) => store.set((s) => ({ settings: { ...s.settings, crashAlert: v } }));
      const list = ui.el('div', { class: 'stack' });
      c.append(
        ui.el(
          'div',
          { class: 'list' },
          ui.toggleRow({
            id: 'set-crash', label: 'Crash alert',
            hint: 'After a sudden stop, asks “Are you OK?” for 30 seconds, then alerts your emergency contacts with your location.',
            checked: enabled(),
            onChange: (v) => {
              setOn(v);
              if (!v) return;
              askMotion();
              if (!contacts().length) ui.toast('Add an emergency contact below', { tone: 'warn' });
            },
          }),
        ),
        ui.el('button', {
          type: 'button', class: 'btn btn-sm btn-ghost', text: 'Preview the safety check',
          on: { click: () => { ui.sheet.close(); alert.open(previewInfo(), { preview: true }); } },
        }),
        list,
        ui.el('p', { class: 'small muted', text: 'In an emergency, always call 000. Crash alert is a backup: it can miss a crash or mistake a very hard stop for one.' }),
      );
      const fill = (crew) => renderContactsSection(list, { ui, contacts: contactsStore, crew });
      if (!contactsStore) {
        list.append(ui.el('p', { class: 'muted small', text: 'Emergency contacts aren’t available right now. Reload the app.' }));
        return;
      }
      fill([]);
      if (actions.has('listFriends')) {
        actions.call('listFriends').then((crew) => {
          ui.clear(list);
          fill(Array.isArray(crew) ? crew : []);
        }).catch(() => {});
      }
    },
  });

  function previewInfo() {
    const p = store.get().position;
    const [lng, lat] = p ? [p.lng, p.lat] : ctx.config.DEFAULT_CENTER;
    return { at: Date.now(), lng, lat, speedBeforeKmh: 60, reason: 'gps' };
  }

  actions.register('testCrashAlert', () => alert.open(previewInfo(), { preview: true }));
}

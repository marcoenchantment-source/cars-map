// The "Are you OK?" screen after a suspected crash: a 30-second countdown with a huge "I'm OK",
// "Call 000" and "Send help now". When time runs out, emergency contacts linked to Crew get an
// automatic alert with your location; phone-only contacts get one-tap Text and Call buttons
// (browsers never allow silent texts or calls).
import { smsHref, telHref } from '../assistant/contacts.js';
import { crashMessage } from './crashDetect.js';

export const COUNTDOWN_S = 30;
const RING = 2 * Math.PI * 54;
const isIos = () => /iPad|iPhone|iPod/.test(navigator.userAgent);

export function createCrashAlert(ctx, { send, contacts }) {
  const { ui, bus } = ctx;
  let root = null;
  let timer = null;
  let buzz = null;

  function close() {
    clearInterval(timer);
    clearInterval(buzz);
    navigator.vibrate?.(0);
    root?.remove();
    root = null;
  }

  function shell(...children) {
    root?.remove();
    root = ui.el('div', { class: 'sx', role: 'alertdialog', 'aria-modal': 'true', 'aria-labelledby': 'sx-title' }, ui.el('div', { class: 'sx-card' }, ...children));
    document.getElementById('app')?.append(root);
    return root;
  }

  const call000 = () => ui.el('a', { class: 'btn btn-danger btn-block sx-btn', href: 'tel:000' }, ui.icon('phone', { size: 20 }), 'Call 000');

  /** Countdown stage. */
  function open(info, { preview = false } = {}) {
    close();
    let left = COUNTDOWN_S;
    const num = ui.el('span', { class: 'sx-num num', text: String(left) });
    const ring = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    ring.setAttribute('viewBox', '0 0 120 120');
    ring.setAttribute('class', 'sx-ring');
    ring.setAttribute('aria-hidden', 'true');
    ring.innerHTML = `<circle cx="60" cy="60" r="54" class="sx-ring-bg"/><circle cx="60" cy="60" r="54" class="sx-ring-fg" stroke-dasharray="${RING}" stroke-dashoffset="0"/>`; // constant markup
    const fg = ring.querySelector('.sx-ring-fg');
    const ok = ui.el('button', { type: 'button', class: 'btn btn-accent btn-block sx-ok', on: { click: () => { close(); ui.toast('Glad you’re OK', { tone: 'good' }); } } }, 'I’m OK');
    const helpNow = ui.el('button', { type: 'button', class: 'btn btn-ghost btn-block sx-btn', text: 'Send help now', on: { click: () => finish(info, preview) } });
    shell(
      preview ? ui.el('p', { class: 'sx-preview', text: 'Preview: nothing will be sent' }) : null,
      ui.el('h2', { class: 'sx-title', id: 'sx-title', text: 'Are you OK?' }),
      ui.el('p', { class: 'sx-sub', text: 'It looks like you stopped very suddenly. If you don’t answer, your emergency contacts get your location.' }),
      ui.el('div', { class: 'sx-count' }, ring, num),
      ok,
      ui.el('div', { class: 'sx-row' }, call000(), helpNow),
    );
    ok.focus();
    bus.emit('voice:say', { text: 'Possible crash. Are you OK? Tap I’m OK to cancel.', priority: 'high' });
    navigator.vibrate?.([400, 200, 400]);
    buzz = setInterval(() => navigator.vibrate?.([400, 200, 400]), 2500);
    timer = setInterval(() => {
      left -= 1;
      num.textContent = String(Math.max(0, left));
      fg.setAttribute('stroke-dashoffset', String(RING * (1 - left / COUNTDOWN_S)));
      if (left === 15) bus.emit('voice:say', { text: 'Are you OK? Alerting your emergency contacts in 15 seconds.', priority: 'high' });
      if (left <= 0) finish(info, preview);
    }, 1000);
  }

  /** Sending + result stage. */
  async function finish(info, preview) {
    clearInterval(timer);
    clearInterval(buzz);
    navigator.vibrate?.(0);
    const list = contacts();
    const status = ui.el('div', { class: 'stack sx-status', 'aria-live': 'polite' }, ui.el('p', { text: preview ? 'Preview: this is what would happen.' : 'Alerting your emergency contacts…' }));
    const text = crashMessage(info);
    const phoneButtons = list.map((c) => ui.el(
      'div',
      { class: 'sx-contact' },
      ui.el('strong', { text: c.name }),
      ui.el('a', { class: 'btn btn-sm btn-accent', href: smsHref(c.phone, text, { ios: isIos() }) }, ui.icon('message', { size: 18 }), 'Text'),
      ui.el('a', { class: 'btn btn-sm btn-ghost', href: telHref(c.phone) }, ui.icon('phone', { size: 18 }), 'Call'),
    ));
    shell(
      ui.el('h2', { class: 'sx-title', id: 'sx-title', text: preview ? 'Preview' : 'Getting you help' }),
      status,
      call000(),
      list.length ? ui.el('p', { class: 'sx-sub', text: 'One tap sends your location by text, or calls:' }) : ui.el('p', { class: 'sx-sub', text: 'You have no emergency contacts yet. Add them in Settings.' }),
      ...phoneButtons,
      ui.el('button', { type: 'button', class: 'btn btn-ghost btn-block sx-btn', text: 'I’m safe now — close', on: { click: close } }),
    );
    if (preview) {
      const linked = list.filter((c) => c.crew).map((c) => c.name);
      ui.clear(status).append(ui.el('p', { text: linked.length ? `Automatic alert would go to: ${linked.join(', ')} (in Crew).` : 'No contacts are linked to Crew, so nothing would be sent automatically.' }));
      return;
    }
    bus.emit('voice:say', { text: 'Alerting your emergency contacts.', priority: 'high' });
    const result = await send(info, list).catch((err) => ({ sent: [], failed: [], error: err?.message }));
    ui.clear(status);
    if (result.sent.length) status.append(ui.el('p', { class: 'sx-good', text: `Crash alert with your location sent to ${result.sent.join(', ')}.` }));
    if (result.failed.length) status.append(ui.el('p', { class: 'sx-bad', text: `Couldn’t reach ${result.failed.join(', ')} automatically. Use Text or Call below.` }));
    if (!result.sent.length && !result.failed.length) status.append(ui.el('p', { text: 'No contacts are linked to Crew, so nothing was sent automatically. Use Text or Call below.' }));
  }

  return Object.freeze({ open, close, isOpen: () => root !== null });
}

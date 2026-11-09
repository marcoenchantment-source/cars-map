// Demo drive: starts navigation and feeds simulated fixes along the route at 1 Hz, so the whole
// app can be tested on a desktop. Real GPS is muted while it runs (`gps:sim`).
import { createSimulator } from './simulate.js';
import { endPlace } from './route.js';

const TICK_MS = 1000;
const END_TICKS = 4; // stationary fixes at the end so arrival can trigger
const SPEEDS = [1, 2, 4, 10];

export function createDemoDrive(ctx, { controller }) {
  const { bus, ui, store } = ctx;
  let sim = null;
  let timer = null;
  let lastTick = 0;
  let endTicks = 0;
  let chip = null;

  function emitFix(f) {
    bus.emit('gps:fix', {
      lng: f.lng, lat: f.lat, accuracy: 5, speed: f.speed, heading: f.heading, timestamp: Date.now(), simulated: true,
    });
  }

  function tick() {
    if (!sim) return;
    const now = performance.now();
    const dt = Math.min(2, Math.max(0.2, (now - lastTick) / 1000));
    lastTick = now;
    const f = sim.step(dt);
    emitFix(f);
    if (f.done && ++endTicks >= END_TICKS) stop();
  }

  function renderChip() {
    chip?.remove();
    const factor = sim?.factor() ?? 2;
    const speeds = SPEEDS.map((n) =>
      ui.el('button', {
        type: 'button', class: 'nav-demo-speed', text: `×${n}`, 'aria-pressed': String(n === factor), 'aria-label': `${n} times speed`,
        on: { click: () => setFactor(n) },
      }),
    );
    chip = ui.el(
      'div',
      { class: 'nav-demo', role: 'group', 'aria-label': 'Demo drive controls' },
      ui.el('span', { class: 'nav-demo-label' }, ui.el('span', { class: 'nav-demo-dot', 'aria-hidden': 'true' }), 'Demo'),
      ...speeds,
      ui.el('button', { type: 'button', class: 'nav-demo-stop', 'aria-label': 'Stop demo drive', on: { click: () => stopAll() } }, ui.icon('stop', { size: 18 })),
    );
    document.getElementById('hud-left')?.prepend(chip);
  }

  function setFactor(n) {
    sim?.setFactor(n);
    renderChip();
  }

  /** Stop feeding fixes (navigation keeps going unless it already ended). */
  function stop() {
    if (!sim) return;
    clearInterval(timer);
    timer = null;
    sim = null;
    chip?.remove();
    chip = null;
    bus.emit('gps:sim', { active: false });
  }

  function stopAll() {
    stop();
    if (controller.isActive()) controller.stopNavigation();
  }

  function start(route, { speedFactor = 2, destination } = {}) {
    let next;
    try {
      next = createSimulator(route, { speedFactor });
    } catch (err) {
      ui.toast(err?.message || "This route can't be demo-driven.", { tone: 'bad' });
      return false;
    }
    stop();
    bus.emit('gps:sim', { active: true });
    const current = controller.route();
    const sameRoute = controller.isActive() && current && current.id === next.route().id;
    if (!sameRoute) {
      const dest = destination ?? store.get().destination ?? endPlace(next.route());
      if (!controller.startNavigation(route, dest)) {
        bus.emit('gps:sim', { active: false });
        return false;
      }
    }
    sim = next;
    endTicks = 0;
    lastTick = performance.now();
    emitFix(sim.start());
    timer = setInterval(tick, TICK_MS);
    renderChip();
    ui.toast('Demo drive started. Real GPS is paused.', { tone: 'good' });
    return true;
  }

  bus.on('nav:stop', () => stop());
  bus.on('nav:rerouted', ({ route }) => {
    if (!sim) return;
    try {
      const factor = sim.factor();
      sim = createSimulator(route, { speedFactor: factor });
      endTicks = 0;
    } catch (err) {
      console.warn('[demo] could not follow the new route', err);
      stop();
    }
  });

  return Object.freeze({ start, stop: stopAll, active: () => !!sim });
}

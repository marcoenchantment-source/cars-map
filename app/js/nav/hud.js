// Driving HUD: visible only in navigate mode. Wires the banner, speed gauge and ETA bar to the
// store (progress, route, settings) and to the nav module's private events (re-routing state).
import { createBanner } from './banner.js';
import { createGauge } from './gauge.js';
import { createEtaBar } from './etaBar.js';

export function createHud(ctx, { controller, voice, internal }) {
  const { store, bus } = ctx;
  const banner = createBanner(ctx);
  const gauge = createGauge(ctx);
  const eta = createEtaBar(ctx, { controller, voice });
  let rerouting = false;
  let gpsState = 'ok';
  let simActive = false;
  let visible = false;

  function render() {
    const s = store.get();
    const show = s.mode === 'navigate' && !!s.activeRoute;
    if (show !== visible) {
      visible = show;
      banner.setVisible(show);
      gauge.setVisible(show);
      eta.setVisible(show);
      document.getElementById('app')?.classList.toggle('nav-hud-on', show);
    }
    if (!show) return;
    const units = s.settings.units;
    const progress = s.progress;
    banner.update({ route: s.activeRoute, progress, units, rerouting, destination: s.destination });
    gauge.update(progress?.speed ?? 0, units);
    gauge.setGpsWeak(!simActive && (gpsState === 'searching' || gpsState === 'unavailable'));
    eta.update(progress, units);
  }

  store.subscribe((s, prev) => {
    if (s.progress !== prev.progress || s.mode !== prev.mode || s.activeRoute !== prev.activeRoute || s.settings !== prev.settings) render();
  });
  internal.on('rerouting', ({ active }) => {
    if (rerouting === active) return;
    rerouting = active;
    render();
  });
  bus.on('gps:status', (p) => {
    gpsState = p?.state ?? 'ok';
    render();
  });
  bus.on('gps:sim', (p) => {
    simActive = !!p?.active;
    render();
  });
  render();
}

// ETA bar (#bottom-slot): arrival clock, time and distance left, plus Mute, Overview and an
// End button with an inline two-tap confirm (no window.confirm while driving).
import { formatClockParts } from './format.js';

const CONFIRM_MS = 4000;

export function createEtaBar(ctx, { controller, voice }) {
  const { ui, store, geo, mapView, map } = ctx;
  const host = document.getElementById('bottom-slot');
  let overview = false;
  let confirmTimer = null;

  const time = ui.el('span', { class: 'nav-eta-time num', text: '–' });
  const period = ui.el('span', { class: 'nav-eta-ampm' });
  const left = ui.el('span', { class: 'num', text: '–' });
  const dist = ui.el('span', { class: 'num', text: '–' });
  const stats = ui.el(
    'div',
    { class: 'nav-eta-stats' },
    ui.el('div', { class: 'nav-eta-arrive' }, ui.el('span', { class: 'sr-only', text: 'Arrive at ' }), time, period),
    ui.el('div', { class: 'nav-eta-sub' }, left, ui.el('span', { class: 'nav-eta-dot', 'aria-hidden': 'true', text: '·' }), dist),
  );

  const muteBtn = ui.el('button', { type: 'button', class: 'nav-eta-btn', on: { click: toggleMute } });
  const overviewBtn = ui.el(
    'button',
    { type: 'button', class: 'nav-eta-btn', 'aria-label': 'Show the whole route', 'aria-pressed': 'false', on: { click: toggleOverview } },
    ui.icon('route', { size: 26 }),
  );
  const endLabel = ui.el('span', { class: 'nav-end-label', text: 'End' });
  const endBtn = ui.el(
    'button',
    { type: 'button', class: 'nav-eta-btn nav-end', 'aria-label': 'End navigation', on: { click: onEnd } },
    ui.icon('close', { size: 24 }),
    endLabel,
  );
  const root = ui.el('section', { class: 'nav-eta', 'aria-label': 'Trip progress', hidden: true }, muteBtn, stats, overviewBtn, endBtn);
  host?.prepend(root);

  function renderMute() {
    const on = store.get().settings.voice !== false;
    ui.clear(muteBtn).append(ui.icon(on ? 'volume' : 'mute', { size: 26 }));
    muteBtn.setAttribute('aria-label', on ? 'Mute voice directions' : 'Turn voice directions on');
    muteBtn.setAttribute('aria-pressed', String(!on));
    muteBtn.dataset.muted = String(!on);
  }

  function toggleMute() {
    const on = store.get().settings.voice !== false;
    store.set((s) => ({ settings: { ...s.settings, voice: !on } }));
    if (on) ui.toast('Voice directions off');
    else voice.say('Voice directions on.');
  }

  function resetEnd() {
    clearTimeout(confirmTimer);
    endBtn.dataset.confirm = 'false';
    endLabel.textContent = 'End';
    endBtn.setAttribute('aria-label', 'End navigation');
  }

  function onEnd() {
    if (endBtn.dataset.confirm === 'true') {
      resetEnd();
      controller.stopNavigation();
      return;
    }
    endBtn.dataset.confirm = 'true';
    endLabel.textContent = 'End?';
    endBtn.setAttribute('aria-label', 'Tap again to end navigation');
    clearTimeout(confirmTimer);
    confirmTimer = setTimeout(resetEnd, CONFIRM_MS);
  }

  function setOverview(on) {
    overview = on;
    overviewBtn.setAttribute('aria-pressed', String(on));
    overviewBtn.setAttribute('aria-label', on ? 'Back to driving view' : 'Show the whole route');
  }

  function toggleOverview() {
    if (overview) {
      setOverview(false);
      mapView.camera.recenter();
      return;
    }
    const { activeRoute: route, progress } = store.get();
    if (!route) return;
    const coords = progress ? geo.sliceAlong(route.geometry, route.cum, progress.along) : route.geometry;
    setOverview(true);
    store.set({ follow: false });
    // The follow camera pads the top of the map; clear it so the fit uses the whole screen.
    map.setPadding({ top: 0, right: 0, bottom: 0, left: 0 });
    mapView.fitBounds(geo.bboxOf(coords.length > 1 ? coords : route.geometry), { maxZoom: 16 });
  }

  renderMute();
  store.select((s) => s.settings.voice, renderMute);
  store.select(
    (s) => s.follow,
    (follow) => {
      if (follow && overview) setOverview(false);
    },
  );

  return Object.freeze({
    setVisible(v) {
      root.hidden = !v;
      if (!v) {
        resetEnd();
        setOverview(false);
      }
    },
    update(progress, units) {
      if (!progress) return;
      const clock = formatClockParts(progress.eta);
      time.textContent = clock.time;
      period.textContent = clock.period;
      left.textContent = geo.formatDuration(progress.durationRemaining);
      dist.textContent = geo.formatDistance(progress.distanceRemaining, units).text;
    },
  });
}

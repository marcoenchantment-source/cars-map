// A race session on one track: race mode, the whole circuit fitted to the screen, lap timing
// from GPS fixes, the lap panel, voice call-outs, and the optional demo driver.
import { createLapTimer, currentLapMs, lapSummary, makeStartLine, spokenLap, stepLaps, formatLap } from './laps.js';
import { computeTrackCamera } from './trackFit.js';
import { createDemoRun, DEMO } from './demo.js';
import { createLapPanel } from './panel.js';

const CLOCK_MS = 100;
const REFIT_DEBOUNCE_MS = 220;

/** Keep the screen on at the track. Returns release(). */
export function holdWakeLock() {
  let lock = null;
  let released = false;
  const request = async () => {
    if (released || !navigator.wakeLock || document.visibilityState !== 'visible') return;
    try {
      lock = await navigator.wakeLock.request('screen');
    } catch (err) {
      console.warn('[race] screen wake lock unavailable', err);
    }
  };
  const onVisible = () => document.visibilityState === 'visible' && request();
  document.addEventListener('visibilitychange', onVisible);
  request();
  return () => {
    released = true;
    document.removeEventListener('visibilitychange', onVisible);
    lock?.release().catch(() => {});
    lock = null;
  };
}

/** Fit the whole track inside the area the HUD leaves free. */
export function fitTrack(ctx, track, panelNode) {
  const { map } = ctx;
  const box = map.getContainer().getBoundingClientRect();
  const topHud = document.querySelector('.hud-top')?.getBoundingClientRect().bottom ?? box.top;
  const panelTop = panelNode?.isConnected ? panelNode.getBoundingClientRect().top : box.bottom;
  const viewport = {
    width: box.width,
    height: box.height,
    dpr: window.devicePixelRatio || 1,
    insets: { top: Math.max(0, topHud - box.top), bottom: Math.max(0, box.bottom - panelTop), left: 0, right: 0 },
  };
  const cam = computeTrackCamera(track.line, viewport);
  if (!cam) {
    ctx.mapView.fitBounds(track.bbox, { maxZoom: 18 });
    return;
  }
  map.easeTo({
    center: cam.center, zoom: cam.zoom, bearing: cam.bearing, pitch: 0,
    padding: { top: 0, bottom: 0, left: 0, right: 0 },
    duration: ctx.mapView.reduceMotion ? 0 : 1000,
  });
}

function lapSpeech(event) {
  const { lap, delta, isBest } = event;
  let tail = '';
  if (isBest && delta != null) tail = ' Best lap.';
  else if (delta != null) tail = ` ${delta > 0 ? 'Plus' : 'Minus'} ${Math.abs(delta / 1000).toFixed(1)}.`;
  return `Lap ${lap.n}. ${spokenLap(lap.time)}.${tail}`;
}

/**
 * @param {object} ctx
 * @param {{track: object, layer: object, demo?: boolean, onRecord?: Function, onEnd?: Function}} opts
 *   onRecord(track, lap) is called for a real lap that beats the stored best.
 */
export function startRaceSession(ctx, { track, layer, demo = false, onRecord, onEnd }) {
  const { store, bus, ui, map } = ctx;
  const disposers = [];
  let ended = false;
  let timer = createLapTimer(makeStartLine(track.start.point, track.start.heading), demo ? null : track.bestLap);
  let demoTimer = null;

  ui.sheet.close();
  store.set({ mode: 'race', follow: false });
  layer.showTrack(track);

  const panel = createLapPanel(ui, { onEnd: () => end(), demo, trackName: track.name });
  document.getElementById('bottom-slot')?.append(panel.node);
  const render = () => panel.setLaps({ ...lapSummary(timer), started: timer.lapStartedAt != null, demo });
  render();
  requestAnimationFrame(() => fitTrack(ctx, track, panel.node));

  const clock = setInterval(() => panel.setClock(currentLapMs(timer, Date.now())), CLOCK_MS);
  disposers.push(() => clearInterval(clock));

  function onLap(event) {
    render();
    bus.emit('voice:say', { text: lapSpeech(event), priority: 'normal' });
    if (!demo && event.isBest) {
      onRecord?.(track, event.lap);
      ui.toast(`New best lap: ${formatLap(event.lap.time)}`, { tone: 'good' });
    }
  }

  disposers.push(bus.on('gps:fix', (fix) => {
    if (!fix || Boolean(fix.simulated) !== demo) return;
    const r = stepLaps(timer, fix);
    timer = r.state;
    layer.setYou([fix.lng, fix.lat]);
    if (r.event?.type === 'start') {
      render();
      bus.emit('voice:say', { text: 'Timing started.', priority: 'normal' });
    } else if (r.event?.type === 'lap') onLap(r.event);
  }));

  // Refit when the screen changes shape; the re-centre button refits instead of following.
  let refitTimer = null;
  const refit = () => {
    clearTimeout(refitTimer);
    refitTimer = setTimeout(() => fitTrack(ctx, track, panel.node), REFIT_DEBOUNCE_MS);
  };
  map.on('resize', refit);
  window.addEventListener('orientationchange', refit);
  disposers.push(() => {
    clearTimeout(refitTimer);
    map.off('resize', refit);
    window.removeEventListener('orientationchange', refit);
  });
  disposers.push(store.select((s) => s.follow, (follow) => {
    if (!follow || store.get().mode !== 'race') return;
    fitTrack(ctx, track, panel.node);
    store.set({ follow: false });
  }));
  disposers.push(store.select((s) => s.mode, (mode) => mode !== 'race' && end({ keepMode: true })));
  disposers.push(holdWakeLock());

  if (demo) startDemo();

  function startDemo() {
    const run = createDemoRun(track);
    const t0 = performance.now();
    bus.emit('gps:sim', { active: true });
    demoTimer = setInterval(() => {
      const { fix, done } = run.fixAt((performance.now() - t0) / 1000, Date.now());
      bus.emit('gps:fix', fix);
      if (done) stopDemo(true);
    }, 1000 / DEMO.hz);
  }

  function stopDemo(finished = false) {
    if (!demoTimer) return;
    clearInterval(demoTimer);
    demoTimer = null;
    bus.emit('gps:sim', { active: false });
    if (finished && !ended) ui.toast('Demo finished. Tap End when you are done.', { ms: 4000 });
  }

  function end({ keepMode = false } = {}) {
    if (ended) return;
    ended = true;
    stopDemo();
    for (const d of disposers.splice(0)) {
      try {
        d();
      } catch (err) {
        console.error('[race] cleanup failed', err);
      }
    }
    panel.node.remove();
    layer.remove();
    if (!keepMode && store.get().mode === 'race') store.set({ mode: 'explore', follow: true });
    onEnd?.();
  }

  return Object.freeze({ end, track, demo });
}

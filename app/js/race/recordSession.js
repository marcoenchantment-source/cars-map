// Record a new track: the start/finish line is where the driver pressed Start; drive one lap
// and the loop closes itself back at the line (or tap Finish once 300 m are done).
import { LAPS, buildTrack, canFinishRecording, createRecording, stepRecording } from './laps.js';
import { createRecordPanel } from './panel.js';
import { holdWakeLock } from './session.js';

const RECORD_ZOOM = 16.5;

/**
 * @param {object} ctx
 * @param {{layer: object, nameFor: () => string, onSaved: (track) => void, onEnd?: Function}} opts
 * @returns {{cancel: Function}|null} null when there is no usable GPS fix yet
 */
export function startRecordSession(ctx, { layer, nameFor, onSaved, onEnd }) {
  const { store, bus, ui, map } = ctx;
  const pos = store.get().position;
  if (!pos || pos.simulated || !Number.isFinite(pos.lng) || !(pos.accuracy <= LAPS.maxAccuracyM)) {
    ui.toast('Waiting for a good GPS lock. Try again in a moment.', { tone: 'warn', ms: 4000 });
    return null;
  }
  const disposers = [];
  let ended = false;
  let rec = createRecording([pos.lng, pos.lat], Date.now());
  let lastAt = pos.timestamp;

  ui.sheet.close();
  store.set({ mode: 'race', follow: true });
  layer.showLine(rec.points, null);
  layer.setYou(rec.start);
  map.easeTo({ center: rec.start, zoom: RECORD_ZOOM, pitch: 0, bearing: 0, padding: { top: 0, bottom: 0, left: 0, right: 0 }, duration: ctx.mapView.reduceMotion ? 0 : 800 });

  const panel = createRecordPanel(ui, { onCancel: () => end(), onFinish: () => finish() });
  document.getElementById('bottom-slot')?.append(panel.node);
  const units = () => store.get().settings.units;
  panel.update({ meters: 0, canFinish: false, units: units() });
  bus.emit('voice:say', { text: 'Recording. Drive one full lap.', priority: 'normal' });

  disposers.push(bus.on('gps:fix', (fix) => {
    if (!fix || fix.simulated) return;
    rec = stepRecording(rec, fix);
    layer.setYou([fix.lng, fix.lat]);
    layer.showLine(rec.points, rec.heading != null ? { point: rec.start, heading: rec.heading } : null);
    panel.update({ meters: rec.distance, canFinish: canFinishRecording(rec), units: units() });
    if (store.get().follow) {
      const dt = Number.isFinite(fix.timestamp) && Number.isFinite(lastAt) ? fix.timestamp - lastAt : 1000;
      map.easeTo({ center: [fix.lng, fix.lat], duration: Math.max(0, Math.min(1000, dt)), easing: (k) => k });
    }
    lastAt = fix.timestamp;
    if (rec.closed) finish();
  }));
  disposers.push(store.select((s) => s.mode, (mode) => mode !== 'race' && end({ keepMode: true })));
  disposers.push(holdWakeLock());

  function finish() {
    if (ended) return;
    const track = buildTrack(rec, { id: `track-${Date.now().toString(36)}`, name: nameFor(), createdAt: Date.now() });
    if (!track) {
      ui.toast('Keep driving: a track needs at least 300 m.', { tone: 'warn' });
      return;
    }
    end({ keepMode: true, saved: true });
    bus.emit('voice:say', { text: 'Track saved. Timing starts at the line.', priority: 'normal' });
    onSaved(track);
  }

  function end({ keepMode = false, saved = false } = {}) {
    if (ended) return;
    ended = true;
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
    if (!saved) onEnd?.();
  }

  return Object.freeze({ cancel: () => end() });
}

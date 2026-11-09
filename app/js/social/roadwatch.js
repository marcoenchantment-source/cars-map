// Road changes: while driving (> 15 km/h, accuracy < 20 m, real GPS) check whether a mapped
// road is under the car. After 5 fixes with no road, record an "unmapped trace"; once back on
// a road, publish it (kind 7380). Traces from relays are aggregated by roadLogic: a chain is
// drawn for everyone only when ROAD_CONSENSUS_USERS distinct drivers passed it.
import { geohashEncode, geohashNeighbors, formatDistance, haversine } from '../core/geo.js';
import { KIND, isEventShape } from './events.js';
import { isLngLat } from './sanitize.js';
import { prepareTrace, traceTemplate, parseTraceEvent, roadConsensus, lineLength, TRACE_TTL_DAYS } from './roadLogic.js';

const MIN_SPEED_MPS = 15 / 3.6;
const MAX_ACCURACY_M = 20;
const OFF_FIXES = 5;
const ON_FIXES = 2;
const MIN_ZOOM = 14.5;
const MAX_POINTS = 600;
const GAP_MS = 30000;
const MIN_LENGTH_M = 50;
const MAX_TRACES = 1000;
const MAX_MINE = 50;
const REQUERY_MS = 600000;
const NEAR_M = 25000;
const SRC = 'cm-community-roads';
const EMPTY = { type: 'FeatureCollection', features: [] };
const nowSec = () => Math.floor(Date.now() / 1000);

export function createRoadwatch(ctx, nostr, { onChange }) {
  const { map, store, bus, storage, config } = ctx;
  const traces = new Map();
  let mine = loadMine();
  let consensus = { confirmed: [], pending: [] };
  let simActive = false;
  let offStreak = [];
  let recording = null;
  let onStreak = 0;
  let lastFixAt = 0;
  let cell = null;
  let layerReady = false;
  let recomputeTimer = null;

  function loadMine() {
    const raw = storage.load('social.myTraces', []);
    if (!Array.isArray(raw)) return [];
    return raw.filter((r) => r && isEventShape(r.event) && parseTraceEvent(r.event, nowSec())).map((r) => ({ event: r.event, sent: r.sent === true }));
  }
  const saveMine = () => storage.save('social.myTraces', mine);

  // ---------------------------------------------------------------- detection
  function roadLayerIds() {
    return (map.getStyle()?.layers ?? []).filter((l) => l.id.startsWith('road-')).map((l) => l.id);
  }

  /** true = on a mapped road, false = no road under the car, null = can't tell right now. */
  function onMappedRoad(fix) {
    if (map.getZoom() < MIN_ZOOM || !map.areTilesLoaded()) return null;
    const pt = map.project([fix.lng, fix.lat]);
    const canvas = map.getCanvas();
    if (pt.x < 0 || pt.y < 0 || pt.x > canvas.clientWidth || pt.y > canvas.clientHeight) return null;
    const metresPerPx = (40075016.686 * Math.cos((fix.lat * Math.PI) / 180)) / (512 * 2 ** map.getZoom());
    const r = Math.min(60, Math.max(4, (fix.accuracy + 8) / metresPerPx));
    const layers = roadLayerIds();
    if (layers.length === 0) return null;
    return map.queryRenderedFeatures([[pt.x - r, pt.y - r], [pt.x + r, pt.y + r]], { layers }).length > 0;
  }

  function reset() {
    offStreak = [];
    recording = null;
    onStreak = 0;
  }

  function onFix(fix) {
    if (simActive || fix.simulated || !isLngLat([fix.lng, fix.lat])) {
      reset();
      return;
    }
    updateCell([fix.lng, fix.lat]);
    if (!(fix.speed > MIN_SPEED_MPS) || !(fix.accuracy < MAX_ACCURACY_M)) return;
    if ((fix.timestamp ?? Date.now()) - lastFixAt > GAP_MS) reset();
    lastFixAt = fix.timestamp ?? Date.now();
    let on = null;
    try {
      on = onMappedRoad(fix);
    } catch (err) {
      console.warn('[social] road check failed', err?.message);
    }
    if (on === null) return;
    const p = [fix.lng, fix.lat];
    if (!on) {
      onStreak = 0;
      if (recording) {
        recording.push(p);
        if (recording.length >= MAX_POINTS) finish();
      } else {
        offStreak.push(p);
        if (offStreak.length >= OFF_FIXES) {
          recording = offStreak;
          offStreak = [];
        }
      }
      return;
    }
    offStreak = [];
    if (recording && ++onStreak >= ON_FIXES) finish();
  }

  function finish() {
    const pts = recording;
    reset();
    if (!pts || pts.length < OFF_FIXES || lineLength(pts) < MIN_LENGTH_M) return;
    publishTrace(prepareTrace(pts)).catch((err) => console.warn('[social] trace not saved', err?.message));
  }

  async function publishTrace(trace) {
    await nostr.start();
    const event = nostr.sign(traceTemplate({ trace, nowSec: nowSec() }));
    mine = [...mine, { event, sent: false }].slice(-MAX_MINE);
    saveMine();
    scheduleRecompute();
    send(event);
  }

  function send(event) {
    nostr.publishSigned(event)
      .then(() => {
        mine = mine.map((r) => (r.event.id === event.id ? { ...r, sent: true } : r));
        saveMine();
      })
      .catch(() => {}); // retried when signal returns
  }

  // ---------------------------------------------------------------- data
  const sub = nostr.live({
    filters: () => (cell ? [{ kinds: [KIND.TRACE], '#g': geohashNeighbors(cell), since: nowSec() - TRACE_TTL_DAYS * 86400, limit: 1000 }] : null),
    onevent: (ev) => {
      const t = parseTraceEvent(ev, nowSec());
      if (!t) return;
      traces.set(t.id, t);
      if (traces.size > MAX_TRACES) traces.delete(traces.keys().next().value);
      scheduleRecompute();
    },
    oneose: () => scheduleRecompute(),
  });

  function updateCell(lngLat) {
    const next = geohashEncode(lngLat[1], lngLat[0], 5);
    if (next === cell) return;
    cell = next;
    sub.refresh().catch(() => {});
  }

  function scheduleRecompute() {
    clearTimeout(recomputeTimer);
    recomputeTimer = setTimeout(recompute, 500);
  }

  function recompute() {
    const all = new Map(traces);
    for (const r of mine) {
      const t = parseTraceEvent(r.event, nowSec());
      if (t) all.set(t.id, t);
    }
    consensus = roadConsensus([...all.values()], { threshold: config.ROAD_CONSENSUS_USERS, me: nostr.pubkey() });
    render();
    onChange?.();
  }

  // ---------------------------------------------------------------- map layer
  function cssColor(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || null;
  }

  function applyColors() {
    if (!layerReady) return;
    const accent = cssColor('--accent');
    const ink = cssColor('--ink-2');
    if (accent) {
      map.setPaintProperty(`${SRC}-glow`, 'line-color', accent);
      map.setPaintProperty(SRC, 'line-color', accent);
    }
    if (ink) map.setPaintProperty(`${SRC}-pending`, 'line-color', ink);
  }

  function featureCollection() {
    const features = consensus.confirmed.map((c) => ({
      type: 'Feature', properties: { status: 'confirmed' }, geometry: { type: 'MultiLineString', coordinates: c.lines },
    }));
    for (const p of consensus.pending) {
      if (p.mine) features.push({ type: 'Feature', properties: { status: 'pending' }, geometry: { type: 'LineString', coordinates: p.trace } });
    }
    return { type: 'FeatureCollection', features };
  }

  function render() {
    if (layerReady) map.getSource(SRC)?.setData(featureCollection());
  }

  async function installLayer() {
    await ctx.mapView.ready;
    const before = map.getLayer('label-road') ? 'label-road' : undefined;
    map.addSource(SRC, { type: 'geojson', data: EMPTY });
    const confirmed = ['==', ['get', 'status'], 'confirmed'];
    map.addLayer({ id: `${SRC}-glow`, type: 'line', source: SRC, filter: confirmed,
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-width': 12, 'line-blur': 6, 'line-opacity': 0.35 } }, before);
    map.addLayer({ id: SRC, type: 'line', source: SRC, filter: confirmed,
      layout: { 'line-join': 'round' },
      paint: { 'line-width': 4, 'line-dasharray': [2, 1.4] } }, before);
    map.addLayer({ id: `${SRC}-pending`, type: 'line', source: SRC, filter: ['==', ['get', 'status'], 'pending'],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-width': 3, 'line-opacity': 0.5, 'line-dasharray': [0.2, 2] } }, before);
    layerReady = true;
    applyColors();
    render();
  }

  /** For the Crew sheet. */
  function summary() {
    const fix = store.get().position;
    const near = (p) => !fix || !p.trace?.length || haversine([fix.lng, fix.lat], p.trace[0]) < NEAR_M;
    return {
      confirmed: consensus.confirmed.length,
      pending: consensus.pending.filter(near).map((p) => ({
        id: p.id, drivers: p.drivers, mine: p.mine, lengthText: formatDistance(p.length, store.get().settings.units).text,
      })),
    };
  }

  function init() {
    bus.on('gps:sim', (p) => {
      simActive = !!p?.active;
      if (simActive) reset();
    });
    bus.on('gps:fix', onFix);
    store.select((s) => s.theme, () => requestAnimationFrame(applyColors));
    nostr.onStatus((st) => {
      if (st.state === 'online') for (const r of mine) if (!r.sent) send(r.event);
    });
    setInterval(() => sub.refresh().catch(() => {}), REQUERY_MS);
    installLayer().catch((err) => console.error('[social] road layer failed', err));
    nostr.start().then(scheduleRecompute).catch(() => {});
  }

  return Object.freeze({ init, summary });
}

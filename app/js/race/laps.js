// Pure lap timing: start/finish line geometry, line crossing with interpolated time, lap
// validity, best/last/delta, and track-closure detection while recording a lap.
import { angleDiff, bearing, haversine, simplify, bboxOf, EARTH_RADIUS_M } from '../core/geo.js';

export const LAPS = Object.freeze({
  lineWidthM: 30,
  minLapM: 200,
  minLapMs: 10000,
  closeWithinM: 25,
  closeHeadingDeg: 60,
  closeAfterM: 300,
  maxAccuracyM: 30,
  /** Recording ignores moves shorter than this (GPS wander at standstill). */
  recordStepM: 3,
  /** Distance from the start used to measure the start heading. */
  headingBaseM: 10,
  trackSimplifyM: 3,
});

const D2R = Math.PI / 180;
const round6 = (v) => Math.round(v * 1e6) / 1e6;

/** Local flat projection (metres east/north) around an origin; accurate over a few km. */
export function projector(origin) {
  const kx = Math.cos(origin[1] * D2R) * D2R * EARTH_RADIUS_M;
  const ky = D2R * EARTH_RADIUS_M;
  return {
    toXY: (p) => [(p[0] - origin[0]) * kx, (p[1] - origin[1]) * ky],
    toLngLat: (xy) => [origin[0] + xy[0] / kx, origin[1] + xy[1] / ky],
  };
}

/** Start/finish line: `width` metres long, centred on point, perpendicular to the driving heading. */
export function makeStartLine(point, heading, width = LAPS.lineWidthM) {
  const half = width / 2;
  const proj = projector(point);
  // Built in the same flat projection crossedLine uses, so the point is exactly the midpoint.
  const left = [-Math.cos(heading * D2R) * half, Math.sin(heading * D2R) * half];
  return Object.freeze({
    point: [point[0], point[1]],
    heading,
    width,
    a: proj.toLngLat(left),
    b: proj.toLngLat([-left[0], -left[1]]),
  });
}

const cross = (u, v) => u[0] * v[1] - u[1] * v[0];
const EPS = 1e-9;

/**
 * Did the move prevFix → fix cross the line in the driving direction?
 * The end point counts as crossing (t = 1) and the start point does not (t = 0), so a fix
 * landing exactly on the line is counted once.
 * @returns {{t:number, time:number, point:number[]}|null} interpolated crossing
 */
export function crossedLine(prevFix, fix, line, { anyDirection = false } = {}) {
  if (!prevFix || !fix || !line) return null;
  const proj = projector(line.point);
  const p = proj.toXY([prevFix.lng, prevFix.lat]);
  const q = proj.toXY([fix.lng, fix.lat]);
  const a = proj.toXY(line.a);
  const b = proj.toXY(line.b);
  const r = [q[0] - p[0], q[1] - p[1]];
  const s = [b[0] - a[0], b[1] - a[1]];
  const denom = cross(r, s);
  if (Math.abs(denom) < 1e-9) return null; // parallel to the line
  const ap = [a[0] - p[0], a[1] - p[1]];
  const t = cross(ap, s) / denom;
  const u = cross(ap, r) / denom;
  if (t <= EPS || t > 1 + EPS || u < -EPS || u > 1 + EPS) return null;
  const forward = r[0] * Math.sin(line.heading * D2R) + r[1] * Math.cos(line.heading * D2R) > 0;
  if (!forward && !anyDirection) return null;
  const time = prevFix.timestamp + t * (fix.timestamp - prevFix.timestamp);
  return { t, time, point: proj.toLngLat([p[0] + r[0] * t, p[1] + r[1] * t]), forward };
}

export function isValidLap(ms, distanceM, opts = LAPS) {
  return Number.isFinite(ms) && Number.isFinite(distanceM) && ms >= opts.minLapMs && distanceM >= opts.minLapM;
}

export function isUsableFix(fix, opts = LAPS) {
  return (
    !!fix &&
    Number.isFinite(fix.lng) &&
    Number.isFinite(fix.lat) &&
    Number.isFinite(fix.timestamp) &&
    (!Number.isFinite(fix.accuracy) || fix.accuracy <= opts.maxAccuracyM)
  );
}

// ---------------------------------------------------------------- lap timer

/** @param {{a,b,point,heading}} line start/finish line  @param {number|null} [bestMs] stored record */
export function createLapTimer(line, bestMs = null) {
  return Object.freeze({ line, prev: null, lapStartedAt: null, lapDistance: 0, laps: Object.freeze([]), best: Number.isFinite(bestMs) ? bestMs : null, lastDelta: null });
}

/**
 * Feed one fix.
 * event: {type:'start', at} on the first crossing; {type:'lap', lap, delta, isBest} for each
 * valid lap (delta = lap − previous best, null when there is none); crossings that would make a
 * too-short lap (GPS jitter at the line) are ignored.
 */
export function stepLaps(state, fix, opts = LAPS) {
  if (!isUsableFix(fix, opts)) return { state, event: null };
  const prev = state.prev;
  if (prev && fix.timestamp <= prev.timestamp) return { state, event: null };
  const here = { lng: fix.lng, lat: fix.lat, timestamp: fix.timestamp };
  if (!prev) return { state: Object.freeze({ ...state, prev: here }), event: null };
  const step = haversine([prev.lng, prev.lat], [fix.lng, fix.lat]);
  const running = state.lapStartedAt != null ? state.lapDistance + step : 0;
  const c = crossedLine(prev, fix, state.line);
  if (!c) return { state: Object.freeze({ ...state, prev: here, lapDistance: running }), event: null };
  const afterLine = haversine(c.point, [fix.lng, fix.lat]);
  if (state.lapStartedAt == null) {
    const next = { ...state, prev: here, lapStartedAt: c.time, lapDistance: afterLine };
    return { state: Object.freeze(next), event: { type: 'start', at: c.time } };
  }
  const time = c.time - state.lapStartedAt;
  const distance = running - afterLine;
  if (!isValidLap(time, distance, opts)) return { state: Object.freeze({ ...state, prev: here, lapDistance: running }), event: null };
  const lap = Object.freeze({ n: state.laps.length + 1, time, distance, endedAt: c.time });
  const delta = state.best == null ? null : time - state.best;
  const isBest = state.best == null || time < state.best;
  const next = {
    ...state,
    prev: here,
    lapStartedAt: c.time,
    lapDistance: afterLine,
    laps: Object.freeze([...state.laps, lap]),
    best: isBest ? time : state.best,
    lastDelta: delta,
  };
  return { state: Object.freeze(next), event: { type: 'lap', lap, delta, isBest } };
}

/** Running time of the current lap, or null before the first crossing. */
export function currentLapMs(state, now) {
  return state.lapStartedAt == null ? null : Math.max(0, now - state.lapStartedAt);
}

/** {count, last, best, delta}: delta = last lap − the best lap before it (negative = faster). */
export function lapSummary(state) {
  const laps = state.laps;
  return { count: laps.length, last: laps.length ? laps[laps.length - 1].time : null, best: state.best, delta: state.lastDelta };
}

// ---------------------------------------------------------------- recording a track

export function createRecording(startPoint, startedAt) {
  return Object.freeze({ start: [startPoint[0], startPoint[1]], startedAt, heading: null, points: Object.freeze([[startPoint[0], startPoint[1]]]), distance: 0, closed: false });
}

/** Feed a fix while the driver laps the circuit; `closed` turns true back at the start line. */
export function stepRecording(rec, fix, opts = LAPS) {
  if (rec.closed || !isUsableFix(fix, opts)) return rec;
  const p = [fix.lng, fix.lat];
  const tail = rec.points[rec.points.length - 1];
  const step = haversine(tail, p);
  if (step < opts.recordStepM) return rec;
  const moveHeading = bearing(tail, p);
  const heading = rec.heading ?? (haversine(rec.start, p) >= opts.headingBaseM ? bearing(rec.start, p) : null);
  const distance = rec.distance + step;
  const closed =
    heading != null &&
    distance >= opts.closeAfterM &&
    haversine(p, rec.start) <= opts.closeWithinM &&
    Math.abs(angleDiff(moveHeading, heading)) <= opts.closeHeadingDeg;
  return Object.freeze({ ...rec, heading, distance, closed, points: Object.freeze([...rec.points, p]) });
}

/** True once enough has been driven to finish by hand (closing straight back to the start). */
export function canFinishRecording(rec, opts = LAPS) {
  return rec.heading != null && rec.distance >= opts.closeAfterM;
}

/** Saved track from a recording: closed loop line starting at the start point. */
export function buildTrack(rec, { id, name, createdAt }, opts = LAPS) {
  if (!canFinishRecording(rec, opts)) return null;
  const loop = [...rec.points, rec.start];
  const line = simplify(loop, opts.trackSimplifyM).map(([lng, lat]) => [round6(lng), round6(lat)]);
  let length = 0;
  for (let i = 1; i < line.length; i++) length += haversine(line[i - 1], line[i]);
  return {
    id,
    name,
    createdAt,
    line,
    start: { point: [round6(rec.start[0]), round6(rec.start[1])], heading: Math.round(rec.heading * 10) / 10 },
    length: Math.round(length),
    bbox: bboxOf(line),
    bestLap: null,
    bestLapAt: null,
  };
}

// ---------------------------------------------------------------- text

/** 92410 → "1:32.41"; digits = decimals (1 or 2). */
export function formatLap(ms, digits = 2) {
  if (!Number.isFinite(ms) || ms < 0) return digits === 1 ? '–:––.–' : '–:––.––';
  const unit = 10 ** digits;
  const total = Math.floor((ms / 1000) * unit);
  const frac = total % unit;
  const secs = Math.floor(total / unit);
  return `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}.${String(frac).padStart(digits, '0')}`;
}

/** -520 → "−0.52", 1300 → "+1.30". */
export function formatDelta(ms) {
  if (!Number.isFinite(ms)) return '';
  const sign = ms < 0 ? '−' : '+';
  return `${sign}${(Math.abs(ms) / 1000).toFixed(2)}`;
}

/** Speech: "1 32.4" for 92410 ms, "45.2 seconds" under a minute. */
export function spokenLap(ms) {
  const tenths = Math.round(ms / 100) / 10;
  const m = Math.floor(tenths / 60);
  const s = (tenths - m * 60).toFixed(1);
  return m ? `${m} ${s.padStart(4, '0')}` : `${s} seconds`;
}

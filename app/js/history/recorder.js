// Trip recorder. A pure state machine (stepRecorder / finishTrip / markGap) turns real GPS
// fixes into trips; startRecorder() is the thin wiring to the bus, the page lifecycle and the
// trip store. Simulated fixes (demo drive, demo lap) are never recorded.
import { haversine, simplify } from '../core/geo.js';

export const RECORDER = Object.freeze({
  maxAccuracyM: 30,
  /** Only fixes faster than this (m/s) extend a trip, so parking-lot shuffles stay out. */
  movingSpeed: 2,
  /** A stop longer than this ends the trip; moving again starts a new one. */
  stopSplitMs: 10 * 60 * 1000,
  simplifyM: 8,
  /** Shorter trips are discarded (car park laps, GPS wander). */
  minTripM: 300,
  /** Raw points closer than this to the previous one are not stored. */
  minPointGapM: 4,
  /** Jumps implying more than this (m/s) within a short window are GPS glitches. */
  maxPlausibleSpeed: 85,
  glitchWindowS: 10,
  /** After the app was hidden, a jump bigger than this starts a new trip (no straight line across town). */
  resumeGapM: 300,
  /** Without a hide, a silent spell (tunnel, signal loss) longer than gapS with a jump above gapM splits. */
  gapS: 30,
  gapM: 1500,
  /** Thin the in-memory buffer past this many raw points (very long drives). */
  maxRawPoints: 4000,
  checkpointMs: 5 * 60 * 1000,
});

const round6 = (v) => Math.round(v * 1e6) / 1e6;

export function createRecorderState() {
  return Object.freeze({ trip: null, last: null, gap: false });
}

/** True when a fix is real, finite and accurate enough to draw on a road. */
export function isRecordableFix(fix, opts = RECORDER) {
  if (!fix || fix.simulated === true) return false;
  if (!Number.isFinite(fix.lng) || !Number.isFinite(fix.lat) || !Number.isFinite(fix.timestamp)) return false;
  return Number.isFinite(fix.accuracy) && fix.accuracy <= opts.maxAccuracyM;
}

/** Reported speed when the device gives one, else speed derived from the previous fix. */
export function fixSpeed(fix, jumpM, dtS) {
  if (Number.isFinite(fix.speed) && fix.speed >= 0) return fix.speed;
  if (dtS > 0 && dtS <= 30) return jumpM / dtS;
  return 0;
}

function startTrip(point, t, speed) {
  return { startedAt: t, lastMovingAt: t, points: [point], tail: point, distance: 0, maxSpeed: speed };
}

function extendTrip(trip, point, t, speed, opts) {
  const step = haversine(trip.tail, point);
  const base = { ...trip, lastMovingAt: t, maxSpeed: Math.max(trip.maxSpeed, speed) };
  if (step < opts.minPointGapM) return base;
  const points = trip.points.length >= opts.maxRawPoints ? simplify(trip.points, 3) : trip.points;
  return { ...base, points: [...points, point], tail: point, distance: trip.distance + step };
}

/**
 * The saved form of an in-progress trip, or null if it is too short to keep.
 * @returns {{id,startedAt,endedAt,distance,duration,maxSpeed,line,from?,to?}|null}
 */
export function buildTrip(trip, opts = RECORDER) {
  if (!trip || trip.points.length < 2 || trip.distance < opts.minTripM) return null;
  const line = simplify(trip.points, opts.simplifyM).map(([lng, lat]) => [round6(lng), round6(lat)]);
  return {
    id: `trip-${trip.startedAt}`,
    startedAt: trip.startedAt,
    endedAt: trip.lastMovingAt,
    distance: Math.round(trip.distance),
    duration: Math.round((trip.lastMovingAt - trip.startedAt) / 1000),
    maxSpeed: Math.round(trip.maxSpeed * 10) / 10,
    line,
    ...(trip.from ? { from: trip.from } : {}),
    ...(trip.to ? { to: trip.to } : {}),
  };
}

/** Close the open trip. extra (e.g. {to}) is merged in. */
export function finishTrip(state, extra = {}, opts = RECORDER) {
  const finished = state.trip ? buildTrip({ ...state.trip, ...extra }, opts) : null;
  return { state: Object.freeze({ ...state, trip: null }), finished };
}

/** The app went to the background: GPS may pause, so judge the next jump as a resume. */
export function markGap(state) {
  return Object.freeze({ ...state, gap: true });
}

function isGapSplit(state, jumpM, dtS, opts) {
  if (!state.trip) return false;
  if (state.gap) return jumpM > opts.resumeGapM;
  return dtS > opts.gapS && jumpM > opts.gapM;
}

/**
 * Feed one fix. Returns the next state and, when a trip just ended, the finished trip.
 * @returns {{state: object, finished: object|null}}
 */
export function stepRecorder(state, fix, opts = RECORDER) {
  if (!isRecordableFix(fix, opts)) return { state, finished: null };
  const point = [fix.lng, fix.lat];
  const t = fix.timestamp;
  const last = state.last;
  if (last && t <= last.timestamp) return { state, finished: null };
  const jumpM = last ? haversine([last.lng, last.lat], point) : 0;
  const dtS = last ? (t - last.timestamp) / 1000 : 0;
  if (last && !state.gap && dtS <= opts.glitchWindowS && jumpM / dtS > opts.maxPlausibleSpeed) {
    return { state, finished: null };
  }
  let finished = null;
  let trip = state.trip;
  if (trip && (t - trip.lastMovingAt > opts.stopSplitMs || isGapSplit(state, jumpM, dtS, opts))) {
    finished = buildTrip(trip, opts);
    trip = null;
  }
  const speed = fixSpeed(fix, jumpM, dtS);
  if (speed > opts.movingSpeed) trip = trip ? extendTrip(trip, point, t, speed, opts) : startTrip(point, t, speed);
  const next = Object.freeze({ trip, last: { lng: fix.lng, lat: fix.lat, timestamp: t }, gap: false });
  return { state: next, finished };
}

// ---------------------------------------------------------------- wiring

/**
 * Record real drives into the trip store.
 * @param {{bus: object}} ctx
 * @param {{upsert: Function}} tripStore
 * @returns {() => void} stop
 */
export function startRecorder(ctx, tripStore, { doc = globalThis.document, win = globalThis.window } = {}) {
  let state = createRecorderState();
  let lastCheckpoint = 0;

  const save = (trip) => {
    if (!trip) return;
    try {
      tripStore.upsert(trip);
    } catch (err) {
      console.error('[history] could not save a trip', err);
    }
  };
  const checkpoint = () => {
    save(buildTrip(state.trip));
    lastCheckpoint = state.last?.timestamp ?? 0;
  };

  const offFix = ctx.bus.on('gps:fix', (fix) => {
    const r = stepRecorder(state, fix);
    state = r.state;
    save(r.finished);
    if (state.trip && state.last && state.last.timestamp - lastCheckpoint > RECORDER.checkpointMs) checkpoint();
  });
  const offArrive = ctx.bus.on('nav:arrive', (payload) => {
    const r = finishTrip(state, { to: payload?.destination?.name ?? '' });
    state = r.state;
    save(r.finished);
  });

  const onHide = () => {
    if (doc && doc.visibilityState !== 'hidden') return;
    checkpoint();
    state = markGap(state);
  };
  const onPageHide = () => checkpoint();
  doc?.addEventListener('visibilitychange', onHide);
  win?.addEventListener('pagehide', onPageHide);

  return () => {
    offFix();
    offArrive();
    doc?.removeEventListener('visibilitychange', onHide);
    win?.removeEventListener('pagehide', onPageHide);
  };
}

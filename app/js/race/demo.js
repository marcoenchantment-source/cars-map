// Pure demo helpers: a made-up circuit around a point, and simulated fixes for driving it
// (lead-in to the line, two laps with the second a little quicker, a short run-out).
import { bboxOf, bearing, cumulativeDistances, destination, haversine, pointAlong } from '../core/geo.js';
import { projector } from './laps.js';

export const DEMO = Object.freeze({
  speeds: [29, 30.5], // m/s per lap: lap 2 is quicker so the delta shows green
  leadInM: 80,
  runOutM: 40,
  hz: 5,
  wobbleM: 1.2,
});

const round6 = (v) => Math.round(v * 1e6) / 1e6;

/** A ~1.6 km closed circuit centred on `center`, starting on its eastern straight heading north. */
export function demoCircuit(center, { id = 'demo', name = 'Demo circuit' } = {}) {
  const proj = projector(center);
  const n = 220;
  const line = [];
  for (let i = 0; i <= n; i++) {
    const t = (i / n) * 2 * Math.PI;
    const x = 340 * Math.cos(t) - 30 * Math.cos(2 * t);
    const y = 140 * Math.sin(t) + 45 * Math.sin(2 * t);
    line.push(proj.toLngLat([x, y]).map(round6));
  }
  line[n] = line[0];
  const cum = cumulativeDistances(line);
  return {
    id,
    name,
    createdAt: 0,
    demo: true,
    line,
    start: { point: line[0], heading: Math.round(bearing(line[0], line[1]) * 10) / 10 },
    length: Math.round(cum[cum.length - 1]),
    bbox: bboxOf(line),
    bestLap: null,
    bestLapAt: null,
  };
}

/** Distance travelled after `seconds` and whether the run is over. */
export function demoDistanceAt(seconds, length, opts = DEMO) {
  const [s1, s2] = opts.speeds;
  const firstLeg = opts.leadInM + length; // lead-in + lap 1 at s1
  const t1 = firstLeg / s1;
  const total = firstLeg + length + opts.runOutM;
  const d = seconds <= t1 ? seconds * s1 : firstLeg + (seconds - t1) * s2;
  return { distance: Math.min(d, total), speed: seconds <= t1 ? s1 : s2, done: d >= total };
}

/**
 * Simulated driver for a track. fixAt(seconds, timestamp) → {fix, done}.
 * @param {{line:number[][]}} track
 */
export function createDemoRun(track, opts = DEMO) {
  const line = track.line;
  const cum = cumulativeDistances(line);
  const length = cum[cum.length - 1];
  return {
    length,
    fixAt(seconds, timestamp) {
      const { distance, speed, done } = demoDistanceAt(seconds, length, opts);
      const along = (((length - opts.leadInM + distance) % length) + length) % length;
      const at = pointAlong(line, cum, along);
      const wobble = opts.wobbleM * Math.sin(distance / 37);
      const p = destination(at.point, Math.abs(wobble), at.bearing + (wobble >= 0 ? 90 : -90));
      const fix = { lng: p[0], lat: p[1], accuracy: 4, speed, heading: at.bearing, timestamp, simulated: true };
      return { fix, done };
    },
    /** Total run time in seconds. */
    duration() {
      const [s1, s2] = opts.speeds;
      return (opts.leadInM + length) / s1 + (length + opts.runOutM) / s2;
    },
  };
}

/** Distance from p to the nearest track vertex (cheap "am I at this circuit?" check). */
export function distanceToTrack(track, p) {
  let best = Infinity;
  for (const c of track.line) best = Math.min(best, haversine(c, p));
  return best;
}

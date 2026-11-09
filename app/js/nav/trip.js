// Pure trip recorder: distance, speeds and a simplified track for the drive being navigated.
import { haversine, simplify } from '../core/geo.js';

const MIN_STEP_M = 2;
const MAX_JUMP_M = 2000;
const MAX_POINTS = 20000;
const TRACK_TOLERANCE_M = 5;
const MAX_SANE_SPEED = 120; // m/s; anything faster is a GPS glitch (demo drive is capped well below)

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

export function createTripRecorder(startedAt) {
  let points = [];
  let tail = null;
  let distance = 0;
  let maxSpeed = 0;
  let fixes = 0;
  let simulated = false;
  let accuracies = [];
  let reroutes = 0;
  let offRoutes = 0;

  return Object.freeze({
    add(fix) {
      if (!fix || !isNum(fix.lng) || !isNum(fix.lat)) return;
      fixes += 1;
      simulated = simulated || !!fix.simulated;
      if (isNum(fix.speed) && fix.speed <= MAX_SANE_SPEED) maxSpeed = Math.max(maxSpeed, fix.speed);
      // Private buffers (never shared until finish() copies them), so appending in place is safe.
      if (isNum(fix.accuracy) && accuracies.length < 5000) accuracies.push(fix.accuracy);
      const point = [fix.lng, fix.lat];
      if (!tail) {
        tail = point;
        points = [point];
        return;
      }
      const step = haversine(tail, point);
      if (step < MIN_STEP_M) return;
      if (step <= MAX_JUMP_M) distance += step;
      tail = point;
      if (points.length >= MAX_POINTS) points = simplify(points, 3);
      points.push(point);
    },
    noteReroute() {
      reroutes += 1;
    },
    noteOffRoute() {
      offRoutes += 1;
    },
    /** Trip summary {startedAt, endedAt, distance, duration, avgSpeed, maxSpeed, track, ...}. */
    finish(endedAt) {
      const duration = Math.max(0, (endedAt - startedAt) / 1000);
      const sorted = [...accuracies].sort((a, b) => a - b);
      return {
        startedAt,
        endedAt,
        distance,
        duration,
        avgSpeed: duration > 0 ? distance / duration : 0,
        maxSpeed,
        track: simplify(points, TRACK_TOLERANCE_M),
        simulated,
        fixes,
        reroutes,
        offRoutes,
        medianAccuracy: sorted.length ? sorted[Math.floor(sorted.length / 2)] : null,
      };
    },
  });
}

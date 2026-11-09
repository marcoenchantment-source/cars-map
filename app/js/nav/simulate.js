// Pure demo-drive simulator: moves a virtual car along a route with believable speeds
// (each step's distance/duration), braking for turns, times a playback factor.
import { bearing, haversine, pointAlong } from '../core/geo.js';
import { normalizeRoute } from './route.js';
import { maneuverKind } from './maneuver.js';

const MIN_MPS = 4;
const MAX_MPS = 33; // ~120 km/h before the playback factor
const ACCEL = 2.5; // m/s² (simulated time)
const DECEL = 3.5;
const BRAKE = 1.8; // comfortable braking used to plan turn speeds
const LOOKAHEAD_M = 10;

function turnSpeed(step) {
  const m = maneuverKind(step);
  if (m.kind === 'arrive') return 3;
  if (m.kind === 'uturn') return 4;
  if (m.kind === 'roundabout') return 6;
  if (m.kind === 'turn') return m.degree === 'slight' ? 12 : m.degree === 'sharp' ? 5 : 7;
  if (m.kind === 'fork' || m.kind === 'ramp' || m.kind === 'merge') return 14;
  return Infinity;
}

function stepIndexAt(steps, along) {
  let i = 0;
  while (i < steps.length - 1 && steps[i + 1].along <= along) i++;
  return i;
}

export function createSimulator(input, { speedFactor = 2 } = {}) {
  const route = normalizeRoute(input);
  const total = route.cum[route.cum.length - 1];
  const fallback = route.duration > 0 ? total / route.duration : 13.9;
  let factor = speedFactor > 0 ? speedFactor : 2;
  let along = 0;
  let speed = 0; // real-world m/s before the factor

  function targetSpeed() {
    const { steps } = route;
    const i = stepIndexAt(steps, along);
    const step = steps[i];
    const cruise = step.duration > 0 && step.distance > 0 ? step.distance / step.duration : fallback;
    let target = Math.min(MAX_MPS, Math.max(MIN_MPS, cruise));
    for (let k = i + 1; k < steps.length && steps[k].along - along < 400; k++) {
      const d = Math.max(0, steps[k].along - along);
      const v = turnSpeed(steps[k]);
      if (Number.isFinite(v)) target = Math.min(target, Math.sqrt(v * v + 2 * BRAKE * d));
    }
    return target;
  }

  function headingAt(a) {
    const p = pointAlong(route.geometry, route.cum, a);
    const q = pointAlong(route.geometry, route.cum, Math.min(total, a + LOOKAHEAD_M));
    return haversine(p.point, q.point) > 1 ? bearing(p.point, q.point) : p.bearing;
  }

  return Object.freeze({
    route: () => route,
    along: () => along,
    done: () => along >= total,
    factor: () => factor,
    setFactor(f) {
      if (Number.isFinite(f) && f > 0) factor = f;
    },
    /** Advance by dtSec of real time; returns a Fix-like object (timestamp/accuracy added by the caller). */
    step(dtSec) {
      const simDt = Math.max(0, Math.min(5, dtSec)) * factor;
      const target = targetSpeed();
      speed = speed < target ? Math.min(target, speed + ACCEL * simDt) : Math.max(target, speed - DECEL * simDt);
      if (along === 0 && speed < MIN_MPS) speed = Math.min(target, MIN_MPS);
      along = Math.min(total, along + speed * simDt);
      const p = pointAlong(route.geometry, route.cum, along).point;
      const finished = along >= total;
      return { lng: p[0], lat: p[1], heading: headingAt(along), speed: finished ? 0 : speed * factor, along, done: finished };
    },
    /** Position at the start, before the first step. */
    start() {
      const p = route.geometry[0];
      return { lng: p[0], lat: p[1], heading: headingAt(0), speed: 0, along: 0, done: false };
    },
  });
}

// Pure map matching of a fix onto the route line.
// Search a window just ahead of the last match first, so roads the route uses twice (loops,
// out-and-back legs, self-crossings) never snap the car backwards or far ahead; fall back to a
// whole-route search that prefers forward, heading-consistent candidates.
import { angleDiff, bearing, projectOnSegment, segmentIndexAt } from '../core/geo.js';

export const WINDOW_BACK_M = 40;
export const WINDOW_AHEAD_MIN_M = 300;
const HEADING_FREE_DEG = 45;
const HEADING_PENALTY_M = 30;
const HEADING_MIN_SPEED = 3;
const FORWARD_PENALTY_PER_M = 0.04;
const BACKWARD_PENALTY_PER_M = 0.2;
const BACK_SLACK_M = 12;

/** Bearing of every segment; zero-length segments inherit their neighbour's bearing. */
export function segmentBearings(geometry) {
  const out = new Array(Math.max(0, geometry.length - 1)).fill(null);
  for (let i = 0; i < out.length; i++) {
    const a = geometry[i];
    const b = geometry[i + 1];
    if (a[0] !== b[0] || a[1] !== b[1]) out[i] = bearing(a, b);
  }
  let last = out.find((v) => v != null) ?? 0;
  return out.map((v) => {
    if (v != null) last = v;
    return v ?? last;
  });
}

function headingPenalty(q, segBearing) {
  if (q.heading == null || !(q.speed >= HEADING_MIN_SPEED)) return 0;
  const diff = Math.abs(angleDiff(q.heading, segBearing));
  return diff <= HEADING_FREE_DEG ? 0 : ((diff - HEADING_FREE_DEG) / (180 - HEADING_FREE_DEG)) * HEADING_PENALTY_M;
}

function alongPenalty(q, along) {
  const ahead = along - (q.lastAlong + q.expectedAdvance + q.slack);
  if (ahead > 0) return ahead * FORWARD_PENALTY_PER_M;
  const behind = q.lastAlong - BACK_SLACK_M - along;
  return behind > 0 ? behind * BACKWARD_PENALTY_PER_M : 0;
}

/** Best-scoring candidate on segments [from, to) whose distance is <= maxDist, plus the minimum distance seen. */
function scan(route, segBearing, q, from, to, maxDist) {
  const { geometry, cum } = route;
  let best = null;
  let minDist = Infinity;
  for (let i = from; i < to; i++) {
    const r = projectOnSegment(q.point, geometry[i], geometry[i + 1]);
    if (r.dist < minDist) minDist = r.dist;
    if (r.dist > maxDist) continue;
    const along = cum[i] + r.t * (cum[i + 1] - cum[i]);
    const score = r.dist + headingPenalty(q, segBearing[i]) + alongPenalty(q, along);
    if (!best || score < best.score) best = { index: i, t: r.t, dist: r.dist, point: r.point, along, score };
  }
  return { best, minDist };
}

/**
 * Match a point onto the route.
 * @param {{geometry:number[][], cum:number[]}} route
 * @param {number[]} segBearing segmentBearings(route.geometry)
 * @param {{point:number[], heading:number|null, speed:number, lastAlong:number, ahead:number,
 *          expectedAdvance:number, slack:number, threshold:number}} q
 * @returns {{index:number, t:number, dist:number, point:number[], along:number, minDist:number, scope:'window'|'global'|'none'}}
 */
export function matchOnRoute(route, segBearing, q) {
  const n = route.geometry.length;
  const from = segmentIndexAt(route.cum, Math.max(0, q.lastAlong - WINDOW_BACK_M));
  const to = Math.min(n - 1, segmentIndexAt(route.cum, q.lastAlong + Math.max(q.ahead, WINDOW_AHEAD_MIN_M)) + 1);
  const win = scan(route, segBearing, q, from, to, Infinity);
  if (win.best && win.best.dist <= q.threshold) return { ...win.best, minDist: win.best.dist, scope: 'window' };
  const all = scan(route, segBearing, q, 0, n - 1, q.threshold);
  if (all.best) return { ...all.best, minDist: all.minDist, scope: 'global' };
  const fallback = win.best ?? scan(route, segBearing, q, 0, n - 1, Infinity).best;
  return { ...fallback, minDist: all.minDist, dist: all.minDist, scope: 'none' };
}

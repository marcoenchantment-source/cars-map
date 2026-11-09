// Shared synthetic routes and fixes for the nav tests (not a test file itself).
import * as geo from '../app/js/core/geo.js';

export const PERTH = [115.8605, -31.9505];
const VERTEX_SPACING_M = 25;
const SPEED = 13.9;

function modifierFor(turn) {
  const a = Math.abs(turn);
  const side = turn > 0 ? 'right' : 'left';
  if (a < 20) return 'straight';
  if (a > 160) return 'uturn';
  if (a < 60) return `slight ${side}`;
  if (a > 120) return `sharp ${side}`;
  return side;
}

/**
 * Build a Route from legs [{dist, brg, road}]. Each leg after the first starts with a turn step.
 * Vertices every 25 m so the matcher has realistic density.
 */
export function buildRoute(legs, { start = PERTH, speed = SPEED, id = 'test' } = {}) {
  const geometry = [start];
  const steps = [];
  let cursor = start;
  let along = 0;
  legs.forEach((leg, i) => {
    const prevBrg = i > 0 ? legs[i - 1].brg : leg.brg;
    const turn = geo.angleDiff(prevBrg, leg.brg);
    const road = leg.road ?? `Road ${i + 1}`;
    const type = i === 0 ? 'depart' : 'turn';
    const modifier = i === 0 ? null : modifierFor(turn);
    const instruction = i === 0 ? `Head off on ${road}` : modifier === 'uturn' ? 'Make a U-turn' : `Turn ${modifier} onto ${road}`;
    steps.push({ index: i, type, modifier, location: cursor, along, distance: leg.dist, duration: leg.dist / speed, road, instruction });
    const n = Math.max(1, Math.round(leg.dist / VERTEX_SPACING_M));
    for (let k = 1; k <= n; k++) geometry.push(geo.destination(cursor, (leg.dist * k) / n, leg.brg));
    cursor = geometry[geometry.length - 1];
    along += leg.dist;
  });
  steps.push({ index: steps.length, type: 'arrive', modifier: null, location: cursor, along, distance: 0, duration: 0, road: '', instruction: 'You have arrived' });
  const cum = geo.cumulativeDistances(geometry);
  return {
    id, provider: 'osrm', geometry, cum, distance: cum[cum.length - 1], duration: cum[cum.length - 1] / speed,
    summary: 'test', bbox: geo.bboxOf(geometry), steps, options: {},
  };
}

/** A fix `along` metres into the route, optionally pushed sideways by `offset` metres (+ = right). */
export function fixAt(route, along, { offset = 0, speed = SPEED, t = 0, heading, accuracy = 5 } = {}) {
  const p = geo.pointAlong(route.geometry, route.cum, along);
  const point = offset ? geo.destination(p.point, Math.abs(offset), p.bearing + (offset > 0 ? 90 : -90)) : p.point;
  return { lng: point[0], lat: point[1], accuracy, speed, heading: heading ?? p.bearing, timestamp: t, simulated: true };
}

/** Clock that tests can advance. */
export function clock(start = 1_700_000_000_000) {
  let t = start;
  return { now: () => t, set: (v) => (t = v), tick: (ms = 1000) => (t += ms) };
}

/** Drive a route at `speed` m/s, one fix per second, from `from` to `to` metres. Returns all events + progresses. */
export function drive(nav, route, { from = 0, to = route.cum[route.cum.length - 1], speed = SPEED, c, offset = 0 } = {}) {
  const events = [];
  const progresses = [];
  for (let a = from; a <= to + 0.001; a += speed) {
    const t = c.tick(1000);
    const r = nav.update(fixAt(route, Math.min(a, to), { speed, t, offset }));
    events.push(...r.events.map((e) => ({ ...e, along: a })));
    progresses.push(r.progress);
  }
  return { events, progresses };
}

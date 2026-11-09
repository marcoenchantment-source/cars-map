// Pure route normalisation: every route the navigator drives goes through here so the engine
// can trust geometry, cumulative distances and step positions. Returns new objects only.
import { cumulativeDistances } from '../core/geo.js';
import { describeManeuver } from './maneuver.js';

/** Fallback cruising speed (m/s, ~50 km/h) when a route or step has no duration. */
export const DEFAULT_SPEED_MPS = 13.9;

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

function validCoord(c) {
  return Array.isArray(c) && isNum(c[0]) && isNum(c[1]) && Math.abs(c[0]) <= 180 && Math.abs(c[1]) <= 90;
}

function cleanText(v) {
  return typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : '';
}

function normalizeStep(raw, index, along) {
  const distance = isNum(raw.distance) && raw.distance >= 0 ? raw.distance : 0;
  const duration = isNum(raw.duration) && raw.duration >= 0 ? raw.duration : distance / DEFAULT_SPEED_MPS;
  const step = {
    ...raw,
    index,
    type: cleanText(raw.type) || 'continue',
    modifier: cleanText(raw.modifier) || null,
    road: cleanText(raw.road),
    along,
    distance,
    duration,
  };
  const instruction = cleanText(raw.instruction) || describeManeuver(step);
  const spoken = cleanText(raw.spoken);
  return spoken ? { ...step, instruction, spoken } : { ...step, instruction };
}

/** Steps with guaranteed, non-decreasing `along`, ending with an arrive step. */
export function normalizeSteps(steps, total) {
  const list = Array.isArray(steps) ? steps.filter((s) => s && typeof s === 'object') : [];
  const out = [];
  let expected = 0;
  let prev = 0;
  for (const raw of list) {
    const along = clamp(isNum(raw.along) ? raw.along : expected, prev, total);
    const step = normalizeStep(raw, out.length, along);
    out.push(step);
    prev = along;
    expected = along + step.distance;
  }
  if (!out.length) out.push(normalizeStep({ type: 'depart', distance: total }, 0, 0));
  if (out[out.length - 1].type !== 'arrive') {
    out.push(normalizeStep({ type: 'arrive', distance: 0, duration: 0 }, out.length, total));
  }
  return out;
}

/**
 * A drivable copy of a Route. Throws an Error with a friendly message when it cannot be driven.
 * @returns {object} route with geometry, cum, distance, duration, steps all valid
 */
export function normalizeRoute(route) {
  if (!route || !Array.isArray(route.geometry)) throw new Error('This route has no line to follow. Pick another route.');
  const geometry = route.geometry.filter(validCoord).map((c) => [c[0], c[1]]);
  if (geometry.length < 2) throw new Error('This route is too short to navigate. Pick another route.');
  const cumOk =
    geometry.length === route.geometry.length &&
    Array.isArray(route.cum) &&
    route.cum.length === geometry.length &&
    route.cum.every(isNum);
  const cum = cumOk ? [...route.cum] : cumulativeDistances(geometry);
  const total = cum[cum.length - 1];
  const distance = isNum(route.distance) && route.distance > 0 ? route.distance : total;
  const duration = isNum(route.duration) && route.duration > 0 ? route.duration : total / DEFAULT_SPEED_MPS;
  return {
    ...route,
    id: route.id ?? `route-${Math.round(total)}-${geometry.length}`,
    geometry,
    cum,
    distance,
    duration,
    steps: normalizeSteps(route.steps, total),
  };
}

/** A Place for the end of a route, used when no destination was given. */
export function endPlace(route, name = 'Destination') {
  const end = route.geometry[route.geometry.length - 1];
  return { id: `end-${end[0].toFixed(5)},${end[1].toFixed(5)}`, name, label: '', lng: end[0], lat: end[1] };
}

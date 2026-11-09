// Shared helpers that turn provider output into the app's Route/Step models (CONTRACTS.md).
// Pure functions, no DOM.
import { cumulativeDistances, bboxOf, nearestOnLine, segmentIndexAt, pointAlong } from '../core/geo.js';
import { describeStep } from './instructions.js';

const MATCH_MAX_M = 60; // a manoeuvre further than this from the line falls back to the provider's distance
let routeSeq = 0;

export function newRouteId(provider) {
  routeSeq += 1;
  return `${provider}-${Date.now().toString(36)}-${routeSeq}`;
}

const isLngLat = (c) =>
  Array.isArray(c) && Number.isFinite(c[0]) && Number.isFinite(c[1]) && Math.abs(c[0]) <= 180 && Math.abs(c[1]) <= 90;

/** New [lng,lat][] keeping only valid points and dropping exact repeats. */
export function cleanCoords(coords) {
  if (!Array.isArray(coords)) return [];
  const out = [];
  for (const c of coords) {
    if (!isLngLat(c)) continue;
    const prev = out[out.length - 1];
    if (prev && prev[0] === c[0] && prev[1] === c[1]) continue;
    out.push([c[0], c[1]]);
  }
  return out;
}

const NUMERIC_REF = /^[A-Z]?\d+[A-Z]?$/i;

/** A road's display name: its name, else its ref ("Route 2" for bare numbers). */
export function roadLabel(name, ref) {
  const n = typeof name === 'string' ? name.trim() : '';
  if (n && !NUMERIC_REF.test(n)) return n;
  const r = (typeof ref === 'string' && ref.trim()) || n;
  if (!r) return '';
  const first = r.split(/[;,/]/)[0].trim();
  return NUMERIC_REF.test(first) ? `Route ${first.toUpperCase()}` : first;
}

/** First real name in a list of names/refs (Valhalla street_names). */
export function pickName(list) {
  const names = (Array.isArray(list) ? list : []).filter((x) => typeof x === 'string' && x.trim());
  const named = names.find((x) => !NUMERIC_REF.test(x.trim()));
  return named ? named.trim() : roadLabel('', names[0] ?? '');
}

/** "via Kwinana Freeway and Leach Highway" from up to two names. */
export function formatVia(names) {
  const unique = [...new Set((names ?? []).map((x) => String(x ?? '').trim()).filter(Boolean))].slice(0, 2);
  if (unique.length === 0) return '';
  return `via ${unique.join(' and ')}`;
}

/** Summary from the two roads driven the longest, in driving order. */
export function summaryFromSteps(steps) {
  const byRoad = new Map();
  steps.forEach((s, i) => {
    if (!s.road || s.type === 'arrive') return;
    const cur = byRoad.get(s.road) ?? { first: i, distance: 0 };
    byRoad.set(s.road, { first: cur.first, distance: cur.distance + (s.distance || 0) });
  });
  const top = [...byRoad.entries()]
    .sort((a, b) => b[1].distance - a[1].distance)
    .slice(0, 2)
    .sort((a, b) => a[1].first - b[1].first)
    .map(([name]) => name);
  return formatVia(top);
}

/**
 * Metres along the route of each manoeuvre: project its location onto the line near where
 * the provider's own distances say it should be; always monotonic and within [0, total].
 * @param {number[][]} geometry
 * @param {number[]} cum
 * @param {{location?: number[], expected?: number}[]} drafts
 */
export function computeAlongs(geometry, cum, drafts) {
  const total = cum[cum.length - 1] ?? 0;
  let prevAlong = 0;
  let prevIdx = 0;
  return drafts.map((d, i) => {
    if (i === 0) return 0;
    if (i === drafts.length - 1 && d.type === 'arrive') return total;
    let along = Number.isFinite(d.expected) ? d.expected : NaN;
    if (Number.isFinite(d.exactAlong)) along = d.exactAlong;
    else if (isLngLat(d.location) && geometry.length > 1) {
      const target = Number.isFinite(along) ? along : prevAlong;
      const slack = Math.max(300, target * 0.1);
      const to = Math.max(prevIdx + 1, Math.min(geometry.length - 1, segmentIndexAt(cum, target + slack) + 1));
      const hit = nearestOnLine(geometry, cum, d.location, { from: prevIdx, to });
      if (hit && hit.dist <= MATCH_MAX_M) {
        along = hit.along;
        prevIdx = hit.index;
      }
    }
    if (!Number.isFinite(along)) along = prevAlong;
    along = Math.min(total, Math.max(prevAlong, along));
    prevAlong = along;
    return along;
  });
}

/** Final Step objects (with index, along, instruction, spoken) from provider-neutral drafts. */
export function finishSteps(geometry, cum, drafts, { destinationName = '' } = {}) {
  const alongs = computeAlongs(geometry, cum, drafts);
  return drafts.map((d, index) => {
    const along = alongs[index];
    const location = isLngLat(d.location) ? [d.location[0], d.location[1]] : (pointAlong(geometry, cum, along)?.point ?? geometry[0]);
    const text = describeStep(d, { destinationName });
    const step = {
      index,
      type: d.type,
      modifier: d.modifier ?? null,
      location,
      along,
      distance: Number.isFinite(d.distance) ? d.distance : 0,
      duration: Number.isFinite(d.duration) ? d.duration : 0,
      road: d.road ?? '',
      instruction: text.instruction,
      spoken: text.spoken,
    };
    if (Number.isFinite(d.exit) && d.exit > 0) step.exit = d.exit;
    if (d.towards) step.towards = d.towards;
    return step;
  });
}

/** Assemble a Route. Throws nothing; returns null when the geometry is unusable. */
export function buildRoute({ provider, geometry, distance, duration, durationNoTraffic, trafficDelay, drafts, summary, hasTolls, congestion, options, destinationName }) {
  const coords = cleanCoords(geometry);
  if (coords.length < 2) return null;
  const cum = cumulativeDistances(coords);
  const steps = finishSteps(coords, cum, drafts ?? [], { destinationName });
  const route = {
    id: newRouteId(provider),
    provider,
    geometry: coords,
    cum,
    distance: Number.isFinite(distance) && distance > 0 ? distance : cum[cum.length - 1],
    duration: Number.isFinite(duration) && duration >= 0 ? duration : 0,
    summary: summary || summaryFromSteps(steps),
    bbox: bboxOf(coords),
    steps,
    hasTolls: !!hasTolls,
    options: { avoidTolls: !!options?.avoidTolls, avoidMotorways: !!options?.avoidMotorways, avoidFerries: !!options?.avoidFerries },
  };
  if (Number.isFinite(durationNoTraffic)) route.durationNoTraffic = durationNoTraffic;
  if (Number.isFinite(trafficDelay)) route.trafficDelay = Math.max(0, trafficDelay);
  if (Array.isArray(congestion) && congestion.length) route.congestion = congestion;
  return route;
}

/** True when route a runs (almost) entirely along route b. */
export function isNearDuplicate(a, b, { toleranceM = 35, overlap = 0.9, samples = 24 } = {}) {
  const longer = Math.max(a.distance, b.distance) || 1;
  if (Math.abs(a.distance - b.distance) > 0.05 * longer) return false;
  const total = a.cum[a.cum.length - 1];
  let near = 0;
  for (let i = 1; i < samples; i++) {
    const p = pointAlong(a.geometry, a.cum, (total * i) / samples)?.point;
    const hit = p ? nearestOnLine(b.geometry, b.cum, p) : null;
    if (hit && hit.dist <= toleranceM) near += 1;
  }
  return near / (samples - 1) >= overlap;
}

/** Sorted by duration, near-identical alternatives removed. Returns a new array. */
export function rankRoutes(routes, { max = 3 } = {}) {
  const sorted = [...routes].filter(Boolean).sort((x, y) => x.duration - y.duration);
  const kept = [];
  for (const r of sorted) {
    if (kept.length >= max) break;
    if (!kept.some((k) => isNearDuplicate(r, k))) kept.push(r);
  }
  return kept;
}

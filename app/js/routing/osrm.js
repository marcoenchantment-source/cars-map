// OSRM (public demo server) → Route[].
// Verified 2026-11-09 against router.project-osrm.org: `exclude=` is rejected with
// 400 "Exclude flag combination is not supported", so the router sends avoid-requests to
// Valhalla first. `bearings=<deg>,45;` (empty for the destination) is accepted.
import { fetchJson, ServiceError } from './http.js';
import { buildRoute, roadLabel, formatVia } from './normalize.js';

const TYPE_MAP = Object.freeze({
  depart: 'depart',
  arrive: 'arrive',
  turn: 'turn',
  'new name': 'new-name',
  continue: 'continue',
  merge: 'merge',
  'on ramp': 'on-ramp',
  ramp: 'on-ramp',
  'off ramp': 'off-ramp',
  fork: 'fork',
  'end of road': 'end-of-road',
  'use lane': 'continue',
  roundabout: 'roundabout',
  rotary: 'rotary',
  'roundabout turn': 'roundabout',
  'exit roundabout': 'exit-roundabout',
  'exit rotary': 'exit-roundabout',
  notification: 'notification',
});

/**
 * OSRM `destinations` ("1, 7: Fremantle") → "Fremantle"; refs only → "Route 1, Route 7".
 * @param {string} dest
 */
export function destinationsText(dest) {
  if (typeof dest !== 'string' || !dest.trim()) return '';
  const [refs, names] = dest.includes(':') ? dest.split(':', 2) : [dest, ''];
  const list = (names.trim() ? names : refs)
    .split(',')
    .map((x) => (names.trim() ? x.trim() : roadLabel('', x.trim())))
    .filter(Boolean);
  return [...new Set(list)].slice(0, 2).join(', ');
}

const coordText = (c) => `${c[0].toFixed(6)},${c[1].toFixed(6)}`;

/** Request URL. bearing (deg) constrains the start direction when rerouting. */
export function buildOsrmUrl(base, from, to, { bearing, alternatives = true } = {}) {
  const params = new URLSearchParams({
    overview: 'full',
    geometries: 'geojson',
    steps: 'true',
    alternatives: alternatives ? '3' : 'false',
  });
  let url = `${base}/route/v1/driving/${coordText(from)};${coordText(to)}?${params}`;
  if (Number.isFinite(bearing)) url += `&bearings=${Math.round(((bearing % 360) + 360) % 360)},45;`;
  return url;
}

function stepDraft(s) {
  const m = s?.maneuver ?? {};
  const type = TYPE_MAP[m.type] ?? 'continue';
  return {
    type,
    modifier: typeof m.modifier === 'string' ? m.modifier : null,
    location: m.location,
    road: roadLabel(s.name, s.ref),
    towards: destinationsText(s.destinations),
    exit: Number.isInteger(m.exit) ? m.exit : undefined,
    rotaryName: typeof s.rotary_name === 'string' ? s.rotary_name : '',
    heading: m.bearing_after,
    mode: s.mode,
    distance: Number(s.distance) || 0,
    duration: Number(s.duration) || 0,
  };
}

const onlyRefs = (text) => !text || text.split(', ').every((x) => x.startsWith('Route '));

/** A nameless ramp/fork (or one signposted only with route numbers) reads better with the road it leads to. */
function borrowNextRoad(drafts) {
  return drafts.map((d, i) => {
    if (d.road || !onlyRefs(d.towards) || !['on-ramp', 'off-ramp', 'fork', 'merge'].includes(d.type)) return d;
    const next = drafts.slice(i + 1, i + 4).find((x) => x.road && !x.road.startsWith('Route '));
    return next ? { ...d, road: next.road, towards: '' } : d;
  });
}

function classesUsed(route) {
  const set = new Set();
  for (const leg of route.legs ?? []) {
    for (const s of leg.steps ?? []) {
      if (s.mode === 'ferry') set.add('ferry');
      for (const x of s.intersections ?? []) for (const c of x.classes ?? []) set.add(c);
    }
  }
  return set;
}

const FREEWAY_NAME = /\b(freeway|motorway|fwy|mwy)\b/i;

function withExpected(drafts) {
  let sum = 0;
  return drafts.map((d) => {
    const out = { ...d, expected: sum };
    sum += d.distance;
    return out;
  });
}

function parseRoute(r, { options, destinationName }) {
  const legs = Array.isArray(r?.legs) ? r.legs : [];
  const rawSteps = legs.flatMap((leg, li) => (leg.steps ?? []).filter((s) => li === legs.length - 1 || s?.maneuver?.type !== 'arrive'));
  const drafts = withExpected(borrowNextRoad(rawSteps.map(stepDraft)));
  const used = classesUsed(r);
  // The demo server sends no road classes, so "no toll class" proves nothing; names do for freeways.
  const classesKnown = [...used].some((c) => c !== 'ferry');
  const freeway = used.has('motorway') || drafts.some((d) => FREEWAY_NAME.test(d.road));
  const summaryNames = legs.map((l) => l.summary).join(', ').split(',');
  return buildRoute({
    provider: 'osrm',
    geometry: r?.geometry?.coordinates,
    distance: Number(r?.distance),
    duration: Number(r?.duration),
    drafts,
    summary: formatVia(summaryNames),
    hasTolls: used.has('toll'),
    // OSRM can't avoid anything here; only claim what this route provably avoids.
    options: {
      avoidTolls: !!options?.avoidTolls && classesKnown && !used.has('toll'),
      avoidMotorways: !!options?.avoidMotorways && !freeway,
      avoidFerries: !!options?.avoidFerries && !used.has('ferry'),
    },
    destinationName,
  });
}

/** Parse an OSRM /route response into Route[]. Throws ServiceError on error codes. */
export function parseOsrm(json, ctx = {}) {
  if (!json || typeof json !== 'object') throw new ServiceError('The route service sent an answer we couldn’t read.', { code: 'bad-response' });
  if (json.code !== 'Ok') {
    const noRoute = ['NoRoute', 'NoSegment', 'NoMatch'].includes(json.code);
    throw new ServiceError(noRoute ? 'No driving route found to there.' : 'The route service couldn’t plan this trip.', { code: noRoute ? 'no-route' : 'bad-response' });
  }
  if (!Array.isArray(json.routes)) throw new ServiceError('The route service sent an answer we couldn’t read.', { code: 'bad-response' });
  return json.routes.map((r) => parseRoute(r, ctx)).filter(Boolean);
}

/** Fetch + parse. */
export async function routeOsrm({ base, from, to, options, bearing, alternatives, signal, timeoutMs, destinationName, fetchImpl }) {
  const url = buildOsrmUrl(base, from, to, { bearing, alternatives });
  let json;
  try {
    json = await fetchJson(url, { signal, timeoutMs, service: 'The route service', fetchImpl });
  } catch (err) {
    // OSRM answers 400 with {code:'NoRoute'|'NoSegment'} for unroutable points.
    if (err?.body?.code) return parseOsrm(err.body, { options, destinationName });
    throw err;
  }
  return parseOsrm(json, { options, destinationName });
}

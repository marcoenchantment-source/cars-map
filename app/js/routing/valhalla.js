// Valhalla (valhalla1.openstreetmap.de) → Route[]. Handles the avoid options OSRM can't.
import { decodePolyline, cumulativeDistances } from '../core/geo.js';
import { fetchJson, ServiceError } from './http.js';
import { buildRoute, cleanCoords, pickName } from './normalize.js';

/** Valhalla maneuver type → [our type, modifier]. */
const TYPE_MAP = Object.freeze({
  1: ['depart', null], 2: ['depart', 'right'], 3: ['depart', 'left'],
  4: ['arrive', null], 5: ['arrive', 'right'], 6: ['arrive', 'left'],
  7: ['new-name', 'straight'], 8: ['continue', 'straight'],
  9: ['turn', 'slight right'], 10: ['turn', 'right'], 11: ['turn', 'sharp right'],
  12: ['uturn', 'uturn'], 13: ['uturn', 'uturn'],
  14: ['turn', 'sharp left'], 15: ['turn', 'left'], 16: ['turn', 'slight left'],
  17: ['on-ramp', 'straight'], 18: ['on-ramp', 'right'], 19: ['on-ramp', 'left'],
  20: ['off-ramp', 'slight right'], 21: ['off-ramp', 'slight left'],
  22: ['fork', 'straight'], 23: ['fork', 'slight right'], 24: ['fork', 'slight left'],
  25: ['merge', 'straight'], 26: ['roundabout', null], 27: ['exit-roundabout', null],
  28: ['notification', null], 29: ['notification', null],
  37: ['merge', 'slight right'], 38: ['merge', 'slight left'],
});

const texts = (list) => (Array.isArray(list) ? list.map((x) => (typeof x?.text === 'string' ? x.text.trim() : '')).filter(Boolean) : []);

/** Request body. bearing (deg) sets the start heading when rerouting. */
export function buildValhallaRequest(from, to, { options = {}, bearing, alternatives = true } = {}) {
  const start = { lat: from[1], lon: from[0], type: 'break' };
  if (Number.isFinite(bearing)) Object.assign(start, { heading: Math.round(((bearing % 360) + 360) % 360), heading_tolerance: 45 });
  return {
    locations: [start, { lat: to[1], lon: to[0], type: 'break' }],
    costing: 'auto',
    costing_options: {
      auto: {
        use_tolls: options.avoidTolls ? 0 : 0.5,
        use_highways: options.avoidMotorways ? 0 : 1,
        use_ferry: options.avoidFerries ? 0 : 0.5,
      },
    },
    alternates: alternatives ? 2 : 0,
    units: 'kilometers',
    language: 'en-US',
  };
}

function maneuverDraft(m, next, ctx) {
  const [type, modifier] = TYPE_MAP[m?.type] ?? ['continue', 'straight'];
  const sign = m?.sign ?? {};
  let road = pickName([...(m?.begin_street_names ?? []), ...(m?.street_names ?? [])]);
  const branch = pickName(texts(sign.exit_branch_elements));
  if ((!road || road.startsWith('Route ')) && branch && !branch.startsWith('Route ')) road = branch;
  const draft = {
    type,
    modifier,
    road,
    towards: [...new Set(texts(sign.exit_toward_elements))].slice(0, 2).join(', '),
    heading: m?.bearing_after,
    mode: m?.travel_type === 'ferry' || m?.type === 28 ? 'ferry' : 'driving',
    distance: (Number(m?.length) || 0) * ctx.unitM,
    duration: Number(m?.time) || 0,
    exactAlong: ctx.cum ? ctx.cum[Math.min(ctx.cum.length - 1, ctx.offset + (m?.begin_shape_index ?? 0))] : undefined,
    location: ctx.geometry[Math.min(ctx.geometry.length - 1, ctx.offset + (m?.begin_shape_index ?? 0))],
  };
  if (type === 'off-ramp') {
    const exitNo = Number.parseInt(texts(sign.exit_number_elements)[0], 10);
    if (Number.isFinite(exitNo)) draft.exit = exitNo;
  }
  if (type === 'roundabout') {
    draft.exit = Number.isInteger(m?.roundabout_exit_count) ? m.roundabout_exit_count : undefined;
    const exitRoad = next?.type === 27 ? pickName([...(next.begin_street_names ?? []), ...(next.street_names ?? [])]) : '';
    if (exitRoad && exitRoad !== road) draft.rotaryName = road;
    draft.road = exitRoad || '';
  }
  return draft;
}

function parseTrip(trip, { options, destinationName }) {
  const legs = Array.isArray(trip?.legs) ? trip.legs : [];
  const unitM = trip?.units === 'miles' ? 1609.344 : 1000;
  // Keep the raw decoded shape so begin_shape_index lines up; buildRoute cleans it later
  // (dropping repeated points never changes distances along the line).
  const geometry = [];
  const parts = [];
  for (const leg of legs) {
    if (typeof leg?.shape !== 'string') continue;
    const pts = decodePolyline(leg.shape, 6);
    const offset = geometry.length ? geometry.length - 1 : 0;
    geometry.push(...(geometry.length ? pts.slice(1) : pts));
    parts.push({ leg, offset });
  }
  if (cleanCoords(geometry).length < 2) return null;
  const cum = cumulativeDistances(geometry);
  const drafts = parts.flatMap(({ leg, offset }, li) => {
    const ms = Array.isArray(leg.maneuvers) ? leg.maneuvers : [];
    return ms
      .map((m, i) => ({ m, next: ms[i + 1] }))
      .filter(({ m }) => li === parts.length - 1 || ![4, 5, 6].includes(m?.type))
      .map(({ m, next }) => maneuverDraft(m, next, { unitM, offset, geometry, cum }));
  });
  const s = trip.summary ?? {};
  return buildRoute({
    provider: 'valhalla',
    geometry,
    distance: (Number(s.length) || 0) * unitM,
    duration: Number(s.time),
    drafts,
    hasTolls: !!s.has_toll,
    options: {
      avoidTolls: !!options?.avoidTolls && !s.has_toll,
      avoidMotorways: !!options?.avoidMotorways && !s.has_highway,
      avoidFerries: !!options?.avoidFerries && !s.has_ferry,
    },
    destinationName,
  });
}

/** Parse a Valhalla /route response (trip + alternates) into Route[]. */
export function parseValhalla(json, ctx = {}) {
  if (!json || typeof json !== 'object') throw new ServiceError('The route service sent an answer we couldn’t read.', { code: 'bad-response' });
  if (json.error_code || json.error) {
    const noRoute = [171, 442, 443].includes(Number(json.error_code));
    throw new ServiceError(noRoute ? 'No driving route found to there.' : 'The route service couldn’t plan this trip.', { code: noRoute ? 'no-route' : 'bad-response' });
  }
  const trips = [json.trip, ...(Array.isArray(json.alternates) ? json.alternates.map((a) => a?.trip) : [])].filter((t) => t && Array.isArray(t.legs));
  if (!trips.length) throw new ServiceError('The route service sent an answer we couldn’t read.', { code: 'bad-response' });
  return trips.map((t) => parseTrip(t, ctx)).filter(Boolean);
}

/** Fetch + parse. */
export async function routeValhalla({ base, from, to, options, bearing, alternatives, signal, timeoutMs, destinationName, fetchImpl }) {
  const body = buildValhallaRequest(from, to, { options, bearing, alternatives });
  let json;
  try {
    json = await fetchJson(`${base}/route`, { method: 'POST', body, signal, timeoutMs, service: 'The route service', fetchImpl });
  } catch (err) {
    if (err?.body?.error_code) return parseValhalla(err.body, { options, destinationName });
    throw err;
  }
  return parseValhalla(json, { options, destinationName });
}

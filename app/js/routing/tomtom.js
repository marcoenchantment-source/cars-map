// TomTom Routing API (only with the driver's own key) → Route[] with live traffic.
// Written from TomTom's documented calculateRoute response; never log the URL (it holds the key).
import { cumulativeDistances } from '../core/geo.js';
import { fetchJson, ServiceError } from './http.js';
import { buildRoute, roadLabel } from './normalize.js';

/** TomTom maneuver code → [our type, modifier]. */
const MANEUVERS = Object.freeze({
  DEPART: ['depart', null],
  ARRIVE: ['arrive', null], ARRIVE_LEFT: ['arrive', 'left'], ARRIVE_RIGHT: ['arrive', 'right'],
  WAYPOINT_REACHED: ['notification', null], WAYPOINT_LEFT: ['notification', null], WAYPOINT_RIGHT: ['notification', null],
  STRAIGHT: ['continue', 'straight'], FOLLOW: ['continue', 'straight'],
  KEEP_LEFT: ['fork', 'slight left'], KEEP_RIGHT: ['fork', 'slight right'],
  BEAR_LEFT: ['turn', 'slight left'], BEAR_RIGHT: ['turn', 'slight right'],
  TURN_LEFT: ['turn', 'left'], TURN_RIGHT: ['turn', 'right'],
  SHARP_LEFT: ['turn', 'sharp left'], SHARP_RIGHT: ['turn', 'sharp right'],
  MAKE_UTURN: ['uturn', 'uturn'], TRY_MAKE_UTURN: ['uturn', 'uturn'],
  ENTER_MOTORWAY: ['on-ramp', null], ENTER_FREEWAY: ['on-ramp', null], ENTER_HIGHWAY: ['on-ramp', null], ENTRANCE_RAMP: ['on-ramp', null],
  TAKE_EXIT: ['off-ramp', null], MOTORWAY_EXIT_LEFT: ['off-ramp', 'slight left'], MOTORWAY_EXIT_RIGHT: ['off-ramp', 'slight right'],
  ROUNDABOUT_CROSS: ['roundabout', 'straight'], ROUNDABOUT_LEFT: ['roundabout', 'left'], ROUNDABOUT_RIGHT: ['roundabout', 'right'], ROUNDABOUT_BACK: ['roundabout', 'uturn'],
  TAKE_FERRY: ['notification', null],
  SWITCH_PARALLEL_ROAD: ['continue', 'straight'], SWITCH_MAIN_ROAD: ['continue', 'straight'],
});

const AVOID = [['avoidTolls', 'tollRoads'], ['avoidMotorways', 'motorways'], ['avoidFerries', 'ferries']];

/** Request URL (contains the key: never log it). */
export function buildTomTomUrl(base, key, from, to, { options = {}, bearing, alternatives = true, language = 'en-AU' } = {}) {
  const locs = `${from[1].toFixed(6)},${from[0].toFixed(6)}:${to[1].toFixed(6)},${to[0].toFixed(6)}`;
  const p = new URLSearchParams({
    key,
    traffic: 'true',
    travelMode: 'car',
    routeType: 'fastest',
    maxAlternatives: alternatives ? '2' : '0',
    instructionsType: 'text',
    language,
    computeTravelTimeFor: 'all',
  });
  p.append('sectionType', 'traffic');
  p.append('sectionType', 'tollRoad');
  for (const [opt, value] of AVOID) if (options[opt]) p.append('avoid', value);
  if (Number.isFinite(bearing)) p.set('vehicleHeading', String(Math.round(((bearing % 360) + 360) % 360)));
  return `${base}/routing/1/calculateRoute/${locs}/json?${p}`;
}

/** TRAFFIC section → congestion level. magnitudeOfDelay: 0 unknown, 1 minor, 2 moderate, 3 major, 4 undefined/closure. */
export function trafficLevel(section) {
  if (section?.simpleCategory === 'ROAD_CLOSURE' || section?.magnitudeOfDelay === 4) return 'closed';
  if (section?.magnitudeOfDelay === 3) return 'heavy';
  return 'slow';
}

const toLngLat = (p) => (Number.isFinite(p?.longitude) && Number.isFinite(p?.latitude) ? [p.longitude, p.latitude] : null);

function instructionDraft(ins, next, geometry, cum) {
  const [type, fallbackMod] = MANEUVERS[ins?.maneuver] ?? ['continue', 'straight'];
  const angle = Number(ins?.turnAngleInDecimalDegrees);
  let modifier = fallbackMod;
  if (!modifier && Number.isFinite(angle) && ['on-ramp', 'off-ramp'].includes(type)) modifier = angle < -10 ? 'slight left' : angle > 10 ? 'slight right' : 'straight';
  const idx = Number.isInteger(ins?.pointIndex) && ins.pointIndex >= 0 && ins.pointIndex < geometry.length ? ins.pointIndex : null;
  const offset = Number(ins?.routeOffsetInMeters);
  const nextOffset = Number(next?.routeOffsetInMeters);
  const numbers = Array.isArray(ins?.roadNumbers) ? ins.roadNumbers.filter((x) => typeof x === 'string') : [];
  const draft = {
    type,
    modifier,
    road: roadLabel(typeof ins?.street === 'string' ? ins.street : '', numbers[0] ?? ''),
    towards: typeof ins?.signpostText === 'string' ? ins.signpostText.trim() : '',
    location: toLngLat(ins?.point) ?? (idx != null ? geometry[idx] : undefined),
    exactAlong: idx != null ? cum[idx] : undefined,
    expected: Number.isFinite(offset) ? offset : undefined,
    distance: Number.isFinite(nextOffset) && Number.isFinite(offset) ? Math.max(0, nextOffset - offset) : 0,
    duration: Math.max(0, (Number(next?.travelTimeInSeconds) || 0) - (Number(ins?.travelTimeInSeconds) || 0)),
    mode: ins?.maneuver === 'TAKE_FERRY' ? 'ferry' : 'driving',
  };
  if (type === 'roundabout' && Number.isInteger(ins?.roundaboutExitNumber)) draft.exit = ins.roundaboutExitNumber;
  if (type === 'off-ramp' && Number.parseInt(ins?.exitNumber, 10) > 0) draft.exit = Number.parseInt(ins.exitNumber, 10);
  return draft;
}

function congestionOf(sections, geometry) {
  return sections
    .filter((s) => s?.sectionType === 'TRAFFIC' && Number.isInteger(s.startPointIndex) && Number.isInteger(s.endPointIndex))
    .map((s) => ({ coords: geometry.slice(Math.max(0, s.startPointIndex), Math.min(geometry.length, s.endPointIndex + 1)), level: trafficLevel(s) }))
    .filter((c) => c.coords.length > 1);
}

function parseRoute(r, { options, destinationName }) {
  const geometry = (Array.isArray(r?.legs) ? r.legs : []).flatMap((leg) => (Array.isArray(leg?.points) ? leg.points : []).map(toLngLat)).filter(Boolean);
  if (geometry.length < 2) return null;
  const cum = cumulativeDistances(geometry);
  const list = Array.isArray(r?.guidance?.instructions) ? r.guidance.instructions : [];
  const drafts = list.map((ins, i) => instructionDraft(ins, list[i + 1], geometry, cum));
  const sections = Array.isArray(r?.sections) ? r.sections : [];
  const s = r?.summary ?? {};
  const hasTolls = sections.some((x) => x?.sectionType === 'TOLL_ROAD');
  return buildRoute({
    provider: 'tomtom',
    geometry,
    distance: Number(s.lengthInMeters),
    duration: Number(s.travelTimeInSeconds),
    durationNoTraffic: Number(s.noTrafficTravelTimeInSeconds),
    trafficDelay: Number(s.trafficDelayInSeconds),
    drafts,
    hasTolls,
    congestion: congestionOf(sections, geometry),
    options: { avoidTolls: !!options?.avoidTolls && !hasTolls, avoidMotorways: !!options?.avoidMotorways, avoidFerries: !!options?.avoidFerries },
    destinationName,
  });
}

/** Parse a calculateRoute response into Route[]. */
export function parseTomTom(json, ctx = {}) {
  if (!json || typeof json !== 'object' || !Array.isArray(json.routes)) {
    throw new ServiceError('Live traffic routing sent an answer we couldn’t read.', { code: 'bad-response' });
  }
  return json.routes.map((r) => parseRoute(r, ctx)).filter(Boolean);
}

/** Fetch + parse. Retries once in en-GB if TomTom rejects the language. */
export async function routeTomTom({ base, key, from, to, options, bearing, alternatives, signal, timeoutMs, destinationName, fetchImpl }) {
  if (!key) throw new ServiceError('No TomTom key set.', { code: 'no-key' });
  const opts = { signal, timeoutMs, service: 'Live traffic routing', fetchImpl };
  let json;
  try {
    json = await fetchJson(buildTomTomUrl(base, key, from, to, { options, bearing, alternatives }), opts);
  } catch (err) {
    const msg = JSON.stringify(err?.body ?? '').toLowerCase();
    if (err?.status === 400 && msg.includes('language')) {
      json = await fetchJson(buildTomTomUrl(base, key, from, to, { options, bearing, alternatives, language: 'en-GB' }), opts);
    } else if (err?.status === 403 || err?.status === 401) {
      throw new ServiceError('Live traffic routing was refused.', { code: 'http', status: err.status });
    } else {
      throw err;
    }
  }
  return parseTomTom(json, { options, destinationName });
}

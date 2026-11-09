// Route planning: TomTom (with the driver's key) → OSRM → Valhalla, each with a 10 s timeout.
// Avoid-options go to Valhalla first because the public OSRM server can't exclude roads.
import { ServiceError, isAbort } from './http.js';
import { rankRoutes } from './normalize.js';
import { routeOsrm } from './osrm.js';
import { routeValhalla } from './valhalla.js';
import { routeTomTom } from './tomtom.js';

export const ROUTE_TIMEOUT_MS = 10000;

const PROVIDERS = Object.freeze({
  tomtom: (a) => routeTomTom({ ...a, base: a.endpoints.tomtom, key: a.settings.tomtomKey }),
  osrm: (a) => routeOsrm({ ...a, base: a.endpoints.osrm }),
  valhalla: (a) => routeValhalla({ ...a, base: a.endpoints.valhalla }),
});

const validPoint = (p) => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1]) && Math.abs(p[0]) <= 180 && Math.abs(p[1]) <= 90;

/** [lng,lat] from a Place or a coordinate pair, or null. */
export function toLngLat(target) {
  if (validPoint(target)) return [target[0], target[1]];
  if (target && Number.isFinite(target.lng) && Number.isFinite(target.lat)) return validPoint([target.lng, target.lat]) ? [target.lng, target.lat] : null;
  return null;
}

/** Avoid options from settings. */
export function avoidOptions(settings = {}) {
  return { avoidTolls: !!settings.avoidTolls, avoidMotorways: !!settings.avoidMotorways, avoidFerries: !!settings.avoidFerries };
}

/** Provider order for these settings. */
export function providerChain(settings = {}) {
  const o = avoidOptions(settings);
  const chain = settings.tomtomKey ? ['tomtom'] : [];
  return chain.concat(o.avoidTolls || o.avoidMotorways || o.avoidFerries ? ['valhalla', 'osrm'] : ['osrm', 'valhalla']);
}

function finalError(errors) {
  if (errors.length && errors.every((e) => e.code === 'no-route')) {
    return new ServiceError('Couldn’t find a driving route to there. Try a spot closer to a road.', { code: 'no-route' });
  }
  return new ServiceError('Couldn’t get a route right now. Check your signal and try again.', { code: errors.at(-1)?.code ?? 'network' });
}

/**
 * Plan routes.
 * @param {number[]} from [lng,lat]
 * @param {object|number[]} to Place or [lng,lat]
 * @param {{settings: object, endpoints: object, bearing?: number, alternatives?: boolean,
 *          signal?: AbortSignal, timeoutMs?: number, fetchImpl?: Function, providers?: object}} opts
 * @returns {Promise<object[]>} Route[] sorted by duration, near-duplicates removed
 */
export async function computeRoutes(from, to, opts = {}) {
  const start = toLngLat(from);
  const end = toLngLat(to);
  if (!start || !end) throw new ServiceError('That place has no usable location. Pick it again from search.', { code: 'bad-input' });
  const settings = opts.settings ?? {};
  const providers = opts.providers ?? PROVIDERS;
  const alternatives = opts.alternatives !== false;
  const args = {
    from: start,
    to: end,
    settings,
    endpoints: opts.endpoints ?? {},
    options: avoidOptions(settings),
    bearing: Number.isFinite(opts.bearing) ? opts.bearing : undefined,
    alternatives,
    signal: opts.signal,
    timeoutMs: opts.timeoutMs ?? ROUTE_TIMEOUT_MS,
    fetchImpl: opts.fetchImpl,
    destinationName: typeof to?.name === 'string' ? to.name : '',
  };
  const errors = [];
  for (const name of providerChain(settings)) {
    try {
      const routes = await providers[name](args);
      const ranked = rankRoutes(routes, { max: alternatives ? 3 : 1 });
      if (ranked.length) return ranked;
      errors.push(new ServiceError('No route', { code: 'no-route' }));
    } catch (err) {
      if (isAbort(err)) throw err;
      errors.push(err);
      console.warn(`[routing] ${name} failed (${err?.code ?? 'error'}): ${err?.message ?? err}`);
    }
  }
  throw finalError(errors);
}

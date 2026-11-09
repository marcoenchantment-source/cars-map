// The saved-trips list: loads once, saves through ctx.storage under the budget, and tells
// subscribers (map layer, logbook) whenever it changes. DOM-free; storage is injected.
import { TRIP_LIMITS, capTrips, removeTrip, sanitizeTrips, upsertTrip } from './tripsModel.js';

export const TRIPS_KEY = 'trips';

/**
 * @param {{load: Function, save: Function}} storage ctx.storage (or a test double)
 * @param {{maxTrips?: number, maxChars?: number}} [limits]
 */
export function createTripStore(storage, limits = TRIP_LIMITS) {
  let trips = Object.freeze(capTrips(sanitizeTrips(storage.load(TRIPS_KEY, [])), limits));
  const listeners = new Set();

  function notify() {
    for (const fn of [...listeners]) {
      try {
        fn(trips);
      } catch (err) {
        console.error('[history] trips listener failed', err);
      }
    }
  }

  /** Persist; if the browser quota is hit (other modules share it), retry with fewer trips. */
  function persist(next) {
    let list = capTrips(next, limits);
    if (storage.save(TRIPS_KEY, list)) return list;
    const smaller = { ...limits, maxChars: Math.floor((limits.maxChars ?? TRIP_LIMITS.maxChars) * 0.6) };
    list = capTrips(list, smaller);
    if (!storage.save(TRIPS_KEY, list)) console.warn('[history] could not save the logbook');
    return list;
  }

  function commit(next) {
    trips = Object.freeze(persist(next));
    notify();
    return trips;
  }

  return Object.freeze({
    list: () => trips,
    get: (id) => trips.find((t) => t.id === id) ?? null,
    upsert: (trip) => commit(upsertTrip(trips, trip)),
    remove: (id) => commit(removeTrip(trips, id)),
    /** Replace one trip with fn(trip) (fn must return a new object). No-op if missing. */
    update(id, fn) {
      const current = trips.find((t) => t.id === id);
      if (!current) return trips;
      return commit(upsertTrip(trips, fn(current)));
    },
    /** fn(trips) after every change. Returns unsubscribe. */
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  });
}

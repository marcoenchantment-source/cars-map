// Pure-ish feedback list handling (storage key 'feedback': newest first, at most 100 entries).

export const FEEDBACK_KEY = 'feedback';
export const FEEDBACK_MAX = 100;

/** Build a compact feedback entry (no GPS track: it stays small). */
export function feedbackEntry({ trip, destination, route, rating, notes }) {
  return {
    id: `trip-${trip.startedAt}`,
    at: trip.endedAt,
    rating: Number.isInteger(rating) ? Math.max(0, Math.min(5, rating)) : 0,
    notes: String(notes ?? '').trim(),
    destination: destination
      ? { name: String(destination.name ?? ''), label: String(destination.label ?? ''), lng: destination.lng, lat: destination.lat }
      : null,
    route: route ? { id: route.id ?? null, provider: route.provider ?? null, distance: route.distance, duration: route.duration } : null,
    trip: {
      startedAt: trip.startedAt, endedAt: trip.endedAt, distance: trip.distance, duration: trip.duration,
      avgSpeed: trip.avgSpeed, maxSpeed: trip.maxSpeed, reroutes: trip.reroutes ?? 0, simulated: !!trip.simulated,
    },
  };
}

/** New list with `entry` first (replacing any entry with the same id), capped. */
export function upsertFeedback(list, entry, max = FEEDBACK_MAX) {
  const safe = Array.isArray(list) ? list.filter((e) => e && typeof e === 'object' && e.id !== entry.id) : [];
  return [entry, ...safe].slice(0, max);
}

/** Save through the app's storage wrapper ({load, save}). Returns true on success. */
export function saveFeedback(storage, info) {
  const entry = feedbackEntry(info);
  return storage.save(FEEDBACK_KEY, upsertFeedback(storage.load(FEEDBACK_KEY, []), entry));
}

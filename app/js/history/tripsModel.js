// Pure trip-list helpers: validation of stored data, upsert/remove, and the storage budget.
// Trips are kept newest first. No DOM, no storage access: safe to unit test under Node.

/** localStorage is ~5 MB shared by every module, so the logbook keeps itself to about half. */
export const TRIP_LIMITS = Object.freeze({
  maxTrips: 250,
  /** Budget in JSON characters (localStorage quotas count string length). */
  maxChars: 2.5 * 1024 * 1024,
  maxNameLength: 48,
});

const isFiniteNum = (v) => typeof v === 'number' && Number.isFinite(v);

function isCoord(c) {
  return (
    Array.isArray(c) &&
    c.length >= 2 &&
    isFiniteNum(c[0]) &&
    isFiniteNum(c[1]) &&
    Math.abs(c[0]) <= 180 &&
    Math.abs(c[1]) <= 90
  );
}

/** Trim a place name to something that fits a list row. Returns '' for anything unusable. */
export function cleanName(value, max = TRIP_LIMITS.maxNameLength) {
  if (typeof value !== 'string') return '';
  const s = value.replace(/\s+/g, ' ').trim();
  return s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s;
}

/** A trip that is safe to draw and list, or null. Unknown fields are dropped. */
export function sanitizeTrip(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const { id, startedAt, endedAt, distance, duration, maxSpeed, line } = raw;
  if (typeof id !== 'string' || !id) return null;
  if (!isFiniteNum(startedAt) || !isFiniteNum(endedAt) || endedAt < startedAt) return null;
  if (!isFiniteNum(distance) || distance < 0) return null;
  if (!Array.isArray(line) || line.length < 2 || !line.every(isCoord)) return null;
  const trip = {
    id,
    startedAt,
    endedAt,
    distance,
    duration: isFiniteNum(duration) && duration >= 0 ? duration : (endedAt - startedAt) / 1000,
    maxSpeed: isFiniteNum(maxSpeed) && maxSpeed >= 0 ? maxSpeed : 0,
    line: line.map((c) => [c[0], c[1]]),
  };
  const from = cleanName(raw.from);
  const to = cleanName(raw.to);
  return { ...trip, ...(from ? { from } : {}), ...(to ? { to } : {}) };
}

/** Validate a stored list: drops bad entries and duplicates, sorts newest first. */
export function sanitizeTrips(raw) {
  if (!Array.isArray(raw)) return [];
  const seen = new Set();
  const out = [];
  for (const item of raw) {
    const trip = sanitizeTrip(item);
    if (!trip || seen.has(trip.id)) continue;
    seen.add(trip.id);
    out.push(trip);
  }
  return out.sort((a, b) => b.startedAt - a.startedAt);
}

/** JSON size of one trip inside the stored array (plus its comma). */
export function tripChars(trip) {
  return JSON.stringify(trip).length + 1;
}

/**
 * Keep the newest trips that fit both the count and the character budget.
 * @param {object[]} trips newest first
 * @param {{maxTrips?: number, maxChars?: number}} [limits]
 * @returns {object[]} a new array (the input is untouched)
 */
export function capTrips(trips, limits = {}) {
  const maxTrips = limits.maxTrips ?? TRIP_LIMITS.maxTrips;
  const maxChars = limits.maxChars ?? TRIP_LIMITS.maxChars;
  const out = [];
  let chars = 2; // the [] brackets
  for (const trip of trips) {
    if (out.length >= maxTrips) break;
    const size = tripChars(trip);
    if (chars + size > maxChars) break;
    chars += size;
    out.push(trip);
  }
  return out;
}

/** Insert or replace a trip (matched by id), keeping newest first. */
export function upsertTrip(trips, trip) {
  const rest = trips.filter((t) => t.id !== trip.id);
  return [...rest, trip].sort((a, b) => b.startedAt - a.startedAt);
}

export function removeTrip(trips, id) {
  return trips.filter((t) => t.id !== id);
}

/** New trip with the given place names merged in (empty names are ignored). */
export function withPlaceNames(trip, { from, to } = {}) {
  const f = cleanName(from);
  const t = cleanName(to);
  return { ...trip, ...(f ? { from: f } : {}), ...(t ? { to: t } : {}) };
}

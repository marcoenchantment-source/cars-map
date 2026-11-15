// Pure saved-track helpers: validation, budget, best-lap updates. Stored under ctx.storage 'tracks'.
export const TRACK_LIMITS = Object.freeze({ maxTracks: 20, maxChars: 900 * 1024, maxNameLength: 40, maxLaps: 50 });

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const isCoord = (c) => Array.isArray(c) && isNum(c[0]) && isNum(c[1]) && Math.abs(c[0]) <= 180 && Math.abs(c[1]) <= 90;

export function cleanTrackName(v, max = TRACK_LIMITS.maxNameLength) {
  if (typeof v !== 'string') return '';
  const s = v.replace(/\s+/g, ' ').trim();
  return s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s;
}

export function sanitizeTrack(raw) {
  if (!raw || typeof raw !== 'object' || typeof raw.id !== 'string' || !raw.id) return null;
  const { line, start } = raw;
  if (!Array.isArray(line) || line.length < 3 || !line.every(isCoord)) return null;
  if (!start || !isCoord(start.point) || !isNum(start.heading)) return null;
  const bbox = Array.isArray(raw.bbox) && raw.bbox.length === 4 && raw.bbox.every(isNum) ? [...raw.bbox] : null;
  if (!bbox) return null;
  return {
    id: raw.id,
    name: cleanTrackName(raw.name) || 'My track',
    createdAt: isNum(raw.createdAt) ? raw.createdAt : 0,
    line: line.map((c) => [c[0], c[1]]),
    start: { point: [start.point[0], start.point[1]], heading: start.heading },
    length: isNum(raw.length) ? raw.length : 0,
    bbox,
    bestLap: isNum(raw.bestLap) && raw.bestLap > 0 ? raw.bestLap : null,
    bestLapAt: isNum(raw.bestLapAt) ? raw.bestLapAt : null,
    laps: sanitizeLaps(raw.laps),
    anyDirection: raw.anyDirection === true,
    country: cleanTrackName(raw.country) || '',
    source: raw.source === 'osm' ? 'osm' : 'recorded',
  };
}

/** Lap history [{ms, at}] oldest first, at most TRACK_LIMITS.maxLaps. */
export function sanitizeLaps(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((l) => l && isNum(l.ms) && l.ms > 0 && l.ms < 6 * 3600 * 1000 && isNum(l.at))
    .slice(-TRACK_LIMITS.maxLaps)
    .map((l) => ({ ms: Math.round(l.ms), at: l.at }));
}

/** Lap stats for the history view: count, best, average and the laps newest first. */
export function lapStats(track) {
  const laps = track?.laps ?? [];
  if (!laps.length) return { count: 0, best: track?.bestLap ?? null, average: null, newestFirst: [] };
  const average = Math.round(laps.reduce((sum, l) => sum + l.ms, 0) / laps.length);
  return { count: laps.length, best: track.bestLap ?? Math.min(...laps.map((l) => l.ms)), average, newestFirst: [...laps].reverse() };
}

export function sanitizeTracks(raw) {
  if (!Array.isArray(raw)) return [];
  const seen = new Set();
  const out = [];
  for (const item of raw) {
    const t = sanitizeTrack(item);
    if (!t || seen.has(t.id)) continue;
    seen.add(t.id);
    out.push(t);
  }
  return out.sort((a, b) => b.createdAt - a.createdAt);
}

/** Newest tracks within the count and character budget. */
export function capTracks(tracks, limits = TRACK_LIMITS) {
  const out = [];
  let chars = 2;
  for (const t of tracks) {
    if (out.length >= limits.maxTracks) break;
    const size = JSON.stringify(t).length + 1;
    if (chars + size > limits.maxChars) break;
    chars += size;
    out.push(t);
  }
  return out;
}

export function upsertTrack(tracks, track) {
  return [...tracks.filter((t) => t.id !== track.id), track].sort((a, b) => b.createdAt - a.createdAt);
}

export function removeTrack(tracks, id) {
  return tracks.filter((t) => t.id !== id);
}

/** New track with the lap added to its history, and as best lap when it's the quickest. */
export function withLap(track, ms, at) {
  if (!isNum(ms) || ms <= 0) return track;
  const laps = [...(track.laps ?? []), { ms: Math.round(ms), at }].slice(-TRACK_LIMITS.maxLaps);
  const isBest = track.bestLap == null || ms < track.bestLap;
  return { ...track, laps, ...(isBest ? { bestLap: ms, bestLapAt: at } : {}) };
}

/** "Track 3" style default name not already taken. */
export function nextTrackName(tracks) {
  const names = new Set(tracks.map((t) => t.name));
  let n = tracks.length + 1;
  while (names.has(`Track ${n}`)) n++;
  return `Track ${n}`;
}

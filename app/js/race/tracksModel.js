// Pure saved-track helpers: validation, budget, best-lap updates. Stored under ctx.storage 'tracks'.
export const TRACK_LIMITS = Object.freeze({ maxTracks: 20, maxChars: 600 * 1024, maxNameLength: 40 });

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
  };
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

/** New track with the lap recorded if it beats the stored best. */
export function withLap(track, ms, at) {
  if (!isNum(ms) || (track.bestLap != null && track.bestLap <= ms)) return track;
  return { ...track, bestLap: ms, bestLapAt: at };
}

/** "Track 3" style default name not already taken. */
export function nextTrackName(tracks) {
  const names = new Set(tracks.map((t) => t.name));
  let n = tracks.length + 1;
  while (names.has(`Track ${n}`)) n++;
  return `Track ${n}`;
}

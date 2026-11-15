// World tracks: turning OpenStreetMap race-track pieces into one lap (used by the build script),
// plus loading and searching the generated catalogue in the app. Pure helpers + one loader.
import { haversine, bearing, simplify, bboxOf } from '../core/geo.js';

export const WORLD = Object.freeze({
  joinM: 12, // two pieces join when their ends are this close
  minLapM: 600,
  maxLapM: 30000,
  simplifyM: 4,
});

const lengthOf = (coords) => {
  let m = 0;
  for (let i = 1; i < coords.length; i++) m += haversine(coords[i - 1], coords[i]);
  return m;
};
const round6 = (v) => Math.round(v * 1e6) / 1e6;

/** Drop pit lanes, paddock roads and karting tracks (karting only when nothing else exists). */
export function racingWays(ways) {
  const usable = ways.filter((w) => {
    if (!Array.isArray(w.coords) || w.coords.length < 2) return false;
    const tags = w.tags ?? {};
    const text = Object.entries(tags).map(([k, v]) => `${k}=${v}`).join(' ');
    if (/pit|paddock|service|access|area=yes/i.test(text)) return false;
    return true;
  });
  const notKarting = usable.filter((w) => !/kart/i.test(String(w.tags?.sport ?? '')));
  return notKarting.length ? notKarting : usable;
}

/**
 * Stitch pieces into the longest closed lap. Oneway pieces are never reversed.
 * @param {{coords: number[][], oneway?: boolean}[]} ways
 * @returns {{coords: number[][], length: number, oneway: boolean}|null}
 */
export function chainLoop(ways, tol = WORLD.joinM) {
  const pool = ways.map((w, i) => ({ ...w, i, len: lengthOf(w.coords) })).sort((a, b) => b.len - a.len);
  let best = null;
  for (const seed of pool.slice(0, 4)) {
    let chain = [...seed.coords];
    const used = new Set([seed.i]);
    let allOneway = !!seed.oneway;
    let closed = chain.length > 3 && haversine(chain[0], chain.at(-1)) <= tol;
    while (!closed) {
      const end = chain.at(-1);
      let pick = null;
      let reverse = false;
      for (const w of pool) {
        if (used.has(w.i)) continue;
        if (haversine(end, w.coords[0]) <= tol && (!pick || w.len > pick.len)) [pick, reverse] = [w, false];
        else if (!w.oneway && haversine(end, w.coords.at(-1)) <= tol && (!pick || w.len > pick.len)) [pick, reverse] = [w, true];
      }
      if (!pick) break;
      used.add(pick.i);
      allOneway = allOneway && !!pick.oneway;
      const add = reverse ? [...pick.coords].reverse() : pick.coords;
      chain = [...chain, ...add.slice(1)];
      closed = chain.length > 3 && haversine(chain[0], chain.at(-1)) <= tol;
    }
    if (!closed) continue;
    const length = lengthOf(chain);
    if (!best || length > best.length) best = { coords: chain, length, oneway: allOneway };
  }
  return best;
}

/** Start/finish on the main straight: the middle of the longest straight stretch, facing along it. */
export function guessStart(loop) {
  const straight = simplify(loop, 15);
  let bestI = 0;
  let bestLen = -1;
  for (let i = 1; i < straight.length; i++) {
    const d = haversine(straight[i - 1], straight[i]);
    if (d > bestLen) [bestLen, bestI] = [d, i];
  }
  const a = straight[bestI - 1] ?? straight[0];
  const b = straight[bestI] ?? straight[1];
  return { point: [round6((a[0] + b[0]) / 2), round6((a[1] + b[1]) / 2)], heading: Math.round(bearing(a, b) * 10) / 10 };
}

/**
 * OSM pieces → a track in the app's saved-track format (or null when no usable lap).
 * anyDirection: lap direction unknown unless every piece is one-way.
 */
export function buildCircuit({ id, name, country = '' }, ways) {
  const loop = chainLoop(racingWays(ways));
  if (!loop || loop.length < WORLD.minLapM || loop.length > WORLD.maxLapM) return null;
  const line = simplify(loop.coords, WORLD.simplifyM).map(([lng, lat]) => [round6(lng), round6(lat)]);
  return {
    id: `osm:${id}`,
    name,
    country,
    createdAt: 0,
    line,
    start: guessStart(loop.coords),
    length: Math.round(lengthOf(line)),
    bbox: bboxOf(line).map(round6),
    bestLap: null,
    bestLapAt: null,
    anyDirection: !loop.oneway,
    source: 'osm',
  };
}

// ---------------------------------------------------------------- in the app

const norm = (s) => String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

/** Catalogue tracks matching the text (name or country), nearest first. */
export function findTracks(tracks, { query = '', near = null, limit = 20 } = {}) {
  const words = norm(query).split(/\s+/).filter(Boolean);
  const hit = (t) => words.every((w) => norm(`${t.name} ${t.country}`).includes(w));
  const dist = (t) => (near ? haversine(near, t.start.point) : 0);
  return tracks.filter(hit).map((t) => ({ t, d: dist(t) })).sort((a, b) => a.d - b.d).slice(0, limit).map(({ t, d }) => ({ ...t, distance: near ? d : null }));
}

let cache = null;

/** Load the generated catalogue (shipped with the app; refreshed monthly from OpenStreetMap). */
export async function loadWorldTracks(url = 'data/world-tracks.json') {
  if (cache) return cache;
  const res = await fetch(url);
  if (!res.ok) throw new Error('The world track list could not load. Check your signal.');
  const json = await res.json();
  const tracks = Array.isArray(json?.tracks) ? json.tracks : [];
  cache = { generatedAt: json?.generatedAt ?? null, tracks };
  return cache;
}

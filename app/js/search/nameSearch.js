// Searching by name ("Kings Park", "Hoyts Carousel", "Westfield Carousel").
// Both services are asked at once and merged; results that don't match the words typed and are
// far away are dropped; and "<business> <place>" queries are split so "Hoyts Carousel" finds the
// Hoyts that sits at Westfield Carousel. Pure helpers + one orchestrator with injected fetchers.
import { haversine } from '../core/geo.js';
import { cleanText, sanitizePlace } from './places.js';

const FAR_KM = 250; // a partial match further than this is almost never what was meant
const PAIR_M = 700; // "Hoyts" within this of "Carousel" counts as "Hoyts at Carousel"
const STOP = new Set(['the', 'at', 'in', 'on', 'of', 'and', 'near', 'to']);

/** Lower-case words (2+ characters, no accents or punctuation), minus filler words. */
export function tokens(text) {
  return String(text ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 2 && !STOP.has(w));
}

/**
 * How well a place matches the typed words.
 * coverage: share of words found anywhere (1 = every word).
 * quality: whole word in the name 1, word start in the name 0.85, whole word in the address 0.7,
 * word start in the address 0.6 (averaged), minus a little for each extra word in the name, so
 * "Perth Zoo" beats "Perth Zoo Car Park" and "Zoom Convenience".
 */
export function scorePlace(place, query) {
  const want = tokens(query);
  if (!want.length) return { coverage: 0, quality: 0 };
  const name = tokens(place?.name);
  const label = tokens(place?.label);
  const one = (w) => {
    if (name.includes(w)) return 1;
    if (name.some((h) => h.startsWith(w))) return 0.85;
    if (label.includes(w)) return 0.7;
    if (label.some((h) => h.startsWith(w))) return 0.6;
    return 0;
  };
  const scores = want.map(one);
  const coverage = scores.filter((s) => s > 0).length / want.length;
  const extra = Math.max(0, name.length - want.length);
  const quality = scores.reduce((a, b) => a + b, 0) / want.length - Math.min(0.3, extra * 0.05);
  return { coverage, quality };
}

/** Share (0..1) of typed words the place matches. */
export function matchScore(place, query) {
  return scorePlace(place, query).coverage;
}

const distKm = (near, p) => (near ? haversine(near, [p.lng, p.lat]) / 1000 : 0);

/**
 * Keep places that match at least one word; drop partial matches that are far away.
 * Most words matched first, then the closest name, then nearest. Returns a new array.
 */
export function rankPlaces(places, query, near) {
  return places
    .filter(Boolean)
    .map((p, i) => ({ p, i, ...scorePlace(p, query), km: distKm(near, p) }))
    .filter(({ coverage, km }) => coverage > 0 && (coverage === 1 || km <= FAR_KM))
    .sort((a, b) => b.coverage - a.coverage || b.quality - a.quality || a.km - b.km || a.i - b.i)
    .map(({ p }) => p);
}

/** Drop repeats: same name (case-insensitive) within 500 m — two services, one place. Keeps the first. */
export function mergePlaces(...lists) {
  const out = [];
  for (const p of lists.flat()) {
    if (!p) continue;
    const name = p.name.toLowerCase();
    if (!out.some((q) => q.name.toLowerCase() === name && haversine([q.lng, q.lat], [p.lng, p.lat]) < 500)) out.push(p);
  }
  return out;
}

/** Australian nicknames the map services don't know. */
const ALIASES = [
  [/\bmaccas\b|\bmacca'?s\b|\bmacker'?s\b/gi, "McDonald's"],
  [/\bhungry jacks\b/gi, "Hungry Jack's"],
  [/\bbottle[- ]?o\b/gi, 'liquor store'],
  [/\bkfc\b/gi, 'KFC'],
  [/\bbunnos\b/gi, 'Bunnings'],
];

/** "maccas cannington" → "McDonald's cannington". */
export function expandAliases(query) {
  return ALIASES.reduce((q, [re, to]) => q.replace(re, to), String(query ?? ''));
}

/** Ways to split "hoyts carousel cannington" into [name, context]: first word, then last word. */
export function splits(query) {
  const words = cleanText(query).split(/\s+/).filter(Boolean);
  if (words.length < 2) return [];
  const out = [[words.slice(0, 1).join(' '), words.slice(1).join(' ')]];
  if (words.length > 2) out.push([words.slice(0, -1).join(' '), words.slice(-1).join(' ')]);
  return out;
}

/** Name results that sit within PAIR_M of a context result, labelled "At <context>". */
export function pairNearby(names, contexts) {
  const out = [];
  for (const n of names) {
    const ctx = contexts.find((c) => c.name.toLowerCase() !== n.name.toLowerCase() && haversine([n.lng, n.lat], [c.lng, c.lat]) <= PAIR_M);
    if (!ctx) continue;
    out.push(sanitizePlace({ ...n, id: `${n.id}@${ctx.id}`, label: `At ${ctx.name}${n.label ? ` · ${n.label}` : ''}` }));
  }
  return out;
}

async function settle(promises, signal) {
  const results = await Promise.allSettled(promises);
  if (signal?.aborted) throw signal.reason ?? new DOMException('Aborted', 'AbortError');
  const ok = results.filter((r) => r.status === 'fulfilled').map((r) => r.value);
  const failed = results.filter((r) => r.status === 'rejected').map((r) => r.reason);
  return { ok, failed };
}

/**
 * @param {string} query
 * @param {{near?: number[], limit: number, signal?: AbortSignal}} args
 * @param {{sources: Function[], fallback?: Function}} fetchers  each (q, {limit}) → Promise<Place[]>
 */
export async function searchByName(rawQuery, args, { sources, fallback }) {
  const query = expandAliases(rawQuery);
  // Ask for a few more than we show, so the real place isn't cut off before ranking.
  const ask = (q, limit = Math.max(args.limit, 10)) => settle(sources.map((s) => s(q, limit)), args.signal);
  const first = await ask(query);
  let found = rankPlaces(mergePlaces(...first.ok), query, args.near);

  // Split only when a service answered: if they're all down, more calls won't help.
  if (first.ok.length && !found.some((p) => matchScore(p, query) === 1)) {
    for (const [name, context] of splits(query)) {
      const [a, b] = await Promise.all([ask(name, 10), ask(context, 10)]);
      const paired = pairNearby(mergePlaces(...a.ok), mergePlaces(...b.ok));
      if (paired.length) {
        found = mergePlaces(rankPlaces(paired, name, args.near), found);
        break;
      }
    }
  }

  // Backup service: when asked to, or when every main service failed (so search still works).
  const allFailed = !first.ok.length && first.failed.length > 0;
  if (!found.length && fallback && (args.fallbackOnEmpty || allFailed)) {
    const backup = (await fallback(query, args.limit)).filter(Boolean);
    const ranked = rankPlaces(backup, query, args.near);
    found = ranked.length ? ranked : backup; // its own fuzzy matches beat an empty list
  } else if (!found.length && allFailed) {
    throw first.failed[0];
  }
  return found.slice(0, args.limit);
}

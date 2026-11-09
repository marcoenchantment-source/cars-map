// Street addresses ("12 Hay Street", "3/45 Canning Hwy Fremantle").
// OpenStreetMap lacks many Australian house numbers, so:
//  - with a TomTom key we search TomTom's full address database;
//  - otherwise exact house-number matches rank first, and a missing number is estimated
//    between the nearest known numbers on the same street (clearly marked "estimated").
import { haversine } from '../core/geo.js';
import { cleanText, sanitizePlace } from './places.js';

const ABBREV = {
  st: 'street', rd: 'road', ave: 'avenue', av: 'avenue', dr: 'drive', hwy: 'highway', fwy: 'freeway',
  pde: 'parade', tce: 'terrace', cres: 'crescent', cr: 'crescent', pl: 'place', ct: 'court', cct: 'circuit',
  bvd: 'boulevard', blvd: 'boulevard', gr: 'grove', hts: 'heights', ln: 'lane', cl: 'close', wy: 'way', esp: 'esplanade',
};
const MAX_SEGMENT_GAP_M = 3000; // two known numbers further apart are probably different stretches of the street

/** Lower-case street text with Australian abbreviations expanded: "Hay St" → "hay street". */
export function normaliseStreet(text) {
  return cleanText(text)
    .toLowerCase()
    .replace(/[.,]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => ABBREV[w] ?? w)
    .join(' ');
}

/** { unit, number, numeric, street } for queries that start with a house number, else null. */
export function parseAddressQuery(query) {
  const q = cleanText(query);
  const m = q.match(/^(?:(?:unit|u|apt|apartment)\s*)?(?:(\d+[a-z]?)\s*\/\s*)?(\d{1,5})([a-z]?)\s*,?\s+(.*[a-z].*)$/i);
  if (!m) return null;
  const street = cleanText(m[4]);
  if (street.length < 3) return null;
  return { unit: m[1] ?? '', number: `${m[2]}${m[3]}`.toUpperCase(), numeric: Number(m[2]), street };
}

/** True when a place's street is part of what was typed ("hay street" in "hay street perth"). */
function onStreet(placeStreet, typedStreet) {
  const s = normaliseStreet(placeStreet);
  return s.length > 2 && normaliseStreet(typedStreet).includes(s);
}

/** Street name of a Place built by geocoder.js: label "195 Hay Street, Perth WA" → "Hay Street". */
export function streetOf(place) {
  const first = String(place?.label ?? '').split(',')[0] ?? '';
  return first.replace(/^\s*\d+[a-z]?(\/\d+[a-z]?)?\s+/i, '').trim();
}
export function numberOf(place) {
  const m = String(place?.label ?? '').match(/^\s*(?:\d+[a-z]?\/)?(\d+)([a-z]?)\s/i);
  return m ? { number: `${m[1]}${m[2]}`.toUpperCase(), numeric: Number(m[1]) } : null;
}

/** Exact number on the typed street first, then the street itself, then everything else. */
export function rankForAddress(places, parsed) {
  const score = (p) => {
    const n = numberOf(p);
    const street = onStreet(streetOf(p) || p.name, parsed.street);
    if (n && street && n.number === parsed.number) return 0;
    if (!n && street) return 1;
    if (n && street) return 3; // a different number on the same street
    return 2;
  };
  return [...places].map((p, i) => ({ p, i, s: score(p) })).sort((a, b) => a.s - b.s || a.i - b.i).map(({ p }) => p);
}

export function hasExactMatch(places, parsed) {
  return places.some((p) => {
    const n = numberOf(p);
    return n && n.number === parsed.number && onStreet(streetOf(p), parsed.street);
  });
}

/**
 * Estimate where `parsed.numeric` sits on its street from known numbered places on it.
 * Prefers neighbours on the same side (same odd/even) and refuses to bridge far-apart stretches.
 * @returns {Place|null}
 */
export function estimateAddress(parsed, samples, near = null) {
  const known = samples
    .map((p) => ({ p, n: numberOf(p) }))
    .filter(({ p, n }) => n && Number.isFinite(n.numeric) && onStreet(streetOf(p), parsed.street))
    .map(({ p, n }) => ({ num: n.numeric, lng: p.lng, lat: p.lat, label: p.label }));
  if (!known.length) return null;
  const target = parsed.numeric;
  const sameSide = known.filter((k) => k.num % 2 === target % 2);
  const pool = sameSide.length >= 2 ? sameSide : known;
  const below = pool.filter((k) => k.num <= target).sort((a, b) => b.num - a.num);
  const above = pool.filter((k) => k.num >= target).sort((a, b) => a.num - b.num);
  let point = null;
  for (const lo of below.slice(0, 3)) {
    const hi = above.find((h) => haversine([lo.lng, lo.lat], [h.lng, h.lat]) < MAX_SEGMENT_GAP_M);
    if (!hi) continue;
    const t = hi.num === lo.num ? 0 : (target - lo.num) / (hi.num - lo.num);
    point = { lng: lo.lng + (hi.lng - lo.lng) * t, lat: lo.lat + (hi.lat - lo.lat) * t, ref: lo };
    break;
  }
  if (!point) {
    // Only one side known: accept the closest number if it's within 20 numbers.
    const closest = [...pool].sort((a, b) => Math.abs(a.num - target) - Math.abs(b.num - target) || (near ? haversine(near, [a.lng, a.lat]) - haversine(near, [b.lng, b.lat]) : 0))[0];
    if (Math.abs(closest.num - target) > 20) return null;
    point = { lng: closest.lng, lat: closest.lat, ref: closest };
  }
  const area = String(point.ref.label ?? '').split(',').slice(1).join(',').trim();
  const streetTitle = streetOf({ label: point.ref.label }) || parsed.street;
  return sanitizePlace({
    id: `est:${parsed.number}:${normaliseStreet(streetTitle)}`,
    name: `${parsed.unit ? `${parsed.unit}/` : ''}${parsed.number} ${streetTitle}`,
    label: `Estimated spot${area ? ` · ${area}` : ''}`,
    lng: point.lng,
    lat: point.lat,
    kind: 'address',
    source: 'estimate',
  });
}

// ---------------------------------------------------------------- TomTom (when a key is set)

const STATE_CODES = new Set(['WA', 'NSW', 'VIC', 'QLD', 'SA', 'TAS', 'NT', 'ACT']);

/** TomTom Search result → Place (or null). */
export function placeFromTomTom(r) {
  const pos = r?.position;
  const a = r?.address && typeof r.address === 'object' ? r.address : {};
  if (!pos || !Number.isFinite(pos.lat) || !Number.isFinite(pos.lon)) return null;
  const streetLine = cleanText([a.streetNumber, a.streetName].filter(Boolean).join(' '));
  const poiName = cleanText(r.poi?.name);
  const suburb = cleanText(a.municipalitySubdivision || a.municipality || a.localName);
  const state = cleanText(a.countrySubdivisionCode || a.countrySubdivision);
  const area = [suburb, STATE_CODES.has(state) ? state : cleanText(a.countrySubdivision)].filter(Boolean).join(' ');
  const name = poiName || streetLine || cleanText(a.freeformAddress) || suburb;
  const label = [poiName ? streetLine : '', area].filter(Boolean).join(', ') || cleanText(a.freeformAddress);
  const isAddress = r.type === 'Point Address' || r.type === 'Address Range';
  return sanitizePlace({
    id: `tomtom:${cleanText(String(r.id ?? `${pos.lat},${pos.lon}`))}`,
    name,
    label: isAddress && !poiName ? `${streetLine}${area ? `, ${area}` : ''}` : label,
    lng: pos.lon,
    lat: pos.lat,
    kind: isAddress ? 'address' : poiName ? cleanText(r.poi?.categories?.[0]) || 'place' : 'street',
    source: 'tomtom',
  });
}

/** Search TomTom (addresses + places), biased to `near`. */
export async function tomtomSearch(query, { near, limit, signal, endpoints, key, fetchJson }) {
  const p = new URLSearchParams({ key, limit: String(limit), typeahead: 'true', language: 'en-AU' });
  if (near) {
    p.set('lat', near[1].toFixed(5));
    p.set('lon', near[0].toFixed(5));
  }
  const url = `${endpoints.tomtom}/search/2/search/${encodeURIComponent(query)}.json?${p}`;
  const json = await fetchJson(url, { signal, timeoutMs: 8000, service: 'Place search' });
  const results = Array.isArray(json?.results) ? json.results : [];
  return results.map(placeFromTomTom).filter(Boolean);
}

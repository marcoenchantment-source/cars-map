// Place search: Photon (komoot) biased to the driver, Nominatim as a fallback. DOM-free.
// Verified 2026-11-09 on Photon 1.3.0: category search works with `include=osm.amenity.fuel`
// and no `q`; a `bbox` keeps results local (text + osm_tag alone returns worldwide names).
import { haversine } from '../core/geo.js';
import { fetchJson, ServiceError, isAbort } from '../routing/http.js';
import { cleanText, sanitizePlace } from './places.js';
import { parseAddressQuery, rankForAddress, hasExactMatch, estimateAddress, tomtomSearch } from './addresses.js';

export const GEOCODE_TIMEOUT_MS = 8000;

/** Quick-search categories. `words` are what drivers type or say. */
export const CATEGORIES = Object.freeze({
  fuel: { label: 'Servos', icon: 'fuel', include: ['osm.amenity.fuel'], words: ['servo', 'servos', 'petrol', 'petrol station', 'petrol stations', 'fuel', 'gas', 'gas station', 'service station', 'servo station'] },
  cafe: { label: 'Coffee', icon: 'star', include: ['osm.amenity.cafe'], words: ['coffee', 'cafe', 'café', 'cafes', 'cafés', 'coffee shop'] },
  parking: { label: 'Parking', icon: 'car', include: ['osm.amenity.parking'], words: ['parking', 'car park', 'carpark', 'car parks', 'parking lot'] },
  food: { label: 'Food', icon: 'star', include: ['osm.amenity.fast_food', 'osm.amenity.restaurant'], words: ['food', 'restaurant', 'restaurants', 'takeaway', 'take away', 'fast food', 'something to eat', 'lunch', 'dinner'] },
  toilets: { label: 'Toilets', icon: 'pin', include: ['osm.amenity.toilets'], words: ['toilet', 'toilets', 'loo', 'restroom', 'bathroom', 'public toilet', 'public toilets'] },
  charging: { label: 'EV charging', icon: 'spark', include: ['osm.amenity.charging_station'], words: ['charging', 'charger', 'chargers', 'ev charger', 'ev chargers', 'ev charging', 'charging station', 'charging stations'] },
});

const FILLER = /\b(nearest|closest|nearby|near me|around here|close by|find|show|me|a|an|the|some|any|local|please)\b/g;

/** Category id for queries like "nearest servo" or "coffee near me", else null. */
export function detectCategory(query) {
  const q = String(query ?? '').toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(FILLER, ' ').replace(/\s+/g, ' ').trim();
  if (!q) return null;
  for (const [id, c] of Object.entries(CATEGORIES)) if (c.words.includes(q)) return id;
  return null;
}

const AU_STATES = Object.freeze({
  'western australia': 'WA', 'new south wales': 'NSW', victoria: 'VIC', queensland: 'QLD',
  'south australia': 'SA', tasmania: 'TAS', 'northern territory': 'NT', 'australian capital territory': 'ACT',
});

function stateText(state, countryCode) {
  const s = cleanText(state);
  if (countryCode === 'AU') return AU_STATES[s.toLowerCase()] ?? s;
  return s;
}

/** "100 St Georges Terrace, Perth WA" from address parts (skips parts equal to the name). */
export function formatLabel({ name = '', housenumber = '', street = '', suburb = '', state = '', country = '', countryCode = '' }) {
  const streetLine = cleanText([housenumber, street].filter(Boolean).join(' '));
  const place = cleanText(suburb);
  const st = stateText(state, countryCode);
  const lowerName = cleanText(name).toLowerCase();
  const parts = [];
  if (streetLine && streetLine.toLowerCase() !== lowerName) parts.push(streetLine);
  const area = [place && place.toLowerCase() !== lowerName ? place : '', st].filter(Boolean).join(countryCode === 'AU' ? ' ' : ', ');
  if (area) parts.push(area);
  if (countryCode && countryCode !== 'AU' && country) parts.push(cleanText(country));
  return parts.join(', ');
}

function kindOf(key, value, hasNumber) {
  if (['amenity', 'shop', 'tourism', 'leisure', 'aeroway', 'railway', 'office'].includes(key)) return cleanText(value);
  if (key === 'place' || key === 'boundary') return 'place';
  if (key === 'highway') return ['bus_stop', 'platform', 'rest_area', 'services'].includes(value) ? cleanText(value) : 'street';
  return hasNumber ? 'address' : cleanText(value) || 'place';
}

/** Photon GeoJSON feature → Place, or null when unusable. */
export function placeFromPhoton(feature) {
  const p = feature?.properties;
  const c = feature?.geometry?.coordinates;
  if (!p || typeof p !== 'object' || !Array.isArray(c)) return null;
  const countryCode = cleanText(p.countrycode).toUpperCase();
  const streetLine = cleanText([p.housenumber, p.street].filter(Boolean).join(' '));
  const name = cleanText(p.name) || streetLine || cleanText(p.district) || cleanText(p.city);
  const suburb = p.district || p.locality || p.city || p.county || '';
  return sanitizePlace({
    id: `photon:${cleanText(p.osm_type)}${cleanText(String(p.osm_id ?? ''))}` || undefined,
    name,
    label: formatLabel({ name, housenumber: p.housenumber, street: p.street, suburb, state: p.state, country: p.country, countryCode }),
    lng: Number(c[0]),
    lat: Number(c[1]),
    kind: kindOf(p.osm_key, p.osm_value, !!p.housenumber),
    source: 'photon',
  });
}

/** Nominatim jsonv2 item → Place, or null. */
export function placeFromNominatim(item) {
  if (!item || typeof item !== 'object') return null;
  const a = item.address && typeof item.address === 'object' ? item.address : {};
  const countryCode = cleanText(a.country_code).toUpperCase();
  const streetLine = cleanText([a.house_number, a.road].filter(Boolean).join(' '));
  const suburb = a.suburb || a.town || a.city_district || a.city || a.village || a.neighbourhood || '';
  const name = cleanText(item.name) || streetLine || cleanText(suburb) || cleanText(String(item.display_name ?? '').split(',')[0]);
  return sanitizePlace({
    id: `nominatim:${cleanText(item.osm_type)}${cleanText(String(item.osm_id ?? ''))}`,
    name,
    label: formatLabel({ name, housenumber: a.house_number, street: a.road, suburb, state: a.state, country: a.country, countryCode }),
    lng: Number(item.lon),
    lat: Number(item.lat),
    kind: kindOf(item.category, item.type, !!a.house_number),
    source: 'nominatim',
  });
}

/** Drop repeats: same name within 150 m (Photon returns a park, its suburb and its boundary). */
export function dedupePlaces(places) {
  const out = [];
  for (const p of places) {
    if (!p) continue;
    const dup = out.some((q) => q.name.toLowerCase() === p.name.toLowerCase() && haversine([q.lng, q.lat], [p.lng, p.lat]) < 150);
    if (!dup) out.push(p);
  }
  return out;
}

/** New array sorted nearest first. */
export function sortByDistance(places, near) {
  if (!near) return [...places];
  return [...places].sort((a, b) => haversine(near, [a.lng, a.lat]) - haversine(near, [b.lng, b.lat]));
}

const bboxAround = (c, d) => [c[0] - d, c[1] - d * 0.85, c[0] + d, c[1] + d * 0.85].map((x) => x.toFixed(4)).join(',');

function features(json) {
  if (!json || !Array.isArray(json.features)) throw new ServiceError('Place search sent an answer we couldn’t read.', { code: 'bad-response' });
  return json.features;
}

async function photonSearch(q, { near, limit, signal, endpoints, fetchImpl }) {
  const p = new URLSearchParams({ q, limit: String(limit), lang: 'en' });
  if (near) {
    p.set('lat', near[1].toFixed(5));
    p.set('lon', near[0].toFixed(5));
  }
  const json = await fetchJson(`${endpoints.photon}/api/?${p}`, { signal, timeoutMs: GEOCODE_TIMEOUT_MS, service: 'Place search', fetchImpl });
  return dedupePlaces(features(json).map(placeFromPhoton)).slice(0, limit);
}

async function nominatimSearch(q, { near, limit, signal, endpoints, fetchImpl }) {
  const p = new URLSearchParams({ q, format: 'jsonv2', limit: String(limit), addressdetails: '1', 'accept-language': 'en' });
  if (near) p.set('viewbox', `${near[0] - 0.6},${near[1] + 0.5},${near[0] + 0.6},${near[1] - 0.5}`);
  const json = await fetchJson(`${endpoints.nominatim}/search?${p}`, { signal, timeoutMs: GEOCODE_TIMEOUT_MS, service: 'Place search', fetchImpl });
  if (!Array.isArray(json)) throw new ServiceError('Place search sent an answer we couldn’t read.', { code: 'bad-response' });
  return dedupePlaces(json.map(placeFromNominatim)).slice(0, limit);
}

/** Nearby places of one category, nearest first. Widens the search box once if few turn up. */
export async function searchCategory(id, { near, limit = 8, signal, endpoints, fetchImpl }) {
  const cat = CATEGORIES[id];
  if (!cat) throw new ServiceError('Unknown category.', { code: 'bad-input' });
  const centre = near ?? null;
  let found = [];
  for (const span of centre ? [0.06, 0.3] : [null]) {
    const p = new URLSearchParams({ include: cat.include.join(','), limit: String(Math.max(limit, 10)), lang: 'en' });
    if (centre) {
      p.set('lat', centre[1].toFixed(5));
      p.set('lon', centre[0].toFixed(5));
      p.set('bbox', bboxAround(centre, span));
    }
    const json = await fetchJson(`${endpoints.photon}/api/?${p}`, { signal, timeoutMs: GEOCODE_TIMEOUT_MS, service: 'Place search', fetchImpl });
    found = dedupePlaces(features(json).map(placeFromPhoton)).map((pl) => (pl.kind ? pl : { ...pl, kind: id }));
    if (found.length >= 3) break;
  }
  return sortByDistance(found, centre).slice(0, limit);
}

/**
 * Search places. Categories ("servo") become nearby category searches.
 * @param {string} query
 * @param {{near?: number[], limit?: number, signal?: AbortSignal, endpoints: object,
 *          fallbackOnEmpty?: boolean, fetchImpl?: Function}} opts
 */
export async function searchPlaces(query, opts) {
  const q = cleanText(query);
  if (!q) return [];
  const limit = Math.min(Math.max(1, opts.limit ?? 8), 20);
  const args = { ...opts, limit };
  const category = detectCategory(q);
  if (category) return searchCategory(category, args);
  const parsed = parseAddressQuery(q);
  if (opts.tomtomKey) {
    try {
      const tt = await tomtomSearch(q, { ...args, key: opts.tomtomKey, fetchJson: (url, o) => fetchJson(url, { ...o, fetchImpl: opts.fetchImpl }) });
      if (tt.length) return parsed ? rankForAddress(tt, parsed) : tt;
    } catch (err) {
      if (isAbort(err)) throw err;
      console.warn(`[search] TomTom search failed: ${err.message}`);
    }
  }
  let results = null;
  try {
    results = await photonSearch(q, args);
  } catch (err) {
    if (isAbort(err)) throw err;
    console.warn(`[search] Photon failed: ${err.message}`);
  }
  if (results && parsed) return addressResults(parsed, results, args);
  if (results && (results.length || !opts.fallbackOnEmpty)) return results;
  const fallback = await nominatimSearch(q, args);
  return parsed ? rankForAddress(fallback, parsed) : fallback;
}

/** House-number queries: exact match first; otherwise an estimate between known neighbours. */
async function addressResults(parsed, results, args) {
  if (hasExactMatch(results, parsed)) return rankForAddress(results, parsed);
  let samples = results;
  try {
    samples = [...results, ...(await photonSearch(parsed.street, { ...args, limit: 40 }))];
  } catch (err) {
    if (isAbort(err)) throw err;
  }
  const estimate = estimateAddress(parsed, samples, args.near);
  const ranked = rankForAddress(results, parsed);
  return (estimate ? [estimate, ...ranked] : ranked).slice(0, args.limit);
}

/** Address or POI at a point; the Place keeps the exact point that was asked about. */
export async function reverseGeocode(point, { signal, endpoints, fetchImpl }) {
  const [lng, lat] = point;
  const near = (pl) => pl && haversine(point, [pl.lng, pl.lat]) < 120;
  const atPoint = (pl) => sanitizePlace({ ...pl, id: `pt:${lat.toFixed(5)},${lng.toFixed(5)}`, lng, lat, name: near(pl) ? pl.name : 'Dropped pin', label: pl.label || pl.name });
  try {
    const p = new URLSearchParams({ lon: lng.toFixed(6), lat: lat.toFixed(6), lang: 'en', limit: '1' });
    const json = await fetchJson(`${endpoints.photon}/reverse?${p}`, { signal, timeoutMs: GEOCODE_TIMEOUT_MS, service: 'Place search', fetchImpl });
    const place = features(json).map(placeFromPhoton).find(Boolean);
    if (place) return atPoint(place);
  } catch (err) {
    if (isAbort(err)) throw err;
    console.warn(`[search] Photon reverse failed: ${err.message}`);
  }
  const p = new URLSearchParams({ format: 'jsonv2', lat: lat.toFixed(6), lon: lng.toFixed(6), zoom: '18', addressdetails: '1', 'accept-language': 'en' });
  const json = await fetchJson(`${endpoints.nominatim}/reverse?${p}`, { signal, timeoutMs: GEOCODE_TIMEOUT_MS, service: 'Place search', fetchImpl });
  const place = json && !json.error ? placeFromNominatim(json) : null;
  return place ? atPoint(place) : null;
}

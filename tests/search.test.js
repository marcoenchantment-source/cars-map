// Geocoding (Photon/Nominatim parsing, category search, fallback) and place helpers.
// Photon/Nominatim samples are trimmed copies of real responses fetched 2026-11-09.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  detectCategory, placeFromPhoton, placeFromNominatim, dedupePlaces, sortByDistance, formatLabel,
  searchPlaces, searchCategory, reverseGeocode,
} from '../app/js/search/geocoder.js';
import { sanitizePlace, addRecent, loadPlaces, cleanText, formatClock, durationParts, trafficChip, iconForKind, samePlace } from '../app/js/search/places.js';
import { createPlaceMemory } from '../app/js/search/memory.js';

const ENDPOINTS = { photon: 'https://photon.test', nominatim: 'https://nominatim.test' };
const PERTH = [115.8605, -31.9505];

const ENEX = {
  type: 'Feature',
  properties: { osm_type: 'W', osm_id: 121661805, osm_key: 'shop', osm_value: 'mall', type: 'house', housenumber: '100', name: 'Enex', street: 'St Georges Terrace', district: 'Perth', city: 'Perth', state: 'Western Australia', country: 'Australia', postcode: '6000', countrycode: 'AU' },
  geometry: { type: 'Point', coordinates: [115.8576918, -31.9546227] },
};
const HAY = { type: 'Feature', properties: { osm_type: 'W', osm_id: 1, osm_key: 'highway', osm_value: 'secondary', type: 'street', name: 'Hay Street', district: 'West Perth', city: 'Perth', state: 'Western Australia', country: 'Australia', countrycode: 'AU' }, geometry: { type: 'Point', coordinates: [115.845, -31.951] } };
const FREO = { type: 'Feature', properties: { osm_type: 'N', osm_id: 2, osm_key: 'place', osm_value: 'town', type: 'city', name: 'Fremantle', state: 'Western Australia', country: 'Australia', countrycode: 'AU' }, geometry: { type: 'Point', coordinates: [115.7475, -32.0569] } };
const KINGS_PARK = [
  { type: 'Feature', properties: { osm_type: 'W', osm_id: 3, osm_key: 'leisure', osm_value: 'park', name: 'Kings Park', district: 'Kings Park', city: 'Perth', state: 'Western Australia', countrycode: 'AU' }, geometry: { coordinates: [115.833, -31.962] } },
  { type: 'Feature', properties: { osm_type: 'N', osm_id: 4, osm_key: 'place', osm_value: 'locality', name: 'Kings Park', city: 'Perth', state: 'Western Australia', countrycode: 'AU' }, geometry: { coordinates: [115.8335, -31.9622] } },
];
const SHELL = { type: 'Feature', properties: { osm_type: 'N', osm_id: 5, osm_key: 'amenity', osm_value: 'fuel', name: 'Shell', street: 'South Street', district: 'Fremantle', state: 'Western Australia', countrycode: 'AU' }, geometry: { coordinates: [115.759, -32.061] } };
const BP = { type: 'Feature', properties: { osm_type: 'N', osm_id: 6, osm_key: 'amenity', osm_value: 'fuel', name: 'BP', street: 'Queen Victoria Street', district: 'Fremantle', state: 'Western Australia', countrycode: 'AU' }, geometry: { coordinates: [115.752, -32.044] } };
const NOMINATIM_MARKETS = {
  osm_type: 'way', osm_id: 34911431, lat: '-32.0559654', lon: '115.7495795', category: 'amenity', type: 'marketplace', name: 'Fremantle Markets',
  display_name: 'Fremantle Markets, South Terrace, Fremantle, Western Australia, 6160, Australia',
  address: { amenity: 'Fremantle Markets', road: 'South Terrace', town: 'Fremantle', state: 'Western Australia', postcode: '6160', country: 'Australia', country_code: 'au' },
};

const json = (body, status = 200) => new Response(JSON.stringify(body), { status });

test('Photon features become readable Places', () => {
  const enex = placeFromPhoton(ENEX);
  assert.deepEqual({ ...enex }, { id: 'photon:W121661805', name: 'Enex', label: '100 St Georges Terrace, Perth WA', lng: 115.8576918, lat: -31.9546227, kind: 'mall', source: 'photon' });
  assert.ok(Object.isFrozen(enex));
  const hay = placeFromPhoton(HAY);
  assert.equal(hay.name, 'Hay Street');
  assert.equal(hay.label, 'West Perth WA');
  assert.equal(hay.kind, 'street');
  const freo = placeFromPhoton(FREO);
  assert.equal(freo.label, 'WA');
  assert.equal(freo.kind, 'place');
  assert.equal(placeFromPhoton({ properties: {} }), null);
  assert.equal(placeFromPhoton({ properties: { name: 'x' }, geometry: { coordinates: [500, 0] } }), null);
});

test('labels for other countries keep the country', () => {
  assert.equal(formatLabel({ name: 'Cafe', street: 'Rue X', suburb: 'Paris', state: 'Ile-de-France', country: 'France', countryCode: 'FR' }), 'Rue X, Paris, Ile-de-France, France');
});

test('Nominatim items become Places', () => {
  const p = placeFromNominatim(NOMINATIM_MARKETS);
  assert.equal(p.name, 'Fremantle Markets');
  assert.equal(p.label, 'South Terrace, Fremantle WA');
  assert.equal(p.lat, -32.0559654);
  assert.equal(p.kind, 'marketplace');
  assert.equal(p.source, 'nominatim');
  assert.equal(placeFromNominatim(null), null);
});

test('duplicates collapse and sorting is by distance', () => {
  const places = KINGS_PARK.map(placeFromPhoton);
  assert.equal(dedupePlaces(places).length, 1);
  const sorted = sortByDistance([placeFromPhoton(SHELL), placeFromPhoton(BP)], [115.7475, -32.0569]);
  assert.equal(sorted[0].name, 'Shell'); // ~1.2 km vs BP ~1.5 km
});

test('category words are recognised', () => {
  assert.equal(detectCategory('servo'), 'fuel');
  assert.equal(detectCategory('nearest servo'), 'fuel');
  assert.equal(detectCategory('Petrol station near me'), 'fuel');
  assert.equal(detectCategory('coffee'), 'cafe');
  assert.equal(detectCategory('find a car park'), 'parking');
  assert.equal(detectCategory('food'), 'food');
  assert.equal(detectCategory('loo'), 'toilets');
  assert.equal(detectCategory('EV charger'), 'charging');
  assert.equal(detectCategory('Shell servo Fremantle'), null);
  assert.equal(detectCategory('Hay Street'), null);
  assert.equal(detectCategory(''), null);
});

test('text search is biased to the driver', async () => {
  let seen;
  const fetchImpl = async (url) => {
    seen = new URL(url);
    return json({ features: [ENEX, HAY] });
  };
  const out = await searchPlaces('100 St Georges Terrace', { near: PERTH, endpoints: ENDPOINTS, fetchImpl });
  assert.equal(seen.pathname, '/api/');
  assert.equal(seen.searchParams.get('q'), '100 St Georges Terrace');
  assert.equal(seen.searchParams.get('lat'), '-31.95050');
  assert.equal(seen.searchParams.get('lon'), '115.86050');
  assert.equal(seen.searchParams.get('limit'), '8');
  assert.equal(seen.searchParams.get('lang'), 'en');
  assert.equal(out.length, 2);
  assert.deepEqual(await searchPlaces('   ', { endpoints: ENDPOINTS, fetchImpl }), []);
});

test('category search uses include= with a local box, nearest first', async () => {
  const urls = [];
  const fetchImpl = async (url) => {
    urls.push(new URL(url));
    return json({ features: [SHELL, BP, { ...BP, properties: { ...BP.properties, osm_id: 7, name: 'Ampol' }, geometry: { coordinates: [115.76, -32.03] } }] });
  };
  const out = await searchPlaces('nearest servo', { near: [115.7475, -32.0569], endpoints: ENDPOINTS, fetchImpl });
  assert.equal(urls.length, 1);
  const p = urls[0].searchParams;
  assert.equal(p.get('include'), 'osm.amenity.fuel');
  assert.equal(p.get('q'), null);
  assert.ok(p.get('bbox'));
  assert.deepEqual(out.map((p) => p.name), ['Shell', 'BP', 'Ampol']);
  assert.equal(out[0].kind, 'fuel');
});

test('category search widens the box when little turns up', async () => {
  const boxes = [];
  const fetchImpl = async (url) => {
    boxes.push(new URL(url).searchParams.get('bbox'));
    return json({ features: boxes.length === 1 ? [] : [SHELL, BP, FREO] });
  };
  const out = await searchCategory('food', { near: [115.7475, -32.0569], endpoints: ENDPOINTS, fetchImpl });
  assert.equal(boxes.length, 2);
  assert.notEqual(boxes[0], boxes[1]);
  assert.equal(out.length, 3);
  await assert.rejects(searchCategory('nope', { endpoints: ENDPOINTS, fetchImpl }), (e) => e.code === 'bad-input');
});

test('Photon failure falls back to Nominatim; empty falls back only when asked', async () => {
  const hosts = [];
  const failing = async (url) => {
    hosts.push(new URL(url).host);
    return url.includes('photon') ? new Response('busy', { status: 503 }) : json([NOMINATIM_MARKETS]);
  };
  const out = await searchPlaces('Fremantle Markets', { near: PERTH, endpoints: ENDPOINTS, fetchImpl: failing });
  assert.deepEqual(hosts, ['photon.test', 'nominatim.test']);
  assert.equal(out[0].name, 'Fremantle Markets');
  const empty = async (url) => (url.includes('photon') ? json({ features: [] }) : json([NOMINATIM_MARKETS]));
  assert.deepEqual(await searchPlaces('zzz', { endpoints: ENDPOINTS, fetchImpl: empty }), []);
  assert.equal((await searchPlaces('zzz', { endpoints: ENDPOINTS, fetchImpl: empty, fallbackOnEmpty: true })).length, 1);
  const garbage = async (url) => (url.includes('photon') ? json({ nope: 1 }) : json({ not: 'an array' }));
  await assert.rejects(searchPlaces('x', { endpoints: ENDPOINTS, fetchImpl: garbage }), (e) => e.code === 'bad-response');
});

test('reverse geocode keeps the pressed point and names far POIs "Dropped pin"', async () => {
  const pt = [115.7476, -32.05705];
  const near = await reverseGeocode(pt, { endpoints: ENDPOINTS, fetchImpl: async () => json({ features: [{ ...SHELL, geometry: { coordinates: [115.7477, -32.0570] } }] }) });
  assert.equal(near.name, 'Shell');
  assert.deepEqual([near.lng, near.lat], pt);
  const far = await reverseGeocode(pt, { endpoints: ENDPOINTS, fetchImpl: async () => json({ features: [SHELL] }) });
  assert.equal(far.name, 'Dropped pin');
  assert.equal(far.label, 'South Street, Fremantle WA');
  const viaNominatim = await reverseGeocode(pt, {
    endpoints: ENDPOINTS,
    fetchImpl: async (url) => (url.includes('photon') ? json({ features: [] }) : json({ ...NOMINATIM_MARKETS, lat: '-32.05705', lon: '115.7476' })),
  });
  assert.equal(viaNominatim.name, 'Fremantle Markets');
  const nothing = await reverseGeocode(pt, { endpoints: ENDPOINTS, fetchImpl: async (url) => (url.includes('photon') ? json({ features: [] }) : json({ error: 'Unable to geocode' })) });
  assert.equal(nothing, null);
});

test('sanitizePlace rejects bad input and strips junk', () => {
  assert.equal(sanitizePlace(null), null);
  assert.equal(sanitizePlace({ lng: 'x', lat: 1 }), null);
  assert.equal(sanitizePlace({ lng: 200, lat: 1 }), null);
  const p = sanitizePlace({ name: '  Hay\u0000 St\n', lng: '115.8', lat: -31.9, extra: '<script>' });
  assert.equal(p.name, 'Hay St');
  assert.equal(p.id, 'pt:-31.90000,115.80000');
  assert.equal(p.extra, undefined);
  assert.equal(sanitizePlace({ lng: 1, lat: 1 }).name, 'Dropped pin');
  assert.equal(cleanText('x'.repeat(500)).length, 160);
  assert.equal(cleanText(null), '');
});

test('recent places: newest first, no duplicates, capped at 12', () => {
  let list = [];
  for (let i = 0; i < 15; i++) list = addRecent(list, { id: `p${i}`, name: `Place ${i}`, lng: 115 + i / 100, lat: -32 });
  assert.equal(list.length, 12);
  assert.equal(list[0].id, 'p14');
  const before = list;
  list = addRecent(list, { id: 'p5', name: 'Place 5', lng: 115.05, lat: -32 });
  assert.equal(list[0].id, 'p5');
  assert.equal(list.filter((p) => p.id === 'p5').length, 1);
  assert.equal(before[0].id, 'p14', 'input list not mutated');
  assert.ok(samePlace({ id: 'a', name: 'X', lng: 1, lat: 1 }, { id: 'b', name: 'X', lng: 1.0001, lat: 1 }));
  assert.deepEqual(loadPlaces([{ lng: 'bad' }, { name: 'ok', lng: 1, lat: 1 }, 'junk']).map((p) => p.name), ['ok']);
  assert.deepEqual(loadPlaces('nope'), []);
});

test('display formatting: clock, duration parts, traffic chip, icons', () => {
  const d = new Date('2026-11-10T02:42:00Z'); // 10:42 am in Perth
  assert.equal(formatClock(d, { timeZone: 'Australia/Perth' }), '10:42 am');
  assert.equal(formatClock(new Date('2026-11-10T07:05:00Z'), { timeZone: 'Australia/Perth' }), '3:05 pm');
  assert.equal(formatClock('nope'), '');
  assert.deepEqual(durationParts(1440).map((p) => p.text), ['24', 'min']);
  assert.deepEqual(durationParts(3900).map((p) => p.text), ['1', 'h', '05', 'min']);
  assert.deepEqual(durationParts(7200).map((p) => p.text), ['2', 'h']);
  assert.deepEqual(durationParts(10).map((p) => p.text), ['1', 'min']);
  assert.equal(trafficChip(480), '+8 min traffic');
  assert.equal(trafficChip(20), '');
  assert.equal(iconForKind('fuel'), 'fuel');
  assert.equal(iconForKind('whatever'), 'pin');
});

test('place memory stores home/work/recents safely', () => {
  const data = new Map([['home', { name: 'Old', lng: 'bad', lat: 0 }]]);
  const storage = { load: (k, f) => (data.has(k) ? data.get(k) : f), save: (k, v) => (data.set(k, v), true) };
  const memory = createPlaceMemory(storage);
  assert.equal(memory.home(), null, 'invalid stored home ignored');
  let changes = 0;
  memory.subscribe(() => changes++);
  memory.setHome({ name: 'Home', label: 'Fremantle WA', lng: 115.75, lat: -32.05 });
  assert.equal(memory.home().name, 'Home');
  assert.equal(data.get('home').name, 'Home');
  assert.throws(() => memory.setWork({ name: 'x' }), /no usable location/);
  memory.remember({ name: 'A', lng: 1, lat: 1 });
  assert.equal(memory.recents().length, 1);
  memory.clearRecents();
  assert.equal(memory.recents().length, 0);
  assert.equal(changes, 3);
  const full = createPlaceMemory({ load: (k, f) => f, save: () => false });
  assert.throws(() => full.setWork({ name: 'W', lng: 1, lat: 1 }), /Couldn’t save/);
});

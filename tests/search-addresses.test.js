import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseAddressQuery, normaliseStreet, rankForAddress, hasExactMatch, estimateAddress, placeFromTomTom, numberOf, streetOf,
} from '../app/js/search/addresses.js';

const place = (label, lng, lat, name = label.split(',')[0]) => ({ id: label, name, label, lng, lat });

test('parseAddressQuery reads house numbers, units and suffixes', () => {
  assert.deepEqual(parseAddressQuery('12 Hay Street Perth'), { unit: '', number: '12', numeric: 12, street: 'Hay Street Perth' });
  assert.deepEqual(parseAddressQuery('3/45 Canning Hwy'), { unit: '3', number: '45', numeric: 45, street: 'Canning Hwy' });
  assert.equal(parseAddressQuery('12a Smith St').number, '12A');
  assert.equal(parseAddressQuery('Kings Park'), null);
  assert.equal(parseAddressQuery('7 11'), null);
});

test('normaliseStreet expands Australian abbreviations', () => {
  assert.equal(normaliseStreet('St Georges Tce'), 'street georges terrace');
  assert.equal(normaliseStreet('Canning Hwy.'), 'canning highway');
});

test('numberOf / streetOf read our label format', () => {
  const p = place('195 Hay Street, Perth WA', 115.85, -31.95);
  assert.deepEqual(numberOf(p), { number: '195', numeric: 195 });
  assert.equal(streetOf(p), 'Hay Street');
  assert.equal(numberOf(place('Hay Street, Perth WA', 0, 0)), null);
});

test('rankForAddress puts the exact number first and other numbers last', () => {
  const parsed = parseAddressQuery('100 St Georges Tce Perth');
  const list = [
    place('120 St Georges Terrace, Perth WA', 1, 1),
    place('Kings Park, Perth WA', 2, 2),
    place('St Georges Terrace, Perth WA', 3, 3),
    place('100 St Georges Terrace, Perth WA', 4, 4),
  ];
  const ranked = rankForAddress(list, parsed).map((p) => p.lng);
  assert.deepEqual(ranked, [4, 3, 2, 1]);
  assert.equal(hasExactMatch(list, parsed), true);
  assert.equal(hasExactMatch(list.slice(0, 3), parsed), false);
});

test('estimateAddress interpolates between same-side neighbours', () => {
  const parsed = parseAddressQuery('20 Hay Street Perth');
  const samples = [
    place('10 Hay Street, Perth WA', 115.80, -31.95),
    place('30 Hay Street, Perth WA', 115.81, -31.95),
    place('21 Hay Street, Perth WA', 115.90, -31.95), // other side, ignored when same side has 2+
    place('20 Murray Street, Perth WA', 115.70, -31.90), // other street
  ];
  const est = estimateAddress(parsed, samples);
  assert.ok(Math.abs(est.lng - 115.805) < 1e-9);
  assert.equal(est.name, '20 Hay Street');
  assert.match(est.label, /^Estimated spot/);
  assert.equal(est.source, 'estimate');
});

test('estimateAddress refuses far-apart stretches and distant single numbers', () => {
  const parsed = parseAddressQuery('500 Hay Street');
  assert.equal(estimateAddress(parsed, [place('10 Hay Street, Perth WA', 115.8, -31.95)]), null);
  const far = [place('100 Hay Street, Perth WA', 115.70, -31.95), place('900 Hay Street, Perth WA', 115.95, -31.95)];
  assert.equal(estimateAddress(parsed, far), null); // ~24 km apart: different stretches
  assert.ok(estimateAddress(parseAddressQuery('104 Hay Street'), far)); // close to a known number
});

test('placeFromTomTom maps point addresses and POIs, rejects bad positions', () => {
  const addr = placeFromTomTom({
    id: 'abc', type: 'Point Address', position: { lat: -31.955, lon: 115.858 },
    address: { streetNumber: '12', streetName: 'Hay Street', municipalitySubdivision: 'Perth', countrySubdivisionCode: 'WA' },
  });
  assert.equal(addr.name, '12 Hay Street');
  assert.equal(addr.label, '12 Hay Street, Perth WA');
  assert.equal(addr.kind, 'address');
  const poi = placeFromTomTom({ type: 'POI', position: { lat: -31.95, lon: 115.86 }, poi: { name: 'Caltex', categories: ['petrol station'] }, address: { streetName: 'Hay Street' } });
  assert.equal(poi.name, 'Caltex');
  assert.equal(placeFromTomTom({ type: 'POI', position: { lat: 'x' } }), null);
});

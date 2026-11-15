import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  tokens, scorePlace, matchScore, rankPlaces, mergePlaces, splits, pairNearby, expandAliases, searchByName,
} from '../app/js/search/nameSearch.js';

const PERTH = [115.8605, -31.9505];
const P = (name, label, lng, lat, id = `${name}@${lng},${lat}`) => ({ id, name, label, lng, lat });

test('tokens drops filler words, accents and punctuation', () => {
  assert.deepEqual(tokens("Hoyts at the Carousel!"), ['hoyts', 'carousel']);
  assert.deepEqual(tokens('Café Crème'), ['cafe', 'creme']);
});

test('scorePlace prefers whole words in the name and short names', () => {
  const zoo = scorePlace(P('Perth Zoo', '20 Labouchere Road', 0, 0), 'perth zoo');
  const carPark = scorePlace(P('Perth Zoo Car Park', 'Darley Street', 0, 0), 'perth zoo');
  const zoom = scorePlace(P('Zoom Convenience', 'Murray Street, Perth', 0, 0), 'perth zoo');
  assert.equal(zoo.coverage, 1);
  assert.ok(zoo.quality > carPark.quality && carPark.quality > zoom.quality);
  assert.equal(matchScore(P('Hoyts', 'Cannington', 0, 0), 'hoyts carousel'), 0.5);
});

test('rankPlaces drops far partial matches but keeps far full matches', () => {
  const list = [
    P('Carousel Lane', 'Shelter Island Heights NY', -72.3, 41.1),
    P('Sydney Opera House', 'Sydney NSW', 151.21, -33.86),
    P('Kings Park Road', 'West Perth WA', 115.84, -31.95),
    P('Kings Park', 'Perth WA', 115.83, -31.96),
    P('Nothing Related', 'Perth WA', 115.86, -31.95),
  ];
  assert.deepEqual(rankPlaces(list, 'hoyts carousel', PERTH).map((p) => p.name), []);
  assert.deepEqual(rankPlaces(list, 'sydney opera house', PERTH).map((p) => p.name), ['Sydney Opera House']);
  assert.deepEqual(rankPlaces(list, 'kings park', PERTH).map((p) => p.name), ['Kings Park', 'Kings Park Road']);
});

test('mergePlaces folds the same place from two services', () => {
  const a = P('Perth Zoo', 'x', 115.853, -31.975);
  const b = P('perth zoo', 'y', 115.855, -31.976);
  const c = P('Perth Zoo', 'z', 116.5, -31.0);
  assert.equal(mergePlaces([a], [b, c]).length, 2);
});

test('splits and pairNearby find "<business> at <place>"', () => {
  assert.deepEqual(splits('hoyts carousel'), [['hoyts', 'carousel']]);
  assert.deepEqual(splits('bunnings cannington wa'), [['bunnings', 'cannington wa'], ['bunnings cannington', 'wa']]);
  assert.deepEqual(splits('kings'), []);
  const hoyts = [P('Hoyts', '1382 Albany Highway', 115.9348, -32.0221), P('Hoyts', 'Karrinyup', 115.776, -31.876)];
  const carousel = [P('Westfield Carousel', 'Cannington WA', 115.9356, -32.0225)];
  const paired = pairNearby(hoyts, carousel);
  assert.equal(paired.length, 1);
  assert.match(paired[0].label, /^At Westfield Carousel/);
});

test('expandAliases understands Aussie nicknames', () => {
  assert.equal(expandAliases('maccas cannington'), "McDonald's cannington");
  assert.equal(expandAliases('nearest bottle-o'), 'nearest liquor store');
  assert.equal(expandAliases('kings park'), 'kings park');
});

test('searchByName splits a mixed query when nothing matches every word', async () => {
  const db = {
    'hoyts carousel': [P('Carousel Lane', 'Shelter Island Heights NY', -72.3, 41.1)],
    hoyts: [P('Hoyts', '1382 Albany Highway, Cannington WA', 115.9348, -32.0221)],
    carousel: [P('Westfield Carousel', 'Cannington WA', 115.9356, -32.0225)],
  };
  const source = async (q) => db[q] ?? [];
  const failing = async () => {
    throw new Error('down');
  };
  const out = await searchByName('hoyts carousel', { near: PERTH, limit: 5 }, { sources: [source, failing] });
  assert.equal(out[0].name, 'Hoyts');
  assert.match(out[0].label, /At Westfield Carousel/);
});

test('searchByName surfaces an error only when every service fails and nothing is found', async () => {
  const failing = async () => {
    throw new Error('Place search is down');
  };
  await assert.rejects(searchByName('kings park', { near: PERTH, limit: 5 }, { sources: [failing] }), /down/);
  const empty = async () => [];
  assert.deepEqual(await searchByName('zzqx', { near: PERTH, limit: 5 }, { sources: [empty] }), []);
});

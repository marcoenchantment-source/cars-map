import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as geo from '../app/js/core/geo.js';
import { solarElevation, dayOrNight } from '../app/js/core/sun.js';
import { createStore } from '../app/js/core/store.js';
import { createBus } from '../app/js/core/bus.js';
import { createActions } from '../app/js/core/actions.js';
import { resolveSafe } from '../server/serve.mjs';

const PERTH = [115.8605, -31.9505];
const FREO = [115.7475, -32.0569];

test('haversine Perth to Fremantle is about 15.7 km', () => {
  const d = geo.haversine(PERTH, FREO);
  assert.ok(d > 15000 && d < 16500, `got ${d}`);
});

test('bearing is clockwise from north', () => {
  assert.ok(Math.abs(geo.bearing([0, 0], [0, 1]) - 0) < 1e-6);
  assert.ok(Math.abs(geo.bearing([0, 0], [1, 0]) - 90) < 1e-6);
  assert.ok(Math.abs(geo.bearing([0, 0], [0, -1]) - 180) < 1e-6);
  assert.ok(Math.abs(geo.bearing([0, 0], [-1, 0]) - 270) < 1e-6);
});

test('angleDiff returns signed smallest turn', () => {
  assert.equal(geo.angleDiff(350, 10), 20);
  assert.equal(geo.angleDiff(10, 350), -20);
  assert.equal(geo.angleDiff(0, 180), 180);
});

test('destination round-trips with haversine and bearing', () => {
  const p = geo.destination(PERTH, 1000, 45);
  assert.ok(Math.abs(geo.haversine(PERTH, p) - 1000) < 0.5);
  assert.ok(Math.abs(geo.bearing(PERTH, p) - 45) < 0.1);
});

test('cumulativeDistances, pointAlong and sliceAlong agree', () => {
  const line = [PERTH, geo.destination(PERTH, 500, 90), geo.destination(geo.destination(PERTH, 500, 90), 500, 180)];
  const cum = geo.cumulativeDistances(line);
  assert.equal(cum.length, 3);
  assert.ok(Math.abs(cum[2] - 1000) < 1);
  const mid = geo.pointAlong(line, cum, 750);
  assert.equal(mid.index, 1);
  assert.ok(Math.abs(mid.bearing - 180) < 1);
  const slice = geo.sliceAlong(line, cum, 250, 750);
  const sliceLen = geo.cumulativeDistances(slice).at(-1);
  assert.ok(Math.abs(sliceLen - 500) < 1, `slice length ${sliceLen}`);
  assert.deepEqual(geo.cumulativeDistances([]), []);
});

test('nearestOnLine snaps onto the right segment and respects a window', () => {
  const a = PERTH;
  const b = geo.destination(a, 1000, 90);
  const line = [a, b];
  const cum = geo.cumulativeDistances(line);
  const off = geo.destination(geo.destination(a, 400, 90), 20, 0);
  const hit = geo.nearestOnLine(line, cum, off);
  assert.ok(Math.abs(hit.along - 400) < 1);
  assert.ok(Math.abs(hit.dist - 20) < 0.5);
  assert.equal(geo.nearestOnLine([], [], off), null);
  const single = geo.nearestOnLine([a], [0], off);
  assert.equal(single.index, 0);
});

test('segmentIndexAt clamps both ends', () => {
  const cum = [0, 10, 20, 30];
  assert.equal(geo.segmentIndexAt(cum, -5), 0);
  assert.equal(geo.segmentIndexAt(cum, 15), 1);
  assert.equal(geo.segmentIndexAt(cum, 99), 2);
});

test('simplify keeps ends and drops collinear points', () => {
  const pts = Array.from({ length: 50 }, (_, i) => geo.destination(PERTH, i * 10, 90));
  const s = geo.simplify(pts, 2);
  assert.equal(s.length, 2);
  assert.deepEqual(s[0], pts[0]);
  assert.deepEqual(s.at(-1), pts.at(-1));
  assert.equal(geo.simplify([PERTH], 5).length, 1);
});

test('bboxOf returns west, south, east, north', () => {
  assert.deepEqual(geo.bboxOf([PERTH, FREO]), [FREO[0], FREO[1], PERTH[0], PERTH[1]]);
});

test('decodePolyline decodes the Google reference example', () => {
  const pts = geo.decodePolyline('_p~iF~ps|U_ulLnnqC_mqNvxq`@', 5);
  assert.deepEqual(pts, [[-120.2, 38.5], [-120.95, 40.7], [-126.453, 43.252]]);
});

test('geohash encodes, bounds contain the point, neighbours are 9 cells', () => {
  const h = geo.geohashEncode(-31.9505, 115.8605, 6);
  assert.equal(h.length, 6);
  const b = geo.geohashBounds(h);
  assert.ok(b.south <= -31.9505 && b.north >= -31.9505 && b.west <= 115.8605 && b.east >= 115.8605);
  const n = geo.geohashNeighbors(h);
  assert.equal(n.length, 9);
  assert.ok(n.includes(h));
  assert.equal(geo.geohashEncode(57.64911, 10.40744, 11), 'u4pruydqqvj');
  assert.throws(() => geo.geohashBounds('a!'));
});

test('formatDistance rounds sensibly in both unit systems', () => {
  assert.equal(geo.formatDistance(37).text, '40 m');
  assert.equal(geo.formatDistance(330).text, '350 m');
  assert.equal(geo.formatDistance(990).text, '1.0 km');
  assert.equal(geo.formatDistance(12345).text, '12 km');
  assert.equal(geo.formatDistance(4321).text, '4.3 km');
  assert.equal(geo.formatDistance(NaN).text, '–');
  assert.equal(geo.formatDistance(100, 'imperial').text, '330 ft');
  assert.equal(geo.formatDistance(5000, 'imperial').text, '3.1 mi');
});

test('spokenDistance reads naturally', () => {
  assert.equal(geo.spokenDistance(300), '300 metres');
  assert.equal(geo.spokenDistance(1000), '1 kilometre');
  assert.equal(geo.spokenDistance(2500), '2.5 kilometres');
  assert.equal(geo.spokenDistance(800, 'imperial'), 'half a mile');
});

test('formatDuration and speedForDisplay', () => {
  assert.equal(geo.formatDuration(20), '< 1 min');
  assert.equal(geo.formatDuration(720), '12 min');
  assert.equal(geo.formatDuration(3900), '1 h 05 min');
  assert.equal(geo.speedForDisplay(27.78), 100);
  assert.equal(geo.speedForDisplay(-1), 0);
  assert.equal(geo.speedForDisplay(10, 'imperial'), 22);
});

test('sun: Perth is daytime at 10 am local and night at 10 pm local', () => {
  // AWST is UTC+8, so 10:00 local = 02:00 UTC
  const morning = new Date('2026-11-10T02:00:00Z');
  const night = new Date('2026-11-10T14:00:00Z');
  assert.ok(solarElevation(morning, -31.95, 115.86) > 30);
  assert.ok(solarElevation(night, -31.95, 115.86) < -20);
  assert.equal(dayOrNight(40), 'light');
  assert.equal(dayOrNight(-10), 'dark');
  assert.equal(dayOrNight(-2, 'light'), 'light'); // hysteresis
  assert.equal(dayOrNight(-2, 'dark'), 'dark');
});

test('store merges immutably and notifies selectors only on change', () => {
  const store = createStore({ a: 1, b: { c: 1 } });
  const seen = [];
  store.select((s) => s.a, (v) => seen.push(v));
  const before = store.get();
  store.set({ b: { c: 2 } });
  store.set((s) => ({ a: s.a + 1 }));
  store.set(() => null);
  assert.deepEqual(seen, [2]);
  assert.equal(before.b.c, 1);
  assert.ok(Object.isFrozen(store.get()));
});

test('bus isolates failing handlers', () => {
  const bus = createBus();
  const got = [];
  bus.on('x', () => {
    throw new Error('boom');
  });
  bus.on('x', (p) => got.push(p));
  bus.once('x', (p) => got.push(`once:${p}`));
  const origError = console.error;
  console.error = () => {};
  bus.emit('x', 1);
  bus.emit('x', 2);
  console.error = origError;
  assert.deepEqual(got, [1, 'once:1', 2]);
});

test('actions registry calls and rejects unknown names', async () => {
  const actions = createActions();
  actions.register('add', (a, b) => a + b);
  assert.equal(await actions.call('add', 2, 3), 5);
  assert.ok(actions.has('add'));
  await assert.rejects(actions.call('nope'), /not available/);
  assert.throws(() => actions.register('bad', 42));
});

test('static server refuses path traversal and hidden files', () => {
  const appRoot = resolveSafe('/').replace(/index\.html$/, '');
  const escaped = resolveSafe('/../../etc/passwd');
  assert.ok(escaped === null || escaped.startsWith(appRoot), `escaped root: ${escaped}`);
  const encoded = resolveSafe('/%2e%2e/%2e%2e/secret');
  assert.ok(encoded === null || encoded.startsWith(appRoot), `escaped root: ${encoded}`);
  assert.equal(resolveSafe('/.git/config'), null);
  assert.equal(resolveSafe('/%E0%A4%A'), null);
  assert.ok(resolveSafe('/js/main.js').endsWith('main.js'));
  assert.ok(resolveSafe('/').endsWith('index.html'));
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { destination } from '../app/js/core/geo.js';
import {
  TRIP_LIMITS, capTrips, cleanName, removeTrip, sanitizeTrips, tripChars, upsertTrip, withPlaceNames,
} from '../app/js/history/tripsModel.js';
import { createTripStore } from '../app/js/history/tripStore.js';
import { bigDistance, tripPlaces, tripTotals, tripWhen, uniqueRoadKm } from '../app/js/history/stats.js';

const START = [115.8605, -31.9505];

function makeTrip(i, points = 50) {
  const line = Array.from({ length: points }, (_, k) => destination(START, k * 40, 0).map((v) => Math.round((v + i * 1e-4) * 1e6) / 1e6));
  const startedAt = Date.UTC(2026, 0, 1) + i * 3600000;
  return { id: `trip-${startedAt}`, startedAt, endedAt: startedAt + 600000, distance: (points - 1) * 40, duration: 600, maxSpeed: 20, line };
}

function memoryStorage(initial = {}, { failAbove = Infinity } = {}) {
  const data = { ...initial };
  return {
    data,
    load: (k, fb) => (k in data ? JSON.parse(JSON.stringify(data[k])) : fb),
    save: (k, v) => {
      if (JSON.stringify(v).length > failAbove) return false;
      data[k] = v;
      return true;
    },
  };
}

test('sanitizeTrips drops bad entries and duplicates and sorts newest first', () => {
  const a = makeTrip(1);
  const b = makeTrip(2);
  const list = sanitizeTrips([a, null, { id: 'x' }, { ...b, line: [[999, 0], [1, 1]] }, b, a, 'junk']);
  assert.deepEqual(list.map((t) => t.id), [b.id, a.id]);
  assert.deepEqual(sanitizeTrips('nope'), []);
});

test('capTrips keeps the newest within the count limit', () => {
  const trips = sanitizeTrips(Array.from({ length: 300 }, (_, i) => makeTrip(i, 3)));
  const capped = capTrips(trips);
  assert.equal(capped.length, TRIP_LIMITS.maxTrips);
  assert.equal(capped[0].id, trips[0].id);
  assert.equal(trips.length, 300, 'input untouched');
});

test('capTrips keeps the total under the character budget', () => {
  const trips = sanitizeTrips(Array.from({ length: 40 }, (_, i) => makeTrip(i, 200)));
  const one = tripChars(trips[0]);
  const capped = capTrips(trips, { maxChars: one * 10 + 2 });
  assert.equal(capped.length, 10);
  assert.ok(JSON.stringify(capped).length <= one * 10 + 2);
  assert.equal(capped[0].id, trips[0].id, 'oldest are the ones dropped');
});

test('default budget stays well under the 5 MB localStorage quota', () => {
  assert.ok(TRIP_LIMITS.maxChars <= 2.6 * 1024 * 1024);
  const trips = sanitizeTrips(Array.from({ length: 250 }, (_, i) => makeTrip(i, 800)));
  const capped = capTrips(trips);
  assert.ok(JSON.stringify(capped).length <= TRIP_LIMITS.maxChars);
  assert.ok(capped.length < 250);
});

test('upsert replaces by id and remove deletes', () => {
  const a = makeTrip(1);
  const b = makeTrip(2);
  let list = upsertTrip([a], b);
  assert.deepEqual(list.map((t) => t.id), [b.id, a.id]);
  list = upsertTrip(list, { ...a, distance: 1 });
  assert.equal(list.length, 2);
  assert.equal(list.find((t) => t.id === a.id).distance, 1);
  assert.deepEqual(removeTrip(list, b.id).map((t) => t.id), [a.id]);
});

test('place names are cleaned and merged immutably', () => {
  assert.equal(cleanName('  Hay   Street '), 'Hay Street');
  assert.equal(cleanName(42), '');
  assert.ok(cleanName('x'.repeat(100)).length <= TRIP_LIMITS.maxNameLength);
  const a = makeTrip(1);
  const named = withPlaceNames(a, { from: 'Joondalup', to: '' });
  assert.equal(named.from, 'Joondalup');
  assert.equal(named.to, undefined);
  assert.equal(a.from, undefined);
});

test('trip store persists, notifies and retries smaller when the quota is hit', () => {
  const storage = memoryStorage();
  const store = createTripStore(storage);
  let calls = 0;
  store.subscribe(() => calls++);
  store.upsert(makeTrip(1));
  store.upsert(makeTrip(2));
  assert.equal(store.list().length, 2);
  assert.equal(storage.data.trips.length, 2);
  store.update(makeTrip(1).id, (t) => withPlaceNames(t, { from: 'Perth' }));
  assert.equal(store.get(makeTrip(1).id).from, 'Perth');
  store.remove(makeTrip(2).id);
  assert.equal(store.list().length, 1);
  assert.equal(calls, 4);

  const reloaded = createTripStore(storage);
  assert.equal(reloaded.list()[0].from, 'Perth');

  const one = tripChars(makeTrip(0, 100));
  const tight = memoryStorage({}, { failAbove: one * 3 });
  const small = createTripStore(tight, { maxTrips: 250, maxChars: one * 5 + 2 });
  for (let i = 0; i < 5; i++) small.upsert(makeTrip(i, 100));
  assert.ok(tight.data.trips.length <= 3, `kept ${tight.data.trips.length}`);
});

test('roads explored counts a road driven twice once', () => {
  const a = makeTrip(0, 101); // 4 km north
  const once = uniqueRoadKm([a]);
  const twice = uniqueRoadKm([a, { ...a, id: 'again' }]);
  assert.equal(once, twice);
  assert.ok(once > 3.5 && once < 5.5, `km ${once}`);
  const totals = tripTotals([a, { ...a, id: 'again' }]);
  assert.equal(totals.count, 2);
  assert.equal(totals.distance, 8000);
});

test('labels: dates in en-AU, places, big distances', () => {
  const now = new Date(2026, 10, 10, 12, 0).getTime();
  assert.match(tripWhen(new Date(2026, 10, 10, 8, 42).getTime(), now), /^Today · 8:42 am$/);
  assert.match(tripWhen(new Date(2026, 10, 9, 17, 5).getTime(), now), /^Yesterday · 5:05 pm$/);
  assert.match(tripWhen(new Date(2026, 10, 6, 9, 0).getTime(), now), /^Fri 6 Nov · 9:00 am$/);
  assert.equal(tripPlaces({ from: 'A', to: 'B' }), 'A → B');
  assert.equal(tripPlaces({ to: 'B' }), 'To B');
  assert.equal(tripPlaces({}), '');
  assert.deepEqual(bigDistance(42500), { value: '42.5', unit: 'km' });
  assert.deepEqual(bigDistance(1284000), { value: '1,284', unit: 'km' });
  assert.equal(bigDistance(1609.344, 'imperial').unit, 'mi');
});

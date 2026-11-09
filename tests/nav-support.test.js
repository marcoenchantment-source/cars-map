import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as geo from '../app/js/core/geo.js';
import { createFixGate, createPoseSmoother, fixFromPosition } from '../app/js/nav/fixFilter.js';
import { createSimulator } from '../app/js/nav/simulate.js';
import { createTripRecorder } from '../app/js/nav/trip.js';
import { buildTripReport } from '../app/js/nav/report.js';
import { feedbackEntry, upsertFeedback, saveFeedback } from '../app/js/nav/feedback.js';
import { maneuverKind, describeManeuver, ordinal, shortLabel } from '../app/js/nav/maneuver.js';
import { lowerFirst, planAnnouncement } from '../app/js/nav/announce.js';
import { normalizeRoute, endPlace } from '../app/js/nav/route.js';
import { pickRoute } from '../app/js/nav/rerouter.js';
import { formatClock, formatClockParts } from '../app/js/nav/format.js';
import { createNavigator } from '../app/js/nav/engine.js';
import { buildRoute, PERTH } from './nav-helpers.js';

const pos = (lng, lat, extra = {}) => ({
  coords: { longitude: lng, latitude: lat, accuracy: 5, speed: null, heading: null, ...extra.coords },
  timestamp: extra.timestamp ?? 1000,
});

test('fixFromPosition maps coords and cleans invalid speed/heading', () => {
  const f = fixFromPosition(pos(115.86, -31.95, { coords: { speed: -1, heading: -1 }, timestamp: 5 }));
  assert.deepEqual(f, { lng: 115.86, lat: -31.95, accuracy: 5, speed: null, heading: null, timestamp: 5, simulated: false });
  assert.equal(fixFromPosition({ coords: { longitude: NaN, latitude: 1 } }), null);
  assert.equal(fixFromPosition(null), null);
});

test('gate drops poor accuracy once a good fix exists, and stale repeats', () => {
  const gate = createFixGate();
  assert.equal(gate.accept({ lng: 1, lat: 1, accuracy: 900, timestamp: 1 }), true, 'coarse fix ok before any good one');
  assert.equal(gate.accept({ lng: 1, lat: 1, accuracy: 10, timestamp: 2 }), true);
  assert.equal(gate.accept({ lng: 1, lat: 1, accuracy: 400, timestamp: 3 }), false);
  assert.equal(gate.accept({ lng: 1, lat: 1, accuracy: 10, timestamp: 3 }), true);
  assert.equal(gate.accept({ lng: 1, lat: 1, accuracy: 10, timestamp: 3 }), false, 'duplicate timestamp');
  assert.equal(gate.accept({ lng: 1, lat: 1, accuracy: 400, timestamp: 30000 }), true, 'coarse allowed after good fixes go stale');
});

test('smoother derives heading from movement and holds still while parked', () => {
  const s = createPoseSmoother();
  const a = PERTH;
  const b = geo.destination(a, 20, 90);
  const first = s.next({ lng: a[0], lat: a[1], accuracy: 5, speed: null, heading: null, timestamp: 0 });
  assert.equal(first.heading, null);
  const moved = s.next({ lng: b[0], lat: b[1], accuracy: 5, speed: null, heading: null, timestamp: 2000 });
  assert.ok(Math.abs(moved.heading - 90) < 1);
  assert.ok(Math.abs(moved.speed - 10) < 0.5);
  const jitter = geo.destination(b, 3, 10);
  const held = s.next({ lng: jitter[0], lat: jitter[1], accuracy: 8, speed: 0.2, heading: null, timestamp: 3000 });
  assert.equal(held.lng, b[0]);
  assert.equal(held.lat, b[1]);
  assert.ok(Math.abs(held.heading - 90) < 1, 'heading kept while still');
  const far = geo.destination(b, 30, 90);
  const go = s.next({ lng: far[0], lat: far[1], accuracy: 8, speed: 9, heading: 92, timestamp: 4000 });
  assert.equal(go.lng, far[0]);
  assert.equal(go.heading, 92);
});

test('simulator drives the whole route, slows for turns and reports scaled speed', () => {
  const route = buildRoute([{ dist: 800, brg: 0 }, { dist: 600, brg: 90 }]);
  const sim = createSimulator(route, { speedFactor: 2 });
  const fixes = [];
  for (let i = 0; i < 400 && !sim.done(); i++) fixes.push(sim.step(1));
  assert.ok(sim.done());
  assert.equal(fixes.at(-1).done, true);
  const nearTurn = fixes.filter((f) => Math.abs(f.along - 800) < 40).map((f) => f.speed / 2);
  const cruise = fixes.filter((f) => f.along > 200 && f.along < 500).map((f) => f.speed / 2);
  assert.ok(Math.min(...nearTurn) < Math.max(...cruise), 'brakes for the turn');
  assert.ok(Math.max(...cruise) <= 13.9 + 0.01);
  sim.setFactor(10);
  assert.equal(sim.factor(), 10);
  assert.throws(() => createSimulator({ geometry: [] }));
});

test('simulated drive through the engine arrives exactly once', () => {
  const route = buildRoute([{ dist: 900, brg: 0 }, { dist: 500, brg: 270 }]);
  const sim = createSimulator(route, { speedFactor: 4 });
  let t = 0;
  const nav = createNavigator(route, { now: () => t });
  const types = [];
  for (let i = 0; i < 200; i++) {
    t += 1000;
    const f = sim.step(1);
    const r = nav.update({ ...f, accuracy: 5, timestamp: t });
    types.push(...r.events.map((e) => e.type));
    if (f.done && i > 5) break;
  }
  assert.equal(types.filter((x) => x === 'arrive').length, 1);
  assert.equal(types.includes('offroute'), false);
});

test('trip recorder sums distance, max speed and simplifies the track', () => {
  const trip = createTripRecorder(0);
  for (let i = 0; i <= 100; i++) {
    const p = geo.destination(PERTH, i * 10, 0);
    trip.add({ lng: p[0], lat: p[1], speed: i === 50 ? 30 : 10, accuracy: 5, simulated: false });
  }
  trip.noteReroute();
  const t = trip.finish(100_000);
  assert.ok(Math.abs(t.distance - 1000) < 2);
  assert.equal(t.maxSpeed, 30);
  assert.equal(t.duration, 100);
  assert.ok(Math.abs(t.avgSpeed - 10) < 0.1);
  assert.equal(t.track.length, 2, 'straight line simplifies to its ends');
  assert.equal(t.reroutes, 1);
  assert.equal(t.medianAccuracy, 5);
});

test('trip report is short plain text with the key facts', () => {
  const start = new Date(2026, 10, 10, 10, 0).getTime();
  const text = buildTripReport({
    trip: { startedAt: start, endedAt: start + 29 * 60000, distance: 12400, duration: 1740, avgSpeed: 7.1, maxSpeed: 20, reroutes: 1, offRoutes: 1, simulated: false, fixes: 1700, medianAccuracy: 6 },
    destination: { name: 'Kings Park', label: 'Fraser Ave, Perth' },
    route: { summary: 'via Mounts Bay Rd', provider: 'osrm', distance: 11900, duration: 1500 },
    rating: 4, notes: '  Missed the second exit  ', appVersion: '1.0.0', userAgent: 'test',
  });
  assert.match(text, /^Cars Map trip report/);
  assert.match(text, /To: Kings Park \(Fraser Ave, Perth\)/);
  assert.match(text, /12 km in 29 min, average 26 km\/h, top 72 km\/h/);
  assert.match(text, /Rating: ★★★★☆ \(4\/5\)/);
  assert.match(text, /Notes: Missed the second exit$/m);
  assert.match(text, /10:00 am – 10:29 am/);
});

test('feedback entries are newest first, de-duplicated and capped', () => {
  const trip = { startedAt: 1, endedAt: 2, distance: 3, duration: 4, avgSpeed: 1, maxSpeed: 2, track: [[1, 1]] };
  const e = feedbackEntry({ trip, destination: { name: 'X', lng: 1, lat: 2 }, rating: 9, notes: ' hi ' });
  assert.equal(e.rating, 5);
  assert.equal(e.notes, 'hi');
  assert.equal(e.trip.track, undefined, 'no GPS track stored');
  const list = upsertFeedback([{ id: e.id }, { id: 'old' }, null], e);
  assert.deepEqual(list.map((x) => x.id), [e.id, 'old']);
  const big = upsertFeedback(Array.from({ length: 150 }, (_, i) => ({ id: `t${i}` })), e);
  assert.equal(big.length, 100);
  assert.equal(upsertFeedback('garbage', e).length, 1);
  const mem = new Map();
  const storage = { load: (k, f) => mem.get(k) ?? f, save: (k, v) => (mem.set(k, v), true) };
  assert.equal(saveFeedback(storage, { trip, rating: 3, notes: '' }), true);
  assert.equal(mem.get('feedback').length, 1);
});

test('manoeuvre kinds, wording and ordinals', () => {
  assert.equal(maneuverKind({ type: 'turn', modifier: 'sharp left' }).kind, 'turn');
  assert.equal(maneuverKind({ type: 'turn', modifier: 'sharp left' }).degree, 'sharp');
  assert.equal(maneuverKind({ type: 'turn', modifier: 'uturn' }).kind, 'uturn');
  assert.equal(maneuverKind({ type: 'continue', modifier: 'straight' }).kind, 'straight');
  const rb = maneuverKind({ type: 'roundabout', modifier: 'right', exit: 3 });
  assert.deepEqual([rb.kind, rb.exit, rb.angle, rb.ccw], ['roundabout', 3, 90, false]);
  assert.equal(maneuverKind({ type: 'off-ramp' }).side, 'left');
  assert.equal(describeManeuver({ type: 'roundabout', exit: 2, road: 'Canning Hwy' }), 'At the roundabout, take the 2nd exit onto Canning Hwy');
  assert.equal(describeManeuver({ type: 'turn', modifier: 'left', road: '' }), 'Turn left');
  assert.equal(describeManeuver({ type: 'arrive', modifier: 'right' }), 'Your destination is on the right');
  assert.deepEqual([1, 2, 3, 4, 11, 12, 13, 21, 22].map(ordinal), ['1st', '2nd', '3rd', '4th', '11th', '12th', '13th', '21st', '22nd']);
  assert.equal(shortLabel({ type: 'turn', modifier: 'slight right' }), 'Bear right');
});

test('lowerFirst only lowercases leading verbs', () => {
  assert.equal(lowerFirst('Turn left onto Hay St'), 'turn left onto Hay St');
  assert.equal(lowerFirst('At the roundabout, take the 1st exit'), 'at the roundabout, take the 1st exit');
  assert.equal(lowerFirst('Mitchell Freeway ahead'), 'Mitchell Freeway ahead');
});

test('planAnnouncement never repeats a fired tier and skips depart', () => {
  const steps = [
    { type: 'depart', along: 0, instruction: 'Head off' },
    { type: 'turn', modifier: 'left', along: 1000, instruction: 'Turn left onto Hay St' },
    { type: 'arrive', along: 1500, instruction: 'Arrive' },
  ];
  assert.equal(planAnnouncement({ steps, stepIndex: 0, distance: 10, speed: 10 }), null);
  const a = planAnnouncement({ steps, stepIndex: 1, distance: 140, speed: 10, fired: [] });
  assert.equal(a.tier, 'mid');
  assert.deepEqual(a.marks, ['far', 'mid']);
  assert.equal(planAnnouncement({ steps, stepIndex: 1, distance: 480, speed: 10, fired: a.marks }), null);
  assert.equal(planAnnouncement({ steps, stepIndex: 1, distance: 30, speed: 10, fired: ['far', 'mid', 'now'] }), null);
  assert.equal(planAnnouncement({ steps, stepIndex: 1, distance: 180, speed: 10, fired: [] }), null, 'too close for far, not yet mid');
  assert.match(planAnnouncement({ steps, stepIndex: 1, distance: 380, speed: 10, fired: [], units: 'imperial' }).text, /quarter of a mile/);
});

test('normalizeRoute fills ids and endPlace names the route end', () => {
  const route = buildRoute([{ dist: 300, brg: 0 }]);
  const n = normalizeRoute({ ...route, id: undefined, duration: 0 });
  assert.ok(n.id.startsWith('route-'));
  assert.ok(n.duration > 0);
  const p = endPlace(n);
  assert.equal(p.lng, n.geometry.at(-1)[0]);
  assert.equal(p.name, 'Destination');
});

test('pickRoute accepts an array or a single route and rejects junk', () => {
  const r = { geometry: [[1, 1], [2, 2]] };
  assert.equal(pickRoute([null, { geometry: [] }, r]), r);
  assert.equal(pickRoute(r), r);
  assert.equal(pickRoute(undefined), null);
});

test('clock formatting is en-AU 12-hour with lowercase am/pm', () => {
  const t = new Date(2026, 10, 10, 10, 42).getTime();
  assert.equal(formatClock(t), '10:42 am');
  assert.deepEqual(formatClockParts(new Date(2026, 10, 10, 15, 5).getTime()), { time: '3:05', period: 'pm' });
  assert.equal(formatClock(NaN), '–');
});

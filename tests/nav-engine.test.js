import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createNavigator } from '../app/js/nav/engine.js';
import { buildRoute, fixAt, clock, drive } from './nav-helpers.js';

const STRAIGHT = () => buildRoute([{ dist: 2000, brg: 0, road: 'Hay Street' }]);
const L_SHAPE = () => buildRoute([{ dist: 1000, brg: 0, road: 'Hay Street' }, { dist: 800, brg: 90, road: 'Barrack Street' }]);
// Square loop that then re-drives the first leg: along 0-600 and 1600-2200 share the same road.
const LOOP = () =>
  buildRoute([
    { dist: 600, brg: 0, road: 'North Rd' },
    { dist: 400, brg: 90, road: 'East Rd' },
    { dist: 600, brg: 180, road: 'South Rd' },
    { dist: 400, brg: 270, road: 'West Rd' },
    { dist: 600, brg: 0, road: 'North Rd' },
  ]);
// Out and back on the same road.
const OUT_BACK = () => buildRoute([{ dist: 500, brg: 0, road: 'Up St' }, { dist: 500, brg: 180, road: 'Up St' }]);

function navFor(route, c = clock()) {
  return { nav: createNavigator(route, { now: c.now }), c };
}

test('snaps a fix beside the line onto it', () => {
  const route = STRAIGHT();
  const { nav, c } = navFor(route);
  const { progress } = nav.update(fixAt(route, 500, { offset: 10, t: c.tick() }));
  assert.ok(Math.abs(progress.along - 500) < 2, `along ${progress.along}`);
  assert.equal(progress.onRoute, true);
  assert.ok(Math.abs(progress.offRouteMeters - 10) < 1);
  assert.ok(Math.abs(progress.distanceRemaining - 1500) < 3);
  assert.ok(Math.abs(progress.bearing - 0) < 1 || Math.abs(progress.bearing - 360) < 1);
});

test('rejects invalid fixes without throwing', () => {
  const { nav } = navFor(STRAIGHT());
  const r = nav.update({ lng: NaN, lat: 1 });
  assert.deepEqual(r.events, []);
  assert.equal(r.progress.along, 0);
});

test('normalises a route with missing cum and steps', () => {
  const route = STRAIGHT();
  const { nav } = navFor({ ...route, cum: undefined, steps: undefined });
  const steps = nav.route().steps;
  assert.equal(steps[0].type, 'depart');
  assert.equal(steps.at(-1).type, 'arrive');
  assert.throws(() => createNavigator({ geometry: [[1, 1]] }), /too short/);
});

test('advances steps by along and emits step events once per change', () => {
  const route = L_SHAPE();
  const { nav, c } = navFor(route);
  const first = nav.update(fixAt(route, 100, { t: c.tick() }));
  assert.equal(first.progress.stepIndex, 1);
  assert.equal(first.events.filter((e) => e.type === 'step').length, 1);
  assert.ok(Math.abs(first.progress.distanceToManeuver - 900) < 2);
  assert.equal(first.progress.currentRoad, 'Hay Street');
  const same = nav.update(fixAt(route, 200, { t: c.tick() }));
  assert.equal(same.events.filter((e) => e.type === 'step').length, 0);
  const after = nav.update(fixAt(route, 1050, { t: c.tick(4000) }));
  assert.equal(after.progress.stepIndex, 2);
  assert.equal(after.events.find((e) => e.type === 'step').step.type, 'arrive');
  assert.equal(after.progress.currentRoad, 'Barrack Street');
});

test('never snaps backwards onto the first pass of a looping route', () => {
  const route = LOOP();
  const { nav, c } = navFor(route);
  const { progresses } = drive(nav, route, { from: 0, to: 2150, c });
  for (let i = 1; i < progresses.length; i++) {
    assert.ok(progresses[i].along >= progresses[i - 1].along - 0.5, `went back at ${i}: ${progresses[i - 1].along} → ${progresses[i].along}`);
  }
  const lastAlong = progresses.at(-1).along;
  assert.ok(lastAlong > 2100, `ended at ${lastAlong}`);
});

test('the start of a round trip snaps to the start, not the end', () => {
  const route = LOOP();
  const { nav, c } = navFor(route);
  const { progress, events } = nav.update(fixAt(route, 5, { t: c.tick() }));
  assert.ok(progress.along < 50, `along ${progress.along}`);
  assert.equal(events.some((e) => e.type === 'arrive'), false);
});

test('out-and-back: heading keeps the car on its own leg', () => {
  const route = OUT_BACK();
  const { nav, c } = navFor(route);
  const { progresses } = drive(nav, route, { from: 0, to: 480, c });
  assert.ok(progresses.every((p) => p.along <= 500), 'jumped onto the return leg');
  const back = drive(nav, route, { from: 520, to: 950, c });
  assert.ok(back.progresses.at(-1).along > 900);
});

test('off-route only after N consecutive moving fixes beyond the threshold', () => {
  const route = STRAIGHT();
  const { nav, c } = navFor(route);
  drive(nav, route, { from: 0, to: 300, c });
  const r1 = nav.update(fixAt(route, 320, { offset: 100, t: c.tick() }));
  const r2 = nav.update(fixAt(route, 335, { offset: 110, t: c.tick() }));
  assert.equal(r1.events.some((e) => e.type === 'offroute'), false);
  assert.equal(r2.events.some((e) => e.type === 'offroute'), false);
  assert.equal(r2.progress.onRoute, false);
  const r3 = nav.update(fixAt(route, 350, { offset: 120, t: c.tick() }));
  assert.equal(r3.events.filter((e) => e.type === 'offroute').length, 1);
  assert.equal(r3.progress.offRoute, true);
  const r4 = nav.update(fixAt(route, 365, { offset: 130, t: c.tick() }));
  assert.equal(r4.events.some((e) => e.type === 'offroute'), false, 'fires once per episode');
  const back = nav.update(fixAt(route, 380, { t: c.tick() }));
  assert.equal(back.progress.offRoute, false);
  assert.equal(back.progress.onRoute, true);
});

test('stationary fixes off the line never trigger off-route', () => {
  const route = STRAIGHT();
  const { nav, c } = navFor(route);
  drive(nav, route, { from: 0, to: 200, c });
  for (let i = 0; i < 6; i++) {
    const r = nav.update(fixAt(route, 200, { offset: 90, speed: 0, t: c.tick() }));
    assert.equal(r.events.some((e) => e.type === 'offroute'), false);
  }
});

test('accuracy widens the off-route threshold', () => {
  const route = STRAIGHT();
  const { nav, c } = navFor(route);
  drive(nav, route, { from: 0, to: 200, c });
  for (let i = 0; i < 5; i++) {
    const r = nav.update(fixAt(route, 215 + i * 14, { offset: 60, accuracy: 50, t: c.tick() }));
    assert.equal(r.progress.onRoute, true, '60 m off with 50 m accuracy is still on route');
  }
});

test('before joining the route, a car park beside the start does not cause re-routing', () => {
  const route = STRAIGHT();
  const { nav, c } = navFor(route);
  for (let i = 0; i < 6; i++) {
    const r = nav.update(fixAt(route, i * 5, { offset: 80, speed: 3, t: c.tick() }));
    assert.equal(r.events.some((e) => e.type === 'offroute'), false);
  }
});

test('replaceRoute resets matching and step state', () => {
  const route = L_SHAPE();
  const { nav, c } = navFor(route);
  drive(nav, route, { from: 0, to: 400, c });
  for (let i = 0; i < 3; i++) nav.update(fixAt(route, 420 + i * 14, { offset: 150, t: c.tick() }));
  assert.equal(nav.progress().offRoute, true);
  const fresh = buildRoute([{ dist: 700, brg: 90, road: 'New Road' }], { start: [nav.progress().snapped[0], nav.progress().snapped[1]], id: 'new' });
  const initial = nav.replaceRoute(fresh);
  assert.equal(initial.routeId, 'new');
  assert.equal(initial.offRoute, false);
  const r = nav.update(fixAt(fresh, 20, { t: c.tick() }));
  assert.equal(r.progress.routeId, 'new');
  assert.ok(r.events.some((e) => e.type === 'step'));
  assert.ok(Math.abs(r.progress.distanceRemaining - 680) < 3);
});

test('arrives once near the end', () => {
  const route = STRAIGHT();
  const { nav, c } = navFor(route);
  const { events } = drive(nav, route, { from: 0, to: 2000, c });
  assert.equal(events.filter((e) => e.type === 'arrive').length, 1);
  const arriveAt = events.find((e) => e.type === 'arrive').along;
  assert.ok(arriveAt >= 2000 - 40, `arrived early at ${arriveAt}`);
  const after = nav.update(fixAt(route, 2000, { t: c.tick() }));
  assert.equal(after.events.length, 0);
  assert.equal(after.progress.arrived, true);
});

test('does not arrive when the route passes the destination earlier on', () => {
  // The loop's end point (top of the first leg) is driven past at along 600 of 2600.
  const route = LOOP();
  const { nav, c } = navFor(route);
  const { events } = drive(nav, route, { from: 0, to: 1500, c });
  assert.equal(events.some((e) => e.type === 'arrive'), false);
});

test('arrives when parked off the line beside the destination', () => {
  const route = L_SHAPE();
  const { nav, c } = navFor(route);
  drive(nav, route, { from: 0, to: 1700, c });
  const r = nav.update(fixAt(route, 1790, { offset: 25, speed: 0, t: c.tick() }));
  assert.ok(r.events.some((e) => e.type === 'arrive'));
});

test('urban announcements fire once each, in order far → mid → now', () => {
  const route = L_SHAPE();
  const { nav, c } = navFor(route);
  const { events } = drive(nav, route, { from: 0, to: 1790, c });
  const turn = events.filter((e) => e.type === 'announce' && e.stepIndex === 1);
  assert.deepEqual(turn.map((e) => e.tier), ['far', 'mid', 'now']);
  assert.match(turn[0].text, /^In 500 metres, turn right onto Barrack Street\.$/);
  assert.match(turn[1].text, /^In 1[45]0 metres, turn right onto Barrack Street\.$/);
  assert.equal(turn[2].text, 'Turn right onto Barrack Street.');
  assert.equal(turn[2].priority, 'high');
  assert.equal(turn[0].priority, 'normal');
  const arrive = events.filter((e) => e.type === 'announce' && e.stepIndex === 2);
  assert.ok(arrive.every((e) => e.tier !== 'now'));
  assert.ok(arrive.some((e) => /destination/.test(e.text)));
});

test('fast-road announcements use 2 km / 800 m / ~7 s', () => {
  const route = buildRoute([{ dist: 5000, brg: 0, road: 'Mitchell Freeway' }, { dist: 600, brg: 90, road: 'Exit Rd' }], { speed: 27 });
  const { nav, c } = navFor(route);
  const { events } = drive(nav, route, { from: 0, to: 5300, speed: 27, c });
  const turn = events.filter((e) => e.type === 'announce' && e.stepIndex === 1);
  assert.deepEqual(turn.map((e) => e.tier), ['far', 'mid', 'now']);
  assert.ok(5000 - turn[0].along <= 2000 && 5000 - turn[0].along > 1900);
  assert.ok(5000 - turn[1].along <= 800 && 5000 - turn[1].along > 700);
  const nowDist = 5000 - turn[2].along;
  assert.ok(nowDist <= 27 * 7 && nowDist > 27 * 5, `now at ${nowDist}`);
});

test('chains "then" when the following manoeuvre is close', () => {
  const route = buildRoute([
    { dist: 600, brg: 0, road: 'A St' },
    { dist: 80, brg: 90, road: 'B St' },
    { dist: 500, brg: 0, road: 'C St' },
  ]);
  const { nav, c } = navFor(route);
  const { events } = drive(nav, route, { from: 0, to: 640, c });
  const now = events.find((e) => e.type === 'announce' && e.stepIndex === 1 && e.tier === 'now');
  assert.equal(now.text, 'Turn right onto B St, then turn left onto C St.');
});

test('uses spoken text when a step provides it', () => {
  const route = L_SHAPE();
  const steps = route.steps.map((s, i) => (i === 1 ? { ...s, spoken: 'Turn right onto Barrack Street North' } : s));
  const { nav, c } = navFor({ ...route, steps });
  const { events } = drive(nav, { ...route, steps }, { from: 0, to: 1010, c });
  const now = events.find((e) => e.type === 'announce' && e.tier === 'now');
  assert.equal(now.text, 'Turn right onto Barrack Street North.');
});

test('ETA stays steady when driving at the planned speed and time remaining falls', () => {
  const route = L_SHAPE();
  const { nav, c } = navFor(route);
  const { progresses } = drive(nav, route, { from: 0, to: 1700, c });
  for (let i = 1; i < progresses.length; i++) {
    const drift = Math.abs(progresses[i].eta - progresses[i - 1].eta);
    assert.ok(drift < 3000, `ETA jumped ${drift} ms at ${i}`);
    assert.ok(progresses[i].durationRemaining <= progresses[i - 1].durationRemaining + 0.5);
  }
  assert.ok(Math.abs(progresses[0].durationRemaining - (1800 - 13.9) / 13.9) < 3);
});

test('small backward jitter holds position', () => {
  const route = STRAIGHT();
  const { nav, c } = navFor(route);
  nav.update(fixAt(route, 500, { t: c.tick() }));
  const r = nav.update(fixAt(route, 494, { speed: 0.5, t: c.tick() }));
  assert.equal(r.progress.along, nav.progress().along);
  assert.ok(Math.abs(r.progress.along - 500) < 1);
});

test('progress is frozen (never mutated by consumers)', () => {
  const route = STRAIGHT();
  const { nav, c } = navFor(route);
  const { progress } = nav.update(fixAt(route, 100, { t: c.tick() }));
  assert.ok(Object.isFrozen(progress));
});

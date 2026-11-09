import { test } from 'node:test';
import assert from 'node:assert/strict';
import { destination } from '../app/js/core/geo.js';
import {
  RECORDER, buildTrip, createRecorderState, finishTrip, isRecordableFix, markGap, stepRecorder, startRecorder, fixSpeed,
} from '../app/js/history/recorder.js';
import { createBus } from '../app/js/core/bus.js';

const START = [115.8605, -31.9505];
const T0 = Date.UTC(2026, 10, 10, 2, 0, 0);

/** Fixes driving north at `speed` m/s, one per second. */
function drive({ from = START, seconds = 60, speed = 15, t0 = T0, heading = 0, extra = {} } = {}) {
  const out = [];
  for (let i = 0; i <= seconds; i++) {
    const p = destination(from, speed * i, heading);
    out.push({ lng: p[0], lat: p[1], accuracy: 8, speed, heading, timestamp: t0 + i * 1000, simulated: false, ...extra });
  }
  return out;
}

function feed(state, fixes) {
  const finished = [];
  let s = state;
  for (const f of fixes) {
    const r = stepRecorder(s, f);
    s = r.state;
    if (r.finished) finished.push(r.finished);
  }
  return { state: s, finished };
}

test('simulated and inaccurate fixes are ignored', () => {
  const base = drive({ seconds: 1 })[0];
  assert.equal(isRecordableFix({ ...base, simulated: true }), false);
  assert.equal(isRecordableFix({ ...base, accuracy: 31 }), false);
  assert.equal(isRecordableFix({ ...base, accuracy: null }), false);
  assert.equal(isRecordableFix(base), true);
  const { state } = feed(createRecorderState(), drive({ extra: { simulated: true } }));
  assert.equal(state.trip, null);
});

test('only moving fixes build a trip; slow fixes do not start one', () => {
  const slow = feed(createRecorderState(), drive({ speed: 1.5 }));
  assert.equal(slow.state.trip, null);
  const { state } = feed(createRecorderState(), drive({ seconds: 60, speed: 15 }));
  assert.ok(state.trip);
  assert.ok(Math.abs(state.trip.distance - 900) < 5, `distance ${state.trip.distance}`);
  assert.equal(state.trip.maxSpeed, 15);
});

test('speed is derived from positions when the device gives none', () => {
  assert.equal(fixSpeed({ speed: null }, 30, 2), 15);
  assert.equal(fixSpeed({ speed: 4 }, 30, 2), 4);
  assert.equal(fixSpeed({ speed: null }, 30, 0), 0);
  const { state } = feed(createRecorderState(), drive({ extra: { speed: null } }));
  assert.ok(state.trip && state.trip.distance > 800);
});

test('a stop of more than 10 minutes splits the trip', () => {
  const leg1 = drive({ seconds: 60 });
  const end1 = leg1[leg1.length - 1];
  const tStop = end1.timestamp;
  // parked: stationary fixes every 30 s for 11 minutes
  const parked = Array.from({ length: 22 }, (_, i) => ({ ...end1, speed: 0, timestamp: tStop + (i + 1) * 30000 }));
  const leg2 = drive({ from: [end1.lng, end1.lat], seconds: 60, t0: tStop + 23 * 30000 });
  const { state, finished } = feed(createRecorderState(), [...leg1, ...parked, ...leg2]);
  assert.equal(finished.length, 1);
  assert.equal(finished[0].startedAt, T0);
  assert.equal(finished[0].endedAt, end1.timestamp);
  assert.equal(finished[0].duration, 60);
  assert.ok(state.trip, 'second trip open');
  assert.equal(state.trip.startedAt, leg2[0].timestamp);
});

test('a short stop (traffic lights) keeps one trip', () => {
  const leg1 = drive({ seconds: 30 });
  const end1 = leg1[leg1.length - 1];
  const wait = Array.from({ length: 6 }, (_, i) => ({ ...end1, speed: 0, timestamp: end1.timestamp + (i + 1) * 10000 }));
  const leg2 = drive({ from: [end1.lng, end1.lat], seconds: 30, t0: end1.timestamp + 70000 });
  const { state, finished } = feed(createRecorderState(), [...leg1, ...wait, ...leg2]);
  assert.equal(finished.length, 0);
  assert.equal(state.trip.startedAt, T0);
});

test('after the app was hidden, a big jump starts a new trip', () => {
  const leg1 = drive({ seconds: 40 });
  let { state } = feed(createRecorderState(), leg1);
  state = markGap(state);
  const end1 = leg1[leg1.length - 1];
  const far = destination([end1.lng, end1.lat], 2000, 90);
  const leg2 = drive({ from: far, seconds: 40, t0: end1.timestamp + 120000 });
  const r = feed(state, leg2);
  assert.equal(r.finished.length, 1);
  assert.equal(r.state.trip.startedAt, leg2[0].timestamp);
});

test('GPS glitches (impossible jumps) are skipped', () => {
  const leg = drive({ seconds: 20 });
  const glitch = { ...leg[10], lng: leg[10].lng + 0.05, timestamp: leg[10].timestamp + 500 };
  const { state } = feed(createRecorderState(), [...leg.slice(0, 11), glitch, ...leg.slice(11)]);
  assert.ok(state.trip.distance < 320, `distance ${state.trip.distance}`);
});

test('buildTrip simplifies and rounds the line, drops short trips', () => {
  const { state } = feed(createRecorderState(), drive({ seconds: 60 }));
  const trip = buildTrip(state.trip);
  assert.equal(trip.id, `trip-${T0}`);
  assert.ok(trip.line.length >= 2 && trip.line.length < 10, `points ${trip.line.length}`);
  for (const [lng, lat] of trip.line) {
    assert.equal(Math.round(lng * 1e6) / 1e6, lng);
    assert.equal(Math.round(lat * 1e6) / 1e6, lat);
  }
  const short = feed(createRecorderState(), drive({ seconds: 10 }));
  assert.equal(buildTrip(short.state.trip), null);
});

test('finishTrip closes the trip and merges the destination name', () => {
  const { state } = feed(createRecorderState(), drive({ seconds: 60 }));
  const r = finishTrip(state, { to: 'Kings Park' });
  assert.equal(r.state.trip, null);
  assert.equal(r.finished.to, 'Kings Park');
  assert.ok(state.trip, 'input state untouched');
});

test('wiring: records from the bus, finalises on nav:arrive, ignores simulated', () => {
  const bus = createBus();
  const saved = [];
  const store = { upsert: (t) => saved.push(t) };
  const stop = startRecorder({ bus }, store, { doc: null, win: null });
  for (const f of drive({ seconds: 60, extra: { simulated: true } })) bus.emit('gps:fix', f);
  bus.emit('nav:arrive', { destination: { name: 'Nowhere' } });
  assert.equal(saved.length, 0);
  for (const f of drive({ seconds: 60, t0: T0 + 100000 })) bus.emit('gps:fix', f);
  bus.emit('nav:arrive', { destination: { name: 'Cottesloe Beach' } });
  assert.equal(saved.length, 1);
  assert.equal(saved[0].to, 'Cottesloe Beach');
  stop();
  assert.equal(RECORDER.stopSplitMs, 600000);
});

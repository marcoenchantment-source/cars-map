import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCrashDetector, crashMessage, CRASH } from '../app/js/safety/crashDetect.js';

const kmh = (v) => v / 3.6;
const START = 1_000_000;
// one fix per second along a line heading east; speed in km/h
function drive(det, speedsKmh, { t0 = START, lng0 = 115.86, step = 1000, moveWhenStopped = 0 } = {}) {
  let lng = lng0;
  speedsKmh.forEach((s, i) => {
    lng += (s > 5 ? (kmh(s) * step) / 1000 : moveWhenStopped) / 94000; // ~94 km per degree at Perth
    det.update({ lng, lat: -31.95, speed: kmh(s), accuracy: 8, timestamp: t0 + i * step });
  });
}

test('a car that slams from 60 km/h to a stop and stays put raises a suspected crash', () => {
  const hits = [];
  const det = createCrashDetector({ onSuspect: (i) => hits.push(i) });
  drive(det, [60, 60, 60, 0, 0, 0, 0, 0, 0]);
  assert.equal(hits.length, 1);
  assert.equal(hits[0].reason, 'gps');
  assert.equal(hits[0].speedBeforeKmh, 60);
});

test('normal hard braking to a red light does not count', () => {
  const hits = [];
  const det = createCrashDetector({ onSuspect: (i) => hits.push(i) });
  drive(det, [60, 60, 45, 28, 12, 0, 0, 0, 0, 0, 0]); // ~1 g at most
  assert.equal(hits.length, 0);
});

test('a harsh stop that then drives on is cancelled (no alert)', () => {
  const hits = [];
  const det = createCrashDetector({ onSuspect: (i) => hits.push(i) });
  drive(det, [70, 70, 0, 0, 20, 40, 50]);
  assert.equal(hits.length, 0);
});

test('a motion-sensor jolt lowers the bar for slower crashes', () => {
  const hits = [];
  const det = createCrashDetector({ onSuspect: (i) => hits.push(i) });
  drive(det, [30, 30, 30]);
  det.motion(32, START + 2900);
  drive(det, [0, 0, 0, 0, 0, 0], { t0: START + 3000, lng0: 115.86 + 0.0003 });
  assert.equal(hits.length, 1);
  assert.equal(hits[0].reason, 'jolt');
});

test('simulated drives, poor GPS and the cooldown never raise extra alerts', () => {
  const hits = [];
  const det = createCrashDetector({ onSuspect: (i) => hits.push(i) });
  [60, 60, 0, 0, 0, 0, 0, 0].forEach((s, i) => det.update({ lng: 115.86, lat: -31.95, speed: kmh(s), accuracy: 8, timestamp: START + i * 1000, simulated: true }));
  [60, 60, 0, 0, 0, 0, 0, 0].forEach((s, i) => det.update({ lng: 115.86, lat: -31.95, speed: kmh(s), accuracy: 80, timestamp: START + i * 1000 }));
  assert.equal(hits.length, 0);
  drive(det, [60, 60, 0, 0, 0, 0, 0, 0], { t0: START + 20000 });
  drive(det, [60, 60, 0, 0, 0, 0, 0, 0], { t0: START + 40000 });
  assert.equal(hits.length, 1, 'second crash inside the cooldown is ignored');
  drive(det, [60, 60, 0, 0, 0, 0, 0, 0], { t0: START + 20000 + CRASH.cooldownMs + 10000 });
  assert.equal(hits.length, 2);
});

test('crashMessage includes the time, speed and a map link', () => {
  const msg = crashMessage({ at: Date.UTC(2026, 10, 15, 2, 42), lng: 115.86051, lat: -31.95052, speedBeforeKmh: 60 }, { timeZone: 'Australia/Perth' });
  assert.match(msg, /CRASH ALERT/);
  assert.match(msg, /10:42/);
  assert.match(msg, /60 km\/h/);
  assert.match(msg, /maps\.google\.com\/\?q=-31\.95052,115\.86051/);
  assert.match(msg, /000/);
});

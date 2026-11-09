import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normaliseLook, isHexColour, sanitiseName, popCount, createFlameTimer, flameFrame,
  metresPerPixel, carLengthMetres, facesLeft, smallDistance, validLngLat, paintName, sameLook,
  PAINTS, POP_SPACING_MS, POP_MS,
} from '../app/js/car/flames.js';
import { DEFAULT_CAR } from '../app/js/config.js';

/** Fake clock: timers run when advance() passes their due time. */
function fakeTimers() {
  let now = 0;
  let seq = 0;
  const jobs = new Map();
  const add = (fn, ms, every) => {
    seq += 1;
    jobs.set(seq, { fn, at: now + ms, every });
    return seq;
  };
  return {
    timers: {
      setTimeout: (fn, ms) => add(fn, ms, 0),
      clearTimeout: (id) => jobs.delete(id),
      setInterval: (fn, ms) => add(fn, ms, ms),
      clearInterval: (id) => jobs.delete(id),
    },
    advance(ms) {
      const end = now + ms;
      for (;;) {
        let nextId = null;
        for (const [id, j] of jobs) if (j.at <= end && (nextId == null || j.at < jobs.get(nextId).at)) nextId = id;
        if (nextId == null) break;
        const job = jobs.get(nextId);
        now = job.at;
        if (job.every) job.at += job.every;
        else jobs.delete(nextId);
        job.fn();
      }
      now = end;
    },
    pending: () => jobs.size,
  };
}

test('normaliseLook keeps a valid look and returns a new object', () => {
  const look = { name: 'Polo', color: '#FF4FA3', rim: 'dish', pat: 'triple', int: 1, body: 'ute' };
  const out = normaliseLook(look);
  assert.deepEqual(out, { ...look, color: '#ff4fa3' });
  assert.notEqual(out, look);
});

test('normaliseLook replaces every bad field with defaults', () => {
  const out = normaliseLook({ name: 42, color: 'red', rim: 'spinner', pat: 'quad', int: 2, body: 'tank' });
  assert.deepEqual(out, { ...DEFAULT_CAR });
});

test('normaliseLook survives junk input and accepts numeric strings for int', () => {
  assert.deepEqual(normaliseLook(null), { ...DEFAULT_CAR });
  assert.deepEqual(normaliseLook('x'), { ...DEFAULT_CAR });
  assert.equal(normaliseLook({ int: '5' }).int, 5);
  assert.equal(normaliseLook({ color: '#12345' }).color, DEFAULT_CAR.color);
  assert.equal(normaliseLook({ color: 'url(#x)' }).color, DEFAULT_CAR.color);
});

test('normaliseLook uses supplied defaults', () => {
  const defaults = { ...DEFAULT_CAR, name: 'Mate', color: '#000000' };
  const out = normaliseLook({ color: 'nope' }, defaults);
  assert.equal(out.name, 'Mate');
  assert.equal(out.color, '#000000');
});

test('isHexColour accepts only 6-digit hex', () => {
  assert.equal(isHexColour('#1e88e5'), true);
  assert.equal(isHexColour('#1E88E5'), true);
  for (const bad of ['1e88e5', '#fff', '#1e88e5ff', 'rgb(0,0,0)', '', null, 123, '#ggg000', '#1e88e5;x']) {
    assert.equal(isHexColour(bad), false, String(bad));
  }
});

test('sanitiseName strips control and bidi characters and caps the length', () => {
  assert.equal(sanitiseName('  Fast\u0000 ‮Eddie  '), 'Fast Eddie');
  assert.equal(sanitiseName('a'.repeat(40)).length, 20);
  assert.equal(sanitiseName('b'.repeat(40), 24).length, 24);
  assert.equal(sanitiseName(null), '');
  assert.equal(sanitiseName('<img src=x>'), '<img src=x>', 'kept as text; rendering uses textContent');
});

test('popCount maps patterns', () => {
  assert.equal(popCount('off'), 0);
  assert.equal(popCount('single'), 1);
  assert.equal(popCount('double'), 2);
  assert.equal(popCount('triple'), 3);
  assert.equal(popCount('bogus'), 0);
});

test('flame timer fires a burst now and every interval, pops spaced 190 ms', () => {
  const clock = fakeTimers();
  const pops = [];
  let t = 0;
  const timer = createFlameTimer({ pat: 'triple', int: 3 }, (i) => pops.push([i, t]), { timers: clock.timers });
  const step = (ms) => {
    t += ms;
    clock.advance(ms);
  };
  timer.start();
  assert.deepEqual(pops, [[0, 0]]);
  step(POP_SPACING_MS);
  step(POP_SPACING_MS);
  assert.deepEqual(pops.map((p) => p[0]), [0, 1, 2]);
  step(3000 - 2 * POP_SPACING_MS);
  assert.equal(pops.length, 4);
  assert.equal(pops[3][0], 0);
  timer.stop();
  assert.equal(clock.pending(), 0);
  step(10000);
  assert.equal(pops.length, 4);
});

test('flame timer with pattern off never pops, and update starts it', () => {
  const clock = fakeTimers();
  let count = 0;
  const timer = createFlameTimer({ pat: 'off', int: 1 }, () => (count += 1), { timers: clock.timers });
  timer.start();
  clock.advance(5000);
  assert.equal(count, 0);
  assert.equal(timer.running(), false);
  timer.update({ pat: 'single' });
  assert.equal(count, 1);
  clock.advance(1000);
  assert.equal(count, 2);
  assert.deepEqual(timer.config(), { pat: 'single', int: 1 });
});

test('flame timer update does not restart a stopped timer, and ignores bad values', () => {
  const clock = fakeTimers();
  let count = 0;
  const timer = createFlameTimer({ pat: 'double', int: 5 }, () => (count += 1), { timers: clock.timers, immediate: false });
  timer.update({ pat: 'single' });
  clock.advance(20000);
  assert.equal(count, 0);
  timer.start();
  timer.update({ pat: 'nope', int: 7 });
  assert.deepEqual(timer.config(), { pat: 'single', int: 5 });
  clock.advance(5000);
  assert.equal(count, 1);
});

test('manual burst clamps the count and a throwing handler does not break the timer', () => {
  const clock = fakeTimers();
  let count = 0;
  const original = console.error;
  console.error = () => {};
  try {
    const timer = createFlameTimer({ pat: 'off', int: 3 }, () => {
      count += 1;
      if (count === 1) throw new Error('boom');
    }, { timers: clock.timers });
    timer.burst(50);
    clock.advance(5000);
    assert.equal(count, 6);
  } finally {
    console.error = original;
  }
});

test('flameFrame follows the prototype keyframes', () => {
  assert.deepEqual(flameFrame(0), { scale: 0.3, opacity: 1 });
  const mid = flameFrame(POP_MS * 0.55);
  assert.ok(Math.abs(mid.scale - 1) < 1e-9 && mid.opacity === 1);
  const late = flameFrame(POP_MS * 0.9);
  assert.ok(late.scale > 1 && late.scale <= 1.15 && late.opacity < 0.3);
  assert.equal(flameFrame(POP_MS), null);
  assert.equal(flameFrame(-1), null);
  assert.equal(flameFrame(NaN), null);
  assert.deepEqual(flameFrame(POP_MS / 2, POP_MS, true), { scale: 1, opacity: 0.5 });
});

test('metresPerPixel halves per zoom level and shrinks with latitude', () => {
  const equator = metresPerPixel(0, 0);
  assert.ok(Math.abs(equator - 40075016.686 / 512) < 1e-6);
  assert.ok(Math.abs(metresPerPixel(17, 0) * 2 - metresPerPixel(16, 0)) < 1e-9);
  const perth = metresPerPixel(17, -31.95);
  assert.ok(perth < metresPerPixel(17, 0));
  assert.ok(perth > 0.5 && perth < 0.53, String(perth));
});

test('carLengthMetres keeps ~70 px on screen and grows with pitch', () => {
  const flat = carLengthMetres({ zoom: 17, lat: -31.95, pitch: 0, px: 70 });
  assert.ok(Math.abs(flat - 70 * metresPerPixel(17, -31.95)) < 1e-9);
  const tilted = carLengthMetres({ zoom: 17, lat: -31.95, pitch: 58, px: 70 });
  assert.ok(tilted > flat && tilted < flat * 1.5);
  const zoomedOut = carLengthMetres({ zoom: 15, lat: -31.95, pitch: 0, px: 70 });
  assert.ok(Math.abs(zoomedOut / flat - 4) < 1e-9);
  assert.ok(Number.isFinite(carLengthMetres({ zoom: NaN, lat: NaN, pitch: NaN })));
});

test('facesLeft flips for westward headings only', () => {
  assert.equal(facesLeft(90), false);
  assert.equal(facesLeft(0), false);
  assert.equal(facesLeft(180), false);
  assert.equal(facesLeft(270), true);
  assert.equal(facesLeft(-45), true);
  assert.equal(facesLeft(NaN), false);
});

test('smallDistance approximates metres and validLngLat rejects junk', () => {
  const d = smallDistance({ lng: 115.86, lat: -31.95 }, { lng: 115.86, lat: -31.951 });
  assert.ok(Math.abs(d - 110.54) < 0.5, String(d));
  assert.equal(smallDistance(null, { lng: 0, lat: 0 }), 0);
  assert.deepEqual(validLngLat([115.8, -31.9]), [115.8, -31.9]);
  assert.deepEqual(validLngLat({ lng: 1, lat: 2 }), [1, 2]);
  assert.equal(validLngLat([200, 0]), null);
  assert.equal(validLngLat(['x', 1]), null);
  assert.equal(validLngLat(null), null);
});

test('paint presets are valid and named', () => {
  assert.equal(PAINTS.length, 12);
  for (const p of PAINTS) assert.equal(isHexColour(p.color), true, p.name);
  assert.equal(paintName('#E53935'), 'Red');
  assert.equal(paintName('#123456'), 'Custom');
  assert.equal(sameLook(normaliseLook({}), normaliseLook({})), true);
  assert.equal(sameLook(normaliseLook({}), normaliseLook({ rim: 'mesh' })), false);
});

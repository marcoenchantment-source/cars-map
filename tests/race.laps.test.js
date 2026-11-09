import { test } from 'node:test';
import assert from 'node:assert/strict';
import { angleDiff, bearing, destination, haversine } from '../app/js/core/geo.js';
import {
  LAPS, buildTrack, canFinishRecording, createLapTimer, createRecording, crossedLine, currentLapMs, formatDelta, formatLap,
  isValidLap, lapSummary, makeStartLine, spokenLap, stepLaps, stepRecording,
} from '../app/js/race/laps.js';
import { createDemoRun, demoCircuit, demoDistanceAt } from '../app/js/race/demo.js';
import { capTracks, nextTrackName, sanitizeTracks, withLap } from '../app/js/race/tracksModel.js';

const START = [115.7845, -31.6626]; // near Wanneroo Raceway
const T0 = 1_800_000_000_000;

const fixAt = (p, timestamp, extra = {}) => ({ lng: p[0], lat: p[1], accuracy: 5, speed: 30, heading: null, timestamp, simulated: false, ...extra });

test('start line is 30 m long and perpendicular to the heading', () => {
  const line = makeStartLine(START, 40);
  assert.ok(Math.abs(haversine(line.a, line.b) - 30) < 0.05);
  assert.ok(Math.abs(haversine(START, line.a) - 15) < 0.05);
  const across = bearing(line.a, line.b);
  assert.ok(Math.abs(Math.abs(angleDiff(across, 40)) - 90) < 0.1, `bearing ${across}`);
});

test('crossing forward is detected with an interpolated time', () => {
  const line = makeStartLine(START, 0); // driving north
  const prev = fixAt(destination(START, 10, 180), T0);
  const next = fixAt(destination(START, 30, 0), T0 + 1000);
  const c = crossedLine(prev, next, line);
  assert.ok(c);
  assert.ok(Math.abs(c.t - 0.25) < 1e-3, `t ${c.t}`);
  assert.ok(Math.abs(c.time - (T0 + 250)) < 1);
  assert.ok(haversine(c.point, START) < 0.1);
});

test('crossing backwards is ignored unless asked for', () => {
  const line = makeStartLine(START, 0);
  const prev = fixAt(destination(START, 20, 0), T0);
  const next = fixAt(destination(START, 20, 180), T0 + 1000);
  assert.equal(crossedLine(prev, next, line), null);
  const any = crossedLine(prev, next, line, { anyDirection: true });
  assert.ok(any && any.forward === false);
});

test('a near miss beside the line does not count', () => {
  const line = makeStartLine(START, 0);
  const side = destination(START, 18, 90); // 18 m east: beyond the 15 m half-width
  const prev = fixAt(destination(side, 10, 180), T0);
  const next = fixAt(destination(side, 10, 0), T0 + 1000);
  assert.equal(crossedLine(prev, next, line), null);
  const inside = destination(START, 12, 90);
  assert.ok(crossedLine(fixAt(destination(inside, 10, 180), T0), fixAt(destination(inside, 10, 0), T0 + 1000), line));
});

test('a fix exactly on the line counts once', () => {
  const line = makeStartLine(START, 0);
  const a = fixAt(destination(START, 10, 180), T0);
  const b = fixAt(START, T0 + 500);
  const c = fixAt(destination(START, 10, 0), T0 + 1000);
  assert.ok(crossedLine(a, b, line));
  assert.equal(crossedLine(b, c, line), null);
});

test('moving parallel to the line never crosses', () => {
  const line = makeStartLine(START, 0);
  assert.equal(crossedLine(fixAt(destination(START, 5, 270), T0), fixAt(destination(START, 5, 90), T0 + 1000), line), null);
});

test('lap validity needs 200 m and 10 s', () => {
  assert.equal(isValidLap(9999, 1000), false);
  assert.equal(isValidLap(60000, 199), false);
  assert.equal(isValidLap(10000, 200), true);
});

/** Laps around the demo circuit at a given speed, 1 Hz like real GPS. */
function lapFixes(track, speeds, t0 = T0) {
  const out = [];
  const run = createDemoRun(track, { speeds, leadInM: 50, runOutM: 30, hz: 1, wobbleM: 0 });
  for (let s = 0; ; s++) {
    const { fix, done } = run.fixAt(s, t0 + s * 1000);
    out.push({ ...fix, simulated: false });
    if (done) break;
  }
  return out;
}

test('lap timer: start, laps, best, delta', () => {
  const track = demoCircuit(START);
  let timer = createLapTimer(makeStartLine(track.start.point, track.start.heading));
  const events = [];
  for (const f of lapFixes(track, [25, 27])) {
    const r = stepLaps(timer, f);
    timer = r.state;
    if (r.event) events.push(r.event);
  }
  assert.deepEqual(events.map((e) => e.type), ['start', 'lap', 'lap']);
  const [, lap1, lap2] = events;
  const expected1 = (track.length / 25) * 1000;
  assert.ok(Math.abs(lap1.lap.time - expected1) < 400, `lap1 ${lap1.lap.time} vs ${expected1}`);
  assert.ok(Math.abs(lap1.lap.distance - track.length) < 40, `distance ${lap1.lap.distance}`);
  assert.equal(lap1.delta, null);
  assert.equal(lap1.isBest, true);
  assert.ok(lap2.lap.time < lap1.lap.time);
  assert.ok(lap2.delta < 0 && lap2.isBest);
  const sum = lapSummary(timer);
  assert.equal(sum.count, 2);
  assert.equal(sum.best, lap2.lap.time);
  assert.equal(sum.last, lap2.lap.time);
  assert.equal(sum.delta, lap2.delta);
  assert.ok(currentLapMs(timer, timer.lapStartedAt + 5000) === 5000);
});

test('lap timer: jitter at the line does not make a short lap; stored best is the reference', () => {
  const line = makeStartLine(START, 0);
  let timer = createLapTimer(line, 60000);
  const seq = [
    fixAt(destination(START, 20, 180), T0),
    fixAt(destination(START, 5, 0), T0 + 1000), // start
    fixAt(destination(START, 5, 180), T0 + 2000), // wobble back (backwards: ignored)
    fixAt(destination(START, 8, 0), T0 + 3000), // forward again within 10 s: ignored
  ];
  const events = [];
  for (const f of seq) {
    const r = stepLaps(timer, f);
    timer = r.state;
    if (r.event) events.push(r.event.type);
  }
  assert.deepEqual(events, ['start']);
  assert.equal(timer.laps.length, 0);
  assert.equal(lapSummary(timer).best, 60000);
});

test('inaccurate and out-of-order fixes are ignored by the lap timer', () => {
  const timer = createLapTimer(makeStartLine(START, 0));
  const r1 = stepLaps(timer, fixAt(START, T0, { accuracy: 80 }));
  assert.equal(r1.state, timer);
  const r2 = stepLaps(stepLaps(timer, fixAt(START, T0)).state, fixAt(START, T0 - 5));
  assert.equal(r2.event, null);
});

test('track closure: back within 25 m, same heading, after 300 m', () => {
  const track = demoCircuit(START);
  let rec = createRecording(track.line[0], T0);
  let closedAt = null;
  const fixes = lapFixes(track, [20, 20]).slice(3); // begin just after the line
  rec = createRecording([fixes[0].lng, fixes[0].lat], T0);
  for (const f of fixes) {
    rec = stepRecording(rec, f);
    if (rec.closed) {
      closedAt = f;
      break;
    }
  }
  assert.ok(closedAt, 'closed');
  assert.ok(rec.distance >= LAPS.closeAfterM);
  assert.ok(haversine([closedAt.lng, closedAt.lat], rec.start) <= LAPS.closeWithinM);
  assert.ok(Math.abs(rec.distance - track.length) < 80, `recorded ${rec.distance} vs ${track.length}`);
  const saved = buildTrack(rec, { id: 't1', name: 'Track 1', createdAt: T0 });
  assert.equal(saved.line[0][0], saved.line[saved.line.length - 1][0]);
  assert.ok(Math.abs(angleDiff(saved.start.heading, track.start.heading)) < 15);
});

test('closure is not triggered near the start too early or heading the wrong way', () => {
  let rec = createRecording(START, T0);
  // 200 m out and straight back: near start but heading opposite, and too short
  for (let i = 1; i <= 20; i++) rec = stepRecording(rec, fixAt(destination(START, i * 10, 0), T0 + i * 1000));
  for (let i = 19; i >= 0; i--) rec = stepRecording(rec, fixAt(destination(START, i * 10 + 1, 0), T0 + (40 - i) * 1000));
  assert.equal(rec.closed, false);
  assert.equal(canFinishRecording(rec), true); // 380 m driven
  const short = stepRecording(createRecording(START, T0), fixAt(destination(START, 50, 0), T0 + 1000));
  assert.equal(canFinishRecording(short), false);
  assert.equal(buildTrack(short, { id: 'x', name: 'x', createdAt: 0 }), null);
});

test('demo run covers lead-in, two laps and run-out', () => {
  const track = demoCircuit(START);
  assert.ok(track.length > 1200 && track.length < 2200, `length ${track.length}`);
  const end = demoDistanceAt(1e6, track.length);
  assert.equal(end.done, true);
  const run = createDemoRun(track);
  const { fix } = run.fixAt(0, T0);
  assert.equal(fix.simulated, true);
  assert.ok(run.duration() > 2 * (track.length / 31));
});

test('lap text formats', () => {
  assert.equal(formatLap(92410), '1:32.41');
  assert.equal(formatLap(45123, 1), '0:45.1');
  assert.equal(formatLap(null), '–:––.––');
  assert.equal(formatDelta(-520), '−0.52');
  assert.equal(formatDelta(1300), '+1.30');
  assert.equal(spokenLap(92410), '1 32.4');
  assert.equal(spokenLap(45200), '45.2 seconds');
});

test('tracks model: sanitise, cap, best lap, names', () => {
  const t = demoCircuit(START, { id: 'a' });
  const list = sanitizeTracks([t, { id: 'bad' }, t, null]);
  assert.equal(list.length, 1);
  assert.equal(capTracks([t, { ...t, id: 'b' }], { maxTracks: 1, maxChars: 1e9 }).length, 1);
  assert.equal(withLap(t, 60000, 1).bestLap, 60000);
  const better = withLap(withLap(t, 60000, 1), 59000, 2);
  assert.equal(better.bestLap, 59000);
  assert.equal(withLap(better, 61000, 3), better);
  assert.equal(nextTrackName([{ name: 'Track 2' }]), 'Track 3');
});

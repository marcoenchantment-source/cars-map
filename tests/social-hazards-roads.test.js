import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateSecretKey, getPublicKey, finalizeEvent } from 'nostr-tools';
import { cumulativeDistances, destination, geohashEncode } from '../app/js/core/geo.js';
import {
  resolveHazardType, hazardTemplate, voteTemplate, parseHazardEvent, parseVoteEvent, aggregateHazards,
  hazardsAhead, selectForMap, LIFETIME_FACTOR,
} from '../app/js/social/hazardLogic.js';
import {
  quantiseTrace, densify, prepareTrace, traceTemplate, parseTraceEvent, roadConsensus, cellDrivers, MAX_TRACE_POINTS,
} from '../app/js/social/roadLogic.js';

const PERTH = [115.8605, -31.9505];
const T0 = 1_800_000_000; // seconds
const hex = (n) => n.toString(16).padStart(64, '0');

function report(over = {}) {
  return { id: hex(1), type: 'police', lng: PERTH[0], lat: PERTH[1], heading: null, reportedAt: T0 * 1000, hardExpiresAt: (T0 + 3 * 3600) * 1000, by: hex(100), ...over };
}
const vote = (n, by, v, atS = T0 + 60, target = hex(1)) => ({ id: hex(5000 + n), target, vote: v, at: atS * 1000, by });

test('resolveHazardType maps ids, labels and synonyms (no prototype keys)', () => {
  assert.equal(resolveHazardType('police'), 'police');
  assert.equal(resolveHazardType('Speed camera'), 'camera');
  assert.equal(resolveHazardType('radar'), 'camera');
  assert.equal(resolveHazardType('booze bus'), 'police');
  assert.equal(resolveHazardType('a big accident'), 'crash');
  assert.equal(resolveHazardType('Road closed'), 'closure');
  assert.equal(resolveHazardType('constructor'), null);
  assert.equal(resolveHazardType(''), null);
});

test('hazard template → signed event → parse round trip with g/hz/expiration tags', () => {
  const sk = generateSecretKey();
  const tpl = hazardTemplate({ type: 'camera', lngLat: PERTH, heading: 92.4, nowSec: T0 });
  const g6 = geohashEncode(PERTH[1], PERTH[0], 6);
  assert.deepEqual(tpl.tags.filter((t) => t[0] === 'g').map((t) => t[1]), [g6.slice(0, 5), g6]);
  assert.ok(tpl.tags.some((t) => t[0] === 'hz' && t[1] === 'camera'));
  assert.ok(tpl.tags.some((t) => t[0] === 't' && t[1] === 'carsmap'));
  const exp = Number(tpl.tags.find((t) => t[0] === 'expiration')[1]);
  assert.equal(exp, T0 + 240 * 60 * LIFETIME_FACTOR);
  const ev = finalizeEvent(tpl, sk);
  const r = parseHazardEvent(ev, T0 + 10);
  assert.equal(r.type, 'camera');
  assert.equal(r.heading, 92);
  assert.equal(r.by, getPublicKey(sk));
  assert.equal(parseHazardEvent(ev, exp), null, 'expired');
  assert.equal(parseHazardEvent({ ...ev, created_at: T0 + 3600 }, T0), null, 'from the future');
  assert.equal(parseHazardEvent({ ...ev, tags: [['hz', 'aliens']] }, T0), null);
  assert.equal(parseHazardEvent({ ...ev, content: '{"lng":500,"lat":0}' }, T0), null);
  assert.throws(() => hazardTemplate({ type: 'nope', lngLat: PERTH, nowSec: T0 }));
});

test('vote template and parse', () => {
  const sk = generateSecretKey();
  const h = { id: hex(9), type: 'police', lng: PERTH[0], lat: PERTH[1] };
  const ev = finalizeEvent(voteTemplate({ hazard: h, vote: 'deny', nowSec: T0 }), sk);
  const v = parseVoteEvent(ev, T0);
  assert.equal(v.target, hex(9));
  assert.equal(v.vote, 'deny');
  assert.equal(parseVoteEvent({ ...ev, tags: [['e', 'zz'], ['v', 'deny']] }, T0), null);
  assert.throws(() => voteTemplate({ hazard: h, vote: 'maybe', nowSec: T0 }));
});

test('aggregate: expiry after ttl unless re-confirmed', () => {
  const nowMs = (T0 + 61 * 60) * 1000; // police ttl 60 min
  assert.equal(aggregateHazards({ reports: [report()], votes: [], nowMs }).length, 0);
  const kept = aggregateHazards({ reports: [report()], votes: [vote(1, hex(200), 'confirm', T0 + 30 * 60)], nowMs });
  assert.equal(kept.length, 1);
  assert.equal(kept[0].confirms, 1);
  assert.equal(kept[0].expiresAt, (T0 + 90 * 60) * 1000);
});

test('aggregate: votes count once per distinct pubkey, latest wins', () => {
  const nowMs = (T0 + 120) * 1000;
  const votes = [
    vote(1, hex(201), 'confirm', T0 + 10), vote(2, hex(201), 'confirm', T0 + 20), vote(3, hex(201), 'deny', T0 + 30),
    vote(4, hex(202), 'confirm', T0 + 40),
  ];
  const [h] = aggregateHazards({ reports: [report()], votes, nowMs });
  assert.equal(h.confirms, 1);
  assert.equal(h.denies, 1);
});

test('aggregate: hidden when denies > confirms + 1, reporter retracts, or I said gone', () => {
  const nowMs = (T0 + 120) * 1000;
  const two = [vote(1, hex(201), 'deny'), vote(2, hex(202), 'deny')];
  assert.equal(aggregateHazards({ reports: [report()], votes: two, nowMs }).length, 0);
  assert.equal(aggregateHazards({ reports: [report()], votes: [...two, vote(3, hex(203), 'confirm')], nowMs }).length, 1);
  assert.equal(aggregateHazards({ reports: [report()], votes: [vote(4, hex(100), 'deny')], nowMs }).length, 0, 'reporter retracted');
  assert.equal(aggregateHazards({ reports: [report()], votes: [vote(5, hex(300), 'deny')], nowMs, me: hex(300) }).length, 0);
  const mine = aggregateHazards({ reports: [report()], votes: [], nowMs, me: hex(100) });
  assert.equal(mine[0].mine, true);
});

test('aggregate: dedupes ids and caps reports per author', () => {
  const nowMs = (T0 + 60) * 1000;
  const many = Array.from({ length: 15 }, (_, i) => report({ id: hex(1000 + i) }));
  assert.equal(aggregateHazards({ reports: [...many, many[0]], nowMs }).length, 10);
});

test('hazardsAhead: within 35 m of the route and the next 1.5 km only', () => {
  const coords = [PERTH];
  for (let i = 1; i <= 30; i++) coords.push(destination(coords[i - 1], 100, 90)); // 3 km due east
  const route = { geometry: coords, cum: cumulativeDistances(coords) };
  const at = (m, off = 0) => {
    const p = destination(destination(PERTH, m, 90), Math.abs(off), off >= 0 ? 0 : 180);
    return { id: `h${m}-${off}`, lng: p[0], lat: p[1], heading: null };
  };
  const hazards = [at(600), at(600, 30), at(800, 80), at(2000), at(100), at(1000)];
  const ahead = hazardsAhead(hazards, route, 300);
  assert.deepEqual(ahead.map((x) => x.hazard.id), ['h600-0', 'h600-30', 'h1000-0']);
  assert.ok(Math.abs(ahead[0].distance - 300) < 2);
  const wrongWay = { ...at(700), id: 'opposite', heading: 270 };
  const sameWay = { ...at(700), id: 'same', heading: 85 };
  assert.deepEqual(hazardsAhead([wrongWay, sameWay], route, 300).map((x) => x.hazard.id), ['same']);
  assert.deepEqual(hazardsAhead(hazards, { geometry: [PERTH] }, 0), []);
});

test('selectForMap keeps the nearest N', () => {
  const list = Array.from({ length: 100 }, (_, i) => ({ id: String(i), lng: PERTH[0] + i * 0.01, lat: PERTH[1] }));
  const out = selectForMap(list, PERTH, { max: 80, maxDistanceM: 5000 });
  assert.ok(out.length < 80 && out.length > 0);
  assert.equal(out[0].id, '0');
});

// ---------------------------------------------------------------- roads

const lineEast = (startM, lengthM, stepM = 25) => {
  const pts = [];
  for (let d = 0; d <= lengthM; d += stepM) pts.push(destination(destination(PERTH, startM, 90), d, 90).map((v) => Number(v.toFixed(6))));
  return pts;
};

test('quantiseTrace: ordered unique geohash-7 cells, densified so no cell is skipped', () => {
  const two = [lineEast(0, 0)[0], lineEast(1000, 0)[0]];
  const cells = quantiseTrace(two);
  assert.ok(cells.every((c) => c.length === 7));
  assert.equal(new Set(cells).size, cells.length);
  assert.deepEqual(cells, quantiseTrace(lineEast(0, 1000, 5)), 'two points and a dense line give the same cells');
  assert.ok(cells.length >= 7, `about 1 km over ~130 m cells, got ${cells.length}`);
  assert.ok(densify(two).length > 20);
});

test('prepareTrace caps at 200 points', () => {
  const wiggly = Array.from({ length: 900 }, (_, i) => destination(PERTH, i * 10, 90 + (i % 2 ? 25 : -25)));
  const out = prepareTrace(wiggly);
  assert.ok(out.length <= MAX_TRACE_POINTS);
  assert.ok(out.length >= 2);
});

function traceEvent(sk, trace, t = T0) {
  return finalizeEvent(traceTemplate({ trace, nowSec: t }), sk);
}

test('trace event round trip; cells are recomputed, junk rejected', () => {
  const sk = generateSecretKey();
  const trace = prepareTrace(lineEast(0, 600));
  const ev = traceEvent(sk, trace);
  assert.ok(ev.tags.some((t) => t[0] === 'g' && t[1].length === 5));
  const parsed = parseTraceEvent(ev, T0 + 1);
  assert.deepEqual(parsed.cells, quantiseTrace(trace));
  const forged = { ...ev, content: JSON.stringify({ cells: ['zzzzzzz'], trace }) };
  assert.deepEqual(parseTraceEvent(forged, T0).cells, quantiseTrace(trace), 'claimed cells are ignored');
  assert.equal(parseTraceEvent({ ...ev, content: JSON.stringify({ trace: [[0, 0]] }) }, T0), null);
  assert.equal(parseTraceEvent({ ...ev, content: JSON.stringify({ trace: [[0, 0], [10, 10]] }) }, T0), null, 'huge jump');
  assert.equal(parseTraceEvent({ ...ev, content: JSON.stringify({ trace: [[0, 0], [0, 'x']] }) }, T0), null);
});

const driverTrace = (i, by, trace) => ({ id: hex(i), by, at: T0 * 1000, trace, cells: quantiseTrace(trace), length: 600 });

test('road consensus: 49 distinct drivers stay pending, 50 confirm', () => {
  const trace = lineEast(0, 600);
  const t49 = Array.from({ length: 49 }, (_, i) => driverTrace(i + 1, hex(10000 + i), trace));
  const r49 = roadConsensus(t49, { threshold: 50 });
  assert.equal(r49.confirmed.length, 0);
  assert.equal(r49.pending.length, 1, 'identical traces collapse into one pending change');
  assert.equal(r49.pending[0].drivers, 49);
  const t50 = [...t49, driverTrace(50, hex(10049), trace)];
  const r50 = roadConsensus(t50, { threshold: 50 });
  assert.equal(r50.confirmed.length, 1);
  assert.equal(r50.confirmed[0].drivers, 50);
  assert.ok(r50.confirmed[0].lines.length >= 1 && r50.confirmed[0].lines[0].length >= 2);
  assert.equal(r50.pending.length, 0);
});

test('road consensus: duplicates from one pubkey do not count', () => {
  const trace = lineEast(0, 600);
  const spam = Array.from({ length: 80 }, (_, i) => driverTrace(i + 1, hex(777), trace));
  const few = Array.from({ length: 10 }, (_, i) => driverTrace(200 + i, hex(20000 + i), trace));
  const r = roadConsensus([...spam, ...few], { threshold: 50 });
  assert.equal(r.confirmed.length, 0);
  assert.equal(r.pending[0].drivers, 11);
  assert.equal(Math.max(...cellDrivers([...spam, ...few]).values()), 11);
});

test('road consensus: only the shared stretch confirms; my trace is flagged', () => {
  const shared = lineEast(0, 600);
  const longer = lineEast(0, 1500);
  const drivers = Array.from({ length: 50 }, (_, i) => driverTrace(i + 1, hex(30000 + i), i === 0 ? longer : shared));
  const r = roadConsensus(drivers, { threshold: 50, me: hex(30000) });
  assert.equal(r.confirmed.length, 1);
  const confirmedCells = new Set(r.confirmed[0].cells);
  assert.ok(quantiseTrace(shared).every((c) => confirmedCells.has(c) || c === quantiseTrace(shared).at(-1)));
  assert.ok(!confirmedCells.has(quantiseTrace(longer).at(-1)), 'the far end only one driver used is not confirmed');
  assert.equal(r.pending.length, 1);
  assert.equal(r.pending[0].mine, true);
});

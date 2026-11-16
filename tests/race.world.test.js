import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chainLoop, racingWays, guessStart, buildCircuit, findTracks } from '../app/js/race/worldTracks.js';
import { destination } from '../app/js/core/geo.js';

// A 1.2 km x 400 m rectangle circuit near Wanneroo, split into pieces like OSM does.
const O = [115.786, -31.661];
const A = O;
const B = destination(A, 1200, 90);
const C = destination(B, 400, 180);
const D = destination(C, 1200, 270);
const line = (p, q, n = 6) => Array.from({ length: n + 1 }, (_, i) => [p[0] + ((q[0] - p[0]) * i) / n, p[1] + ((q[1] - p[1]) * i) / n]);

test('chainLoop stitches pieces (some reversed) into one closed lap', () => {
  const ways = [
    { coords: line(A, B), oneway: false },
    { coords: line(C, B), oneway: false }, // reversed piece
    { coords: line(C, D), oneway: false },
    { coords: line(D, A), oneway: false },
  ];
  const loop = chainLoop(ways);
  assert.ok(loop, 'loop found');
  assert.ok(Math.abs(loop.length - 3200) < 30, `length ${loop.length}`);
  assert.equal(loop.oneway, false);
});

test('chainLoop never reverses one-way pieces and returns null for an open line', () => {
  const ways = [
    { coords: line(A, B), oneway: true },
    { coords: line(C, B), oneway: true }, // wrong way and one-way: can't be used
    { coords: line(C, D), oneway: true },
    { coords: line(D, A), oneway: true },
  ];
  assert.equal(chainLoop(ways), null);
  assert.equal(chainLoop([{ coords: line(A, B) }]), null);
});

test('racingWays drops pit lanes and prefers the main circuit over karting', () => {
  const ways = [
    { coords: line(A, B), tags: { highway: 'raceway', sport: 'motor' } },
    { coords: line(A, C), tags: { highway: 'raceway', name: 'Pit Lane' } },
    { coords: line(C, D), tags: { highway: 'raceway', sport: 'karting' } },
  ];
  assert.equal(racingWays(ways).length, 1);
  assert.equal(racingWays([ways[2]]).length, 1, 'karting kept when nothing else exists');
});

test('guessStart sits on the longest straight, facing along it', () => {
  const loop = [...line(A, B), ...line(B, C).slice(1), ...line(C, D).slice(1), ...line(D, A).slice(1)];
  const s = guessStart(loop);
  assert.ok(Math.abs(s.heading - 90) < 2 || Math.abs(s.heading - 270) < 2, `heading ${s.heading}`);
});

test('buildCircuit makes a valid saved-track object', () => {
  const ways = [{ coords: line(A, B) }, { coords: line(B, C) }, { coords: line(C, D) }, { coords: line(D, A) }];
  const t = buildCircuit({ id: 'test-park', name: 'Test Park', country: 'Australia' }, ways);
  assert.equal(t.id, 'osm:test-park');
  assert.equal(t.anyDirection, true);
  assert.ok(t.line.length >= 4 && t.length > 3000);
  assert.equal(t.bbox.length, 4);
  assert.equal(buildCircuit({ id: 'x', name: 'Tiny' }, [{ coords: line(A, destination(A, 50, 90)) }]), null);
});

test('findTracks filters by name or country and sorts nearest first', () => {
  const mk = (name, country, lng, lat) => ({ name, country, start: { point: [lng, lat] } });
  const list = [mk('Silverstone', 'United Kingdom', -1.02, 52.07), mk('Wanneroo Raceway', 'Australia', 115.78, -31.66), mk('Phillip Island', 'Australia', 145.23, -38.5)];
  assert.deepEqual(findTracks(list, { query: 'australia', near: [115.86, -31.95] }).map((t) => t.name), ['Wanneroo Raceway', 'Phillip Island']);
  assert.deepEqual(findTracks(list, { query: 'silver' }).map((t) => t.name), ['Silverstone']);
  assert.equal(findTracks(list, { near: [115.86, -31.95], limit: 1 })[0].name, 'Wanneroo Raceway');
  const withAka = [{ ...list[1], aka: ['Barbagallo', 'Perth'] }];
  assert.equal(findTracks(withAka, { query: 'barbagallo' }).length, 1, 'other names match');
  assert.equal(findTracks(withAka, { query: 'perth raceway' }).length, 1);
});

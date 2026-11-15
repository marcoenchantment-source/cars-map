import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createGroup, encodeGroupCode, decodeGroupCode, sealJson, openJson, cleanPresence, cleanStart,
  ownerOf, takenColours, settleColour, cleanName, PALETTE,
} from '../app/js/race/groupModel.js';

test('group codes round-trip and reject junk', () => {
  const g = createGroup('Saturday Crew');
  assert.match(g.id, /^[0-9a-f]{32}$/);
  assert.match(g.key, /^[0-9a-f]{64}$/);
  const back = decodeGroupCode(encodeGroupCode(g));
  assert.deepEqual(back, g);
  assert.equal(decodeGroupCode('npub1xyz'), null);
  assert.equal(decodeGroupCode(`cmrace1:${g.id}:short:x`), null);
  assert.equal(decodeGroupCode(`cmrace1:${g.id}:${g.key}:%E0%A4%A`).name, 'Race group', 'bad name falls back');
  assert.equal(cleanName('Fast‮Lane  '), 'FastLane');
});

test('messages encrypt with the group key and fail with any other key', async () => {
  const g = createGroup('A');
  const other = createGroup('B');
  const sealed = await sealJson(g.key, { t: 'p', name: 'Sam' });
  assert.deepEqual(await openJson(g.key, sealed), { t: 'p', name: 'Sam' });
  assert.equal(await openJson(other.key, sealed), null);
  assert.equal(await openJson(g.key, 'not.valid'), null);
  assert.equal(await openJson(g.key, 'x'.repeat(10000)), null);
});

test('presence is cleaned and clipped; bad positions are dropped', () => {
  const now = 1_800_000_000_000;
  const p = cleanPresence({ t: 'p', name: 'Jess\u0000', colour: 'pink', claimedAt: now - 10, lng: 115.78, lat: -31.66, bearing: 400, speed: 999, laps: 3.4, best: 90120, at: now }, now);
  assert.equal(p.name, 'Jess');
  assert.equal(p.colour, 'pink');
  assert.equal(p.bearing, 0);
  assert.equal(p.speed, 0);
  assert.equal(p.laps, 3);
  assert.equal(p.best, 90120);
  const noPos = cleanPresence({ t: 'p', colour: 'gold', lng: 999, lat: -31, at: now }, now);
  assert.equal(noPos.lng, null);
  assert.equal(noPos.colour, null, 'unknown colours are ignored');
  assert.equal(cleanPresence({ t: 'p', at: now - 3600_000 }, now), null, 'old status ignored');
  assert.equal(cleanPresence({ t: 'x', at: now }, now), null);
});

test('race start must be within the next minute', () => {
  const now = 1_800_000_000_000;
  assert.deepEqual(cleanStart({ t: 's', at: now + 30_000, by: 'Sam' }, now), { at: now + 30_000, by: 'Sam' });
  assert.equal(cleanStart({ t: 's', at: now + 3600_000 }, now), null);
  assert.equal(cleanStart({ t: 's', at: now - 60_000 }, now), null);
});

test('colours: first to pick keeps it, ties go to the smaller key, others get a free colour', () => {
  const claims = [
    { pubkey: 'b', colour: 'red', claimedAt: 100, name: 'Ben' },
    { pubkey: 'a', colour: 'red', claimedAt: 200, name: 'Amy' },
    { pubkey: 'c', colour: 'blue', claimedAt: 50, name: 'Cal' },
  ];
  assert.equal(ownerOf('red', claims), 'b');
  assert.equal(ownerOf('red', [{ pubkey: 'z', colour: 'red', claimedAt: 1 }, { pubkey: 'y', colour: 'red', claimedAt: 1 }]), 'y');
  const taken = takenColours(claims, 'a');
  assert.ok(taken.has('red') && taken.has('blue'));
  const mine = settleColour({ colour: 'red', claimedAt: 200 }, claims, 'a');
  assert.equal(mine.changed, true);
  assert.equal(mine.colour, 'yellow', 'first colour nobody owns');
  assert.equal(mine.lostTo, 'Ben');
  const keep = settleColour({ colour: 'red', claimedAt: 100 }, claims, 'b');
  assert.equal(keep.changed, false);
  const fresh = settleColour(null, claims, 'd');
  assert.equal(fresh.colour, 'yellow');
  const full = PALETTE.map((c, i) => ({ pubkey: `p${i}`, colour: c.id, claimedAt: i }));
  assert.ok(settleColour(null, full, 'me').colour, 'still gets a colour when all are taken');
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateSecretKey, getPublicKey, finalizeEvent, verifyEvent, nip19, nip44 } from 'nostr-tools';
import { cleanText, sanitizeCar, isHex64, parseJsonObject, clamp } from '../app/js/social/sanitize.js';
import {
  KIND, isEventShape, hasAppTag, expirationOf, isExpired, buildLocationPayload, parseLocationPayload,
  parseDmPayload, buildHello, buildChat, LOCATION_STALE_MS,
} from '../app/js/social/events.js';
import {
  parseFriendCode, upsertFriend, removeFriend, setSharing, matchFriend, appendMessage, sanitizeStoredFriends,
  sanitizeThreads, MAX_THREAD,
} from '../app/js/social/friendsLogic.js';

const sk = generateSecretKey();
const pk = getPublicKey(sk);
const NOW_MS = 1_800_000_000_000;

test('cleanText strips controls and bidi overrides, collapses whitespace, caps length', () => {
  assert.equal(cleanText('  hi\u0000 there\n\nmate‮ ', 50), 'hi there mate');
  assert.equal(cleanText('a'.repeat(600), 500).length, 500);
  assert.equal(cleanText(42, 10), '');
  assert.equal(cleanText('😀😀😀', 2), '😀😀');
});

test('sanitizeCar keeps only valid CarLook fields', () => {
  const car = sanitizeCar({ name: 'Zoom', color: '#FF0000', rim: 'bad', pat: 'triple', int: 9, body: 'ute', evil: 'x' });
  assert.deepEqual(car, { name: 'Zoom', color: '#ff0000', rim: 'five', pat: 'triple', int: 3, body: 'ute' });
  assert.equal(sanitizeCar('nope'), null);
  assert.equal(sanitizeCar({ color: 'red;background:url(x)' }).color, '#1e88e5');
});

test('parseJsonObject rejects arrays, primitives, oversize and bad JSON', () => {
  assert.equal(parseJsonObject('[1]', 100), null);
  assert.equal(parseJsonObject('"x"', 100), null);
  assert.equal(parseJsonObject('{bad', 100), null);
  assert.equal(parseJsonObject(`{"a":"${'x'.repeat(200)}"}`, 100), null);
  assert.deepEqual(parseJsonObject('{"a":1}', 100), { a: 1 });
  assert.equal(clamp(Number.NaN, 0, 1, 7), 7);
});

test('isEventShape accepts real signed events and rejects malformed ones', () => {
  const ev = finalizeEvent({ kind: KIND.HAZARD, created_at: 1000, tags: [['t', 'carsmap']], content: '{}' }, sk);
  assert.ok(isEventShape(ev));
  assert.ok(verifyEvent(ev));
  assert.ok(hasAppTag(ev));
  assert.equal(isEventShape({ ...ev, id: 'xyz' }), false);
  assert.equal(isEventShape({ ...ev, tags: [['t', 5]] }), false);
  assert.equal(isEventShape({ ...ev, tags: Array.from({ length: 80 }, () => ['g', 'x']) }), false);
  assert.equal(isEventShape({ ...ev, content: 'x'.repeat(40000) }), false);
  assert.equal(isEventShape(null), false);
});

test('expiration tag parsing', () => {
  const ev = { tags: [['expiration', '2000']] };
  assert.equal(expirationOf(ev), 2000);
  assert.equal(isExpired(ev, 2000), true);
  assert.equal(isExpired(ev, 1999), false);
  assert.equal(expirationOf({ tags: [['expiration', '12abc']] }), null);
});

test('location payload: build, clip and validate', () => {
  const p = buildLocationPayload({ lng: 115.8605123456, lat: -31.95051234, heading: 370.4, speed: 999 }, { name: 'Me', color: '#123456' }, NOW_MS);
  assert.equal(p.lng, 115.860512);
  assert.equal(p.bearing, 10);
  assert.equal(p.speed, 120);
  const parsed = parseLocationPayload(p, NOW_MS + 1000);
  assert.equal(parsed.lat, -31.950512);
  assert.equal(parsed.car.color, '#123456');
  assert.equal(parseLocationPayload({ ...p, lat: 91 }, NOW_MS), null);
  assert.equal(parseLocationPayload({ ...p, lng: '115' }, NOW_MS), null);
  assert.equal(parseLocationPayload({ ...p, at: NOW_MS - LOCATION_STALE_MS - 1 }, NOW_MS), null, 'stale');
  assert.equal(parseLocationPayload({ ...p, at: NOW_MS + 5 * 60000 }, NOW_MS), null, 'far future');
  assert.equal(parseLocationPayload({ ...p, speed: -5, bearing: 'x' }, NOW_MS).speed, 0);
  assert.deepEqual(parseLocationPayload({ off: true, at: NOW_MS }, NOW_MS), { off: true, at: NOW_MS });
});

test('DM payloads: hello and msg are validated, others dropped', () => {
  assert.deepEqual(parseDmPayload(buildHello({ name: ' Sam\n', car: null }), NOW_MS), { type: 'hello', name: 'Sam', car: null });
  const m = parseDmPayload(buildChat('On my way', NOW_MS), NOW_MS);
  assert.equal(m.text, 'On my way');
  assert.equal(parseDmPayload({ type: 'msg', text: '   ' }, NOW_MS), null);
  assert.equal(parseDmPayload({ type: 'admin', text: 'x' }, NOW_MS), null);
  assert.equal(parseDmPayload({ type: 'msg', text: 'x'.repeat(900), at: NOW_MS }, NOW_MS).text.length, 500);
});

test('NIP-44 round trip with nostr-tools (as the app uses it)', () => {
  const sk2 = generateSecretKey();
  const pk2 = getPublicKey(sk2);
  const ct = nip44.encrypt(JSON.stringify(buildChat('hi', NOW_MS)), nip44.getConversationKey(sk, pk2));
  const back = JSON.parse(nip44.decrypt(ct, nip44.getConversationKey(sk2, pk)));
  assert.equal(back.text, 'hi');
});

test('parseFriendCode accepts npub, nostr: prefix, nprofile and hex; rejects junk', () => {
  const npub = nip19.npubEncode(pk);
  assert.deepEqual(parseFriendCode(npub, nip19), { pubkey: pk });
  assert.deepEqual(parseFriendCode(`  nostr:${npub} `, nip19), { pubkey: pk });
  assert.deepEqual(parseFriendCode(nip19.nprofileEncode({ pubkey: pk }), nip19), { pubkey: pk });
  assert.deepEqual(parseFriendCode(pk.toUpperCase(), nip19), { pubkey: pk });
  assert.ok(parseFriendCode('', nip19).error);
  assert.ok(parseFriendCode('hello there', nip19).error);
  assert.ok(parseFriendCode(npub.slice(0, -3), nip19).error, 'bad checksum');
  assert.ok(parseFriendCode(nip19.nsecEncode(sk), nip19).error, 'never accept a secret key');
});

test('friend list operations are immutable', () => {
  const a = 'a'.repeat(64);
  const b = 'b'.repeat(64);
  const l0 = [];
  const l1 = upsertFriend(l0, { pubkey: a, name: 'Sam' }, 1);
  assert.equal(l0.length, 0);
  assert.equal(l1[0].sharing, false, 'sharing defaults OFF');
  const l2 = upsertFriend(l1, { pubkey: a, name: 'Samuel', fromHello: true }, 2);
  assert.equal(l2[0].name, 'Sam', 'my own name for them wins over their hello');
  const l3 = setSharing(upsertFriend(l2, { pubkey: b }, 3), b, true);
  assert.equal(l3.find((f) => f.pubkey === b).sharing, true);
  assert.equal(l2.find((f) => f.pubkey === b), undefined);
  assert.equal(removeFriend(l3, a).length, 1);
  assert.equal(upsertFriend(l3, { pubkey: 'nothex' }, 4), l3);
  assert.deepEqual(sanitizeStoredFriends([{ pubkey: a, name: 'x' }, { pubkey: a }, { pubkey: 'zz' }, null]).length, 1);
});

test('matchFriend: exact, prefix, word, typo', () => {
  const list = [
    { pubkey: '1'.repeat(64), name: 'Sam Smith' },
    { pubkey: '2'.repeat(64), name: 'Samantha' },
    { pubkey: '3'.repeat(64), name: 'Jordan' },
  ];
  assert.equal(matchFriend(list, 'samantha').name, 'Samantha');
  assert.equal(matchFriend(list, 'Sam').name, 'Sam Smith');
  assert.equal(matchFriend(list, 'smith').name, 'Sam Smith');
  assert.equal(matchFriend(list, 'jordon').name, 'Jordan');
  assert.equal(matchFriend(list, 'xavier'), null);
  assert.equal(matchFriend([], 'sam'), null);
});

test('threads cap at MAX_THREAD and dedupe by id', () => {
  let t = {};
  const key = 'c'.repeat(64);
  for (let i = 0; i < MAX_THREAD + 20; i++) t = appendMessage(t, key, { id: `m${i}`, text: 'x', at: i, incoming: true });
  assert.equal(t[key].length, MAX_THREAD);
  assert.equal(t[key][0].id, 'm20');
  assert.equal(appendMessage(t, key, { id: 'm50', text: 'dup', at: 50 }), t);
  assert.deepEqual(Object.keys(sanitizeThreads({ bad: [], [key]: [{ id: 'x', text: 'hi', at: 1 }] })), [key]);
  assert.equal(isHex64(key), true);
});

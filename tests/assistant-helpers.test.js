import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validatePhone, validateName, addContact, removeContact, sanitiseContacts, fromPicker, telHref, smsHref, matchName, MAX_CONTACTS } from '../app/js/assistant/contacts.js';
import { musicHref, musicChoices } from '../app/js/assistant/music.js';
import { spokenDuration, formatClock, shortenForSpeech, expandRoads, shortPlace, routeReply } from '../app/js/assistant/phrases.js';
import { readResults, classifyError, startListening, getRecognition } from '../app/js/assistant/listen.js';

test('phone and name validation', () => {
  assert.equal(validatePhone('0412 345 678').ok, true);
  assert.equal(validatePhone('+61 (8) 9123-4567').ok, true);
  assert.equal(validatePhone('12345').ok, false);
  assert.equal(validatePhone('((((((').ok, false);
  assert.equal(validatePhone('call me maybe').ok, false);
  assert.equal(validateName('  Mum <3 ').value, 'Mum 3');
  assert.equal(validateName('').ok, false);
});

test('contacts add/update/remove are immutable', () => {
  const empty = Object.freeze([]);
  const a = addContact(empty, { name: 'Mum', phone: '0412 345 678' }, () => 'id1');
  assert.equal(a.ok, true);
  assert.equal(empty.length, 0);
  const b = addContact(a.list, { name: 'mum', phone: '0400 000 000' }, () => 'id2');
  assert.equal(b.list.length, 1);
  assert.equal(b.list[0].phone, '0400 000 000');
  assert.deepEqual(removeContact(b.list, 'id1'), []);
  assert.equal(addContact([], { name: 'X', phone: 'nope' }).ok, false);
  const full = Array.from({ length: MAX_CONTACTS }, (_, i) => ({ id: `${i}`, name: `P${i}`, phone: '0412345678' }));
  assert.equal(addContact(full, { name: 'New', phone: '0412345678' }).ok, false);
});

test('sanitiseContacts drops junk from storage', () => {
  assert.deepEqual(sanitiseContacts([{ id: 'a', name: 'Mum', phone: '0412 345 678' }, { id: 'b', name: '', phone: '1' }, null, 'x']), [{ id: 'a', name: 'Mum', phone: '0412 345 678' }]);
  assert.deepEqual(sanitiseContacts('nope'), []);
});

test('contact picker results', () => {
  assert.deepEqual(fromPicker([{ name: ['Dad'], tel: ['bad', '+61 400 111 222'] }, { name: ['No Phone'], tel: [] }]), [{ name: 'Dad', phone: '+61 400 111 222' }]);
  assert.deepEqual(fromPicker(null), []);
});

test('tel and sms links', () => {
  assert.equal(telHref('+61 (412) 345-678'), 'tel:+61412345678');
  assert.equal(smsHref('0412 345 678', 'On my way & 5 min'), 'sms:0412345678?body=On%20my%20way%20%26%205%20min');
  assert.equal(smsHref('0412 345 678', 'Hi', { ios: true }), 'sms:0412345678&body=Hi');
  assert.equal(smsHref('0412345678'), 'sms:0412345678');
});

test('matchName: aliases, first names, one typo', () => {
  const people = [{ name: 'Mum' }, { name: 'Sam Smith' }, { name: 'Jessica' }];
  assert.equal(matchName(people, 'my mom').name, 'Mum');
  assert.equal(matchName(people, 'Sam').name, 'Sam Smith');
  assert.equal(matchName(people, 'Jesica').name, 'Jessica');
  assert.equal(matchName(people, 'Dad'), null);
  assert.equal(matchName(null, 'x'), null);
});

test('music links', () => {
  assert.equal(musicHref('spotify', 'AC/DC'), 'https://open.spotify.com/search/AC%2FDC');
  assert.equal(musicHref('youtube', 'Tame Impala'), 'https://music.youtube.com/search?q=Tame%20Impala');
  assert.equal(musicHref('apple', ''), 'https://music.apple.com/au/');
  assert.equal(musicHref('bogus', null), 'https://open.spotify.com/');
  assert.equal(musicChoices().length, 3);
});

test('phrases', () => {
  assert.equal(spokenDuration(20), 'under a minute');
  assert.equal(spokenDuration(NaN), 'a little while');
  assert.equal(spokenDuration(60), '1 minute');
  assert.equal(spokenDuration(3900), '1 hour 5 minutes');
  assert.equal(spokenDuration(7200), '2 hours');
  assert.equal(formatClock(Date.UTC(2026, 10, 10, 2, 42), { timeZone: 'Australia/Perth' }), '10:42 am');
  assert.equal(expandRoads('via Mitchell Fwy and Canning Hwy'), 'via Mitchell Freeway and Canning Highway');
  assert.equal(shortPlace({ name: 'Hay St', label: 'Hay St, Perth, WA' }), 'Hay St, Perth');
  assert.equal(routeReply('Home', null), 'Showing the route to Home.');
  assert.equal(shortenForSpeech('# Hi! **One.** Two? Three. https://x.y'), 'Hi! One.');
  assert.ok(shortenForSpeech('word '.repeat(200)).length <= 240);
});

test('speech results: transcript and alternatives', () => {
  const alt = (t) => ({ transcript: t });
  const r1 = Object.assign([alt('take me')], { isFinal: true });
  const r2 = Object.assign([alt('to kings park'), alt('to kings bark')], { isFinal: true });
  const res = readResults([r1, r2]);
  assert.equal(res.transcript, 'take me to kings park');
  assert.equal(res.final, true);
  assert.deepEqual(res.alternatives, ['take me to kings park', 'take me to kings bark']);
  assert.equal(readResults([Object.assign([alt('nearest')], { isFinal: false })]).final, false);
  assert.equal(readResults(null).transcript, '');
  assert.equal(classifyError('not-allowed'), 'blocked');
  assert.equal(classifyError('no-speech'), 'no-speech');
  assert.equal(classifyError('weird'), 'unknown');
  assert.equal(getRecognition({ webkitSpeechRecognition: 'W' }), 'W');
  assert.equal(getRecognition({}), null);
});

class FakeRecognition {
  static last = null;
  constructor() { FakeRecognition.last = this; }
  start() {}
  stop() { this.onend?.(); }
  abort() { this.onerror?.({ error: 'aborted' }); this.onend?.(); }
}

test('startListening configures en-AU and delivers final alternatives', () => {
  const got = {};
  startListening(FakeRecognition, { onInterim: (t) => (got.interim = t), onResult: (a) => (got.result = a), onError: (e) => (got.error = e), onEnd: () => (got.ended = true) });
  const rec = FakeRecognition.last;
  assert.equal(rec.lang, 'en-AU');
  assert.equal(rec.interimResults, true);
  assert.equal(rec.maxAlternatives, 3);
  rec.onresult({ results: [Object.assign([{ transcript: 'nearest servo' }, { transcript: 'nearest serve oh' }], { isFinal: true })] });
  rec.onend();
  assert.equal(got.interim, 'nearest servo');
  assert.deepEqual(got.result, ['nearest servo', 'nearest serve oh']);
  assert.equal(got.ended, true);
});

test('startListening reports blocked mic and aborts quietly', () => {
  const got = {};
  startListening(FakeRecognition, { onError: (e) => (got.error = e) });
  FakeRecognition.last.onerror({ error: 'not-allowed' });
  FakeRecognition.last.onend();
  assert.equal(got.error, 'blocked');
  const got2 = {};
  const h = startListening(FakeRecognition, { onResult: (r) => (got2.result = r), onError: (e) => (got2.error = e) });
  FakeRecognition.last.onresult({ results: [Object.assign([{ transcript: 'half' }], { isFinal: false })] });
  h.abort();
  assert.equal(got2.result, undefined);
  assert.equal(got2.error, 'aborted');
});

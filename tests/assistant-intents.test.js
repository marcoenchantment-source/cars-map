import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parse, pickBest, splitRecipient, tidyMessage, cleanText } from '../app/js/assistant/intents.js';
import { findHazard, findCategory, exactCategory, findMusicApp } from '../app/js/assistant/vocab.js';

// [utterance, intent, expected slot subset]
const CASES = [
  // navigate
  ['take me to Kings Park', 'navigate', { query: 'Kings Park' }],
  ['Navigate to Elizabeth Quay.', 'navigate', { query: 'Elizabeth Quay' }],
  ['drive to Scarborough Beach', 'navigate', { query: 'Scarborough Beach' }],
  ['directions to Perth Airport', 'navigate', { query: 'Perth Airport' }],
  ['go to Fremantle markets', 'navigate', { query: 'Fremantle markets' }],
  ["let's go to Cottesloe Beach", 'navigate', { query: 'Cottesloe Beach' }],
  ['hey copilot, can you take me to Optus Stadium please', 'navigate', { query: 'Optus Stadium' }],
  ['I want to go to 15 Hay Street Perth', 'navigate', { query: '15 Hay Street Perth' }],
  ['how do I get to Rottnest ferry terminal', 'navigate', { query: 'Rottnest ferry terminal' }],
  ['get me to Joondalup', 'navigate', { query: 'Joondalup' }],
  ['how long to Mandurah', 'navigate', { query: 'Mandurah', ask: 'eta' }],
  ['how far is Bunbury', 'navigate', { query: 'Bunbury', ask: 'eta' }],
  // home / work
  ['take me home', 'go_home', {}],
  ['go home', 'go_home', {}],
  ['navigate home', 'go_home', {}],
  ['home time mate', 'go_home', {}],
  ['drive to work', 'go_work', {}],
  ['head to the office', 'go_work', {}],
  // nearby
  ['nearest servo', 'find_nearby', { category: 'fuel', label: 'servo' }],
  ["where's the nearest petrol station", 'find_nearby', { category: 'fuel' }],
  ['I need fuel', 'find_nearby', { category: 'fuel' }],
  ["we're running low on petrol", 'find_nearby', { category: 'fuel' }],
  ['take me to the nearest servo', 'find_nearby', { category: 'fuel' }],
  ['find coffee', 'find_nearby', { category: 'coffee' }],
  ['any coffee around here', 'find_nearby', { category: 'coffee' }],
  ['can I get a flat white', 'find_nearby', { category: 'coffee' }],
  ['parking near me', 'find_nearby', { category: 'parking' }],
  ['find a car park', 'find_nearby', { category: 'parking' }],
  ['maccas', 'find_nearby', { category: 'food', query: "McDonald's", label: 'Maccas' }],
  ['go to Maccas', 'find_nearby', { category: 'food', query: "McDonald's" }],
  ["I'm starving", 'find_nearby', { category: 'food' }],
  ['find food', 'find_nearby', { category: 'food' }],
  ['toilets', 'find_nearby', { category: 'toilets' }],
  ["I'm busting for the loo", 'find_nearby', { category: 'toilets' }],
  ['EV charger', 'find_nearby', { category: 'ev' }],
  ['is there a charging station nearby', 'find_nearby', { category: 'ev' }],
  ['find a bottle-o', 'find_nearby', { category: 'bottle_shop' }],
  ['where is the nearest Bunnings', 'find_nearby', { category: 'place', query: 'Bunnings' }],
  ['find a police station', 'find_nearby', { category: 'place', query: 'police station' }],
  // hazards
  ['report police', 'report_hazard', { type: 'police' }],
  ['report a speed camera', 'report_hazard', { type: 'camera' }],
  ['speed camera ahead', 'report_hazard', { type: 'camera' }],
  ['booze bus on Canning Highway', 'report_hazard', { type: 'police' }],
  ['cops up ahead', 'report_hazard', { type: 'police' }],
  ["there's a crash", 'report_hazard', { type: 'crash' }],
  ['big prang on the freeway ahead', 'report_hazard', { type: 'crash' }],
  ['roadworks', 'report_hazard', { type: 'roadworks' }],
  ['traffic jam', 'report_hazard', { type: 'traffic' }],
  ['road closed', 'report_hazard', { type: 'closure' }],
  ['flooding', 'report_hazard', { type: 'weather' }],
  ['heavy rain here', 'report_hazard', { type: 'weather' }],
  ["watch out there's a roo on the road", 'report_hazard', { type: 'hazard' }],
  ['report a pothole', 'report_hazard', { type: 'hazard' }],
  // eta
  ['how long left', 'eta', { ask: 'time' }],
  ['when will we get there', 'eta', { ask: 'time' }],
  ["what's my ETA", 'eta', { ask: 'time' }],
  ['how far', 'eta', { ask: 'distance' }],
  ['how far to go', 'eta', { ask: 'distance' }],
  ['are we there yet', 'eta', {}],
  ['how much longer', 'eta', { ask: 'time' }],
  // stop / start
  ['stop navigation', 'stop_nav', {}],
  ['cancel route', 'stop_nav', {}],
  ['end trip', 'stop_nav', {}],
  ["let's go", 'start_nav', {}],
  ['start navigation', 'start_nav', {}],
  // avoid
  ['avoid tolls', 'avoid', { tolls: true }],
  ['no tolls', 'avoid', { tolls: true }],
  ['avoid freeways and tolls', 'avoid', { tolls: true, freeways: true }],
  ['avoid ferries', 'avoid', { ferries: true }],
  ['take the freeway', 'avoid', { freeways: false }],
  ['avoid the traffic', 'avoid', { traffic: true }],
  // message
  ["message Sam I'm 10 minutes away", 'message', { to: 'Sam', text: "I'm 10 minutes away" }],
  ['tell Jess running late', 'message', { to: 'Jess', text: 'Running late' }],
  ['text Mum on my way', 'message', { to: 'Mum', text: 'On my way' }],
  ['send a message to Sam saying see you soon', 'message', { to: 'Sam', text: 'See you soon' }],
  ["let Jess know i'm stuck in traffic", 'message', { to: 'Jess', text: "I'm stuck in traffic" }],
  ['send Dad a text saying nearly there', 'message', { to: 'Dad', text: 'Nearly there' }],
  ['tell Jess to put the kettle on', 'message', { to: 'Jess', text: 'Put the kettle on' }],
  ['reply be there soon', 'message', { reply: true, text: 'Be there soon' }],
  // call
  ['call Mum', 'call', { to: 'Mum' }],
  ['ring my dad', 'call', { to: 'dad' }],
  ['give Sam a call', 'call', { to: 'Sam' }],
  ['call 0412 345 678', 'call', { number: '0412 345 678' }],
  // music
  ['play music', 'music', { query: null }],
  ['play AC/DC', 'music', { query: 'AC/DC' }],
  ['play Thunderstruck by AC/DC on Spotify', 'music', { query: 'Thunderstruck AC/DC', app: 'spotify' }],
  ['chuck on some tunes', 'music', { query: null }],
  ['open Spotify', 'music', { app: 'spotify', query: null }],
  ['open YouTube Music', 'music', { app: 'youtube' }],
  ['open Apple Music', 'music', { app: 'apple' }],
  ['next song', 'music', { control: 'next' }],
  // voice
  ['mute', 'voice_mute', {}],
  ['shut up', 'voice_mute', {}],
  ['be quiet please', 'voice_mute', {}],
  ['unmute', 'voice_unmute', {}],
  ['turn the voice back on', 'voice_unmute', {}],
  // flames
  ['pop the flames', 'flames', {}],
  ['rev it', 'flames', {}],
  ['send it', 'flames', {}],
  ['give it some herbs', 'flames', {}],
  // theme
  ['night mode', 'theme', { theme: 'dark' }],
  ['switch to day mode', 'theme', { theme: 'light' }],
  ['turn off dark mode', 'theme', { theme: 'light' }],
  // misc
  ['where am I', 'where_am_i', {}],
  ['what street is this', 'where_am_i', {}],
  ['open garage', 'garage', {}],
  ['paint my car red', 'garage', { color: '#e53935', colorName: 'red' }],
  ['show my trips', 'open_panel', { panel: 'trips' }],
  ['track day', 'open_panel', { panel: 'race' }],
  ['re-centre', 'recenter', {}],
  ['help', 'help', {}],
  ['what can you do', 'help', {}],
  ['never mind', 'dismiss', {}],
  ['stop', 'dismiss', {}],
  // unknown
  ['tell me a joke', 'unknown', {}],
  ["what's the weather like in Bunbury", 'unknown', {}],
  ["how's the traffic on the Kwinana", 'unknown', {}],
  ['is there a speed camera on my route', 'unknown', {}],
  ['Kings Park', 'unknown', {}],
  ['', 'unknown', {}],
];

test(`parses ${CASES.length} phrasings into the right intent`, () => {
  assert.ok(CASES.length >= 40);
  for (const [text, intent, slots] of CASES) {
    const r = parse(text);
    assert.equal(r.intent, intent, `"${text}" → ${r.intent} (wanted ${intent}) ${JSON.stringify(r.slots)}`);
    for (const [k, v] of Object.entries(slots)) assert.deepEqual(r.slots[k], v, `"${text}" slot ${k}: ${JSON.stringify(r.slots[k])}`);
  }
});

test('confidence is high for clear commands and zero for unknown', () => {
  assert.ok(parse('take me to Kings Park').confidence >= 0.9);
  assert.ok(parse('police').confidence < 0.9);
  assert.equal(parse('sing me a song about wombats').confidence, 0);
});

test('result keeps the cleaned original text', () => {
  assert.equal(parse('  Take me to Kings Park!  ').text, 'Take me to Kings Park');
});

test('pickBest chooses the alternative the parser understands', () => {
  const r = pickBest(['take me to kings bark', 'nearest serve oh', 'nearest servo']);
  assert.equal(r.intent, 'navigate');
  const r2 = pickBest(['nears servo', 'nearest servo']);
  assert.equal(r2.intent, 'find_nearby');
  assert.equal(pickBest([]).intent, 'unknown');
  assert.equal(pickBest('call Mum').intent, 'call');
});

test('splitRecipient prefers known multi-word names', () => {
  assert.deepEqual(splitRecipient('Uncle Bob running late', ['Bob', 'Uncle Bob']), { to: 'Uncle Bob', text: 'Running late' });
  assert.deepEqual(splitRecipient('Sam: see you there'), { to: 'Sam', text: 'See you there' });
  assert.deepEqual(splitRecipient('to Mum on my way'), { to: 'Mum', text: 'On my way' });
  assert.deepEqual(splitRecipient('Jess'), { to: 'Jess', text: '' });
});

test('tidyMessage capitalises and fixes lone i', () => {
  assert.equal(tidyMessage("that i'm late and i know it"), "I'm late and I know it");
  assert.equal(tidyMessage(''), '');
});

test('cleanText strips control characters, curly quotes and edge punctuation', () => {
  assert.equal(cleanText('“Hi” there\u0007 it’s me?!'), "Hi\" there it's me");
  assert.equal(cleanText(null), '');
  assert.equal(cleanText('x'.repeat(500)).length, 300);
});

test('vocab lookups', () => {
  assert.equal(findHazard('cops near the police station'), 'police');
  assert.equal(findHazard('police station'), null);
  assert.equal(findHazard('road closed due to flooding'), 'closure');
  assert.equal(findCategory('a cheap servo please').id, 'fuel');
  assert.equal(findCategory('Kings Park'), null);
  assert.equal(exactCategory('the loo').id, 'toilets');
  assert.equal(findMusicApp('play it on youtube music'), 'youtube');
  assert.equal(findMusicApp('nothing'), null);
});

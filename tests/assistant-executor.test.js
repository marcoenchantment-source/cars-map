import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createExecutor } from '../app/js/assistant/executor.js';
import * as geo from '../app/js/core/geo.js';
import * as config from '../app/js/config.js';

const PERTH = { lng: 115.8605, lat: -31.9505 };

function fakeActions(impls) {
  const calls = [];
  return {
    calls,
    has: (n) => n in impls,
    call: async (n, ...args) => {
      calls.push([n, ...args]);
      if (!(n in impls)) throw new Error(`missing ${n}`);
      return impls[n](...args);
    },
  };
}

function setup(impls = {}, { state = {}, contacts = [], canOpen = false, claude } = {}) {
  const actions = fakeActions(impls);
  const st = { mode: 'explore', position: { ...PERTH }, settings: { units: 'metric', anthropicKey: '' }, routes: [], selectedRoute: 0, destination: null, online: true, ...state };
  const ex = createExecutor({
    actions, config, geo, getState: () => st, getContacts: () => contacts, getNear: () => [PERTH.lng, PERTH.lat],
    canOpenNow: () => canOpen, isIOS: false, lastIncoming: () => 'Sam', timeZone: 'Australia/Perth', claude,
  });
  return { ex, actions };
}

const route = { duration: 720, distance: 8400, summary: 'via Mitchell Fwy', trafficDelay: 180 };
const caltex = { id: 'a', name: 'Caltex Leederville', lng: 115.84, lat: -31.94 };
const far = { id: 'b', name: 'BP Far Away', lng: 116.2, lat: -32.3 };

test('navigate uses routeTo and describes the previewed route', async () => {
  const st = { mode: 'preview', routes: [route], destination: { name: 'Kings Park', lng: 115.83, lat: -31.96 } };
  const { ex, actions } = setup({ routeTo: async () => st.destination }, { state: st });
  const r = await ex.handle('take me to Kings Park');
  assert.deepEqual(actions.calls[0], ['routeTo', 'Kings Park']);
  assert.match(r.text, /^Kings Park, 12 minutes via Mitchell Freeway, with 3 minutes of traffic\. Say "go"/);
});

test('navigate falls back to search + planRoute and passes friendly errors through', async () => {
  const { ex, actions } = setup({ search: async () => [caltex], planRoute: async () => [route] });
  const r = await ex.handle('drive to Caltex Leederville');
  assert.equal(actions.calls[1][0], 'planRoute');
  assert.match(r.text, /^Caltex Leederville, 12 minutes/);
  const bad = setup({ routeTo: async () => { throw new Error('I couldn’t find “Zzz” near you. Try adding the suburb.'); } });
  assert.match((await bad.ex.handle('take me to Zzz')).text, /Try adding the suburb/);
});

test('find_nearby picks the nearest result and routes to it', async () => {
  const { ex, actions } = setup({ search: async () => [far, caltex], planRoute: async () => [route] });
  const r = await ex.handle('nearest servo');
  assert.deepEqual(actions.calls[0], ['search', 'petrol station', { near: [PERTH.lng, PERTH.lat], limit: 8 }]);
  assert.equal(actions.calls[1][1], caltex);
  assert.match(r.text, /^Nearest servo is Caltex Leederville, \d+(\.\d)? km\. Showing the route\.$/);
});

test('find_nearby with no results says so', async () => {
  const { ex } = setup({ search: async () => [] });
  assert.match((await ex.handle('find coffee')).text, /couldn't find any coffee nearby/);
});

test('report_hazard passes the type and current position', async () => {
  const { ex, actions } = setup({ reportHazard: async () => {} });
  const r = await ex.handle('speed camera ahead');
  assert.deepEqual(actions.calls[0], ['reportHazard', 'camera', { lngLat: [PERTH.lng, PERTH.lat] }]);
  assert.match(r.text, /^Speed camera reported/);
  const none = setup({});
  assert.match((await none.ex.handle('report police')).text, /isn't available/);
});

test('eta reads navStatus', async () => {
  const eta = Date.UTC(2026, 10, 10, 2, 42); // 10:42 am in Perth
  const { ex } = setup({ navStatus: () => ({ eta, durationRemaining: 720, distanceRemaining: 8400 }) });
  assert.equal((await ex.handle('how long left')).text, "You'll arrive at 10:42 am, 12 minutes to go.");
  assert.equal((await ex.handle('how far')).text, '8.4 km to go, arriving at 10:42 am.');
  const idle = setup({ navStatus: () => null });
  assert.match((await idle.ex.handle("what's my ETA")).text, /not navigating/);
});

test('stop navigation only when navigating', async () => {
  const nav = setup({ stopNavigation: () => {} }, { state: { mode: 'navigate' } });
  assert.equal((await nav.ex.handle('stop navigation')).text, 'Navigation stopped.');
  assert.equal(nav.actions.calls[0][0], 'stopNavigation');
  const idle = setup({ stopNavigation: () => {} });
  assert.match((await idle.ex.handle('cancel route')).text, /no route to stop/);
});

test('start_nav starts the previewed route', async () => {
  const dest = { name: 'Kings Park', lng: 115.83, lat: -31.96 };
  const { ex, actions } = setup({ startNavigation: () => {} }, { state: { mode: 'preview', routes: [route], destination: dest } });
  const r = await ex.handle("let's go");
  assert.deepEqual(actions.calls[0], ['startNavigation', route, dest]);
  assert.equal(r.speak, false);
});

test('avoid sets settings and re-plans while previewing', async () => {
  const dest = { name: 'Kings Park', lng: 115.83, lat: -31.96 };
  const { ex, actions } = setup({ setSetting: () => {}, planRoute: async () => [route] }, { state: { mode: 'preview', destination: dest } });
  const r = await ex.handle('avoid tolls and freeways');
  assert.deepEqual(actions.calls.slice(0, 2), [['setSetting', 'avoidTolls', true], ['setSetting', 'avoidMotorways', true]]);
  assert.deepEqual(actions.calls[2], ['planRoute', dest]);
  assert.equal(r.text, 'Avoiding tolls and freeways. Route updated.');
});

test('message goes to a crew friend in-app, else SMS to a quick contact', async () => {
  const friends = [{ name: 'Sam', pubkey: 'x' }];
  const contacts = [{ id: '1', name: 'Mum', phone: '0412 345 678' }];
  const { ex, actions } = setup({ listFriends: () => friends, sendMessage: async () => ({}) }, { contacts });
  const r = await ex.handle("message Sam I'm 10 minutes away");
  assert.deepEqual(actions.calls.at(-1), ['sendMessage', 'Sam', "I'm 10 minutes away"]);
  assert.equal(r.text, "Sent to Sam: I'm 10 minutes away");
  const sms = await ex.handle('text Mum on my way');
  assert.equal(sms.links[0].href, 'sms:0412345678?body=On%20my%20way');
  assert.match(sms.text, /^Tap to text Mum/);
  const missing = await ex.handle('tell Jess running late');
  assert.match(missing.text, /can't find Jess/);
  assert.equal(missing.buttons[0].action, 'contacts');
});

test('reply goes to the last person who messaged', async () => {
  const { ex, actions } = setup({ listFriends: () => [{ name: 'Sam' }], sendMessage: async () => ({}) });
  await ex.handle('reply be there soon');
  assert.deepEqual(actions.calls.at(-1), ['sendMessage', 'Sam', 'Be there soon']);
});

test('call opens a tel: link, wording depends on whether we can open it now', async () => {
  const contacts = [{ id: '1', name: 'Mum', phone: '+61 412 345 678' }];
  const later = await setup({}, { contacts }).ex.handle('call Mum');
  assert.equal(later.links[0].href, 'tel:+61412345678');
  assert.equal(later.text, 'Tap to call Mum.');
  const now = await setup({}, { contacts, canOpen: true }).ex.handle('ring mum');
  assert.equal(now.text, 'Opening your phone to call Mum.');
  assert.match((await setup({}).ex.handle('call Dad')).text, /don't have a number for Dad/);
});

test('music opens Spotify search or offers a chooser', async () => {
  const { ex } = setup({}, { canOpen: true });
  const r = await ex.handle('play AC/DC');
  assert.equal(r.links[0].href, 'https://open.spotify.com/search/AC%2FDC');
  assert.equal(r.text, 'Opening Spotify.');
  const chooser = await ex.handle('play music');
  assert.deepEqual(chooser.links.map((l) => l.label), ['Spotify', 'YouTube Music', 'Apple Music']);
  assert.match((await ex.handle('next song')).text, /can't control playback/);
});

test('flames, theme, voice, garage map to their actions', async () => {
  const { ex, actions } = setup({ popFlames: () => {}, setSetting: () => {}, setCarLook: () => {}, openGarage: () => {} });
  await ex.handle('send it');
  await ex.handle('night mode');
  const mute = await ex.handle('mute');
  await ex.handle('paint my car blue');
  await ex.handle('open garage');
  assert.deepEqual(actions.calls.map((c) => c[0]), ['popFlames', 'setSetting', 'setSetting', 'setCarLook', 'openGarage']);
  assert.deepEqual(actions.calls[1], ['setSetting', 'theme', 'dark']);
  assert.deepEqual(actions.calls[2], ['setSetting', 'voice', false]);
  assert.equal(mute.speak, false);
});

test('where_am_i reverse geocodes the current position', async () => {
  const { ex, actions } = setup({ reverseGeocode: async () => ({ name: 'Hay Street', label: 'Perth, WA, Australia', lng: 1, lat: 1 }) });
  assert.equal((await ex.handle('where am I')).text, "You're near Hay Street, Perth.");
  assert.deepEqual(actions.calls[0], ['reverseGeocode', [PERTH.lng, PERTH.lat]]);
});

test('unknown requests: no key → capability list; key → Claude', async () => {
  const noKey = await setup({}).ex.handle('tell me a joke');
  assert.match(noKey.text, /I can navigate, find places/);
  let asked = null;
  const withKey = setup({}, { state: { settings: { anthropicKey: 'sk-ant-x' } }, claude: async (t) => { asked = t; return { text: 'Why did the roo…', links: [], buttons: [] }; } });
  const r = await withKey.ex.handle('tell me a joke');
  assert.equal(asked, 'tell me a joke');
  assert.equal(r.text, 'Why did the roo…');
});

test('a throwing action never escapes', async () => {
  const { ex } = setup({ popFlames: () => { throw new TypeError('boom'); } });
  const r = await ex.handle('pop the flames');
  assert.match(r.text, /didn't work/);
});

test('runTool validates input and maps to intents', async () => {
  const { ex, actions } = setup({ reportHazard: async () => {}, navStatus: () => null });
  const bad = await ex.runTool('report_hazard', { type: 'aliens' });
  assert.equal(bad.isError, true);
  const ok = await ex.runTool('report_hazard', { type: 'police' });
  assert.equal(ok.isError, false);
  assert.equal(actions.calls[0][1], 'police');
  assert.equal((await ex.runTool('nope', {})).isError, true);
  assert.match((await ex.runTool('get_eta', {})).content, /not navigating/);
});

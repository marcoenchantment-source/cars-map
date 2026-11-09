// Route normalisation (real OSRM + Valhalla responses, Perth CBD → Fremantle), ranking and the provider chain.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pointAlong, haversine } from '../app/js/core/geo.js';
import { parseOsrm, buildOsrmUrl, routeOsrm } from '../app/js/routing/osrm.js';
import { parseValhalla, buildValhallaRequest } from '../app/js/routing/valhalla.js';
import { rankRoutes, isNearDuplicate, computeAlongs } from '../app/js/routing/normalize.js';
import { computeRoutes, providerChain, toLngLat } from '../app/js/routing/router.js';
import { fetchJson, ServiceError } from '../app/js/routing/http.js';

const fixture = (name) => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'));
const OSRM = fixture('routing-osrm-perth-fremantle.json');
const VALHALLA = fixture('routing-valhalla-perth-fremantle.json');
const FROM = [115.8605, -31.9505];
const TO = [115.7475, -32.0569];

function assertRouteSane(r, provider) {
  assert.equal(r.provider, provider);
  assert.ok(r.id.startsWith(provider));
  assert.ok(r.geometry.length > 100);
  assert.equal(r.cum.length, r.geometry.length);
  for (let i = 1; i < r.cum.length; i++) assert.ok(r.cum[i] >= r.cum[i - 1]);
  const total = r.cum.at(-1);
  assert.ok(Math.abs(total - r.distance) / r.distance < 0.02, `geometry length ${total} vs distance ${r.distance}`);
  assert.ok(r.distance > 15000 && r.distance < 30000);
  const kmh = r.distance / 1000 / (r.duration / 3600);
  assert.ok(kmh > 20 && kmh < 90, `average speed ${kmh}`);
  const [w, s, e, n] = r.bbox;
  assert.ok(r.geometry.every(([x, y]) => x >= w && x <= e && y >= s && y <= n));
  assert.ok(r.summary.startsWith('via '));
  assert.equal(r.steps[0].type, 'depart');
  assert.equal(r.steps[0].along, 0);
  const last = r.steps.at(-1);
  assert.equal(last.type, 'arrive');
  assert.equal(last.along, total);
  r.steps.forEach((st, i) => {
    assert.equal(st.index, i);
    if (i) assert.ok(st.along >= r.steps[i - 1].along, `step ${i} along not monotonic`);
    assert.ok(typeof st.instruction === 'string' && st.instruction.length > 3);
    assert.ok(typeof st.spoken === 'string' && st.spoken.length > 3);
    const p = pointAlong(r.geometry, r.cum, st.along).point;
    assert.ok(haversine(p, st.location) < 60, `step ${i} (${st.instruction}) is ${haversine(p, st.location)} m from its along point`);
  });
}

test('OSRM: real response normalises to sane routes', () => {
  const routes = parseOsrm(OSRM, { destinationName: 'The Cray' });
  assert.equal(routes.length, 2);
  routes.forEach((r) => assertRouteSane(r, 'osrm'));
  assert.equal(routes[0].hasTolls, false);
  assert.equal(routes[0].summary, 'via Kwinana Freeway and Leach Highway');
});

test('OSRM: instructions read naturally', () => {
  const text = parseOsrm(OSRM, { destinationName: 'The Cray' })[0].steps.map((s) => s.instruction);
  assert.equal(text[0], 'Head south-west');
  assert.ok(text.includes('Turn left onto Roe Street'));
  assert.ok(text.includes('Take the ramp onto Mitchell Freeway'), 'nameless ramp borrows the next road');
  assert.ok(text.includes('Merge onto Mitchell Freeway'));
  assert.ok(text.includes('Continue onto Kwinana Freeway'));
  assert.ok(text.includes('Keep right towards Fremantle'));
  assert.ok(text.includes('At the roundabout, take the 1st exit onto High Street'));
  assert.equal(text.at(-1), 'You have arrived at The Cray, on your right');
});

test('OSRM: along matches the provider’s own step distances', () => {
  const r = parseOsrm(OSRM)[0];
  const raw = OSRM.routes[0].legs[0].steps;
  let sum = 0;
  r.steps.forEach((st, i) => {
    assert.ok(Math.abs(st.along - sum) < 150, `step ${i}: along ${st.along} vs expected ${sum}`);
    sum += raw[i].distance;
  });
});

test('OSRM: error codes become friendly errors', () => {
  assert.throws(() => parseOsrm({ code: 'NoRoute' }), (e) => e instanceof ServiceError && e.code === 'no-route');
  assert.throws(() => parseOsrm({ code: 'InvalidQuery' }), (e) => e.code === 'bad-response');
  assert.throws(() => parseOsrm(null), (e) => e.code === 'bad-response');
  assert.deepEqual(parseOsrm({ code: 'Ok', routes: [{ geometry: { coordinates: [[1, 2]] } }] }), []);
});

test('OSRM: URL uses bearings for reroutes and never exclude', () => {
  const url = buildOsrmUrl('https://osrm', FROM, TO, { bearing: 200.4 });
  assert.match(url, /\/route\/v1\/driving\/115\.860500,-31\.950500;115\.747500,-32\.056900\?/);
  assert.match(url, /overview=full&geometries=geojson&steps=true&alternatives=3/);
  assert.ok(url.endsWith('&bearings=200,45;'));
  assert.ok(!url.includes('exclude'));
  assert.ok(buildOsrmUrl('https://osrm', FROM, TO, { bearing: -10 }).endsWith('bearings=350,45;'));
  assert.ok(!buildOsrmUrl('https://osrm', FROM, TO).includes('bearings'));
});

test('OSRM: avoid options report what the route actually avoids', () => {
  const [freeway, coastal] = parseOsrm(OSRM, { options: { avoidTolls: true, avoidMotorways: true } });
  assert.equal(freeway.options.avoidTolls, false, 'the demo server sends no road classes, so tolls are unverified');
  assert.equal(freeway.options.avoidMotorways, false, 'this route uses Kwinana Freeway');
  assert.equal(coastal.options.avoidMotorways, true, 'the Stirling Highway route has no freeway');
  assert.equal(parseOsrm(OSRM)[0].options.avoidTolls, false);
});

test('Valhalla: real response normalises to sane routes', () => {
  const routes = parseValhalla(VALHALLA, { destinationName: 'The Cray' });
  assert.equal(routes.length, 3);
  routes.forEach((r) => assertRouteSane(r, 'valhalla'));
  const text = routes[0].steps.map((s) => s.instruction);
  assert.ok(text.includes('Enter Point Lewis Rotary and take the 1st exit onto Mounts Bay Road'));
  assert.ok(text.includes('Turn right onto Queen Victoria Street'));
  assert.equal(text.at(-1), 'You have arrived at The Cray, on your right');
});

test('Valhalla: along comes from begin_shape_index', () => {
  const r = parseValhalla(VALHALLA)[0];
  const william = r.steps.find((s) => s.instruction === 'Turn left onto William Street');
  assert.ok(william.along > 500 && william.along < 700, `along ${william.along}`);
  const raw = VALHALLA.trip.legs[0].maneuvers;
  let sum = 0;
  r.steps.forEach((st, i) => {
    assert.ok(Math.abs(st.along - sum) < 120, `step ${i}: along ${st.along} vs expected ${sum}`);
    sum += raw[i].length * 1000;
  });
});

test('Valhalla: request maps avoid options and heading', () => {
  const body = buildValhallaRequest(FROM, TO, { options: { avoidTolls: true, avoidMotorways: true, avoidFerries: false }, bearing: 95 });
  assert.equal(body.costing, 'auto');
  assert.deepEqual(body.costing_options.auto, { use_tolls: 0, use_highways: 0, use_ferry: 0.5 });
  assert.equal(body.alternates, 2);
  assert.equal(body.units, 'kilometers');
  assert.deepEqual(body.locations[0], { lat: FROM[1], lon: FROM[0], type: 'break', heading: 95, heading_tolerance: 45 });
  assert.equal(buildValhallaRequest(FROM, TO, { alternatives: false }).alternates, 0);
});

test('Valhalla: errors', () => {
  assert.throws(() => parseValhalla({ error_code: 442, error: 'No path could be found' }), (e) => e.code === 'no-route');
  assert.throws(() => parseValhalla({ error_code: 100, error: 'x' }), (e) => e.code === 'bad-response');
  assert.throws(() => parseValhalla({}), (e) => e.code === 'bad-response');
});

test('rankRoutes sorts by duration and removes near-identical alternatives', () => {
  const [a, b] = parseOsrm(OSRM);
  const copy = { ...a, id: 'copy', duration: a.duration + 30 };
  assert.ok(isNearDuplicate(copy, a));
  assert.ok(!isNearDuplicate(a, b));
  const ranked = rankRoutes([b, copy, a]);
  assert.deepEqual(ranked.map((r) => r.id), [a.id, b.id]);
  assert.equal(rankRoutes([a, b], { max: 1 }).length, 1);
});

test('computeAlongs stays monotonic even when a manoeuvre is off the line', () => {
  const geometry = [[0, 0], [0, 0.001], [0, 0.002], [0, 0.003]];
  const cum = [0, 111, 222, 333];
  const out = computeAlongs(geometry, cum, [
    { type: 'depart', location: [0, 0] },
    { type: 'turn', location: [0, 0.002], expected: 220 },
    { type: 'turn', location: [5, 5], expected: 100 }, // nonsense: must not go backwards
    { type: 'arrive', location: [0, 0.003] },
  ]);
  assert.equal(out[0], 0);
  assert.ok(Math.abs(out[1] - 222) < 2);
  assert.ok(out[2] >= out[1]);
  assert.equal(out[3], 333);
});

const fakeRoute = (provider, duration) => parseOsrm(OSRM).map((r) => ({ ...r, provider, duration }))[0];

test('router: chain order follows settings', () => {
  assert.deepEqual(providerChain({}), ['osrm', 'valhalla']);
  assert.deepEqual(providerChain({ avoidTolls: true }), ['valhalla', 'osrm']);
  assert.deepEqual(providerChain({ tomtomKey: 'k' }), ['tomtom', 'osrm', 'valhalla']);
  assert.deepEqual(toLngLat({ lng: 1, lat: 2 }), [1, 2]);
  assert.equal(toLngLat({ lng: 'x' }), null);
});

test('router: falls back to the next provider on failure', async () => {
  const calls = [];
  const providers = {
    tomtom: async () => { calls.push('tomtom'); throw new ServiceError('bad key', { code: 'http', status: 403 }); },
    osrm: async () => { calls.push('osrm'); throw new ServiceError('timeout', { code: 'timeout' }); },
    valhalla: async () => { calls.push('valhalla'); return [fakeRoute('valhalla', 900)]; },
  };
  const routes = await computeRoutes(FROM, { lng: TO[0], lat: TO[1], name: 'Freo' }, { settings: { tomtomKey: 'k' }, providers });
  assert.deepEqual(calls, ['tomtom', 'osrm', 'valhalla']);
  assert.equal(routes[0].provider, 'valhalla');
});

test('router: friendly errors, abort passes straight through', async () => {
  const noRoute = async () => { throw new ServiceError('none', { code: 'no-route' }); };
  await assert.rejects(computeRoutes(FROM, TO, { providers: { osrm: noRoute, valhalla: noRoute } }), (e) => e.code === 'no-route' && /closer to a road/.test(e.message));
  const down = async () => { throw new ServiceError('down', { code: 'network' }); };
  await assert.rejects(computeRoutes(FROM, TO, { providers: { osrm: down, valhalla: noRoute } }), (e) => /Check your signal/.test(e.message));
  let valhallaCalled = false;
  const aborted = async () => { throw new ServiceError('Cancelled', { code: 'aborted' }); };
  await assert.rejects(computeRoutes(FROM, TO, { providers: { osrm: aborted, valhalla: async () => { valhallaCalled = true; return []; } } }), (e) => e.code === 'aborted');
  assert.equal(valhallaCalled, false);
  await assert.rejects(computeRoutes(null, TO), (e) => e.code === 'bad-input');
});

test('router: end to end with a mocked fetch, OSRM timeout falls back to Valhalla', async () => {
  const fetchImpl = (url, init) => {
    if (url.includes('/route/v1/')) {
      return new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))));
    }
    assert.equal(init.method, 'POST');
    return Promise.resolve(new Response(JSON.stringify(VALHALLA), { status: 200 }));
  };
  const routes = await computeRoutes(FROM, TO, { endpoints: { osrm: 'https://osrm', valhalla: 'https://val' }, fetchImpl, timeoutMs: 40 });
  assert.equal(routes[0].provider, 'valhalla');
  assert.ok(routes.length >= 2 && routes.length <= 3);
  for (let i = 1; i < routes.length; i++) assert.ok(routes[i].duration >= routes[i - 1].duration);
});

test('routeOsrm: 400 NoSegment body becomes no-route', async () => {
  const fetchImpl = async () => new Response(JSON.stringify({ code: 'NoSegment', message: 'Could not find a matching segment' }), { status: 400 });
  await assert.rejects(routeOsrm({ base: 'https://osrm', from: FROM, to: TO, fetchImpl }), (e) => e.code === 'no-route');
});

test('fetchJson: timeout, HTTP error and unreadable body are friendly', async () => {
  const hang = (url, init) => new Promise((_, reject) => {
    const fail = () => reject(Object.assign(new Error('x'), { name: 'AbortError' }));
    if (init.signal.aborted) fail();
    else init.signal.addEventListener('abort', fail);
  });
  await assert.rejects(fetchJson('https://x', { fetchImpl: hang, timeoutMs: 20, service: 'The route service' }), (e) => e.code === 'timeout' && /took too long/.test(e.message));
  await assert.rejects(fetchJson('https://x', { fetchImpl: async () => new Response('busy', { status: 503 }) }), (e) => e.code === 'http' && e.status === 503);
  await assert.rejects(fetchJson('https://x', { fetchImpl: async () => new Response('<html>', { status: 200 }) }), (e) => e.code === 'bad-response');
  await assert.rejects(fetchJson('https://x', { fetchImpl: async () => { throw new TypeError('Failed to fetch'); } }), (e) => e.code === 'network');
  const ctl = new AbortController();
  ctl.abort();
  await assert.rejects(fetchJson('https://x', { fetchImpl: hang, signal: ctl.signal }), (e) => e.code === 'aborted');
});

// TomTom calculateRoute parsing (hand-made fixture in TomTom's documented shape) and request building.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseTomTom, buildTomTomUrl, trafficLevel, routeTomTom } from '../app/js/routing/tomtom.js';

const FIXTURE = JSON.parse(readFileSync(new URL('./fixtures/routing-tomtom-sample.json', import.meta.url), 'utf8'));
const FROM = [115.8605, -31.9505];
const TO = [115.83, -31.968];

test('parses traffic-aware durations', () => {
  const [r] = parseTomTom(FIXTURE, { destinationName: 'The Cray' });
  assert.equal(r.provider, 'tomtom');
  assert.equal(r.duration, 900);
  assert.equal(r.trafficDelay, 480);
  assert.equal(r.durationNoTraffic, 420);
  assert.equal(r.distance, FIXTURE.routes[0].summary.lengthInMeters);
  assert.equal(r.hasTolls, true);
  assert.equal(r.geometry.length, 10);
  assert.deepEqual(r.geometry[0], [115.8605, -31.9505]);
});

test('TRAFFIC sections become congestion segments', () => {
  const [r] = parseTomTom(FIXTURE);
  assert.deepEqual(r.congestion.map((c) => c.level), ['slow', 'closed', 'heavy']);
  assert.equal(r.congestion[0].coords.length, 3); // points 3..5
  assert.deepEqual(r.congestion[1].coords[0], r.geometry[6]);
  assert.equal(trafficLevel({ magnitudeOfDelay: 1 }), 'slow');
  assert.equal(trafficLevel({ magnitudeOfDelay: 0 }), 'slow');
  assert.equal(trafficLevel({ magnitudeOfDelay: 3 }), 'heavy');
  assert.equal(trafficLevel({ magnitudeOfDelay: 4 }), 'closed');
  assert.equal(trafficLevel({ simpleCategory: 'ROAD_CLOSURE', magnitudeOfDelay: 1 }), 'closed');
});

test('guidance instructions map to steps', () => {
  const [r] = parseTomTom(FIXTURE, { destinationName: 'The Cray' });
  assert.deepEqual(r.steps.map((s) => s.type), ['depart', 'turn', 'roundabout', 'off-ramp', 'arrive']);
  assert.equal(r.steps[1].instruction, 'Turn left onto Beaufort St');
  assert.equal(r.steps[1].spoken, 'Turn left onto Beaufort Street');
  assert.equal(r.steps[2].exit, 2);
  assert.equal(r.steps[2].instruction, 'At the roundabout, take the 2nd exit onto Canning Hwy');
  assert.equal(r.steps[2].spoken, 'At the roundabout, take the 2nd exit onto Canning Highway');
  assert.equal(r.steps[3].instruction, 'Take exit 12 towards Fremantle');
  assert.equal(r.steps[4].instruction, 'You have arrived at The Cray, on your right');
  r.steps.forEach((s, i) => {
    const pi = FIXTURE.routes[0].guidance.instructions[i].pointIndex;
    assert.ok(Math.abs(s.along - r.cum[pi]) < 0.001, `step ${i} along`);
    if (i) assert.ok(s.along >= r.steps[i - 1].along);
  });
  assert.equal(r.steps[1].distance, FIXTURE.routes[0].guidance.instructions[2].routeOffsetInMeters - FIXTURE.routes[0].guidance.instructions[1].routeOffsetInMeters);
  assert.equal(r.steps[1].duration, 140);
});

test('second route: no traffic, keep-left fork', () => {
  const r = parseTomTom(FIXTURE)[1];
  assert.equal(r.trafficDelay, 0);
  assert.equal(r.congestion, undefined);
  assert.equal(r.hasTolls, false);
  assert.equal(r.steps[1].instruction, 'Keep left onto Mounts Bay Road');
});

test('rejects unusable responses', () => {
  assert.throws(() => parseTomTom({}), (e) => e.code === 'bad-response');
  assert.throws(() => parseTomTom(null), (e) => e.code === 'bad-response');
  assert.deepEqual(parseTomTom({ routes: [{ legs: [{ points: [{ latitude: 1, longitude: 2 }] }] }] }), []);
});

test('request URL carries traffic options and avoids', () => {
  const url = new URL(buildTomTomUrl('https://api.tomtom.com', 'abc123', FROM, TO, { options: { avoidTolls: true, avoidFerries: true }, bearing: 271.6 }));
  assert.equal(url.pathname, '/routing/1/calculateRoute/-31.950500,115.860500:-31.968000,115.830000/json');
  const p = url.searchParams;
  assert.equal(p.get('key'), 'abc123');
  assert.equal(p.get('traffic'), 'true');
  assert.equal(p.get('maxAlternatives'), '2');
  assert.equal(p.get('instructionsType'), 'text');
  assert.equal(p.get('language'), 'en-AU');
  assert.equal(p.get('computeTravelTimeFor'), 'all');
  assert.deepEqual(p.getAll('sectionType'), ['traffic', 'tollRoad']);
  assert.deepEqual(p.getAll('avoid'), ['tollRoads', 'ferries']);
  assert.equal(p.get('vehicleHeading'), '272');
});

test('retries in en-GB when the language is rejected; refused key is explained', async () => {
  const seen = [];
  const fetchImpl = async (url) => {
    const lang = new URL(url).searchParams.get('language');
    seen.push(lang);
    if (lang === 'en-AU') return new Response(JSON.stringify({ detailedError: { code: 'INVALID_REQUEST', message: 'Invalid value for language' } }), { status: 400 });
    return new Response(JSON.stringify(FIXTURE), { status: 200 });
  };
  const routes = await routeTomTom({ base: 'https://api.tomtom.com', key: 'k', from: FROM, to: TO, options: {}, fetchImpl });
  assert.deepEqual(seen, ['en-AU', 'en-GB']);
  assert.equal(routes.length, 2);
  const refused = async () => new Response('{"detailedError":{"code":"FORBIDDEN"}}', { status: 403 });
  await assert.rejects(routeTomTom({ base: 'https://x', key: 'k', from: FROM, to: TO, fetchImpl: refused }), /TomTom key was refused/);
  await assert.rejects(routeTomTom({ base: 'https://x', key: '', from: FROM, to: TO }), (e) => e.code === 'no-key');
});

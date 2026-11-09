import { test } from 'node:test';
import assert from 'node:assert/strict';
import { describeWeather, windFrom, parseForecast, parseRadarIndex, isSevere } from '../app/js/map/weatherCodes.js';

test('describeWeather maps WMO codes and day/night', () => {
  assert.deepEqual(describeWeather(0, true), { label: 'Clear', icon: 'sun' });
  assert.deepEqual(describeWeather(0, false), { label: 'Clear', icon: 'moon' });
  assert.equal(describeWeather(63).label, 'Rain');
  assert.equal(describeWeather(95).icon, 'storm');
  assert.equal(describeWeather(1234).label, 'Unknown');
});

test('windFrom gives compass points', () => {
  assert.equal(windFrom(0), 'N');
  assert.equal(windFrom(225), 'SW');
  assert.equal(windFrom(359), 'N');
  assert.equal(windFrom(NaN), '');
});

test('isSevere flags heavy rain, storms, fog and strong wind', () => {
  assert.equal(isSevere(65), true);
  assert.equal(isSevere(2, 70), true);
  assert.equal(isSevere(2, 20), false);
});

test('parseForecast validates and clips Open-Meteo data', () => {
  const ok = parseForecast({
    current: { temperature_2m: 24.3, apparent_temperature: 23, relative_humidity_2m: 40, precipitation: 0, weather_code: 2, wind_speed_10m: 18, wind_direction_10m: 225, is_day: 1 },
    hourly: { precipitation_probability: [10, 30, 90] },
  });
  assert.equal(ok.temp, 24.3);
  assert.equal(ok.rainChance, 30);
  assert.equal(ok.isDay, true);
  assert.equal(parseForecast({ current: { temperature_2m: 'hot', weather_code: 2 } }), null);
  assert.equal(parseForecast(null), null);
  assert.equal(parseForecast({ current: { temperature_2m: 20, weather_code: 2, wind_speed_10m: -5 } }).windKmh, null);
});

test('parseRadarIndex keeps valid frames, newest last, and rejects bad hosts', () => {
  const idx = {
    host: 'https://tilecache.rainviewer.com',
    radar: { past: Array.from({ length: 13 }, (_, i) => ({ time: 1000 + i, path: `/v2/radar/abc${i}` })) },
  };
  const r = parseRadarIndex(idx);
  assert.equal(r.frames.length, 7);
  assert.equal(r.frames.at(-1).time, 1012);
  assert.equal(parseRadarIndex({ ...idx, host: 'javascript:alert(1)' }), null);
  assert.equal(parseRadarIndex({ host: idx.host, radar: { past: [{ time: 1, path: '"><img>' }] } }), null);
});

// Pure helpers for the weather view: WMO weather codes (Open-Meteo) → words + icon, wind direction,
// and validation of the Open-Meteo response.

const CODES = [
  [[0], 'Clear', 'clear'],
  [[1], 'Mostly clear', 'clear'],
  [[2], 'Partly cloudy', 'cloud'],
  [[3], 'Overcast', 'cloud'],
  [[45, 48], 'Fog', 'fog'],
  [[51, 53, 55, 56, 57], 'Drizzle', 'weather'],
  [[61, 63, 66, 80, 81], 'Rain', 'weather'],
  [[65, 67, 82], 'Heavy rain', 'weather'],
  [[71, 73, 75, 77, 85, 86], 'Snow', 'snow'],
  [[95], 'Thunderstorm', 'storm'],
  [[96, 99], 'Storm with hail', 'storm'],
];

/** { label, icon } for a WMO code; icon 'clear' becomes 'sun' or 'moon'. */
export function describeWeather(code, isDay = true) {
  const hit = CODES.find(([codes]) => codes.includes(code));
  const [, label, icon] = hit ?? [null, 'Unknown', 'cloud'];
  return { label, icon: icon === 'clear' ? (isDay ? 'sun' : 'moon') : icon };
}

/** True when the conditions deserve a driving warning. */
export function isSevere(code, windKmh = 0) {
  return [65, 67, 82, 95, 96, 99, 45, 48].includes(code) || windKmh >= 60;
}

const POINTS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
/** Compass point the wind blows FROM, e.g. 225 → "SW". */
export function windFrom(deg) {
  if (!Number.isFinite(deg)) return '';
  return POINTS[Math.round((((deg % 360) + 360) % 360) / 45) % 8];
}

const num = (v, lo, hi) => (typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi ? v : null);

/** Validate an Open-Meteo forecast response into a small, trusted object (or null). */
export function parseForecast(json) {
  const c = json?.current;
  if (!c || typeof c !== 'object') return null;
  const temp = num(c.temperature_2m, -90, 70);
  const code = num(c.weather_code, 0, 99);
  if (temp == null || code == null) return null;
  const probs = Array.isArray(json.hourly?.precipitation_probability) ? json.hourly.precipitation_probability : [];
  const rainChance = probs.slice(0, 2).map((p) => num(p, 0, 100)).filter((p) => p != null);
  return {
    temp,
    feels: num(c.apparent_temperature, -90, 70),
    humidity: num(c.relative_humidity_2m, 0, 100),
    rainNow: num(c.precipitation, 0, 500),
    code,
    windKmh: num(c.wind_speed_10m, 0, 400),
    windDeg: num(c.wind_direction_10m, 0, 360),
    isDay: c.is_day !== 0,
    rainChance: rainChance.length ? Math.max(...rainChance) : null,
  };
}

/** Validate RainViewer's weather-maps.json → { host, frames: [{time, path}] } with the newest last. */
export function parseRadarIndex(json, maxFrames = 7) {
  const host = typeof json?.host === 'string' && /^https:\/\/[a-z0-9.-]+$/i.test(json.host) ? json.host : null;
  const past = Array.isArray(json?.radar?.past) ? json.radar.past : [];
  const frames = past
    .filter((f) => Number.isInteger(f?.time) && typeof f?.path === 'string' && /^\/[A-Za-z0-9/_-]+$/.test(f.path))
    .slice(-maxFrames);
  return host && frames.length ? { host, frames } : null;
}

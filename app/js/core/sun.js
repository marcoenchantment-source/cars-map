// Solar elevation, used to switch the map between day and night looks.

const RAD = Math.PI / 180;

/**
 * Sun elevation above the horizon in degrees for a time and place (accuracy ~0.5°, enough for day/night).
 * @param {Date} date
 * @param {number} lat
 * @param {number} lng
 * @returns {number}
 */
export function solarElevation(date, lat, lng) {
  const d = date.getTime() / 86400000 - 10957.5; // days since J2000.0
  const g = RAD * (357.529 + 0.98560028 * d); // mean anomaly
  const q = 280.459 + 0.98564736 * d; // mean longitude (deg)
  const L = RAD * (q + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)); // ecliptic longitude
  const e = RAD * (23.439 - 0.00000036 * d); // obliquity
  const dec = Math.asin(Math.sin(e) * Math.sin(L));
  const ra = Math.atan2(Math.cos(e) * Math.sin(L), Math.cos(L));
  const gmstHours = (((18.697374558 + 24.06570982441908 * d) % 24) + 24) % 24;
  const hourAngle = RAD * (gmstHours * 15 + lng) - ra;
  const el = Math.asin(
    Math.sin(RAD * lat) * Math.sin(dec) + Math.cos(RAD * lat) * Math.cos(dec) * Math.cos(hourAngle),
  );
  return el / RAD;
}

/**
 * Day or night with hysteresis so the theme doesn't flicker around dusk.
 * @param {number} elevation degrees
 * @param {'light'|'dark'|null} previous
 * @returns {'light'|'dark'}
 */
export function dayOrNight(elevation, previous = null) {
  if (previous === 'dark') return elevation > -1 ? 'light' : 'dark';
  if (previous === 'light') return elevation < -3 ? 'dark' : 'light';
  return elevation < -2 ? 'dark' : 'light';
}

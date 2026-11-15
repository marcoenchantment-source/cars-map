// Crash detection (pure, no DOM). A crash looks like this: driving at speed, then a stop far
// harsher than any braking (or a big jolt from the phone's motion sensor), then the car stays put.
// Hard braking tops out near 1 g (~10 m/s²); GPS-only detection needs more than that, a jolt
// counts when the motion sensor is available. Nothing is sent from here: the detector only
// raises a "suspected crash" so the app can ask "Are you OK?".

export const CRASH = Object.freeze({
  minSpeedKmh: 40, // must have been driving at least this fast (GPS-only rule)
  minSpeedJoltKmh: 20, // lower bar when the motion sensor felt a jolt
  stoppedKmh: 5, // counts as stopped
  hardDecel: 12, // m/s² — beyond normal braking (~1.2 g)
  jolt: 25, // m/s² — motion-sensor spike (~2.5 g, gravity removed)
  joltWindowMs: 3000, // jolt must be this close to the stop
  dropWindowMs: 3000, // speed must collapse within this time
  confirmStillMs: 4000, // and the car must stay stopped this long
  stillRadiusM: 25, // "stayed put" tolerance for GPS drift
  cooldownMs: 120000, // no second alert straight after one
  maxAccuracyM: 35, // ignore poor fixes
});

const kmh = (mps) => (Number.isFinite(mps) ? mps * 3.6 : NaN);

function metresBetween(a, b) {
  const R = 6371008.8;
  const toRad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * toRad;
  const dLng = (b.lng - a.lng) * toRad;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * toRad) * Math.cos(b.lat * toRad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

/**
 * @param {{onSuspect: (info: {at:number, lng:number, lat:number, speedBeforeKmh:number, reason:'gps'|'jolt'}) => void, config?: object}} opts
 */
export function createCrashDetector({ onSuspect, config = CRASH }) {
  let recent = []; // good fixes from the last few seconds
  let lastJolt = null; // { at, value }
  let candidate = null; // { at, lng, lat, speedBeforeKmh, reason }
  let cooldownUntil = 0;

  function maybeCandidate(fix) {
    const t = fix.timestamp;
    const nowKmh = kmh(fix.speed);
    if (!(nowKmh <= config.stoppedKmh)) return null;
    const before = recent.filter((f) => t - f.timestamp <= config.dropWindowMs && t - f.timestamp > 0 && Number.isFinite(f.speed));
    if (!before.length) return null;
    // Harshest drop from any recent fix to now (m/s²), and the fastest speed seen.
    const decelOf = (f) => (f.speed - (fix.speed ?? 0)) / Math.max((t - f.timestamp) / 1000, 0.2);
    const decel = Math.max(...before.map(decelOf));
    const fromKmh = Math.max(...before.map((f) => kmh(f.speed)));
    const jolted = lastJolt && Math.abs(t - lastJolt.at) <= config.joltWindowMs && lastJolt.value >= config.jolt;
    if (jolted && fromKmh >= config.minSpeedJoltKmh) return { reason: 'jolt', fromKmh };
    if (fromKmh >= config.minSpeedKmh && decel >= config.hardDecel) return { reason: 'gps', fromKmh };
    return null;
  }

  /** Feed every GPS fix. Simulated or poor fixes are ignored. */
  function update(fix) {
    if (!fix || fix.simulated || !Number.isFinite(fix.timestamp) || !Number.isFinite(fix.lng) || !Number.isFinite(fix.lat)) return;
    if (Number.isFinite(fix.accuracy) && fix.accuracy > config.maxAccuracyM) return;
    const t = fix.timestamp;

    if (candidate) {
      const moved = metresBetween(candidate, fix);
      if (kmh(fix.speed) > config.stoppedKmh || moved > config.stillRadiusM) {
        candidate = null; // drove on: it was braking, not a crash
      } else if (t - candidate.at >= config.confirmStillMs) {
        const info = candidate;
        candidate = null;
        cooldownUntil = t + config.cooldownMs;
        onSuspect(info);
      }
    } else if (t >= cooldownUntil && Number.isFinite(fix.speed)) {
      const hit = maybeCandidate(fix);
      if (hit) candidate = { at: t, lng: fix.lng, lat: fix.lat, speedBeforeKmh: Math.round(hit.fromKmh), reason: hit.reason };
    }

    recent = [...recent.filter((f) => t - f.timestamp <= config.dropWindowMs + 1000), { timestamp: t, speed: fix.speed, lng: fix.lng, lat: fix.lat }];
  }

  /** Feed motion-sensor acceleration magnitude (m/s², gravity removed) with its time. */
  function motion(value, at) {
    if (!Number.isFinite(value) || !Number.isFinite(at)) return;
    if (!lastJolt || value > lastJolt.value || at - lastJolt.at > config.joltWindowMs) lastJolt = { at, value };
  }

  function reset() {
    recent = [];
    lastJolt = null;
    candidate = null;
  }

  return Object.freeze({ update, motion, reset, pending: () => candidate !== null });
}

/** The message sent to emergency contacts. */
export function crashMessage({ at, lng, lat, speedBeforeKmh }, { locale = 'en-AU', timeZone } = {}) {
  const time = new Date(at).toLocaleTimeString(locale, { hour: 'numeric', minute: '2-digit', ...(timeZone ? { timeZone } : {}) });
  const where = `https://maps.google.com/?q=${lat.toFixed(5)},${lng.toFixed(5)}`;
  const speed = Number.isFinite(speedBeforeKmh) ? ` after travelling at about ${speedBeforeKmh} km/h` : '';
  return `CRASH ALERT from Cars Map: I may have been in a crash at ${time}${speed} and didn't answer the safety check. My location: ${where} Please call me, and call 000 if you can't reach me.`;
}

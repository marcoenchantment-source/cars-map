// Pure GPS fix handling: convert browser positions into Fix objects, gate out bad fixes,
// derive heading/speed from movement and hold the car still while parked (no dancing car).
import { bearing, haversine, normalizeBearing } from '../core/geo.js';

export const MAX_ACCURACY_M = 150;
/** If no good fix has arrived for this long, coarse fixes are let through again. */
export const GOOD_FIX_STALE_MS = 20000;
const HEADING_MIN_MOVE_M = 5;
const STILL_SPEED_MPS = 1;
const STILL_MAX_HOLD_M = 12; // when the device gives no speed
const DEFAULT_ACCURACY_M = 10;

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

/** GeolocationPosition → Fix, or null when unusable. */
export function fixFromPosition(pos, nowMs = Date.now()) {
  const c = pos?.coords;
  if (!c || !isNum(c.longitude) || !isNum(c.latitude)) return null;
  if (Math.abs(c.longitude) > 180 || Math.abs(c.latitude) > 90) return null;
  return {
    lng: c.longitude,
    lat: c.latitude,
    accuracy: isNum(c.accuracy) && c.accuracy >= 0 ? c.accuracy : null,
    speed: isNum(c.speed) && c.speed >= 0 ? c.speed : null,
    heading: isNum(c.heading) && c.heading >= 0 ? normalizeBearing(c.heading) : null,
    timestamp: isNum(pos.timestamp) ? pos.timestamp : nowMs,
    simulated: false,
  };
}

/** Accept/reject real fixes: drop stale repeats, and poor accuracy once a good fix exists. */
export function createFixGate({ maxAccuracy = MAX_ACCURACY_M, staleMs = GOOD_FIX_STALE_MS } = {}) {
  let lastGoodAt = -Infinity;
  let lastTs = -Infinity;
  return Object.freeze({
    accept(fix) {
      if (!fix || !isNum(fix.lng) || !isNum(fix.lat)) return false;
      if (fix.timestamp <= lastTs) return false;
      const acc = isNum(fix.accuracy) ? fix.accuracy : maxAccuracy;
      const good = acc <= maxAccuracy;
      if (!good && fix.timestamp - lastGoodAt < staleMs) return false;
      lastTs = fix.timestamp;
      if (good) lastGoodAt = fix.timestamp;
      return true;
    },
    reset() {
      lastGoodAt = -Infinity;
      lastTs = -Infinity;
    },
  });
}

/**
 * Smooths the displayed pose. next(fix) returns a "stable" copy of the fix:
 * - heading derived from movement (> 5 m) when the device gives none
 * - speed derived from movement when the device gives none
 * - while still (speed < 1 m/s and movement < accuracy) the previous position is kept
 */
export function createPoseSmoother() {
  let prev = null; // last stable fix
  let prevRaw = null;
  let anchor = null; // point the derived heading is measured from
  let derivedHeading = null;

  function deriveSpeed(fix, point) {
    if (isNum(fix.speed)) return fix.speed;
    if (!prevRaw) return null;
    const dt = (fix.timestamp - prevRaw.timestamp) / 1000;
    return dt > 0.2 && dt < 30 ? haversine([prevRaw.lng, prevRaw.lat], point) / dt : null;
  }

  function isStill(fix, point) {
    if (!prev) return false;
    const moved = haversine([prev.lng, prev.lat], point);
    const acc = isNum(fix.accuracy) ? fix.accuracy : DEFAULT_ACCURACY_M;
    if (isNum(fix.speed)) return fix.speed < STILL_SPEED_MPS && moved < acc;
    return moved < Math.min(acc, STILL_MAX_HOLD_M);
  }

  return Object.freeze({
    next(fix) {
      const point = [fix.lng, fix.lat];
      const speed = deriveSpeed(fix, point);
      prevRaw = fix;
      if (isStill(fix, point)) {
        prev = { ...fix, lng: prev.lng, lat: prev.lat, heading: prev.heading ?? fix.heading, speed: isNum(fix.speed) ? fix.speed : 0 };
        return prev;
      }
      if (!anchor) anchor = point;
      else if (haversine(anchor, point) > HEADING_MIN_MOVE_M) {
        derivedHeading = bearing(anchor, point);
        anchor = point;
      }
      prev = { ...fix, speed: speed ?? 0, heading: isNum(fix.heading) ? fix.heading : derivedHeading };
      return prev;
    },
    reset() {
      prev = null;
      prevRaw = null;
      anchor = null;
      derivedHeading = null;
    },
  });
}

// Cars Map's Nostr event kinds, tag helpers and the encrypted payload formats
// (live location, chat, hello). Everything that arrives from a relay is validated here.
// Pure and DOM-free.
import { cleanText, clamp, finiteIn, isHex64, round, sanitizeCar, cleanBearing } from './sanitize.js';

export const KIND = Object.freeze({
  LOCATION: 20777, // ephemeral: relays forward it but never store it
  DM: 7377, // NIP-44 encrypted chat / hello, ['p', friend]
  HAZARD: 7378,
  VOTE: 7379, // ['e', hazard id]
  TRACE: 7380, // unmapped-road trace
});

export const APP_TAG = Object.freeze(['t', 'carsmap']);

export const LIMITS = Object.freeze({
  eventContent: 32768,
  tags: 64,
  tagItems: 8,
  tagValue: 512,
  dmContent: 12000,
  locationContent: 3000,
  chatText: 500,
  name: 32,
});

/** Live locations older than this are dropped. */
export const LOCATION_STALE_MS = 120000;
// Phones' clocks drift a little; anything further ahead is likely a spammer trying to outlive real reports.
const FUTURE_SKEW_S = 60;

const HEX128_RE = /^[0-9a-f]{128}$/;

/** Structural check of a raw Nostr event (signature is verified separately). */
export function isEventShape(e) {
  if (!e || typeof e !== 'object') return false;
  if (!isHex64(e.id) || !isHex64(e.pubkey) || typeof e.sig !== 'string' || !HEX128_RE.test(e.sig)) return false;
  if (!Number.isInteger(e.kind) || e.kind < 0 || e.kind > 65535) return false;
  if (!Number.isInteger(e.created_at) || e.created_at < 0) return false;
  if (typeof e.content !== 'string' || e.content.length > LIMITS.eventContent) return false;
  if (!Array.isArray(e.tags) || e.tags.length > LIMITS.tags) return false;
  return e.tags.every(
    (t) => Array.isArray(t) && t.length > 0 && t.length <= LIMITS.tagItems
      && t.every((v) => typeof v === 'string' && v.length <= LIMITS.tagValue),
  );
}

/** True when the event's created_at is not unreasonably far in the future. */
export function isTimely(e, nowSec) {
  return e.created_at <= nowSec + FUTURE_SKEW_S;
}

export function tagValue(e, name) {
  for (const t of e.tags) if (t[0] === name && typeof t[1] === 'string') return t[1];
  return null;
}

export function tagValues(e, name) {
  return e.tags.filter((t) => t[0] === name && typeof t[1] === 'string').map((t) => t[1]);
}

export function hasAppTag(e) {
  return e.tags.some((t) => t[0] === APP_TAG[0] && t[1] === APP_TAG[1]);
}

/** NIP-40 expiration (unix seconds) or null. */
export function expirationOf(e) {
  const v = tagValue(e, 'expiration');
  return v && /^\d{1,12}$/.test(v) ? Number(v) : null;
}

export function isExpired(e, nowSec) {
  const x = expirationOf(e);
  return x != null && x <= nowSec;
}

export function expirationTag(nowSec, ttlSec) {
  return ['expiration', String(Math.floor(nowSec + ttlSec))];
}

/** Tags plus the app tag every Cars Map event carries. */
export function withAppTag(...tags) {
  return [...tags, [...APP_TAG]];
}

// ---------------------------------------------------------------- live location

/**
 * Payload I send to a friend: position, heading, speed, time and my car look.
 * @param {{lng:number,lat:number,heading?:number|null,speed?:number|null}} pose
 */
export function buildLocationPayload(pose, car, nowMs) {
  return {
    lng: round(pose.lng, 6),
    lat: round(pose.lat, 6),
    bearing: cleanBearing(pose.heading ?? pose.bearing) ?? 0,
    speed: round(clamp(pose.speed, 0, 120, 0), 1),
    at: nowMs,
    car: sanitizeCar(car),
  };
}

/** "Stopped sharing" marker so the friend's map drops my car straight away. */
export function buildLocationOff(nowMs) {
  return { off: true, at: nowMs };
}

/**
 * Validate a decrypted live-location payload. Stale (> 2 min) or malformed → null.
 * @returns {{lng,lat,bearing,speed,at,car}|{off:true,at:number}|null}
 */
export function parseLocationPayload(obj, nowMs) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return null;
  if (!finiteIn(obj.at, nowMs - LOCATION_STALE_MS, nowMs + 60000)) return null;
  const at = Math.min(obj.at, nowMs);
  if (obj.off === true) return { off: true, at };
  if (!finiteIn(obj.lng, -180, 180) || !finiteIn(obj.lat, -90, 90)) return null;
  return {
    lng: obj.lng,
    lat: obj.lat,
    bearing: cleanBearing(obj.bearing) ?? 0,
    speed: clamp(obj.speed, 0, 120, 0),
    at,
    car: sanitizeCar(obj.car),
  };
}

// ---------------------------------------------------------------- chat & hello

export function buildHello({ name, car }) {
  return { type: 'hello', name: cleanText(name, LIMITS.name), car: sanitizeCar(car) };
}

export function buildChat(text, nowMs) {
  return { type: 'msg', text: cleanText(text, LIMITS.chatText), at: nowMs };
}

/**
 * Validate a decrypted DM payload.
 * @returns {{type:'hello',name:string,car:object|null}|{type:'msg',text:string,at:number}|null}
 */
export function parseDmPayload(obj, nowMs) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return null;
  if (obj.type === 'hello') {
    return { type: 'hello', name: cleanText(obj.name, LIMITS.name), car: sanitizeCar(obj.car) };
  }
  if (obj.type === 'msg') {
    const text = cleanText(obj.text, LIMITS.chatText);
    if (!text) return null;
    const at = finiteIn(obj.at, 0, nowMs + 300000) ? Math.min(obj.at, nowMs) : nowMs;
    return { type: 'msg', text, at };
  }
  return null;
}

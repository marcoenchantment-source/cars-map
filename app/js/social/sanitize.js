// Validation helpers for untrusted data (relay events, decrypted payloads, stored JSON).
// Pure and DOM-free so they run under Node tests.
import { DEFAULT_CAR } from '../config.js';

// C0/C1 controls, zero-width and bidi-override characters (used to spoof text direction).
const CONTROL_RE = /[\u0000-\u001F\u007F-\u009F​-‏‪-‮⁠-⁩﻿]/g;
const HEX64_RE = /^[0-9a-f]{64}$/;
const COLOR_RE = /^#[0-9a-fA-F]{6}$/;

const CAR_RIMS = Object.freeze(['five', 'mesh', 'dish']);
const CAR_PATS = Object.freeze(['off', 'single', 'double', 'triple']);
const CAR_INTS = Object.freeze([1, 3, 5]);
const CAR_BODIES = Object.freeze(['coupe', 'ute', 'hatch']);

/**
 * Single-line display text: control characters removed, whitespace collapsed, trimmed and
 * capped at `max` characters (code points). Non-strings become ''.
 * @param {unknown} value
 * @param {number} max
 * @returns {string}
 */
export function cleanText(value, max = 200) {
  if (typeof value !== 'string') return '';
  const raw = value.length > max * 4 ? value.slice(0, max * 4) : value;
  const s = raw
    .replace(/[\t\n\r]+/g, ' ')
    .replace(CONTROL_RE, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
  const chars = [...s];
  return chars.length > max ? chars.slice(0, max).join('').trim() : s;
}

/** True when v is a finite number within [min, max]. */
export function finiteIn(v, min, max) {
  return typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;
}

/** Clamp a number into [min, max]; non-numbers give `fallback`. */
export function clamp(v, min, max, fallback = null) {
  if (typeof v !== 'number' || !Number.isFinite(v)) return fallback;
  return Math.min(max, Math.max(min, v));
}

export function round(v, dp) {
  const f = 10 ** dp;
  return Math.round(v * f) / f;
}

/** Lower-case 64-char hex (Nostr pubkeys and event ids). */
export function isHex64(s) {
  return typeof s === 'string' && HEX64_RE.test(s);
}

/** [lng, lat] with both values in range. */
export function isLngLat(p) {
  return Array.isArray(p) && p.length >= 2 && finiteIn(p[0], -180, 180) && finiteIn(p[1], -90, 90);
}

/** Compass bearing in [0, 360) or null. */
export function cleanBearing(v) {
  if (typeof v !== 'number' || !Number.isFinite(v)) return null;
  return ((Math.round(v) % 360) + 360) % 360;
}

/**
 * Parse a JSON object from a length-capped string. Arrays, primitives and bad JSON give null.
 * @returns {Record<string, unknown>|null}
 */
export function parseJsonObject(text, maxLen) {
  if (typeof text !== 'string' || text.length === 0 || text.length > maxLen) return null;
  try {
    const v = JSON.parse(text);
    return v && typeof v === 'object' && !Array.isArray(v) ? v : null;
  } catch {
    return null;
  }
}

/**
 * Validated CarLook copy. Unknown fields are dropped, bad values fall back to `base`.
 * @returns {{name:string,color:string,rim:string,pat:string,int:number,body:string}|null}
 */
export function sanitizeCar(car, base = DEFAULT_CAR) {
  if (!car || typeof car !== 'object' || Array.isArray(car)) return null;
  return {
    name: cleanText(car.name, 24) || base.name,
    color: typeof car.color === 'string' && COLOR_RE.test(car.color) ? car.color.toLowerCase() : base.color,
    rim: CAR_RIMS.includes(car.rim) ? car.rim : base.rim,
    pat: CAR_PATS.includes(car.pat) ? car.pat : base.pat,
    int: CAR_INTS.includes(car.int) ? car.int : base.int,
    body: CAR_BODIES.includes(car.body) ? car.body : base.body,
  };
}

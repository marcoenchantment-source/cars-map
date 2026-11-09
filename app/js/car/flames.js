// Pure car logic (no DOM): look validation, flame-pop timing, pop animation curve and the
// scale maths that keeps the car a constant size on screen. Friends' looks arrive from
// untrusted relays, so everything here validates instead of trusting.
import { DEFAULT_CAR } from '../config.js';

export const RIMS = Object.freeze(['five', 'mesh', 'dish']);
export const PATS = Object.freeze(['off', 'single', 'double', 'triple']);
export const INTS = Object.freeze([1, 3, 5]);
export const BODIES = Object.freeze(['coupe', 'ute', 'hatch']);
export const NAME_MAX = 20;
export const LABEL_MAX = 24;

/** Gap between pops inside one burst, and the length of one pop (as in the prototype). */
export const POP_SPACING_MS = 190;
export const POP_MS = 170;

export const PAINTS = Object.freeze([
  { name: 'Red', color: '#e53935' },
  { name: 'Blue', color: '#1e88e5' },
  { name: 'Yellow', color: '#fdd835' },
  { name: 'Green', color: '#2e9e5b' },
  { name: 'Purple', color: '#8e44ad' },
  { name: 'Black', color: '#1a1a1f' },
  { name: 'Flame orange', color: '#ff8a00' },
  { name: 'Silver', color: '#c0c4cc' },
  { name: 'Pearl white', color: '#f4f4f6' },
  { name: 'Teal', color: '#1fb5a8' },
  { name: 'Hot pink', color: '#ff4fa3' },
  { name: 'Midnight', color: '#23305e' },
]);

const HEX_RE = /^#[0-9a-f]{6}$/i;
// Control characters, zero-width and bidi overrides: never show these in a map label.
const UNSAFE_CHARS_RE = /[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩﻿]/g;

/** True for a 6-digit #hex colour. */
export function isHexColour(value) {
  return typeof value === 'string' && HEX_RE.test(value);
}

/** Display name for a paint colour ("Custom" when it is not a preset). */
export function paintName(color) {
  const c = String(color ?? '').toLowerCase();
  return PAINTS.find((p) => p.color === c)?.name ?? 'Custom';
}

/** Clean free text for a label: strip control/bidi chars, collapse spaces, cap the length. */
export function sanitiseName(value, max = NAME_MAX) {
  if (typeof value !== 'string') return '';
  const clean = value.replace(UNSAFE_CHARS_RE, '').replace(/\s+/g, ' ').trim();
  return Array.from(clean).slice(0, max).join('').trim();
}

function pick(value, allowed, fallback) {
  return allowed.includes(value) ? value : fallback;
}

/**
 * Always returns a complete, valid CarLook (new object). Bad or missing fields take defaults.
 * @param {unknown} look
 * @param {object} [defaults]
 */
export function normaliseLook(look, defaults = DEFAULT_CAR) {
  const src = look && typeof look === 'object' ? look : {};
  const base = defaults ?? DEFAULT_CAR;
  const name = sanitiseName(src.name, NAME_MAX);
  const int = Number(src.int);
  return {
    name: name || sanitiseName(base.name, NAME_MAX) || DEFAULT_CAR.name,
    color: isHexColour(src.color) ? src.color.toLowerCase() : base.color,
    rim: pick(src.rim, RIMS, base.rim),
    pat: pick(src.pat, PATS, base.pat),
    int: INTS.includes(int) ? int : base.int,
    body: pick(src.body, BODIES, base.body),
  };
}

/** True when two looks render the same. */
export function sameLook(a, b) {
  return !!a && !!b && a.name === b.name && a.color === b.color && a.rim === b.rim && a.pat === b.pat && a.int === b.int && a.body === b.body;
}

/** Pops per burst for a pattern. */
export function popCount(pat) {
  return { single: 1, double: 2, triple: 3 }[pat] ?? 0;
}

const realTimers = () => ({
  setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
  clearTimeout: (id) => globalThis.clearTimeout(id),
  setInterval: (fn, ms) => globalThis.setInterval(fn, ms),
  clearInterval: (id) => globalThis.clearInterval(id),
});

/**
 * Fires onPop(index) 1/2/3 times (190 ms apart) every `int` seconds.
 * @param {{pat:string,int:number}} opts
 * @param {(burstIndex:number)=>void} onPop
 * @param {{timers?: object, immediate?: boolean}} [options] injectable timers for tests
 */
export function createFlameTimer({ pat, int } = {}, onPop, { timers = realTimers(), immediate = true } = {}) {
  let cfg = { pat: pick(pat, PATS, 'off'), int: INTS.includes(Number(int)) ? Number(int) : 3 };
  let interval = null;
  let wanted = false; // start() called and not stopped since
  const pending = new Set();

  function fire(index) {
    try {
      onPop?.(index);
    } catch (err) {
      console.error('[car] flame pop failed', err);
    }
  }

  function burst(count = popCount(cfg.pat)) {
    const n = Math.max(0, Math.min(6, Math.floor(Number(count) || 0)));
    for (let i = 0; i < n; i += 1) {
      if (i === 0) {
        fire(0);
        continue;
      }
      const id = timers.setTimeout(() => {
        pending.delete(id);
        fire(i);
      }, i * POP_SPACING_MS);
      pending.add(id);
    }
  }

  function halt() {
    if (interval != null) timers.clearInterval(interval);
    interval = null;
    for (const id of pending) timers.clearTimeout(id);
    pending.clear();
  }

  function stop() {
    wanted = false;
    halt();
  }

  function start() {
    halt();
    wanted = true;
    if (cfg.pat === 'off') return;
    interval = timers.setInterval(() => burst(), cfg.int * 1000);
    if (immediate) burst();
  }

  /** Change the pattern/interval; restarts only when something changed and start() is in effect. */
  function update(next = {}) {
    const merged = {
      pat: pick(next.pat, PATS, cfg.pat),
      int: INTS.includes(Number(next.int)) ? Number(next.int) : cfg.int,
    };
    const changed = merged.pat !== cfg.pat || merged.int !== cfg.int;
    cfg = merged;
    if (changed && wanted) start();
  }

  return Object.freeze({
    start,
    stop,
    update,
    burst,
    running: () => interval != null,
    config: () => ({ ...cfg }),
  });
}

/**
 * One pop's look at `elapsed` ms, matching the prototype's CSS keyframes
 * (0%: scale .3, 55%: scale 1, 100%: scale 1.15 and faded). Reduced motion: fade only.
 * @returns {{scale:number, opacity:number}|null} null when the pop is over
 */
export function flameFrame(elapsed, duration = POP_MS, reduced = false) {
  if (!Number.isFinite(elapsed) || elapsed < 0 || elapsed >= duration) return null;
  const p = elapsed / duration;
  if (reduced) return { scale: 1, opacity: 1 - p };
  if (p < 0.55) return { scale: 0.3 + 0.7 * (p / 0.55), opacity: 1 };
  const q = (p - 0.55) / 0.45;
  return { scale: 1 + 0.15 * q, opacity: 1 - q };
}

// ---------------------------------------------------------------- screen-size maths

const EARTH_CIRCUMFERENCE_M = 40075016.686;
const TILE_SIZE = 512; // MapLibre world size at zoom 0

/** Ground metres per CSS pixel at a zoom and latitude (MapLibre, 512 px tiles). */
export function metresPerPixel(zoom, lat) {
  const z = Number.isFinite(zoom) ? zoom : 16;
  const phi = ((Number.isFinite(lat) ? Math.max(-85, Math.min(85, lat)) : 0) * Math.PI) / 180;
  return (EARTH_CIRCUMFERENCE_M * Math.cos(phi)) / (TILE_SIZE * 2 ** z);
}

/**
 * Real-world length (m) to draw the car so it reads about `px` long on screen.
 * Pitch foreshortens a car seen from behind, so it is stretched a little as the map tilts.
 */
export function carLengthMetres({ zoom, lat, pitch = 0, px = 70 }) {
  const tilt = (Math.max(0, Math.min(85, Number.isFinite(pitch) ? pitch : 0)) * Math.PI) / 180;
  const boost = 1 / (0.55 + 0.45 * Math.cos(tilt));
  return px * metresPerPixel(zoom, lat) * boost;
}

/** Side-view cars face right by default; flip them when heading west-ish. */
export function facesLeft(bearing) {
  if (!Number.isFinite(bearing)) return false;
  const b = ((bearing % 360) + 360) % 360;
  return b > 180 && b < 360;
}

/** Approximate ground distance in metres between two nearby poses (for wheel spin). */
export function smallDistance(a, b) {
  if (!a || !b) return 0;
  const lat = ((a.lat + b.lat) / 2) * (Math.PI / 180);
  const dx = (b.lng - a.lng) * 111320 * Math.cos(lat);
  const dy = (b.lat - a.lat) * 110540;
  const d = Math.hypot(dx, dy);
  return Number.isFinite(d) ? d : 0;
}

/** Valid [lng, lat] or null. */
export function validLngLat(value) {
  const arr = Array.isArray(value) ? value : value && typeof value === 'object' ? [value.lng, value.lat] : null;
  if (!arr) return null;
  const lng = Number(arr[0]);
  const lat = Number(arr[1]);
  if (!Number.isFinite(lng) || !Number.isFinite(lat) || Math.abs(lng) > 180 || Math.abs(lat) > 90) return null;
  return [lng, lat];
}

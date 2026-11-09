// Place helpers: validation of untrusted place data, the recent list, and display formatting.
// Pure functions, no DOM.
import { haversine } from '../core/geo.js';

export const MAX_RECENTS = 12;
const MAX_TEXT = 160;

/** Plain single-line text from anything (control characters stripped, length capped). */
export function cleanText(value) {
  if (value == null) return '';
  return String(value)
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_TEXT);
}

/** A frozen, valid Place built from untrusted input, or null. */
export function sanitizePlace(p) {
  if (!p || typeof p !== 'object') return null;
  const lng = Number(p.lng);
  const lat = Number(p.lat);
  if (!Number.isFinite(lng) || !Number.isFinite(lat) || Math.abs(lng) > 180 || Math.abs(lat) > 90) return null;
  const label = cleanText(p.label);
  const name = cleanText(p.name) || label || 'Dropped pin';
  const rawId = cleanText(p.id);
  const id = rawId && !rawId.endsWith(':') ? rawId : `pt:${lat.toFixed(5)},${lng.toFixed(5)}`;
  const kind = cleanText(p.kind);
  const source = cleanText(p.source);
  return Object.freeze({ id, name, label, lng, lat, ...(kind ? { kind } : {}), ...(source ? { source } : {}) });
}

/** Same place: same id, or same name within 40 m. */
export function samePlace(a, b) {
  if (!a || !b) return false;
  if (a.id && a.id === b.id) return true;
  return a.name === b.name && haversine([a.lng, a.lat], [b.lng, b.lat]) < 40;
}

/** New recent list with `place` first, no duplicates, capped. */
export function addRecent(list, place, max = MAX_RECENTS) {
  const clean = sanitizePlace(place);
  const prior = Array.isArray(list) ? list.map(sanitizePlace).filter(Boolean) : [];
  if (!clean) return prior.slice(0, max);
  return [clean, ...prior.filter((p) => !samePlace(p, clean))].slice(0, max);
}

/** Valid places only, from storage. */
export function loadPlaces(raw, max = MAX_RECENTS) {
  return Array.isArray(raw) ? raw.map(sanitizePlace).filter(Boolean).slice(0, max) : [];
}

/** Clock time in en-AU: "10:42 am". */
export function formatClock(date, { timeZone } = {}) {
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return '';
  const text = new Intl.DateTimeFormat('en-AU', { hour: 'numeric', minute: '2-digit', hour12: true, ...(timeZone ? { timeZone } : {}) }).format(d);
  return text.replace(/\s+/g, ' ').replace(/\b([AP])\.?M\.?\b/gi, (_, x) => `${x.toLowerCase()}m`).trim();
}

/**
 * Duration split into big numbers and small units for the route cards.
 * 1440 s → [{text:'24',kind:'num'},{text:'min',kind:'unit'}]
 */
export function durationParts(seconds) {
  const mins = Math.max(1, Math.round((Number(seconds) || 0) / 60));
  if (mins < 60) return [{ text: String(mins), kind: 'num' }, { text: 'min', kind: 'unit' }];
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  const parts = [{ text: String(h), kind: 'num' }, { text: 'h', kind: 'unit' }];
  if (m) parts.push({ text: String(m).padStart(2, '0'), kind: 'num' }, { text: 'min', kind: 'unit' });
  return parts;
}

/** Spoken-friendly minutes for chips: "+8 min traffic". Returns '' below a minute. */
export function trafficChip(delaySeconds) {
  const mins = Math.round((Number(delaySeconds) || 0) / 60);
  return mins >= 1 ? `+${mins} min traffic` : '';
}

const KIND_ICONS = Object.freeze({
  fuel: 'fuel', charging_station: 'spark', parking: 'car', cafe: 'star', restaurant: 'star', fast_food: 'star',
  toilets: 'pin', place: 'flag', street: 'route', home: 'home', work: 'work',
});

/** Icon name for a place kind. */
export function iconForKind(kind) {
  return KIND_ICONS[kind] ?? 'pin';
}

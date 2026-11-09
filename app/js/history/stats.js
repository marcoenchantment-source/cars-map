// Pure logbook numbers and labels: totals, "roads explored" and en-AU date/time text.
import { haversine } from '../core/geo.js';

const CELL_M = 100;
const SAMPLE_M = 50;
const M_PER_DEG_LAT = 111320;

function cellKey(lng, lat) {
  const dLat = CELL_M / M_PER_DEG_LAT;
  const dLng = dLat / Math.max(0.05, Math.cos((Math.round(lat) * Math.PI) / 180));
  return `${Math.floor(lat / dLat)}:${Math.floor(lng / dLng)}`;
}

/**
 * Approximate kilometres of distinct road covered by all trips: every line is sampled every
 * 50 m into 100 m grid cells, so driving the same road twice counts once.
 */
export function uniqueRoadKm(trips) {
  const cells = new Set();
  for (const trip of trips) {
    const line = trip.line ?? [];
    for (let i = 0; i < line.length; i++) {
      const a = line[i];
      cells.add(cellKey(a[0], a[1]));
      const b = line[i + 1];
      if (!b) break;
      const steps = Math.floor(haversine(a, b) / SAMPLE_M);
      for (let s = 1; s <= steps; s++) {
        const k = s / (steps + 1);
        cells.add(cellKey(a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k));
      }
    }
  }
  return (cells.size * CELL_M) / 1000;
}

/** {distance m, count, duration s, uniqueKm} */
export function tripTotals(trips) {
  let distance = 0;
  let duration = 0;
  for (const t of trips) {
    distance += t.distance;
    duration += t.duration;
  }
  return { distance, count: trips.length, duration, uniqueKm: uniqueRoadKm(trips) };
}

const DAY_FMT = new Intl.DateTimeFormat('en-AU', { weekday: 'short', day: 'numeric', month: 'short' });
const DAY_YEAR_FMT = new Intl.DateTimeFormat('en-AU', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
const TIME_FMT = new Intl.DateTimeFormat('en-AU', { hour: 'numeric', minute: '2-digit' });

/** "Today · 8:42 am", "Yesterday · 5:10 pm", "Fri 7 Nov · 8:42 am" (year added if not this year). */
export function tripWhen(startedAt, now = Date.now()) {
  const d = new Date(startedAt);
  const today = new Date(now);
  const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  const time = TIME_FMT.format(d).replace(/\s?([ap])\.?m\.?$/i, ' $1m').toLowerCase();
  let day;
  if (startedAt >= startOfToday) day = 'Today';
  else if (startedAt >= startOfToday - 86400000) day = 'Yesterday';
  else day = (d.getFullYear() === today.getFullYear() ? DAY_FMT : DAY_YEAR_FMT).format(d).replace(',', '');
  return `${day} · ${time}`;
}

/** Totals-style distance: {value, unit} e.g. {value: '1,284', unit: 'km'}, {value: '42.5', unit: 'km'}. */
export function bigDistance(m, units = 'metric') {
  const v = units === 'imperial' ? m / 1609.344 : m / 1000;
  const unit = units === 'imperial' ? 'mi' : 'km';
  const value = v < 100 ? v.toFixed(1) : Math.round(v).toLocaleString('en-AU');
  return { value, unit };
}

/** "Joondalup → Perth", "From Joondalup", or '' when no names are known yet. */
export function tripPlaces(trip) {
  if (trip.from && trip.to) return `${trip.from} → ${trip.to}`;
  if (trip.from) return `From ${trip.from}`;
  if (trip.to) return `To ${trip.to}`;
  return '';
}

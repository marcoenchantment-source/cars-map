// Pure display formatting for the nav HUD and trip report (en-AU).
import { formatDistance, formatDuration, speedForDisplay } from '../core/geo.js';

const CLOCK = new Intl.DateTimeFormat('en-AU', { hour: 'numeric', minute: '2-digit', hour12: true });
const DAY = new Intl.DateTimeFormat('en-AU', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });

const tidy = (s) => s.replace(/[  ]/g, ' ').trim();

/** "10:42 am" */
export function formatClock(ms) {
  if (!Number.isFinite(ms)) return '–';
  return tidy(CLOCK.format(new Date(ms)));
}

/** {time: "10:42", period: "am"} for styling the two parts separately. */
export function formatClockParts(ms) {
  if (!Number.isFinite(ms)) return { time: '–', period: '' };
  const parts = CLOCK.formatToParts(new Date(ms));
  const period = parts.find((p) => p.type === 'dayPeriod')?.value ?? '';
  const time = parts.filter((p) => p.type !== 'dayPeriod').map((p) => p.value).join('');
  return { time: tidy(time), period: tidy(period).toLowerCase() };
}

/** "Mon, 9 Nov 2026" */
export function formatDay(ms) {
  return Number.isFinite(ms) ? tidy(DAY.format(new Date(ms))) : '–';
}

export function speedUnit(units) {
  return units === 'imperial' ? 'mph' : 'km/h';
}

/** "52 km/h" */
export function formatSpeed(mps, units = 'metric') {
  return `${speedForDisplay(mps, units)} ${speedUnit(units)}`;
}

/** Remaining-time text for the ETA bar: "12 min", "1 h 05 min". */
export function formatRemaining(seconds) {
  return formatDuration(seconds);
}

export { formatDistance, formatDuration };

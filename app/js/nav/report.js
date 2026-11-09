// Pure plain-text trip report the owner can paste to Claude after a drive.
import { formatDistance, formatDuration, speedForDisplay } from '../core/geo.js';
import { formatClock, formatDay, speedUnit } from './format.js';

const MAX_NOTES = 1000;

function line(label, value) {
  return value ? `${label}: ${value}` : null;
}

function placeText(place) {
  if (!place) return 'Unknown destination';
  const name = String(place.name ?? '').trim() || 'Dropped pin';
  const label = String(place.label ?? '').trim();
  return label && label !== name ? `${name} (${label})` : name;
}

function routeText(route, units) {
  if (!route) return null;
  const via = route.summary ? `${route.summary}, ` : '';
  const planned = `${formatDistance(route.distance, units).text} / ${formatDuration(route.duration)}`;
  return `${via}${route.provider ?? 'unknown provider'}, planned ${planned}`;
}

function gpsText(trip) {
  if (trip.simulated) return 'Demo drive (simulated GPS)';
  const acc = Number.isFinite(trip.medianAccuracy) ? `, median accuracy ${Math.round(trip.medianAccuracy)} m` : '';
  return `Real GPS, ${trip.fixes ?? 0} fixes${acc}`;
}

/**
 * @param {{trip:object, destination?:object, route?:object, rating?:number, notes?:string,
 *          units?:string, appVersion?:string, userAgent?:string, reason?:string}} args
 * @returns {string}
 */
export function buildTripReport({ trip, destination, route, rating = 0, notes = '', units = 'metric', appVersion = '', userAgent = '', reason = 'arrived' }) {
  const unit = speedUnit(units);
  const stars = rating > 0 ? `${'★'.repeat(rating)}${'☆'.repeat(5 - rating)} (${rating}/5)` : 'not rated';
  const cleanNotes = String(notes ?? '').trim().slice(0, MAX_NOTES);
  const lines = [
    'Cars Map trip report',
    line('Date', `${formatDay(trip.startedAt)}, ${formatClock(trip.startedAt)} – ${formatClock(trip.endedAt)}`),
    line('To', placeText(destination)),
    line('Result', reason === 'arrived' ? 'Arrived' : 'Ended early'),
    line(
      'Drive',
      `${formatDistance(trip.distance, units).text} in ${formatDuration(trip.duration)}, average ${speedForDisplay(trip.avgSpeed, units)} ${unit}, top ${speedForDisplay(trip.maxSpeed, units)} ${unit}`,
    ),
    line('Route', routeText(route, units)),
    line('Re-routes', `${trip.reroutes ?? 0} (off-route ${trip.offRoutes ?? 0} times)`),
    line('GPS', gpsText(trip)),
    line('Rating', stars),
    line('Notes', cleanNotes || '(none)'),
    line('App', [appVersion && `Cars Map ${appVersion}`, userAgent].filter(Boolean).join(' · ')),
  ];
  return lines.filter(Boolean).join('\n');
}

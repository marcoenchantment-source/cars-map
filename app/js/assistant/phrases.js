// Short spoken replies (en-AU). Pure: no DOM, no clock unless passed in.

/** "12 minutes", "1 hour 5 minutes", "under a minute". */
export function spokenDuration(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return 'a little while';
  const mins = Math.round(seconds / 60);
  if (mins < 1) return 'under a minute';
  if (mins < 60) return `${mins} ${mins === 1 ? 'minute' : 'minutes'}`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  const hours = `${h} ${h === 1 ? 'hour' : 'hours'}`;
  return m ? `${hours} ${m} ${m === 1 ? 'minute' : 'minutes'}` : hours;
}

/** Wall-clock time like "10:42 am" (en-AU). */
export function formatClock(epochMs, { timeZone } = {}) {
  if (!Number.isFinite(epochMs)) return '';
  const opts = { hour: 'numeric', minute: '2-digit', hour12: true, ...(timeZone ? { timeZone } : {}) };
  return new Intl.DateTimeFormat('en-AU', opts).format(new Date(epochMs)).replace(/[  ]/g, ' ').toLowerCase();
}

const ROAD_WORDS = [
  [/\bFwy\b/g, 'Freeway'], [/\bHwy\b/g, 'Highway'], [/\bRd\b/g, 'Road'], [/\bSt\b/g, 'Street'], [/\bAve?\b/g, 'Avenue'],
  [/\bDr\b/g, 'Drive'], [/\bPde\b/g, 'Parade'], [/\bTce\b/g, 'Terrace'], [/\bCres\b/g, 'Crescent'], [/\bBlvd\b/g, 'Boulevard'],
  [/\bPl\b/g, 'Place'], [/\bCt\b/g, 'Court'], [/\bHts\b/g, 'Heights'],
];

/** Expand road abbreviations so the voice reads them naturally. */
export function expandRoads(text) {
  return ROAD_WORDS.reduce((s, [re, word]) => s.replace(re, word), String(text ?? ''));
}

/** "Hay Street, Perth" from a Place: name plus the first part of its address line. */
export function shortPlace(place) {
  if (!place || typeof place.name !== 'string') return 'there';
  const area = typeof place.label === 'string' ? place.label.split(',').map((s) => s.trim()).find((s) => s && s !== place.name) : '';
  return area ? `${place.name}, ${area}` : place.name;
}

/** ETA answer from nav status. ask: 'time' | 'distance'. */
export function etaReply(status, { ask = 'time', distanceText = '', timeZone } = {}) {
  const clock = formatClock(status.eta, { timeZone });
  const left = spokenDuration(status.durationRemaining);
  if (ask === 'distance' && distanceText) return `${distanceText} to go, arriving at ${clock}.`;
  return clock ? `You'll arrive at ${clock}, ${left} to go.` : `About ${left} to go.`;
}

/** Route summary: "Kings Park, 12 minutes via Mitchell Freeway, with 3 minutes of traffic." */
export function routeReply(name, route, { ask } = {}) {
  if (!route || !Number.isFinite(route.duration)) return `Showing the route to ${name}.`;
  const via = typeof route.summary === 'string' && route.summary.trim() ? ` ${expandRoads(route.summary.trim())}` : '';
  const delay = Number.isFinite(route.trafficDelay) && route.trafficDelay >= 120 ? `, with ${spokenDuration(route.trafficDelay)} of traffic` : '';
  const lead = ask === 'eta' ? `${name} is ${spokenDuration(route.duration)} away${via}` : `${name}, ${spokenDuration(route.duration)}${via}`;
  return `${lead}${delay}. Say "go" when you're ready.`;
}

/** "Nearest servo is Caltex Leederville, 1.2 km. Showing the route." */
export function nearbyReply({ label, generic, place, distanceText, routed }) {
  const where = distanceText ? `, ${distanceText}` : '';
  const tail = routed ? ' Showing the route.' : '';
  if (generic) return `${place.name}${distanceText ? ` is ${distanceText} away` : ''}.${tail}`;
  return `Nearest ${label} is ${place.name}${where}.${tail}`;
}

/** Thank-you line for a hazard report. */
export function hazardReply(label) {
  return `${label} reported. Thanks for looking out for everyone.`;
}

/**
 * Make free text fit for the voice: no markdown or links, at most two sentences, capped length.
 */
export function shortenForSpeech(text, maxChars = 240) {
  const plain = String(text ?? '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/https?:\/\/\S+/g, '')
    .replace(/[*_#`>|]+/g, '')
    .replace(/^\s*[-•]\s+/gm, '')
    .replace(/\s+/g, ' ')
    .trim();
  const sentences = plain.match(/[^.!?]+[.!?]+(?=\s|$)|[^.!?]+$/g) ?? [];
  let out = sentences.slice(0, 2).join(' ').replace(/\s+/g, ' ').trim();
  if (out.length > maxChars) out = `${out.slice(0, maxChars - 1).replace(/\s+\S*$/, '')}…`;
  return out;
}

export const HELP_TEXT = 'Try "take me to Kings Park", "nearest servo", "report police", "how long left", "message Sam on my way", "call Mum" or "play music".';
export const NO_KEY_TEXT = 'I can navigate, find places, report hazards, message your crew, call or text, and play music.';

// Crowd hazard reports: event templates, parsing, vote aggregation, expiry and the
// "hazard ahead on my route" test. Pure and DOM-free.
import { geohashEncode, haversine, nearestOnLine, segmentIndexAt, angleDiff, bearing } from '../core/geo.js';
import { HAZARD_TYPES } from '../config.js';
import { KIND, withAppTag, expirationTag, tagValue, expirationOf, isTimely } from './events.js';
import { finiteIn, isHex64, parseJsonObject, round, cleanBearing } from './sanitize.js';

/** Relays keep a report for this many ttls, so confirmations can keep it alive. */
export const LIFETIME_FACTOR = 3;
export const VOTES = Object.freeze(['confirm', 'deny']);
const VOTE_GRACE_MS = 60000;
const OPPOSITE_DIRECTION_DEG = 120;

const TYPE_BY_ID = new Map(HAZARD_TYPES.map((t) => [t.id, t]));
const SYNONYMS = new Map(Object.entries({
  radar: 'camera', 'speed camera': 'camera', 'red light camera': 'camera', 'mobile camera': 'camera', cameras: 'camera',
  cop: 'police', cops: 'police', 'booze bus': 'police', rbt: 'police', 'speed trap': 'police', 'police car': 'police',
  accident: 'crash', collision: 'crash', prang: 'crash', 'car crash': 'crash',
  debris: 'hazard', pothole: 'hazard', animal: 'hazard', kangaroo: 'hazard', roo: 'hazard', 'broken down car': 'hazard',
  'object on road': 'hazard', 'hazard on road': 'hazard', danger: 'hazard',
  works: 'roadworks', 'road works': 'roadworks', construction: 'roadworks',
  rain: 'weather', flood: 'weather', flooding: 'weather', fog: 'weather', storm: 'weather', hail: 'weather', smoke: 'weather',
  closed: 'closure', 'road closed': 'closure', 'road closure': 'closure',
  jam: 'traffic', congestion: 'traffic', 'traffic jam': 'traffic', 'heavy traffic': 'traffic',
}));

export function hazardType(id) {
  return TYPE_BY_ID.get(id) ?? null;
}

/** Map free text ("speed camera", "cops", "Police") to a HAZARD_TYPES id, or null. */
export function resolveHazardType(input) {
  const q = String(input ?? '').toLowerCase().replace(/[^a-z ]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!q) return null;
  if (TYPE_BY_ID.has(q)) return q;
  const byLabel = HAZARD_TYPES.find((t) => t.label.toLowerCase() === q);
  if (byLabel) return byLabel.id;
  if (SYNONYMS.has(q)) return SYNONYMS.get(q);
  for (const word of q.split(' ')) {
    if (TYPE_BY_ID.has(word)) return word;
    if (SYNONYMS.has(word)) return SYNONYMS.get(word);
  }
  return null;
}

/** Event template for a new report (sign with nostr.sign). */
export function hazardTemplate({ type, lngLat, heading = null, nowSec }) {
  const t = TYPE_BY_ID.get(type);
  if (!t) throw new Error('Unknown hazard type');
  const [lng, lat] = lngLat;
  const g6 = geohashEncode(lat, lng, 6);
  return {
    kind: KIND.HAZARD,
    created_at: nowSec,
    tags: withAppTag(['g', g6.slice(0, 5)], ['g', g6], ['hz', type], expirationTag(nowSec, t.ttlMin * 60 * LIFETIME_FACTOR)),
    content: JSON.stringify({ type, lng: round(lng, 6), lat: round(lat, 6), heading: cleanBearing(heading) }),
  };
}

/** Event template for a "Still there" / "Gone" vote on a hazard. */
export function voteTemplate({ hazard, vote, nowSec }) {
  if (!VOTES.includes(vote)) throw new Error('Unknown vote');
  const t = TYPE_BY_ID.get(hazard.type);
  const g6 = geohashEncode(hazard.lat, hazard.lng, 6);
  return {
    kind: KIND.VOTE,
    created_at: nowSec,
    tags: withAppTag(['e', hazard.id], ['g', g6.slice(0, 5)], ['g', g6], ['v', vote],
      expirationTag(nowSec, (t?.ttlMin ?? 60) * 60 * LIFETIME_FACTOR)),
    content: vote,
  };
}

/** Parsed report or null. */
export function parseHazardEvent(e, nowSec) {
  if (e?.kind !== KIND.HAZARD || !isTimely(e, nowSec)) return null;
  const type = tagValue(e, 'hz');
  const t = TYPE_BY_ID.get(type);
  if (!t) return null;
  const body = parseJsonObject(e.content, 1000);
  if (!body || !finiteIn(body.lng, -180, 180) || !finiteIn(body.lat, -90, 90)) return null;
  const exp = expirationOf(e) ?? Infinity;
  const hardCap = Math.min(exp, e.created_at + t.ttlMin * 60 * LIFETIME_FACTOR);
  if (hardCap <= nowSec) return null;
  return {
    id: e.id, type, lng: body.lng, lat: body.lat, heading: cleanBearing(body.heading),
    reportedAt: e.created_at * 1000, hardExpiresAt: hardCap * 1000, by: e.pubkey,
  };
}

/** Parsed vote or null. */
export function parseVoteEvent(e, nowSec) {
  if (e?.kind !== KIND.VOTE || !isTimely(e, nowSec)) return null;
  const target = tagValue(e, 'e');
  const vote = tagValue(e, 'v');
  if (!isHex64(target) || !VOTES.includes(vote)) return null;
  const exp = expirationOf(e);
  if (exp != null && exp <= nowSec) return null;
  return { id: e.id, target, vote, at: e.created_at * 1000, by: e.pubkey };
}

/** Latest vote per (hazard, pubkey). */
function latestVotes(votes) {
  const byTarget = new Map();
  for (const v of votes) {
    let m = byTarget.get(v.target);
    if (!m) byTarget.set(v.target, (m = new Map()));
    const prev = m.get(v.by);
    if (!prev || v.at > prev.at) m.set(v.by, v);
  }
  return byTarget;
}

function tally(report, voteMap) {
  let confirms = 0;
  let denies = 0;
  let lastConfirm = report.reportedAt;
  let retracted = false;
  for (const v of voteMap?.values() ?? []) {
    if (v.at < report.reportedAt - VOTE_GRACE_MS) continue;
    if (v.by === report.by) {
      if (v.vote === 'deny') retracted = true;
      else lastConfirm = Math.max(lastConfirm, v.at);
    } else if (v.vote === 'confirm') {
      confirms += 1;
      lastConfirm = Math.max(lastConfirm, v.at);
    } else {
      denies += 1;
    }
  }
  return { confirms, denies, lastConfirm, retracted };
}

/**
 * Active hazards from reports + votes. Votes count once per distinct pubkey (latest wins).
 * Hidden when: expired, the reporter said Gone, I said Gone, or denies > confirms + 1.
 * A confirmation restarts the type's ttl (capped by the report's lifetime on relays).
 * @returns {Array<{id,type,lng,lat,heading,reportedAt,expiresAt,confirms,denies,by,mine,myVote,lastConfirmAt}>}
 */
export function aggregateHazards({ reports, votes = [], nowMs, me = null, maxPerAuthor = 10 }) {
  const byTarget = latestVotes(votes);
  const sorted = [...reports].sort((a, b) => b.reportedAt - a.reportedAt);
  const seen = new Set();
  const perAuthor = new Map();
  const out = [];
  for (const r of sorted) {
    const t = TYPE_BY_ID.get(r.type);
    if (!t || seen.has(r.id)) continue;
    seen.add(r.id);
    const voteMap = byTarget.get(r.id);
    const { confirms, denies, lastConfirm, retracted } = tally(r, voteMap);
    const myVote = me ? voteMap?.get(me)?.vote ?? null : null;
    if (retracted || denies > confirms + 1 || (myVote === 'deny' && r.by !== me)) continue;
    const expiresAt = Math.min(r.hardExpiresAt, lastConfirm + t.ttlMin * 60000);
    if (expiresAt <= nowMs) continue;
    const n = perAuthor.get(r.by) ?? 0;
    if (n >= maxPerAuthor) continue;
    perAuthor.set(r.by, n + 1);
    out.push({
      id: r.id, type: r.type, lng: r.lng, lat: r.lat, heading: r.heading ?? null,
      reportedAt: r.reportedAt, expiresAt, confirms, denies, by: r.by,
      mine: r.by === me, myVote, lastConfirmAt: lastConfirm,
    });
  }
  return out;
}

/**
 * Hazards within `corridorM` of the route and between 0 and `lookaheadM` metres ahead of `along`.
 * Reports whose reporter was heading the opposite way are skipped (other carriageway).
 * @param {{geometry:number[][], cum:number[]}} route
 * @returns {{hazard:object, distance:number}[]} nearest first
 */
export function hazardsAhead(hazards, route, along, { corridorM = 35, lookaheadM = 1500 } = {}) {
  const coords = route?.geometry;
  const cum = route?.cum;
  if (!coords || coords.length < 2 || !cum || cum.length !== coords.length || !Number.isFinite(along)) return [];
  const from = segmentIndexAt(cum, along);
  const to = Math.min(coords.length - 1, segmentIndexAt(cum, along + lookaheadM) + 1);
  const out = [];
  for (const h of hazards) {
    const near = nearestOnLine(coords, cum, [h.lng, h.lat], { from, to });
    if (!near || near.dist > corridorM) continue;
    const ahead = near.along - along;
    if (ahead <= 0 || ahead > lookaheadM) continue;
    if (h.heading != null) {
      const routeBearing = bearing(coords[near.index], coords[near.index + 1] ?? coords[near.index]);
      if (Math.abs(angleDiff(routeBearing, h.heading)) > OPPOSITE_DIRECTION_DEG) continue;
    }
    out.push({ hazard: h, distance: ahead });
  }
  return out.sort((a, b) => a.distance - b.distance);
}

/** Nearest `max` hazards to `center` within `maxDistanceM` (map marker budget). */
export function selectForMap(hazards, center, { max = 80, maxDistanceM = 60000 } = {}) {
  if (!center) return hazards.slice(0, max);
  return hazards
    .map((h) => ({ h, d: haversine(center, [h.lng, h.lat]) }))
    .filter((x) => x.d <= maxDistanceM)
    .sort((a, b) => a.d - b.d)
    .slice(0, max)
    .map((x) => x.h);
}

/** "12 min ago", "just now", "2 h ago". */
export function agoText(ms, nowMs) {
  const mins = Math.max(0, Math.round((nowMs - ms) / 60000));
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const h = Math.round(mins / 60);
  return `${h} h ago`;
}

// Pure voice-announcement planning for the upcoming manoeuvre.
// Fast roads (> 80 km/h): ~2 km, ~800 m, "now" (~7 s out). Town: ~500 m (only after a long
// stretch), ~150 m, "now" (~35 m / 4 s out). Each tier fires at most once per step, always in
// order far → mid → now; a closer tier firing retires the farther ones.
import { spokenDistance } from '../core/geo.js';

export const FAST_MPS = 80 / 3.6;
export const THEN_GAP_M = 120;
const URBAN_FAR_MIN_STRETCH_M = 800;
const TIER_ORDER = ['far', 'mid', 'now'];

/** Distance tiers for the current speed. `min` keeps a tier from firing just before the next one. */
export function tiersFor(speed, stretch, step) {
  const v = Number.isFinite(speed) ? Math.max(0, speed) : 0;
  const arrive = step?.type === 'arrive';
  if (v > FAST_MPS) {
    const nowAt = Math.max(80, v * 7);
    return [
      { name: 'far', at: 2000, min: 1100, enabled: true },
      { name: 'mid', at: 800, min: nowAt + 100, enabled: true },
      { name: 'now', at: nowAt, min: -Infinity, enabled: !arrive },
    ];
  }
  const nowAt = Math.max(35, v * 4);
  return [
    { name: 'far', at: 500, min: 210, enabled: stretch >= URBAN_FAR_MIN_STRETCH_M },
    { name: 'mid', at: 150, min: nowAt + 40, enabled: true },
    { name: 'now', at: nowAt, min: -Infinity, enabled: !arrive },
  ];
}

const LOWER_FIRST = new Set([
  'turn', 'continue', 'keep', 'take', 'merge', 'make', 'head', 'at', 'exit', 'go', 'bear', 'enter',
  'drive', 'stay', 'use', 'follow', 'join', 'leave', 'cross', 'proceed', 'the', 'your', 'you', 'arrive', 'slight', 'sharp',
]);

/** "Turn left onto X" → "turn left onto X" (only for leading verbs, never road names). */
export function lowerFirst(text) {
  const word = text.split(/[\s,]/, 1)[0].toLowerCase();
  return LOWER_FIRST.has(word) ? text.charAt(0).toLowerCase() + text.slice(1) : text;
}

function clean(text) {
  return String(text ?? '').replace(/\s+/g, ' ').trim().replace(/[.!]+$/, '');
}

export function spokenText(step) {
  return clean(step?.spoken || step?.instruction || '');
}

function arrivePhrase(step) {
  const m = step?.modifier ?? '';
  if (m.includes('left')) return 'your destination is on the left';
  if (m.includes('right')) return 'your destination is on the right';
  return "you'll reach your destination";
}

function phrase(step) {
  return step.type === 'arrive' ? arrivePhrase(step) : lowerFirst(spokenText(step));
}

function capitalise(text) {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function thenClause(steps, stepIndex) {
  const step = steps[stepIndex];
  const next = steps[stepIndex + 1];
  if (!next || next.type === 'depart' || next.along - step.along >= THEN_GAP_M) return '';
  return `, then ${phrase(next)}`;
}

/** Text for a tier of the step at stepIndex. */
export function announcementText(steps, stepIndex, tier, distance, units = 'metric') {
  const step = steps[stepIndex];
  if (tier === 'now') return `${capitalise(phrase(step))}${thenClause(steps, stepIndex)}.`;
  const then = tier === 'mid' ? thenClause(steps, stepIndex) : '';
  return `In ${spokenDistance(distance, units)}, ${phrase(step)}${then}.`;
}

/**
 * Decide whether to speak now.
 * @param {{steps:object[], stepIndex:number, distance:number, speed:number, units?:string, fired:string[]}} args
 * @returns {{tier:string, text:string, priority:'high'|'normal', marks:string[]}|null}
 */
export function planAnnouncement({ steps, stepIndex, distance, speed, units = 'metric', fired = [] }) {
  const step = steps?.[stepIndex];
  if (!step || step.type === 'depart' || !Number.isFinite(distance)) return null;
  const prev = steps[stepIndex - 1];
  const stretch = prev ? step.along - prev.along : step.along;
  const tiers = tiersFor(speed, stretch, step);
  const firedRank = Math.max(-1, ...fired.map((n) => TIER_ORDER.indexOf(n)));
  for (let r = tiers.length - 1; r > firedRank; r--) {
    const tier = tiers[r];
    if (!tier.enabled || distance > tier.at || distance <= tier.min) continue;
    return {
      tier: tier.name,
      text: announcementText(steps, stepIndex, tier.name, distance, units),
      priority: tier.name === 'now' ? 'high' : 'normal',
      marks: TIER_ORDER.slice(0, r + 1),
    };
  }
  return null;
}

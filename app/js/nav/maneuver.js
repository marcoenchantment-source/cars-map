// Pure manoeuvre helpers: classify a Step into an arrow kind and build fallback wording.
// No DOM: safe to unit test under Node.

const RELATIVE_ANGLE = Object.freeze({
  straight: 0,
  'slight right': 45,
  right: 90,
  'sharp right': 135,
  uturn: 180,
  'sharp left': -135,
  left: -90,
  'slight left': -45,
});

/** Relative exit angle (deg, + = right) for a modifier; straight when unknown. */
export function relativeAngle(modifier) {
  return RELATIVE_ANGLE[modifier] ?? 0;
}

function sideOf(modifier) {
  if (typeof modifier !== 'string') return null;
  if (modifier.includes('left')) return 'left';
  if (modifier.includes('right')) return 'right';
  return null;
}

function degreeOf(modifier) {
  if (typeof modifier !== 'string') return 'normal';
  if (modifier.startsWith('slight')) return 'slight';
  if (modifier.startsWith('sharp')) return 'sharp';
  return 'normal';
}

/**
 * What arrow to draw for a step.
 * @returns {{kind:'straight'|'turn'|'uturn'|'roundabout'|'merge'|'fork'|'ramp'|'arrive'|'depart',
 *            side:'left'|'right'|null, degree:'slight'|'normal'|'sharp', exit:number|null, angle:number, ccw:boolean}}
 */
export function maneuverKind(step) {
  const type = step?.type ?? 'continue';
  const modifier = step?.modifier ?? null;
  const side = sideOf(modifier);
  const degree = degreeOf(modifier);
  const exit = Number.isInteger(step?.exit) && step.exit > 0 ? step.exit : null;
  const base = { side, degree, exit: null, angle: relativeAngle(modifier), ccw: step?.drivingSide === 'right' };
  if (type === 'arrive') return { ...base, kind: 'arrive' };
  if (type === 'depart') return { ...base, kind: 'depart', side: null };
  if (type === 'roundabout' || type === 'rotary') return { ...base, kind: 'roundabout', exit };
  if (type === 'uturn' || modifier === 'uturn') return { ...base, kind: 'uturn', side: base.ccw ? 'left' : 'right' };
  if (type === 'merge') return { ...base, kind: 'merge', side: side ?? 'right' };
  if (type === 'fork') return { ...base, kind: 'fork', side: side ?? 'right' };
  if (type === 'on-ramp' || type === 'off-ramp') return { ...base, kind: 'ramp', side: side ?? 'left' };
  if (!side || modifier === 'straight') return { ...base, kind: 'straight', side: null, degree: 'normal' };
  return { ...base, kind: 'turn' };
}

export function ordinal(n) {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`;
}

/** Plain-English instruction for a step that came without one. */
export function describeManeuver(step) {
  const road = typeof step?.road === 'string' && step.road ? step.road : '';
  const onto = road ? ` onto ${road}` : '';
  const m = maneuverKind(step);
  switch (m.kind) {
    case 'arrive':
      return m.side ? `Your destination is on the ${m.side}` : 'Arrive at your destination';
    case 'depart':
      return road ? `Head off on ${road}` : 'Head off';
    case 'roundabout':
      return m.exit ? `At the roundabout, take the ${ordinal(m.exit)} exit${onto}` : `Go through the roundabout${onto}`;
    case 'uturn':
      return 'Make a U-turn';
    case 'merge':
      return `Merge ${m.side}${onto}`;
    case 'fork':
      return `Keep ${m.side}${onto}`;
    case 'ramp':
      return `Take the ramp on the ${m.side}${onto}`;
    case 'turn':
      return `Turn ${step.modifier}${onto}`;
    default:
      return road ? `Continue on ${road}` : 'Continue';
  }
}

/** Short label for the banner when a step has no road name. */
export function shortLabel(step) {
  const m = maneuverKind(step);
  switch (m.kind) {
    case 'arrive':
      return 'Destination';
    case 'roundabout':
      return m.exit ? `Roundabout, exit ${m.exit}` : 'Roundabout';
    case 'uturn':
      return 'U-turn';
    case 'merge':
      return `Merge ${m.side}`;
    case 'fork':
      return `Keep ${m.side}`;
    case 'ramp':
      return `Ramp on the ${m.side}`;
    case 'turn':
      return `${m.degree === 'normal' ? 'Turn' : m.degree === 'slight' ? 'Bear' : 'Sharp'} ${m.side}`;
    default:
      return 'Continue';
  }
}

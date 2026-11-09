// Turn-by-turn sentences in plain en-AU, plus a "spoken" twin with Australian road
// abbreviations expanded for text-to-speech. Pure functions, no DOM.
// A draft step: { type, modifier, road, exit?, towards?, rotaryName?, heading?, mode? }

const ABBREVIATIONS = Object.freeze({
  st: 'Street', rd: 'Road', hwy: 'Highway', fwy: 'Freeway', ave: 'Avenue', av: 'Avenue', dr: 'Drive',
  pde: 'Parade', tce: 'Terrace', cres: 'Crescent', cr: 'Crescent', pl: 'Place', ct: 'Court',
  bvd: 'Boulevard', blvd: 'Boulevard', cct: 'Circuit', gr: 'Grove', hts: 'Heights', ln: 'Lane',
  esp: 'Esplanade', cl: 'Close', pkwy: 'Parkway', sq: 'Square', gdns: 'Gardens', mt: 'Mount',
  nth: 'North', sth: 'South', rdge: 'Ridge', wy: 'Way', mwy: 'Motorway',
});
/** Abbreviations that mean something else as the first word of a name. */
const FIRST_WORD = Object.freeze({ st: 'Saint', mt: 'Mount', pt: 'Point' });

const COMPASS = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'];

/** "north-east" for a bearing in degrees, or '' when unknown. */
export function compassDirection(deg) {
  if (!Number.isFinite(deg)) return '';
  const i = Math.round((((deg % 360) + 360) % 360) / 45) % 8;
  return COMPASS[i];
}

/** 1st, 2nd, 3rd, 4th, 11th, 12th, 13th, 21st... */
export function ordinal(n) {
  const v = Math.trunc(n);
  const mod100 = v % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${v}th`;
  return `${v}${{ 1: 'st', 2: 'nd', 3: 'rd' }[v % 10] ?? 'th'}`;
}

function expandToken(token, isFirst, hasNext) {
  const m = /^([A-Za-z]+)(\.?)([,;)]*)$/.exec(token);
  if (!m || !/^[A-Z]/.test(m[1])) return token;
  const key = m[1].toLowerCase();
  if (isFirst && hasNext && FIRST_WORD[key]) return FIRST_WORD[key] + m[3];
  const full = ABBREVIATIONS[key];
  return full ? full + m[3] : token;
}

/** Expand abbreviations in a single road or place name: "St Georges Tce" → "Saint Georges Terrace". */
export function expandName(name) {
  if (!name) return '';
  return String(name)
    .split(/(\s*[/;]\s*)/)
    .map((part) => {
      if (/^\s*[/;]\s*$/.test(part)) return part;
      const tokens = part.split(/\s+/).filter(Boolean);
      return tokens.map((t, i) => expandToken(t, i === 0, i < tokens.length - 1)).join(' ');
    })
    .join('');
}

const isCapitalised = (t) => /^[A-Z0-9]/.test(t ?? '');

/**
 * Expand abbreviations inside a whole sentence (for text from other sources).
 * "St" starts a name (→ Saint) when the previous word is not part of a name.
 */
export function speakable(sentence) {
  if (!sentence) return '';
  const tokens = String(sentence).split(/(\s+)/);
  const words = tokens.filter((t) => !/^\s+$/.test(t) && t !== '');
  let wi = -1;
  return tokens
    .map((t) => {
      if (/^\s+$/.test(t) || t === '') return t;
      wi += 1;
      const prev = words[wi - 1];
      const next = words[wi + 1];
      const startsName = !prev || !isCapitalised(prev) || /[.,;:]$/.test(prev);
      return expandToken(t, startsName && isCapitalised(next), !!next);
    })
    .join('');
}

const sideOf = (mod) => (mod?.includes('left') ? 'left' : mod?.includes('right') ? 'right' : '');

function turnPhrase(mod) {
  switch (mod) {
    case 'sharp left':
    case 'sharp right':
      return `Turn sharp ${sideOf(mod)}`;
    case 'slight left':
    case 'slight right':
      return `Turn slightly ${sideOf(mod)}`;
    case 'left':
    case 'right':
      return `Turn ${mod}`;
    case 'straight':
      return 'Go straight';
    default:
      return 'Turn';
  }
}

/** " onto X" / " towards Y" / '' — prefers the road name. */
function ontoOrTowards(road, towards) {
  if (road) return ` onto ${road}`;
  if (towards) return ` towards ${towards}`;
  return '';
}

/** Ramps and forks read better with the signposted destination first. */
function towardsOrOnto(road, towards) {
  if (towards) return ` towards ${towards}`;
  if (road) return ` onto ${road}`;
  return '';
}

function uturn(road) {
  return road ? `Make a U-turn onto ${road}` : 'Make a U-turn';
}

function roundabout(s, road, towards, name) {
  const lead = name ? `Enter ${name} and` : 'At the roundabout,';
  if (Number.isFinite(s.exit) && s.exit > 0) return `${lead} take the ${ordinal(s.exit)} exit${ontoOrTowards(road, towards)}`;
  if (s.modifier === 'uturn') return `${lead} turn around${ontoOrTowards(road, towards)}`;
  if (sideOf(s.modifier)) return `${lead} turn ${sideOf(s.modifier)}${ontoOrTowards(road, towards)}`;
  if (s.modifier === 'straight') return `${lead} go straight${ontoOrTowards(road, towards)}`;
  return name ? `Enter ${name}` : 'Enter the roundabout';
}

function arrive(s, n, destinationName) {
  const name = n(destinationName) || n(s.road);
  const base = name ? `You have arrived at ${name}` : 'You have arrived';
  const side = sideOf(s.modifier);
  return side ? `${base}, on your ${side}` : base;
}

/**
 * Sentence for one step. `n` maps names (identity for display, expandName for speech).
 * @returns {string}
 */
function sentence(s, n, destinationName) {
  const road = n(s.road);
  const towards = n(s.towards);
  const mod = s.modifier ?? null;
  const side = sideOf(mod);
  switch (s.type) {
    case 'depart': {
      const dir = compassDirection(s.heading);
      if (dir) return road ? `Head ${dir} on ${road}` : `Head ${dir}`;
      return road ? `Start on ${road}` : 'Start driving';
    }
    case 'turn':
      if (mod === 'uturn') return uturn(road);
      return `${turnPhrase(mod)}${ontoOrTowards(road, towards)}`;
    case 'new-name':
      if (mod === 'uturn') return uturn(road);
      if (side && !mod.startsWith('slight')) return `${turnPhrase(mod)}${ontoOrTowards(road, towards)}`;
      return road ? `Continue onto ${road}` : 'Continue';
    case 'continue':
    case 'notification':
      if (s.mode === 'ferry') return road ? `Board the ferry (${road})` : 'Board the ferry';
      if (mod === 'uturn') return uturn(road);
      if (side && mod.startsWith('slight')) return `Keep ${side}${ontoOrTowards(road, towards)}`;
      if (side) return `${turnPhrase(mod)}${ontoOrTowards(road, towards)}`;
      return road ? `Continue onto ${road}` : 'Continue straight';
    case 'merge':
      if (road) return `Merge onto ${road}`;
      if (towards) return `Merge towards ${towards}`;
      return side ? `Merge ${side}` : 'Merge';
    case 'on-ramp':
      return `Take the ramp${side ? ` on the ${side}` : ''}${towardsOrOnto(road, towards)}`;
    case 'off-ramp': {
      const exit = s.exit ? `Take exit ${s.exit}` : 'Take the exit';
      return `${exit}${side && !s.exit ? ` on the ${side}` : ''}${towardsOrOnto(road, towards)}`;
    }
    case 'fork':
      if (side) return `Keep ${side}${towardsOrOnto(road, towards) || ' at the fork'}`;
      return `Keep straight${towardsOrOnto(road, towards) || ' at the fork'}`;
    case 'end-of-road':
      return `At the end of the road, turn ${side || 'off'}${ontoOrTowards(road, towards)}`;
    case 'roundabout':
    case 'rotary':
      return roundabout(s, road, towards, n(s.rotaryName));
    case 'exit-roundabout':
      return road ? `Exit the roundabout onto ${road}` : 'Exit the roundabout';
    case 'uturn':
      return uturn(road);
    case 'arrive':
      return arrive(s, n, destinationName);
    default:
      return road ? `Continue onto ${road}` : 'Continue';
  }
}

const identity = (x) => (x ? String(x) : '');

/**
 * Display + spoken text for a draft step.
 * @param {object} step draft step
 * @param {{destinationName?: string}} [opts]
 * @returns {{instruction: string, spoken: string}}
 */
export function describeStep(step, { destinationName = '' } = {}) {
  return {
    instruction: sentence(step, identity, destinationName),
    spoken: sentence(step, expandName, destinationName),
  };
}

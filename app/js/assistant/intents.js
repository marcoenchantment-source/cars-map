// Copilot intent parser: turns what the driver said into { intent, slots, confidence }.
// Pure (no DOM). Matchers run in order; the first hit wins.
import { COLOURS, GENERIC_MUSIC, exactCategory, findCategory, findHazard, findMusicApp } from './vocab.js';

export const INTENT_NAMES = Object.freeze([
  'navigate', 'go_home', 'go_work', 'find_nearby', 'report_hazard', 'eta', 'stop_nav', 'start_nav', 'avoid',
  'message', 'call', 'music', 'voice_mute', 'voice_unmute', 'flames', 'theme', 'where_am_i', 'garage',
  'open_panel', 'recenter', 'help', 'dismiss', 'unknown',
]);

const STRONG = 0.95;
const GOOD = 0.85;
const FAIR = 0.75;
const WEAK = 0.6;

const LEAD = /^(?:hey|hi|hello|ok|okay|oi|g'?day|yo|righto|alright|um+|uh+|er+|so|and|mate|copilot|co-pilot|cars map|please|just|quickly|can you|could you|would you|will you|can u|could u|can i|could i|i want to|i wanna|i'd like to|i would like to|i need you to|do you know|tell me|let's|lets|let us)\b[\s,]*/i;
const TRAIL = /[\s,]+(?:please|mate|thanks|thank you|thanks mate|cheers|cheers mate|ta|for me|now|right now|asap|quickly|if you can)$/i;
const NEAR_SUFFIX = /\s+(?:near me|nearby|near here|around here|close by|close to me|around|on the way|on my way|on the route|on my route|along the way|in the area)$/i;

/** Tidy raw speech/typing: straight quotes, single spaces, no edge punctuation, capped length. */
export function cleanText(text) {
  return String(text ?? '')
    .replace(/[‘’ʼ`]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^[\s,.!?;:"-]+|[\s,.!?;:"]+$/g, '')
    .slice(0, 300);
}

function stripRepeat(text, re) {
  let s = text;
  for (let i = 0; i < 6 && re.test(s); i += 1) s = s.replace(re, '').trim();
  return s;
}

const hit = (intent, slots = {}, confidence = GOOD) => ({ intent, slots, confidence });
const words = (s) => (s ? s.split(/\s+/).length : 0);

/** Message text as it should be sent: no lead-in words, capitalised, "i" → "I". */
export function tidyMessage(text) {
  const t = String(text ?? '')
    .trim()
    .replace(/^(?:[,:-]\s*)?(?:that|saying|to say|to)\s+/i, '')
    .replace(/\s+please$/i, '')
    .replace(/\bi\b/g, 'I')
    .replace(/\bi'(m|ll|ve|d)\b/gi, "I'$1");
  return t ? t[0].toUpperCase() + t.slice(1) : '';
}

/**
 * Split "Sam I'm 10 minutes away" into recipient and text. Known names (crew, contacts) win,
 * so "Uncle Bob running late" works when Uncle Bob is known.
 */
export function splitRecipient(rest, knownNames = []) {
  const r = String(rest ?? '').trim().replace(/^to\s+/i, '');
  const lower = r.toLowerCase();
  const known = [...knownNames].filter((n) => typeof n === 'string' && n.trim()).sort((a, b) => b.length - a.length);
  for (const name of known) {
    const n = name.trim().toLowerCase();
    if (lower === n || /^[\s,:]/.test(lower.slice(n.length)) && lower.startsWith(n)) {
      return { to: r.slice(0, n.length), text: tidyMessage(r.slice(n.length)) };
    }
  }
  const marker = /^(.{1,40}?)\s*(?:,|:|\s+saying\b|\s+that\b|\s+to say\b)\s*(.*)$/i.exec(r);
  if (marker && words(marker[1]) <= 2) return { to: marker[1].trim(), text: tidyMessage(marker[2]) };
  const [first = '', ...more] = r.split(/\s+/);
  return { to: first, text: tidyMessage(more.join(' ')) };
}

function nearbySlots(phrase, { generic = true } = {}) {
  const p = phrase.replace(NEAR_SUFFIX, '').replace(/^(?:a|an|the|some|any)\s+/i, '').trim();
  if (!p) return null;
  const cat = findCategory(p);
  if (cat) return { category: cat.id, query: cat.query, label: cat.label };
  if (!generic || findHazard(p) || /^(?:to|out|it|that|this|my way|the way|a way|route|the route|my car|you|me)\b/i.test(p)) return null;
  return { category: 'place', query: p, label: p };
}

/** Nearby slots for a free-form category ("servo", "Bunnings"), or null. */
export function nearbyFor(phrase) {
  return nearbySlots(cleanText(phrase));
}

// ------------------------------------------------------------------ matchers

function matchDismiss({ lower }) {
  return /^(?:never ?mind|forget (?:it|that|about it)|nothing|cancel(?: that)?|stop|no|nope|nah|no thanks|all good|it'?s (?:fine|ok|okay)|i'?m good|ignore (?:that|me)|oops|sorry|wrong)$/.test(lower) ? hit('dismiss', {}, STRONG) : null;
}

function matchHelp({ lower }) {
  return /^(?:help|help me|what can you do|what can i say|what do you do|what can you help with|commands|options|how does this work|how do i use (?:this|you)|what are my options)$/.test(lower) ? hit('help', {}, STRONG) : null;
}

function matchVoice({ lower }) {
  if (/^(?:unmute|un-mute|unmute (?:the |your )?voice|voice on|turn (?:the )?(?:voice|sound) (?:back )?on|turn on (?:the )?(?:voice|sound)|sound on|speak up|start talking|talk to me|enable (?:the )?voice|voice back on|resume voice)$/.test(lower)) return hit('voice_unmute', {}, STRONG);
  if (/^(?:mute|mute (?:the |your )?voice|mute yourself|be quiet|quiet|shut up|shush|sh+|hush|stop talking|voice off|turn (?:the )?(?:voice|sound) off|turn off (?:the )?(?:voice|sound)|sound off|silence|silent mode|disable (?:the )?voice|no voice|zip it|pipe down|give it a rest|put a sock in it)$/.test(lower)) return hit('voice_mute', {}, STRONG);
  return null;
}

function matchMessage({ core }) {
  const text = core.replace(/[\s,]+please$/i, '');
  let m = /^send\s+(.+?)\s+(?:a\s+)?(?:message|text|msg|sms)\b(?:\s+(?:saying|that|to say)\b)?[\s,:]*(.*)$/i.exec(text);
  if (m && !/^(?:a|an)$/i.test(m[1]) && !/^(?:a\s+)?(?:message|text)/i.test(m[1])) return hit('message', { to: m[1], text: tidyMessage(m[2]), rest: `${m[1]} ${m[2]}`.trim() }, STRONG);
  m = /^send\s+(?:a\s+)?(?:message|text|msg|sms|note)\s+to\s+(.+)$/i.exec(text);
  if (!m) m = /^(?:message|msg|text|txt|sms|tell|ping|write to|reply to|shoot (?:a )?(?:message|text) to)\s+(?!(?:me|us|you)\b)(.+)$/i.exec(text);
  if (m) return hit('message', { ...splitRecipient(m[1]), rest: m[1] }, STRONG);
  m = /^let\s+(.+?)\s+know\b(?:\s+that)?[\s,:]*(.*)$/i.exec(text);
  if (m && !/^(?:me|us)$/i.test(m[1])) return hit('message', { to: m[1], text: tidyMessage(m[2]), rest: `${m[1]} ${m[2]}`.trim() }, GOOD);
  m = /^reply(?:\s+to\s+(?:them|him|her|that))?(?:\s+(?:saying|with))?[\s,:]+(?!to\b)(.+)$/i.exec(text);
  if (m) return hit('message', { to: null, text: tidyMessage(m[1]), reply: true }, GOOD);
  return null;
}

function matchCall({ clean }) {
  const m = /^give\s+(.+?)\s+(?:a\s+)?(?:call|ring|bell|buzz|tinkle)$/i.exec(clean) ?? /^(?:call|ring|phone|dial|ring up|call up)\s+(?:up\s+)?(.+)$/i.exec(clean);
  if (!m) return null;
  const to = m[1].replace(/\s+(?:on speaker(?:phone)?|on (?:her|his|their) mobile|mobile)$/i, '').replace(/^(?:my|the)\s+/i, '').trim();
  if (!to || /^(?:it|off|back)$/i.test(to)) return null;
  const digits = to.replace(/\D/g, '');
  if (/^[+0-9 ()-]+$/.test(to) && digits.length >= 3) return hit('call', { number: to }, STRONG);
  return hit('call', { to }, STRONG);
}

const PRONOUN_DEST = /^(?:go|there|we get there|i get there|we arrive|i arrive|arrival|the destination|destination|we'?re there|the end)$/i;

function matchEta({ clean, lower }) {
  let m = /^how (?:long|far)(?: away)?(?: is it| will it take| does it take| would it take)?(?: to get)? (?:to|till|until)\s+(.+)$/i.exec(clean);
  if (!m) m = /^how far (?:away )?is\s+(?!it\b|we\b)(.+?)(?:\s+from here)?$/i.exec(clean);
  if (m) {
    if (PRONOUN_DEST.test(m[1])) return hit('eta', { ask: /^how far/i.test(clean) ? 'distance' : 'time' }, STRONG);
    return resolveDestination(m[1], { ask: 'eta' }, 0.8);
  }
  if (/^(?:what'?s|what is|whats)\s+(?:my|our|the)\s+(?:eta|e\.?t\.?a\.?|arrival time|time of arrival|time left|distance left)$/.test(lower)) return hit('eta', { ask: 'time' }, STRONG);
  if (/^(?:eta|e t a|arrival time|time left|time remaining|distance left|distance remaining)$/.test(lower)) return hit('eta', { ask: /distance/.test(lower) ? 'distance' : 'time' }, STRONG);
  if (/^how (?:far|much further|much farther)\b/.test(lower)) return hit('eta', { ask: 'distance' }, GOOD);
  if (/^how (?:long|much longer|much time|much more time)\b/.test(lower)) return hit('eta', { ask: 'time' }, GOOD);
  if (/^when (?:will|do|should|shall|are|'ll)\s+(?:we|i)\s+(?:get there|arrive|be there|reach|get home|be home|get to)/.test(lower)) return hit('eta', { ask: 'time' }, STRONG);
  if (/^(?:are we|we) (?:there|nearly there|almost there|close|nearly|almost)(?: yet)?$/.test(lower)) return hit('eta', { ask: 'time' }, GOOD);
  return null;
}

/** Decide what a spoken destination really means: home, work, the garage, "nearest X", or a place. */
function resolveDestination(dest, extra = {}, confidence = STRONG) {
  const d = dest.trim();
  const lower = d.toLowerCase();
  if (/^(?:back )?(?:my )?(?:home|house|place|home time)$|^the house$|^back home$/.test(lower)) return hit('go_home', {}, confidence);
  if (/^(?:my )?(?:work|office|job|workplace)$|^the office$/.test(lower)) return hit('go_work', {}, confidence);
  if (/^(?:the |my )?garage$/.test(lower)) return hit('garage', {}, GOOD);
  const nearest = /^(?:the\s+)?(?:nearest|closest|nearby)\s+(.+)$/i.exec(d);
  if (nearest) {
    const slots = nearbySlots(nearest[1]);
    if (slots) return hit('find_nearby', slots, STRONG);
  }
  const cat = exactCategory(d.replace(NEAR_SUFFIX, ''));
  if (cat) return hit('find_nearby', { category: cat.id, query: cat.query, label: cat.label }, STRONG);
  const indefinite = /^(?:a|an|some)\s+(.+)$/i.exec(d);
  if (indefinite && !extra.ask) return hit('find_nearby', nearbySlots(indefinite[1]) ?? { category: 'place', query: indefinite[1], label: indefinite[1] }, GOOD);
  return hit('navigate', { query: d, ...extra }, confidence);
}

function matchNavigate({ clean, lower }) {
  let m = /^(?:take|bring|get|drive|navigate|route|guide|direct|steer)\s+(?:me|us)\s+(?:back\s+)?(?:(?:to|towards?|over to)\s+)?(.+)$/i.exec(clean);
  if (!m) m = /^(?:navigate|drive|go|head|route|directions|get directions|give me directions|show (?:me )?(?:the )?(?:way|route|directions)|how (?:do|can) (?:i|we) get|set (?:a )?(?:destination|course|route)|plan (?:a )?route)\s+(?:back\s+)?(?:to|towards?|for)\s+(.+)$/i.exec(clean);
  if (!m) m = /^(?:navigate|directions|head|drive|go|going|heading)\s+((?:back )?home|work)$/i.exec(clean);
  if (!m) m = /^navigate\s+(.+)$/i.exec(clean);
  if (m) return resolveDestination(m[1]);
  if (/^(?:home|home time|going home|heading home|back home)$/.test(lower)) return hit('go_home', {}, FAIR);
  if (/^(?:work|to work|going to work|heading to work)$/.test(lower)) return hit('go_work', {}, FAIR);
  return null;
}

function matchStopNav({ lower }) {
  return /^(?:stop|cancel|end|exit|quit|finish|abort|kill|clear|close)\s+(?:the\s+|my\s+|this\s+|current\s+)?(?:navigation|navigating|nav|route|routing|trip|journey|guidance|directions|drive|driving)$/.test(lower) ? hit('stop_nav', {}, STRONG) : null;
}

function matchStartNav({ lower }) {
  return /^(?:go|start|begin|let'?s roll|go go go|let'?s do it|let'?s do this|do it|hit it|start it|on we go|giddy ?up|take me there|go there|drive there|start (?:the\s+)?(?:navigation|navigating|route|trip|drive|driving|guidance|nav)|begin (?:the\s+)?(?:navigation|route|trip)|start guiding)$/.test(lower) ? hit('start_nav', {}, GOOD) : null;
}

function matchWhereAmI({ lower }) {
  return /^(?:where am i|where are we|where i am|where we are|where are we now|where am i now|whereabouts are we|what street (?:is this|am i on|are we on)|what road (?:is this|am i on|are we on)|what suburb (?:is this|am i in|are we in)|what'?s my (?:location|address)|what is my (?:location|address)|my location|current location|my address|which (?:street|road|suburb) (?:is this|am i on|are we on|am i in|are we in)|what'?s this (?:street|road|suburb|place))$/.test(lower) ? hit('where_am_i', {}, STRONG) : null;
}

const AVOID_KEYS = [
  { key: 'tolls', re: /\btolls?\b|\btoll roads?\b|\btollways?\b/ },
  { key: 'freeways', re: /\bfreeways?\b|\bmotorways?\b|\bhighways?\b|\bexpressways?\b/ },
  { key: 'ferries', re: /\bferr(?:y|ies)\b/ },
  { key: 'traffic', re: /\btraffic\b|\bcongestion\b|\bjams?\b/ },
];

function matchAvoid({ lower }) {
  if (/\btoll[ -]?free\b/.test(lower)) return hit('avoid', { tolls: true }, GOOD);
  const on = /^(?:avoid|avoiding|no|skip|without|don'?t use|do not use|don'?t take|stay off|keep off|keep me off|no more|route around|get around|go around|dodge|steer clear of)\s+(?:the\s+)?(.+)$/.exec(lower);
  const off = on ? null : /^(?:allow|use|ok to use|okay to use|happy to use|take|i don'?t mind|stop avoiding|you can use)\s+(?:the\s+)?(.+)$/.exec(lower);
  const obj = (on ?? off)?.[1];
  if (!obj) return null;
  const slots = {};
  for (const { key, re } of AVOID_KEYS) if (re.test(obj) && (on || key !== 'traffic')) slots[key] = !!on;
  return Object.keys(slots).length ? hit('avoid', slots, STRONG) : null;
}

function matchMusic({ clean, lower }) {
  const ctl = /^(?:(next|skip)(?: (?:song|track|this(?: song)?|it))?|(pause|stop|resume)(?: the)? (?:music|song|track|playback|tunes)|(previous|last) (?:song|track)|turn (?:it|the music) (up|down)|volume (up|down))$/.exec(lower);
  if (ctl) return hit('music', { control: ctl.slice(1).find(Boolean) }, GOOD);
  const open = /^(?:open|launch|start|go to|switch to|fire up|put on)\s+(?:the\s+)?(spotify|youtube music|yt music|youtube|apple music|music app|music|my music)$/.exec(lower);
  if (open) return hit('music', { app: findMusicApp(open[1]), query: null }, STRONG);
  if (/^(?:music|tunes|some tunes|some music|play|play something)$/.test(lower)) return hit('music', { app: null, query: null }, GOOD);
  const play = /^(?:play|put on|chuck on|whack on|stick on|throw on|bang on|crank|crank up|blast|shuffle|listen to|i want to listen to|i wanna hear|i want to hear|let'?s hear|queue up)\s+(.+)$/i.exec(clean);
  if (!play) return null;
  let q = play[1];
  let app = null;
  const on = /\s+(?:on|in|with|using)\s+(spotify|youtube music|yt music|youtube|apple music)$/i.exec(q);
  if (on) {
    app = findMusicApp(on[1]);
    q = q.slice(0, on.index);
  }
  if (GENERIC_MUSIC.includes(q.toLowerCase()) || !q.trim()) return hit('music', { app, query: null }, STRONG);
  return hit('music', { app, query: q.replace(/\s+by\s+/i, ' ').trim(), display: q.trim() }, STRONG);
}

function matchFlames({ lower }) {
  return /^(?:pop (?:the |some |me some )?flames|pop (?:'?em|them|it|off)|flames?(?: on)?|light (?:it|'?em|them|the flames) up|let (?:it|'?er|her|'?em) rip|rev it(?: up)?|rev (?:the |my )?(?:engine|car|motor)|rev|send it|full send|give it (?:some|some herbs|the beans|some stick|a rev|a boot)|spit (?:some )?flames|shoot (?:some )?flames|backfire|pops? and bangs?|pop pop|bra+p+|vroo+m|bang bang)$/.test(lower) ? hit('flames', {}, STRONG) : null;
}

function matchTheme({ lower }) {
  let theme = null;
  if (/\bauto(?:matic)? (?:mode|theme)\b|\btheme (?:auto|automatic)\b/.test(lower)) theme = 'auto';
  else if (/\b(?:night|dark)(?:[ -]?time)? (?:mode|theme)\b|\bgo dark\b/.test(lower)) theme = 'dark';
  else if (/\b(?:day|light)(?:[ -]?time)? (?:mode|theme)\b/.test(lower)) theme = 'light';
  if (!theme) return null;
  if (theme !== 'auto' && /\b(?:turn|switch) off\b|\bdisable\b|\bno more\b|\boff$/.test(lower)) theme = theme === 'dark' ? 'light' : 'dark';
  return hit('theme', { theme }, STRONG);
}

function matchGarage({ lower }) {
  const paint = /^(?:paint|make|turn|colour|color|spray|change)\s+(?:my |the )?(?:car|ride|wheels|it)\s+(?:colour |color )?(?:to\s+|in\s+)?([a-z ]+)$/.exec(lower);
  if (paint && COLOURS[paint[1].trim()]) return hit('garage', { color: COLOURS[paint[1].trim()], colorName: paint[1].trim() }, STRONG);
  if (paint || /^(?:open |show |go to )?(?:the |my )?garage$|^(?:change|customi[sz]e|edit|modify|pimp|mod|upgrade|show me|tweak)\s+(?:my |the )?(?:car|ride|wheels|rims|paint(?:job)?)$|^my car$|^paint shop$/.test(lower)) return hit('garage', {}, STRONG);
  return null;
}

function matchPanels({ lower }) {
  if (/^(?:open |start |go to |show )?(?:the |a )?(?:track day|race mode|lap timer|track mode|race|racing)$/.test(lower)) return hit('open_panel', { panel: 'race' }, GOOD);
  if (/^(?:open |show |show me )?(?:my )?(?:trips|logbook|log book|trip history|driving history|past trips|previous trips)$/.test(lower)) return hit('open_panel', { panel: 'trips' }, GOOD);
  if (/^(?:open |show )?(?:the )?settings$/.test(lower)) return hit('open_panel', { panel: 'settings' }, GOOD);
  return null;
}

function matchRecenter({ lower }) {
  return /^(?:re-?cent(?:re|er)|cent(?:re|er)(?: the map| on me| me)?|follow me|where'?s my car|find my car|back to me|show me where i am|zoom (?:to|in on) me|show my position)$/.test(lower) ? hit('recenter', {}, STRONG) : null;
}

const SPECIAL_NEEDS = [
  { re: /\b(?:i'?m|im|i am|we'?re|we are)\s+(?:so\s+|really\s+)?(?:hungry|starving|peckish|famished)\b/, phrase: 'food' },
  { re: /\b(?:low on|running (?:low on|out of)|run out of|out of|getting low on)\s+(?:fuel|petrol|gas|diesel|juice)\b|\bneed to (?:fill up|refuel|get (?:fuel|petrol|gas))\b|\bfill up\b|\btank is (?:low|empty)\b/, phrase: 'fuel' },
  { re: /\b(?:need|busting for|desperate for|dying for)\s+(?:a |the )?(?:wee|pee|toilet|loo|dunny|bathroom)\b/, phrase: 'toilet' },
  { re: /\b(?:need|have) to charge\b|\bbattery (?:is )?(?:low|flat|dying)\b|\blow (?:battery|charge)\b/, phrase: 'ev charger' },
];

function matchNearby({ clean, lower }) {
  for (const { re, phrase } of SPECIAL_NEEDS) if (re.test(lower)) return hit('find_nearby', nearbySlots(phrase), GOOD);
  let m = /^(?:find|search for|search|look for|locate|where'?s|where is|wheres|where are|where can i (?:get|find)|is there|are there|any|anywhere)\s+(?:me\s+)?(?:a |an |the |some |any )?(?:nearest |closest |nearby |good |decent )?(.+)$/i.exec(clean);
  if (!m) m = /^(?:the\s+)?(?:nearest|closest)\s+(.+)$/i.exec(clean);
  if (m) {
    const slots = nearbySlots(m[1]);
    return slots ? hit('find_nearby', slots, slots.category === 'place' ? 0.8 : STRONG) : null;
  }
  m = /^(?:show|show me|get|get me|grab|grab me|i need|i want|we need|we want|need|want|i'?d like|i could use|i'?m after|after)\s+(?:me\s+)?(?:a |an |the |some )?(?:nearest |closest |nearby |good )?(.+)$/i.exec(clean);
  if (m) {
    const slots = nearbySlots(m[1], { generic: false });
    return slots ? hit('find_nearby', slots, GOOD) : null;
  }
  const bare = exactCategory(clean.replace(NEAR_SUFFIX, ''));
  return bare ? hit('find_nearby', { category: bare.id, query: bare.query, label: bare.label }, FAIR) : null;
}

const QUESTION = /^(?:is|are|any|where|what|how|do|does|can|will|was|were|has|have|why|who|should)\b/;
const AHEAD = /\b(?:ahead|up ahead|here|coming up|on the road|on this road|on the left|on the right)$/;

function matchHazard({ lower }) {
  if (QUESTION.test(lower)) return null;
  const report = /^(?:report|reporting|flag|mark)\s+(?:a |an |the |some )?(.+)$/.exec(lower);
  if (report) {
    const type = findHazard(report[1]);
    return hit('report_hazard', { type: type ?? 'hazard' }, type ? STRONG : WEAK);
  }
  const there = /^(?:there'?s|there is|there are|theres|watch out(?: for)?|look out(?: for)?|careful(?: of)?|heads up|beware(?: of)?|caution)\s+(?:a |an |the |some )?(.+)$/.exec(lower);
  if (there) {
    const type = findHazard(there[1]);
    return type ? hit('report_hazard', { type }, GOOD) : null;
  }
  const type = findHazard(lower);
  if (!type) return null;
  const opening = lower.split(/\s+/).slice(0, 3).join(' ');
  if (words(lower) <= 3 || AHEAD.test(lower) || findHazard(opening)) return hit('report_hazard', { type }, FAIR);
  return null;
}

const MATCHERS = [
  matchDismiss, matchHelp, matchVoice, matchMessage, matchCall, matchEta, matchNavigate, matchStopNav,
  matchStartNav, matchWhereAmI, matchAvoid, matchMusic, matchFlames, matchTheme, matchGarage, matchPanels,
  matchRecenter, matchNearby, matchHazard,
];

/**
 * Parse one utterance.
 * @param {string} text
 * @returns {{intent: string, slots: object, confidence: number, text: string}}
 */
export function parse(text) {
  const raw = cleanText(text);
  const core = stripRepeat(raw, LEAD);
  const clean = stripRepeat(core, TRAIL);
  const input = { raw, core, clean, lower: clean.toLowerCase() };
  if (clean) {
    for (const matcher of MATCHERS) {
      const result = matcher(input);
      if (result) return { ...result, text: raw };
    }
  }
  return { intent: 'unknown', slots: { query: raw }, confidence: 0, text: raw };
}

/** Pick the alternative the parser is most sure about (speech gives up to 3). Ties keep the first. */
export function pickBest(alternatives) {
  const list = (Array.isArray(alternatives) ? alternatives : [alternatives]).filter((a) => typeof a === 'string' && a.trim());
  let best = null;
  for (const alt of list) {
    const parsed = parse(alt);
    if (!best || parsed.confidence > best.confidence) best = parsed;
  }
  return best ?? parse('');
}

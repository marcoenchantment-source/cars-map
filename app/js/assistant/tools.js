// Claude tool definitions that mirror the copilot executor, and validation of tool input
// (model output is untrusted: every field is checked before anything runs). Pure.
import { cleanText, parse, nearbyFor } from './intents.js';

const obj = (properties = {}, required = []) => ({ type: 'object', properties, required, additionalProperties: false });
const str = (description) => ({ type: 'string', description });

/** @param {{id: string, label: string}[]} hazardTypes config.HAZARD_TYPES */
export function buildTools(hazardTypes) {
  return [
    { name: 'navigate_to', description: 'Find a destination and open the route preview (fastest route, live traffic when available). Use for any place or address the driver names, including "home" or "work".', input_schema: obj({ query: str('Place name or address, e.g. "Kings Park" or "15 Hay St Perth".') }, ['query']) },
    { name: 'find_nearby', description: 'Find the nearest place of a kind near the driver and show the route to it.', input_schema: obj({ category: str('What to find, e.g. servo, coffee, parking, food, toilets, EV charger, chemist, or a brand like Bunnings.') }, ['category']) },
    { name: 'report_hazard', description: 'Report a hazard at the driver\'s current position so other drivers are warned.', input_schema: obj({ type: { type: 'string', enum: hazardTypes.map((t) => t.id), description: hazardTypes.map((t) => `${t.id} = ${t.label}`).join('; ') } }, ['type']) },
    { name: 'send_message', description: 'Send a short text message to a crew friend in the app, or open an SMS to a quick contact.', input_schema: obj({ friend: str('Name of the friend or contact.'), text: str('The message, in the driver\'s words.') }, ['friend', 'text']) },
    { name: 'call_contact', description: 'Offer to phone one of the driver\'s quick contacts (opens the phone dialler).', input_schema: obj({ name: str('Contact name, e.g. Mum.') }, ['name']) },
    { name: 'get_eta', description: 'Get arrival time, time and distance remaining for the current navigation.', input_schema: obj() },
    { name: 'stop_navigation', description: 'Stop the current navigation or cancel the route preview.', input_schema: obj() },
    { name: 'set_avoid', description: 'Change route preferences. Only include the options the driver mentioned.', input_schema: obj({ tolls: { type: 'boolean', description: 'true = avoid toll roads' }, freeways: { type: 'boolean', description: 'true = avoid freeways' }, ferries: { type: 'boolean', description: 'true = avoid ferries' } }) },
    { name: 'where_am_i', description: 'Look up the street and suburb at the driver\'s current position.', input_schema: obj() },
    { name: 'play_music', description: 'Open a music app, optionally searching for an artist, song or playlist. Cannot control playback.', input_schema: obj({ query: str('What to play, e.g. "AC/DC".'), app: { type: 'string', enum: ['spotify', 'youtube', 'apple'] } }) },
    { name: 'pop_flames', description: 'Make the driver\'s car icon pop flames on the map, just for fun.', input_schema: obj() },
  ];
}

const text = (v, max) => (typeof v === 'string' ? cleanText(v).slice(0, max) : '');
const ROUTE_INTENTS = new Set(['navigate', 'go_home', 'go_work', 'find_nearby']);

function navigateTo(input) {
  const q = text(input.query, 120);
  if (!q) return { error: 'navigate_to needs a query.' };
  const parsed = parse(`take me to ${q}`);
  return ROUTE_INTENTS.has(parsed.intent) ? { intent: parsed.intent, slots: parsed.slots } : { intent: 'navigate', slots: { query: q } };
}

function setAvoid(input) {
  const slots = {};
  for (const key of ['tolls', 'freeways', 'ferries']) if (typeof input[key] === 'boolean') slots[key] = input[key];
  return Object.keys(slots).length ? { intent: 'avoid', slots } : { error: 'set_avoid needs at least one of tolls, freeways, ferries.' };
}

const SIMPLE = {
  get_eta: { intent: 'eta', slots: { ask: 'time' } },
  stop_navigation: { intent: 'stop_nav', slots: {} },
  where_am_i: { intent: 'where_am_i', slots: {} },
  pop_flames: { intent: 'flames', slots: {} },
};

/**
 * Turn a tool call into an executor intent, or { error } when the input is invalid.
 * @returns {{intent: string, slots: object} | {error: string}}
 */
export function toolToIntent(name, rawInput, { HAZARD_TYPES }) {
  const input = rawInput && typeof rawInput === 'object' && !Array.isArray(rawInput) ? rawInput : {};
  if (SIMPLE[name]) return { ...SIMPLE[name], slots: { ...SIMPLE[name].slots } };
  switch (name) {
    case 'navigate_to':
      return navigateTo(input);
    case 'find_nearby': {
      const slots = nearbyFor(text(input.category, 80));
      return slots ? { intent: 'find_nearby', slots } : { error: 'find_nearby needs a category.' };
    }
    case 'report_hazard':
      return HAZARD_TYPES.some((t) => t.id === input.type) ? { intent: 'report_hazard', slots: { type: input.type } } : { error: `Unknown hazard type. Use one of: ${HAZARD_TYPES.map((t) => t.id).join(', ')}.` };
    case 'send_message': {
      const to = text(input.friend, 40);
      const body = text(input.text, 500);
      return to && body ? { intent: 'message', slots: { to, text: body } } : { error: 'send_message needs friend and text.' };
    }
    case 'call_contact': {
      const to = text(input.name, 40);
      return to ? { intent: 'call', slots: { to } } : { error: 'call_contact needs a name.' };
    }
    case 'set_avoid':
      return setAvoid(input);
    case 'play_music': {
      const query = text(input.query, 120) || null;
      const app = ['spotify', 'youtube', 'apple'].includes(input.app) ? input.app : null;
      return { intent: 'music', slots: { query, app, display: query } };
    }
    default:
      return { error: `Unknown tool ${text(name, 40)}.` };
  }
}

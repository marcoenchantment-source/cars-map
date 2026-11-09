// Copilot executor: parsed intent → app actions → a short Reply. DOM-free; everything it touches
// arrives in `deps`, so it is unit-tested with fakes.
import { parse, pickBest } from './intents.js';
import { reply, failed } from './reply.js';
import { NO_KEY_TEXT } from './phrases.js';
import { toolToIntent } from './tools.js';
import * as nav from './handlersNav.js';
import * as comms from './handlersComms.js';

/** Below this, a local match is handed to Claude when a key is set. */
export const MIN_CONFIDENCE = 0.65;

const HANDLERS = Object.freeze({
  navigate: nav.navigate,
  go_home: (_s, env) => nav.goSaved('home', env),
  go_work: (_s, env) => nav.goSaved('work', env),
  find_nearby: nav.findNearby,
  report_hazard: nav.reportHazard,
  eta: nav.eta,
  stop_nav: nav.stopNav,
  start_nav: nav.startNav,
  avoid: nav.avoid,
  where_am_i: nav.whereAmI,
  message: comms.message,
  call: comms.call,
  music: comms.music,
  voice_mute: comms.voiceMute,
  voice_unmute: comms.voiceUnmute,
  flames: comms.flames,
  theme: comms.theme,
  garage: comms.garage,
  open_panel: comms.openPanel,
  recenter: comms.recenter,
  help: comms.help,
  dismiss: comms.dismiss,
});

/**
 * @param {{
 *   actions: {has: Function, call: Function}, getState: () => object, config: object,
 *   geo: {haversine: Function, formatDistance: Function}, getContacts: () => object[],
 *   getNear: () => number[]|null, canOpenNow: () => boolean, isIOS?: boolean,
 *   lastIncoming?: () => string|null, closeSheet?: Function, timeZone?: string,
 *   claude?: (text: string) => Promise<object>,
 * }} deps
 */
export function createExecutor(deps) {
  const env = Object.freeze({
    deps,
    has: (name) => deps.actions.has(name),
    call: (name, ...args) => deps.actions.call(name, ...args),
    state: () => deps.getState(),
    units: () => deps.getState().settings?.units ?? 'metric',
  });

  const claudeReady = () => !!(deps.claude && deps.getState().settings?.anthropicKey);

  async function askClaude(text) {
    if (deps.getState().online === false) return reply('No signal, so I can only do the basics right now.', { tone: 'warn' });
    try {
      return await deps.claude(text);
    } catch (err) {
      return failed(err, "I couldn't reach Claude. Try again in a moment.");
    }
  }

  /** Run one parsed intent. */
  async function run(parsed) {
    const handler = HANDLERS[parsed?.intent];
    if (!handler) return claudeReady() ? askClaude(parsed?.text ?? '') : reply(NO_KEY_TEXT);
    try {
      const result = await handler(parsed.slots ?? {}, env);
      return { ...result, intent: parsed.intent };
    } catch (err) {
      return { ...failed(err, "Sorry, that didn't work. Try again in a moment."), intent: parsed.intent };
    }
  }

  /** Handle a typed string or speech alternatives. */
  async function handle(input) {
    const parsed = Array.isArray(input) ? pickBest(input) : parse(input);
    if (!parsed.text) return reply('I didn\'t catch that. Tap the mic and try again.', { speak: false });
    if (parsed.intent === 'unknown' || (parsed.confidence < MIN_CONFIDENCE && claudeReady())) {
      return claudeReady() ? askClaude(parsed.text) : reply(NO_KEY_TEXT);
    }
    return run(parsed);
  }

  /** Run a Claude tool call. Never recurses into Claude. */
  async function runTool(name, input) {
    const mapped = toolToIntent(name, input, deps.config);
    if (mapped.error || !HANDLERS[mapped.intent]) return { content: mapped.error ?? 'Unsupported tool.', isError: true, reply: null };
    const result = await run(mapped);
    return { content: result.text || 'Done.', isError: result.tone === 'warn' || result.tone === 'bad', reply: result };
  }

  return Object.freeze({ handle, run, runTool });
}

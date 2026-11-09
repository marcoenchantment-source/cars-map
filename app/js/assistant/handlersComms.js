// Copilot handlers for people and the cabin: messages, calls, music, voice, flames, theme, panels.
// Calls and texts open the phone's own dialler / messages app; the web can't place them silently.
import { reply, unavailable, failed } from './reply.js';
import { splitRecipient } from './intents.js';
import { matchName, smsHref, telHref, validatePhone } from './contacts.js';
import { musicChoices, musicHref, musicLabel } from './music.js';
import { HELP_TEXT } from './phrases.js';

const MAX_MESSAGE = 500;
const ADD_CONTACT = Object.freeze({ label: 'Add contact', action: 'contacts' });

async function crew(env) {
  if (!env.has('listFriends')) return [];
  try {
    const list = await env.call('listFriends');
    return Array.isArray(list) ? list.filter((f) => f && typeof f.name === 'string') : [];
  } catch (err) {
    console.warn('[copilot] listFriends failed', err);
    return [];
  }
}

function smsReply(contact, body, env) {
  const href = smsHref(contact.phone, body, { ios: env.deps.isIOS });
  const text = env.deps.canOpenNow() ? `Opening messages to ${contact.name}. Check it, then tap send.` : `Tap to text ${contact.name}: ${body}`;
  return reply(text, { links: [{ label: `Text ${contact.name}`, href, kind: 'sms', autoOpen: true }] });
}

function recipient(slots, known, env) {
  if (slots.reply) return { to: env.deps.lastIncoming?.() ?? null, text: slots.text ?? '' };
  if (slots.rest) return splitRecipient(slots.rest, known);
  return { to: slots.to ?? null, text: slots.text ?? '' };
}

export async function message(slots, env) {
  const friends = await crew(env);
  const contacts = env.deps.getContacts();
  const { to, text } = recipient(slots, [...friends.map((f) => f.name), ...contacts.map((c) => c.name)], env);
  if (!to) return reply(slots.reply ? "There's no message to reply to yet." : 'Who should I message?');
  const body = String(text ?? '').trim().slice(0, MAX_MESSAGE);
  if (!body) return reply(`What should I say? Try "message ${to}" and then your message.`);
  const friend = matchName(friends, to);
  const contact = matchName(contacts, to);
  if (friend && env.has('sendMessage')) {
    try {
      await env.call('sendMessage', friend.name, body);
      return reply(`Sent to ${friend.name}: ${body}`, { tone: 'good' });
    } catch (err) {
      if (!contact) return failed(err, `I couldn't send that to ${friend.name}. Check your signal.`);
      console.warn('[copilot] crew message failed, falling back to SMS', err);
    }
  }
  if (contact) return smsReply(contact, body, env);
  return reply(`I can't find ${to} in your crew or quick contacts. Add them in Settings.`, { tone: 'warn', buttons: [ADD_CONTACT] });
}

function callReply(name, phone, env) {
  const text = env.deps.canOpenNow() ? `Opening your phone to call ${name}.` : `Tap to call ${name}.`;
  return reply(text, { links: [{ label: `Call ${name}`, href: telHref(phone), kind: 'tel', autoOpen: true }] });
}

export function call(slots, env) {
  if (slots.number) {
    const v = validatePhone(slots.number);
    return v.ok ? callReply(v.value, v.value, env) : reply("That number doesn't look right. Try again.", { tone: 'warn' });
  }
  const contact = matchName(env.deps.getContacts(), slots.to);
  if (!contact) return reply(`I don't have a number for ${slots.to ?? 'them'}. Add them to Quick contacts in Settings.`, { tone: 'warn', buttons: [ADD_CONTACT] });
  return callReply(contact.name, contact.phone, env);
}

export function music(slots, env) {
  if (slots.control) return reply("I can't control playback from here. Use your music app or the steering wheel buttons.");
  if (!slots.query && !slots.app) return reply('Pick a music app.', { links: musicChoices() });
  const app = slots.app ?? 'spotify';
  const label = musicLabel(app);
  const link = { label: slots.query ? `Play on ${label}` : `Open ${label}`, href: musicHref(app, slots.query), kind: 'web', autoOpen: true };
  const what = slots.query ? `${slots.display ?? slots.query} on ${label}` : label;
  return reply(env.deps.canOpenNow() ? `Opening ${label}.` : `Tap to open ${what}.`, { links: [link] });
}

async function setting(env, key, value) {
  if (!env.has('setSetting')) return false;
  await env.call('setSetting', key, value);
  return true;
}

export async function voiceMute(_slots, env) {
  if (!(await setting(env, 'voice', false))) return unavailable('Settings');
  return reply('Voice muted. Say "unmute" to bring it back.', { speak: false });
}

export async function voiceUnmute(_slots, env) {
  if (!(await setting(env, 'voice', true))) return unavailable('Settings');
  return reply('Voice is back on.');
}

const FLAME_LINES = ['Pop pop!', 'Send it!', 'Flames out!'];
let flameTurn = 0;

export async function flames(_slots, env) {
  if (!env.has('popFlames')) return unavailable('The garage');
  await env.call('popFlames');
  flameTurn = (flameTurn + 1) % FLAME_LINES.length;
  return reply(FLAME_LINES[flameTurn], { tone: 'good' });
}

const THEME_REPLIES = { dark: 'Night mode on.', light: 'Day mode on.', auto: 'The map now follows the sun.' };

export async function theme(slots, env) {
  const value = THEME_REPLIES[slots.theme] ? slots.theme : 'auto';
  if (!(await setting(env, 'theme', value))) return unavailable('Settings');
  return reply(THEME_REPLIES[value]);
}

export async function garage(slots, env) {
  if (slots.color && env.has('setCarLook')) {
    await env.call('setCarLook', { color: slots.color });
    return reply(`Painted it ${slots.colorName}. Looking sharp.`, { tone: 'good' });
  }
  if (!env.has('openGarage')) return unavailable('The garage');
  await env.call('openGarage');
  return reply('Opening the garage.', { speak: false });
}

const PANELS = {
  race: { action: 'openRace', text: 'Opening track day.', name: 'Track day' },
  trips: { action: 'openTrips', text: 'Opening your logbook.', name: 'The logbook' },
  settings: { action: 'openSettings', text: 'Opening Settings.', name: 'Settings' },
};

export async function openPanel(slots, env) {
  const panel = PANELS[slots.panel];
  if (!panel) return reply(HELP_TEXT);
  if (!env.has(panel.action)) return unavailable(panel.name);
  await env.call(panel.action);
  return reply(panel.text, { speak: false });
}

export async function recenter(_slots, env) {
  if (!env.has('recenter')) return unavailable('The map');
  await env.call('recenter');
  return reply('Back on you.', { speak: false });
}

export const help = () => reply(HELP_TEXT);
export const dismiss = () => reply('No worries.', { speak: false });

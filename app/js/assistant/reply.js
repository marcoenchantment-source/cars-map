// Reply objects the copilot UI shows and speaks. Pure.

/**
 * @typedef {{label: string, href: string, kind: 'tel'|'sms'|'web', autoOpen?: boolean}} ReplyLink
 * @typedef {{label: string, action: 'settings'|'contacts'|'listen'|'type'}} ReplyButton
 * @typedef {{text: string, speak: boolean, tone: string, links: ReplyLink[], buttons: ReplyButton[]}} Reply
 */

/** @returns {Reply} */
export function reply(text, extra = {}) {
  return { text: String(text ?? ''), speak: true, tone: 'info', links: [], buttons: [], ...extra };
}

/** Reply for a feature whose module isn't loaded. */
export function unavailable(feature) {
  return reply(`${feature} isn't available right now. Try reloading the app.`, { tone: 'warn' });
}

/** Use a module's own error text when it is a plain, short, friendly Error; else the fallback. */
export function friendlyError(err, fallback) {
  const msg = err?.message;
  if (err?.name === 'Error' && typeof msg === 'string' && msg.length > 0 && msg.length <= 160) return msg;
  return fallback;
}

export function failed(err, fallback) {
  console.warn('[copilot] action failed', err);
  return reply(friendlyError(err, fallback), { tone: 'warn' });
}

/** "tolls", "tolls and freeways", "tolls, freeways and ferries". */
export function listWords(items) {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

export const isPlace = (p) => !!p && typeof p.name === 'string' && Number.isFinite(p.lng) && Number.isFinite(p.lat);
export const firstRoute = (routes) => (Array.isArray(routes) ? routes.find((r) => r && Number.isFinite(r.duration)) ?? null : null);

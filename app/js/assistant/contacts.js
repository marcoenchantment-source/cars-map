// Quick contacts (name + phone) for calls and texts, plus name matching for crew and contacts.
// Pure: storage and DOM live in contactsSettings.js.

export const PHONE_RE = /^[+0-9 ()-]{6,20}$/;
export const MAX_CONTACTS = 20;
export const NAME_MAX = 40;
const MIN_DIGITS = 6;

/** @returns {{ok: true, value: string} | {ok: false, error: string}} */
export function validatePhone(raw) {
  const value = String(raw ?? '').trim().replace(/\s+/g, ' ');
  if (!PHONE_RE.test(value) || value.replace(/\D/g, '').length < MIN_DIGITS) {
    return { ok: false, error: 'Enter a phone number like 0412 345 678 or +61 412 345 678.' };
  }
  return { ok: true, value };
}

/** @returns {{ok: true, value: string} | {ok: false, error: string}} */
export function validateName(raw) {
  const value = String(raw ?? '').replace(/[\u0000-\u001f\u007f<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, NAME_MAX);
  if (!value) return { ok: false, error: 'Enter a name, for example Mum.' };
  return { ok: true, value };
}

const digitsOf = (phone) => String(phone).replace(/\D/g, '');

/**
 * Add (or update by name) a contact. Returns a new list; never mutates.
 * @returns {{ok: true, list: object[], contact: object} | {ok: false, error: string}}
 */
export function addContact(list, input, makeId = () => `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`) {
  const name = validateName(input?.name);
  if (!name.ok) return name;
  const phone = validatePhone(input?.phone);
  if (!phone.ok) return phone;
  const existing = list.find((c) => c.name.toLowerCase() === name.value.toLowerCase());
  if (existing) {
    const contact = { ...existing, phone: phone.value };
    return { ok: true, contact, list: list.map((c) => (c.id === existing.id ? contact : c)) };
  }
  if (list.length >= MAX_CONTACTS) return { ok: false, error: `You can keep up to ${MAX_CONTACTS} quick contacts. Remove one first.` };
  const contact = { id: makeId(), name: name.value, phone: phone.value };
  return { ok: true, contact, list: [...list, contact] };
}

export function removeContact(list, id) {
  return list.filter((c) => c.id !== id);
}

/** Keep only well-formed contacts from storage (untrusted). */
export function sanitiseContacts(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const item of raw.slice(0, MAX_CONTACTS)) {
    const name = validateName(item?.name);
    const phone = validatePhone(item?.phone);
    if (name.ok && phone.ok && typeof item.id === 'string' && item.id.length <= 40) out.push({ id: item.id, name: name.value, phone: phone.value });
  }
  return out;
}

/** Contact Picker API results → [{name, phone}] that pass validation. */
export function fromPicker(results) {
  if (!Array.isArray(results)) return [];
  return results.flatMap((r) => {
    const name = validateName(Array.isArray(r?.name) ? r.name[0] : r?.name);
    const tel = (Array.isArray(r?.tel) ? r.tel : []).map((t) => validatePhone(t)).find((p) => p.ok);
    return name.ok && tel ? [{ name: name.value, phone: tel.value }] : [];
  });
}

export function telHref(phone) {
  return `tel:${String(phone).replace(/[^+\d]/g, '')}`;
}

/** sms: link with a prefilled body. iOS wants "&body=", everyone else "?body=". */
export function smsHref(phone, body = '', { ios = false } = {}) {
  const number = String(phone).replace(/[^+\d]/g, '');
  if (!body) return `sms:${number}`;
  return `sms:${number}${ios ? '&' : '?'}body=${encodeURIComponent(body)}`;
}

const ALIASES = [
  ['mum', 'mom', 'mother', 'mam', 'mummy', 'ma'],
  ['dad', 'father', 'daddy', 'pa'],
  ['nan', 'nana', 'nanna', 'grandma', 'gran', 'granny'],
  ['pop', 'grandpa', 'grandad', 'granddad', 'poppy'],
];

export function normaliseName(s) {
  return String(s ?? '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();
}

function aliasesOf(n) {
  const group = ALIASES.find((g) => g.includes(n));
  return group ?? [n];
}

function editDistance(a, b) {
  if (Math.abs(a.length - b.length) > 1) return 2;
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    let diag = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const up = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = up;
    }
  }
  return prev[b.length];
}

/**
 * Best match for a spoken name: exact (incl. Mum/Mom aliases), then first word, then one typo off.
 * @template T
 * @param {T[]} items
 * @param {string} spoken
 * @param {(item: T) => string} [getName]
 * @returns {T | null}
 */
export function matchName(items, spoken, getName = (x) => x.name) {
  const want = normaliseName(spoken).replace(/^(?:my|the)\s+/, '');
  if (!want || !Array.isArray(items)) return null;
  const named = items.map((item) => ({ item, n: normaliseName(getName(item)) })).filter((e) => e.n);
  const alts = aliasesOf(want);
  const exact = named.find((e) => alts.includes(e.n));
  if (exact) return exact.item;
  const first = named.find((e) => alts.includes(e.n.split(' ')[0]) || e.n.startsWith(`${want} `));
  if (first) return first.item;
  if (want.length >= 4) {
    const close = named.find((e) => editDistance(e.n, want) <= 1 || editDistance(e.n.split(' ')[0], want) <= 1);
    if (close) return close.item;
  }
  return null;
}

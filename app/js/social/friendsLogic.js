// Friends list and chat thread operations. Every function returns new arrays/objects.
// Pure and DOM-free (nip19 is passed in so tests can use nostr-tools from node_modules).
import { cleanText, isHex64, sanitizeCar } from './sanitize.js';

export const MAX_FRIENDS = 100;
export const MAX_THREAD = 200;
export const NAME_MAX = 32;

/**
 * Turn a pasted friend code (npub1…, nprofile1…, nostr:npub1…, or 64-hex) into a pubkey.
 * @returns {{pubkey:string}|{error:string}}
 */
export function parseFriendCode(input, nip19) {
  const s = String(input ?? '').trim().replace(/^nostr:/i, '');
  if (!s) return { error: 'Paste your friend’s code first.' };
  if (s.length > 400) return { error: 'That’s too long to be a friend code. Paste just the code.' };
  if (/^[0-9a-f]{64}$/i.test(s)) return { pubkey: s.toLowerCase() };
  if (!/^(npub1|nprofile1)[02-9ac-hj-np-z]+$/i.test(s)) return { error: 'That isn’t a friend code. Friend codes start with npub1.' };
  try {
    const d = nip19.decode(s.toLowerCase());
    if (d.type === 'npub' && isHex64(d.data)) return { pubkey: d.data };
    if (d.type === 'nprofile' && isHex64(d.data?.pubkey)) return { pubkey: d.data.pubkey };
  } catch {
    // fall through to the friendly error
  }
  return { error: 'That friend code looks incomplete. Copy it again and paste the whole thing.' };
}

export function defaultFriendName(pubkey) {
  return `Driver ${pubkey.slice(0, 4).toUpperCase()}`;
}

function cleanFriend(raw) {
  if (!raw || typeof raw !== 'object' || !isHex64(raw.pubkey)) return null;
  return {
    pubkey: raw.pubkey,
    name: cleanText(raw.name, NAME_MAX) || defaultFriendName(raw.pubkey),
    named: raw.named === true,
    sharing: raw.sharing === true,
    linked: raw.linked === true,
    car: sanitizeCar(raw.car),
    addedAt: Number.isFinite(raw.addedAt) ? raw.addedAt : 0,
  };
}

/** Validate the stored list (localStorage can hold anything). */
export function sanitizeStoredFriends(raw) {
  if (!Array.isArray(raw)) return [];
  const seen = new Set();
  const out = [];
  for (const item of raw) {
    const f = cleanFriend(item);
    if (!f || seen.has(f.pubkey)) continue;
    seen.add(f.pubkey);
    out.push(f);
    if (out.length >= MAX_FRIENDS) break;
  }
  return out;
}

/**
 * Add a friend, or update an existing one. A name typed by me (`named`) beats the name the
 * friend sends in their hello.
 */
export function upsertFriend(list, { pubkey, name, car, linked, fromHello = false }, nowMs) {
  if (!isHex64(pubkey)) return list;
  const cleanName = cleanText(name, NAME_MAX);
  const existing = list.find((f) => f.pubkey === pubkey);
  if (existing) {
    const keepName = existing.named || (fromHello && !cleanName);
    const next = {
      ...existing,
      name: keepName ? existing.name : cleanName || existing.name,
      named: existing.named || (!fromHello && !!cleanName),
      car: car ? sanitizeCar(car) : existing.car,
      linked: existing.linked || linked === true,
    };
    return list.map((f) => (f.pubkey === pubkey ? next : f));
  }
  if (list.length >= MAX_FRIENDS) return list;
  return [
    ...list,
    {
      pubkey,
      name: cleanName || defaultFriendName(pubkey),
      named: !fromHello && !!cleanName,
      sharing: false,
      linked: linked === true,
      car: car ? sanitizeCar(car) : null,
      addedAt: nowMs,
    },
  ];
}

export function removeFriend(list, pubkey) {
  return list.filter((f) => f.pubkey !== pubkey);
}

export function setSharing(list, pubkey, on) {
  return list.map((f) => (f.pubkey === pubkey ? { ...f, sharing: !!on } : f));
}

export function renameFriend(list, pubkey, name) {
  const clean = cleanText(name, NAME_MAX);
  if (!clean) return list;
  return list.map((f) => (f.pubkey === pubkey ? { ...f, name: clean, named: true } : f));
}

const norm = (s) => String(s ?? '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();

export function levenshtein(a, b) {
  if (a === b) return 0;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length];
}

/** Best friend for a spoken/typed name: exact, prefix, word prefix, substring, then typo match. */
export function matchFriend(list, query) {
  const q = norm(query);
  if (!q || list.length === 0) return null;
  const named = list.map((f) => ({ f, n: norm(f.name) }));
  const tiers = [
    (x) => x.n === q,
    (x) => x.n.split(' ').includes(q),
    (x) => x.n.startsWith(q),
    (x) => x.n.split(' ').some((w) => w.startsWith(q)),
    (x) => x.n.includes(q),
  ];
  for (const test of tiers) {
    const hit = named.filter(test).sort((a, b) => a.n.length - b.n.length)[0];
    if (hit) return hit.f;
  }
  const maxDist = Math.max(1, Math.floor(q.length / 4));
  let best = null;
  for (const x of named) {
    const d = Math.min(levenshtein(q, x.n), ...x.n.split(' ').map((w) => levenshtein(q, w)));
    if (d <= maxDist && (!best || d < best.d)) best = { f: x.f, d };
  }
  return best?.f ?? null;
}

// ---------------------------------------------------------------- chat threads

/** Append a message to a friend's thread (dedupe by id, keep the newest MAX_THREAD). */
export function appendMessage(threads, pubkey, msg) {
  const thread = threads[pubkey] ?? [];
  if (thread.some((m) => m.id === msg.id)) return threads;
  const next = [...thread, msg].sort((a, b) => a.at - b.at).slice(-MAX_THREAD);
  return { ...threads, [pubkey]: next };
}

/** Validate stored threads. */
export function sanitizeThreads(raw) {
  const out = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const [pk, list] of Object.entries(raw)) {
    if (!isHex64(pk) || !Array.isArray(list)) continue;
    out[pk] = list
      .filter((m) => m && typeof m.id === 'string' && m.id.length <= 80 && Number.isFinite(m.at))
      .map((m) => ({ id: m.id, text: cleanText(m.text, 500), at: m.at, incoming: m.incoming === true, failed: m.failed === true }))
      .filter((m) => m.text)
      .slice(-MAX_THREAD);
  }
  return out;
}

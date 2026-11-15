// Race groups (pure): group codes, AES-GCM encryption with the group key, the colour palette
// and "first to pick a colour keeps it", and validation of everything members send.

export const GROUP_KIND = 20778; // ephemeral: relays forward it live and never store it
export const GROUP = Object.freeze({ maxMembers: 20, nameMax: 24, staleMs: 60_000, liveMs: 15_000, countdownS: 30 });

export const PALETTE = Object.freeze([
  { id: 'red', hex: '#e53935', name: 'Red' },
  { id: 'blue', hex: '#1e88e5', name: 'Blue' },
  { id: 'yellow', hex: '#fdd835', name: 'Yellow' },
  { id: 'green', hex: '#2e9e5b', name: 'Green' },
  { id: 'purple', hex: '#8e44ad', name: 'Purple' },
  { id: 'orange', hex: '#ff8a00', name: 'Orange' },
  { id: 'pink', hex: '#ff4fa3', name: 'Pink' },
  { id: 'teal', hex: '#1fb5a8', name: 'Teal' },
  { id: 'white', hex: '#f4f4f6', name: 'White' },
  { id: 'black', hex: '#1a1a1f', name: 'Black' },
]);
export const colourById = (id) => PALETTE.find((c) => c.id === id) ?? null;

const HEX = (n) => new RegExp(`^[0-9a-f]{${n}}$`);
const isHex32 = (s) => typeof s === 'string' && HEX(32).test(s);
const isHex64 = (s) => typeof s === 'string' && HEX(64).test(s);
const fin = (v, lo, hi) => (typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi ? v : null);

/** Plain one-line text, control/bidi characters removed, length-capped. */
export function cleanName(v, max = GROUP.nameMax) {
  if (typeof v !== 'string') return '';
  const s = v.replace(/[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩]/g, '').replace(/\s+/g, ' ').trim();
  return s.length > max ? s.slice(0, max).trimEnd() : s;
}

const toHex = (bytes) => [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
const fromHex = (hex) => Uint8Array.from(hex.match(/../g).map((h) => parseInt(h, 16)));

/** A new group: random id (who to listen to) and key (who can read it). */
export function createGroup(name, rand = (n) => crypto.getRandomValues(new Uint8Array(n))) {
  const clean = cleanName(name) || 'Race group';
  return { id: toHex(rand(16)), key: toHex(rand(32)), name: clean };
}

/** "cmrace1:<id>:<key>:<name>" — what members share by text or QR. */
export function encodeGroupCode(g) {
  return `cmrace1:${g.id}:${g.key}:${encodeURIComponent(g.name)}`;
}

/** Group from a pasted/scanned code, or null when it isn't one. */
export function decodeGroupCode(text) {
  const m = String(text ?? '').trim().match(/^cmrace1:([0-9a-f]{32}):([0-9a-f]{64}):(.{0,200})$/);
  if (!m) return null;
  let name = '';
  try {
    name = cleanName(decodeURIComponent(m[3]));
  } catch {
    name = '';
  }
  return { id: m[1], key: m[2], name: name || 'Race group' };
}

// ---------------------------------------------------------------- encryption (WebCrypto AES-GCM)

const b64 = (bytes) => btoa(String.fromCharCode(...bytes));
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const keyCache = new Map();
async function aesKey(hexKey) {
  if (!keyCache.has(hexKey)) keyCache.set(hexKey, crypto.subtle.importKey('raw', fromHex(hexKey), 'AES-GCM', false, ['encrypt', 'decrypt']));
  return keyCache.get(hexKey);
}

export async function sealJson(hexKey, obj) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = new TextEncoder().encode(JSON.stringify(obj));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await aesKey(hexKey), data));
  return `${b64(iv)}.${b64(ct)}`;
}

/** Decrypt and parse; null on anything wrong (wrong key, tampering, junk, too big). */
export async function openJson(hexKey, content, maxLen = 4096) {
  try {
    if (typeof content !== 'string' || content.length > maxLen) return null;
    const [ivB, ctB] = content.split('.');
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(ivB) }, await aesKey(hexKey), unb64(ctB));
    return JSON.parse(new TextDecoder().decode(plain));
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------- messages

/** A member's live status ('p'), cleaned; null when invalid. */
export function cleanPresence(raw, now = Date.now()) {
  if (!raw || raw.t !== 'p') return null;
  const at = fin(raw.at, now - 5 * 60_000, now + 60_000);
  if (at == null) return null;
  const lng = fin(raw.lng, -180, 180);
  const lat = fin(raw.lat, -90, 90);
  const hasPos = lng != null && lat != null;
  return {
    name: cleanName(raw.name) || 'Driver',
    colour: colourById(raw.colour)?.id ?? null,
    claimedAt: fin(raw.claimedAt, 0, now + 60_000) ?? now,
    trackId: typeof raw.trackId === 'string' ? raw.trackId.slice(0, 60) : null,
    trackName: cleanName(raw.trackName, 40) || null,
    lng: hasPos ? lng : null,
    lat: hasPos ? lat : null,
    bearing: fin(raw.bearing, 0, 360) ?? 0,
    speed: fin(raw.speed, 0, 120) ?? 0,
    laps: Math.round(fin(raw.laps, 0, 999) ?? 0),
    best: fin(raw.best, 1000, 6 * 3600_000),
    at,
  };
}

/** Race start ('s'): start time must be soon (countdown), not in the past or far future. */
export function cleanStart(raw, now = Date.now()) {
  if (!raw || raw.t !== 's') return null;
  const at = fin(raw.at, now - 2000, now + 65_000);
  return at == null ? null : { at, by: cleanName(raw.by) || 'Someone' };
}

// ---------------------------------------------------------------- colours: first to pick keeps it

/** Who owns a colour: earliest claim wins; ties go to the smaller pubkey. claims: [{pubkey, colour, claimedAt}] */
export function ownerOf(colour, claims) {
  return claims
    .filter((c) => c.colour === colour)
    .sort((a, b) => a.claimedAt - b.claimedAt || (a.pubkey < b.pubkey ? -1 : 1))[0]?.pubkey ?? null;
}

/** Colours someone else already owns: Map colourId → their claim. */
export function takenColours(claims, me) {
  const out = new Map();
  for (const c of PALETTE) {
    const owner = ownerOf(c.id, claims);
    if (owner && owner !== me) out.set(c.id, claims.find((x) => x.pubkey === owner));
  }
  return out;
}

/** My colour after checking the group: keep it if it's mine, else the first free one. */
export function settleColour(mine, claims, me) {
  const all = mine?.colour ? [...claims.filter((c) => c.pubkey !== me), { pubkey: me, ...mine }] : claims;
  if (mine?.colour && ownerOf(mine.colour, all) === me) return { ...mine, changed: false };
  const taken = takenColours(all, me);
  const free = PALETTE.find((c) => !taken.has(c.id));
  return { colour: free?.id ?? PALETTE[0].id, claimedAt: Date.now(), changed: true, lostTo: mine?.colour ? taken.get(mine.colour)?.name ?? null : null };
}

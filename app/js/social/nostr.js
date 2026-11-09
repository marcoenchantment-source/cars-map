// Nostr connection for the social module: lazy-loads the vendored nostr-tools bundle, keeps
// this phone's identity (secret key generated once, stored locally), and wraps a SimplePool
// with publish timeouts, validated subscriptions that survive reconnects, and a status feed.
// Relays being unreachable is normal: callers get a clear error and the app keeps working.
import { isEventShape, hasAppTag } from './events.js';
import { parseJsonObject } from './sanitize.js';

const SCRIPT_URL = new URL('../../vendor/nostr.bundle.js', import.meta.url).href;
const LOAD_TIMEOUT_MS = 15000;
const PUBLISH_TIMEOUT_MS = 7000;
const HEALTH_MS = 20000;
const RETRY_MIN_MS = 15000;
const RETRY_MAX_MS = 300000;
const MAX_CONV_KEYS = 200;
const SEEN_CAP = 4000;
const REOPEN_GRACE_MS = 7000;
const HEX64 = /^[0-9a-f]{64}$/;

let libPromise = null;

/** Inject the nostr-tools IIFE once; resolves to the NostrTools global. */
export function loadNostrTools() {
  if (globalThis.NostrTools) return Promise.resolve(globalThis.NostrTools);
  if (libPromise) return libPromise;
  libPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    let timer = null;
    const fail = (err) => {
      clearTimeout(timer);
      libPromise = null;
      script.remove();
      reject(err);
    };
    timer = setTimeout(() => fail(new Error('Loading the friends library timed out.')), LOAD_TIMEOUT_MS);
    script.src = SCRIPT_URL;
    script.async = true;
    script.onload = () => {
      clearTimeout(timer);
      if (globalThis.NostrTools) resolve(globalThis.NostrTools);
      else fail(new Error('The friends library did not start.'));
    };
    script.onerror = () => fail(new Error('The friends library could not load.'));
    document.head.append(script);
  });
  return libPromise;
}

const nowSec = () => Math.floor(Date.now() / 1000);

function withTimeout(promise, ms, message) {
  let timer = null;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/**
 * @param {{storage: {load:Function, save:Function}, relays: string[]}} deps
 */
export function createNostr({ storage, relays }) {
  let lib = null;
  let sk = null;
  let pubkey = null;
  let npub = null;
  let pool = null;
  let startPromise = null;
  let healthTimer = null;
  let connectedSet = new Set();
  const retryAt = new Map(); // url -> {at, delay}
  const convKeys = new Map();
  const managed = new Set();
  const statusListeners = new Set();
  let status = Object.freeze({ state: 'connecting', connected: 0, total: relays.length });

  function loadIdentity() {
    const saved = storage.load('identity', null);
    if (saved && typeof saved.sk === 'string' && HEX64.test(saved.sk)) {
      try {
        const bytes = lib.utils.hexToBytes(saved.sk);
        return { bytes, pub: lib.getPublicKey(bytes) };
      } catch (err) {
        console.warn('[social] stored identity was unusable; creating a new one', err?.message);
      }
    }
    const bytes = lib.generateSecretKey();
    if (!storage.save('identity', { sk: lib.utils.bytesToHex(bytes), createdAt: Date.now() })) {
      console.warn('[social] could not save the identity; the friend code will change next visit');
    }
    return { bytes, pub: lib.getPublicKey(bytes) };
  }

  function setStatus(next) {
    if (next.state === status.state && next.connected === status.connected) return;
    status = Object.freeze({ ...next, total: relays.length });
    for (const fn of [...statusListeners]) {
      try {
        fn(status);
      } catch (err) {
        console.error('[social] status listener failed', err);
      }
    }
  }

  function refreshStatus() {
    if (!pool) return;
    const live = new Set();
    for (const [url, ok] of pool.listConnectionStatus()) if (ok) live.add(url);
    const gained = [...live].some((u) => !connectedSet.has(u));
    connectedSet = live;
    const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
    setStatus({ state: live.size > 0 ? 'online' : offline ? 'offline' : status.state === 'connecting' ? 'connecting' : 'offline', connected: live.size });
    if (gained) for (const m of managed) m.reopenSoon();
  }

  function healthCheck() {
    if (!pool) return;
    refreshStatus();
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
    const now = Date.now();
    const statusMap = pool.listConnectionStatus();
    for (const url of relays) {
      const norm = lib.utils.normalizeURL(url);
      if (statusMap.get(norm)) continue;
      const r = retryAt.get(norm) ?? { at: 0, delay: RETRY_MIN_MS };
      if (now < r.at) continue;
      retryAt.set(norm, { at: now + r.delay, delay: Math.min(RETRY_MAX_MS, r.delay * 2) });
      pool.ensureRelay(url, { connectionTimeout: 6000 })
        .then(() => {
          retryAt.delete(norm);
          refreshStatus();
        })
        .catch(() => refreshStatus());
    }
  }

  async function doStart() {
    lib = await loadNostrTools();
    const id = loadIdentity();
    sk = id.bytes;
    pubkey = id.pub;
    npub = lib.nip19.npubEncode(pubkey);
    pool = new lib.SimplePool({ enablePing: true, enableReconnect: true });
    pool.onRelayConnectionSuccess = () => refreshStatus();
    pool.onRelayConnectionFailure = () => refreshStatus();
    healthTimer = setInterval(healthCheck, HEALTH_MS);
    window.addEventListener('online', () => {
      retryAt.clear();
      healthCheck();
    });
    window.addEventListener('offline', () => refreshStatus());
    healthCheck();
    setTimeout(() => {
      if (status.state === 'connecting') setStatus({ state: 'offline', connected: 0 });
    }, 12000);
  }

  /** Load the library, identity and pool once. Rejects if the bundle cannot load. */
  function start() {
    if (!startPromise) {
      startPromise = doStart().catch((err) => {
        startPromise = null;
        setStatus({ state: 'offline', connected: 0 });
        throw err;
      });
    }
    return startPromise;
  }

  function sign(template) {
    if (!sk) throw new Error('Not started');
    return lib.finalizeEvent({ ...template, created_at: template.created_at ?? nowSec() }, sk);
  }

  /** Resolves once ≥ 1 relay accepts the signed event; rejects with a friendly error otherwise. */
  async function publishSigned(event, { timeoutMs = PUBLISH_TIMEOUT_MS } = {}) {
    await start();
    if (navigator.onLine === false) throw new Error('No signal right now. It will be shared when you are back online.');
    const attempts = pool.publish(relays, event, { maxWait: timeoutMs });
    attempts.forEach((p) => p.catch(() => {}));
    try {
      await withTimeout(Promise.any(attempts), timeoutMs, 'timeout');
      refreshStatus();
      return { id: event.id };
    } catch {
      refreshStatus();
      throw new Error('Could not reach the sharing servers. Check your signal.');
    }
  }

  async function publish(template, opts) {
    await start();
    return publishSigned(sign(template), opts);
  }

  function makeHandler(entry, filters) {
    return (ev) => {
      if (!isEventShape(ev) || !hasAppTag(ev) || entry.seen.has(ev.id)) return;
      if (!lib.matchFilters(filters, ev) || !lib.verifyEvent(ev)) return;
      entry.seen.add(ev.id);
      if (entry.seen.size > SEEN_CAP) entry.seen.delete(entry.seen.values().next().value);
      try {
        entry.onevent(ev);
      } catch (err) {
        console.error('[social] event handler failed', err);
      }
    };
  }

  /**
   * A subscription that reopens itself when a relay (re)connects.
   * filtersFn() → Filter[] | null is called on every (re)open, so `since`/`#g` stay current.
   * @returns {{refresh: () => Promise<void>, close: () => void}}
   */
  function live({ filters: filtersFn, onevent, oneose }) {
    const entry = { onevent, seen: new Set(), closer: null, timer: null, closed: false, openedAt: 0 };
    const open = () => {
      entry.closer?.close();
      entry.closer = null;
      if (entry.closed) return;
      entry.openedAt = Date.now();
      const filters = filtersFn();
      if (!filters || filters.length === 0) return;
      const requests = [];
      for (const url of relays) for (const filter of filters) requests.push({ url, filter });
      entry.closer = pool.subscribeMap(requests, { onevent: makeHandler(entry, filters), oneose: () => oneose?.() });
    };
    entry.reopenSoon = () => {
      // A relay that connects within a few seconds of opening was connected by this open.
      if (entry.closed || !entry.openedAt || Date.now() - entry.openedAt < REOPEN_GRACE_MS) return;
      clearTimeout(entry.timer);
      entry.timer = setTimeout(() => open(), 800);
    };
    managed.add(entry);
    const handle = {
      async refresh() {
        await start();
        open();
      },
      close() {
        entry.closed = true;
        clearTimeout(entry.timer);
        entry.closer?.close();
        managed.delete(entry);
      },
    };
    return handle;
  }

  function conversationKey(otherPubkey) {
    let key = convKeys.get(otherPubkey);
    if (!key) {
      key = lib.nip44.getConversationKey(sk, otherPubkey);
      convKeys.set(otherPubkey, key);
      if (convKeys.size > MAX_CONV_KEYS) convKeys.delete(convKeys.keys().next().value);
    }
    return key;
  }

  /** NIP-44 encrypt a JSON object for one pubkey. */
  function encryptJson(otherPubkey, obj) {
    return lib.nip44.encrypt(JSON.stringify(obj), conversationKey(otherPubkey));
  }

  /** Decrypt + parse; null on any failure (bad key, tampered, oversized). */
  function decryptJson(otherPubkey, content, maxLen) {
    if (typeof content !== 'string' || content.length === 0 || content.length > maxLen) return null;
    try {
      return parseJsonObject(lib.nip44.decrypt(content, conversationKey(otherPubkey)), maxLen);
    } catch {
      return null;
    }
  }

  return Object.freeze({
    start,
    sign,
    publish,
    publishSigned,
    live,
    encryptJson,
    decryptJson,
    lib: () => lib,
    pubkey: () => pubkey,
    npub: () => npub,
    status: () => status,
    onStatus(fn) {
      statusListeners.add(fn);
      return () => statusListeners.delete(fn);
    },
    stop() {
      clearInterval(healthTimer);
      for (const m of [...managed]) m.closer?.close();
      pool?.destroy();
    },
  });
}

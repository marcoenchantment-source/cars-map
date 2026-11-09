// Chat and friend hellos over NIP-44 encrypted DMs (kind 7377). Only friends can chat;
// a hello from a stranger becomes a rate-limited "added you — add back?" notice.
import { KIND, LIMITS, buildHello, buildChat, parseDmPayload, withAppTag, expirationTag, isTimely } from './events.js';
import { appendMessage, sanitizeThreads, matchFriend } from './friendsLogic.js';
import { cleanText, isHex64 } from './sanitize.js';

const THREADS_KEY = 'social.threads';
const CURSOR_KEY = 'social.dmCursor';
const IGNORED_KEY = 'social.ignored';
const DM_TTL_S = 7 * 86400;
const CATCHUP_S = 7 * 86400;
const QUIET_AFTER_MS = 10 * 60000;
const STRANGER_WINDOW_MS = 600000;
const STRANGER_MAX = 3;
const NOTICE_GAP_MS = 4000;
const SPOKEN_GAP_MS = 30000;
let lastSpokenAt = 0;
const SEND_WINDOW_MS = 60000;
const SEND_MAX = 20;
const MAX_IGNORED = 200;
const nowSec = () => Math.floor(Date.now() / 1000);

export const QUICK_REPLIES = Object.freeze(['On my way', 'Running late', 'Here now', 'Call you soon']);

export function createChat(ctx, nostr, friends) {
  const { store, bus, ui, storage } = ctx;
  let threads = sanitizeThreads(storage.load(THREADS_KEY, {}));
  let cursor = Number(storage.load(CURSOR_KEY, 0)) || 0;
  const storedIgnored = storage.load(IGNORED_KEY, []);
  let ignored = new Set((Array.isArray(storedIgnored) ? storedIgnored : []).filter(isHex64).slice(-MAX_IGNORED));
  let unread = new Map();
  let viewing = null;
  let opener = () => {};
  const strangerTimes = [];
  const strangerSeen = new Set();
  const lastNoticeAt = new Map();
  const sendTimes = [];
  const listeners = new Set();
  let saveTimer = null;

  function scheduleSave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      storage.save(THREADS_KEY, threads);
      storage.save(CURSOR_KEY, cursor);
    }, 800);
  }

  function changed(pubkey) {
    for (const fn of [...listeners]) {
      try {
        fn(pubkey);
      } catch (err) {
        console.error('[social] chat listener failed', err);
      }
    }
  }

  const publicFriend = (f) => ({ pubkey: f.pubkey, name: f.name, sharing: f.sharing, car: f.car ?? undefined });

  function dmTemplate(pubkey, payload) {
    const now = nowSec();
    return {
      kind: KIND.DM,
      created_at: now,
      tags: withAppTag(['p', pubkey], expirationTag(now, DM_TTL_S)),
      content: nostr.encryptJson(pubkey, payload),
    };
  }

  async function sendHello(pubkey) {
    await nostr.start();
    const payload = buildHello({ name: friends.myName(), car: store.get().car });
    return nostr.publish(dmTemplate(pubkey, payload));
  }

  function notify(friend, text) {
    const now = Date.now();
    if (now - (lastNoticeAt.get(friend.pubkey) ?? 0) < NOTICE_GAP_MS) return;
    lastNoticeAt.set(friend.pubkey, now);
    ui.notice({
      id: `chat-${friend.pubkey.slice(0, 12)}`,
      iconName: 'message',
      title: friend.name,
      body: text,
      ms: 10000,
      actions: [{ label: 'Reply', primary: true, onClick: () => opener(friend.pubkey) }],
    });
    // Read messages aloud while driving, but never more than one every 30 s across all friends.
    if (store.get().mode === 'navigate' && now - lastSpokenAt >= SPOKEN_GAP_MS) {
      lastSpokenAt = now;
      bus.emit('voice:say', { text: `Message from ${friend.name}: ${text}`, priority: 'normal' });
    }
  }

  function receive(friend, msg) {
    const before = threads;
    threads = appendMessage(threads, friend.pubkey, msg);
    if (threads === before) return;
    scheduleSave();
    const isViewing = viewing === friend.pubkey;
    if (!isViewing) unread = new Map(unread).set(friend.pubkey, (unread.get(friend.pubkey) ?? 0) + 1);
    changed(friend.pubkey);
    bus.emit('chat:message', { from: publicFriend(friend), text: msg.text, at: msg.at, incoming: true });
    if (!isViewing && Date.now() - msg.at < QUIET_AFTER_MS) notify(friend, msg.text);
  }

  function ignore(pubkey) {
    ignored = new Set([...ignored, pubkey].slice(-MAX_IGNORED));
    storage.save(IGNORED_KEY, [...ignored]);
  }

  function acceptHello(pubkey, hello) {
    const f = friends.addFromHello(pubkey, hello);
    if (!f) return;
    ui.toast(`${f.name} added to your crew`, { tone: 'good' });
    sendHello(pubkey).catch(() => ui.toast('Added. They’ll see you once you have signal.', { tone: 'warn' }));
  }

  function onHello(ev, hello) {
    const pk = ev.pubkey;
    if (friends.has(pk)) {
      const r = friends.noteHello(pk, hello);
      if (r && !r.before.linked) ui.toast(`${r.after.name} added you back`, { tone: 'good' });
      return;
    }
    if (ignored.has(pk) || strangerSeen.has(pk)) return;
    const now = Date.now();
    while (strangerTimes.length && strangerTimes[0] < now - STRANGER_WINDOW_MS) strangerTimes.shift();
    if (strangerTimes.length >= STRANGER_MAX) return;
    strangerTimes.push(now);
    strangerSeen.add(pk);
    const name = hello.name || 'Someone';
    ui.notice({
      id: `hello-${pk.slice(0, 12)}`,
      iconName: 'users',
      title: `${name} added you. Add back?`,
      body: 'You can then chat and choose who sees your location.',
      ms: 30000,
      actions: [
        { label: 'Add back', primary: true, onClick: () => acceptHello(pk, hello) },
        { label: 'Not now', onClick: () => ignore(pk) },
      ],
    });
  }

  function handleEvent(ev) {
    const now = nowSec();
    const me = nostr.pubkey();
    if (!me || ev.pubkey === me || !isTimely(ev, now)) return;
    const payload = parseDmPayload(nostr.decryptJson(ev.pubkey, ev.content, LIMITS.dmContent), Date.now());
    if (!payload) return;
    cursor = Math.max(cursor, Math.min(ev.created_at, now));
    scheduleSave();
    if (payload.type === 'hello') {
      onHello(ev, payload);
      return;
    }
    const friend = friends.get(ev.pubkey);
    if (!friend) return; // strangers can't message
    receive(friend, { id: ev.id, text: payload.text, at: Math.min(ev.created_at * 1000, Date.now()), incoming: true });
  }

  const sub = nostr.live({
    filters: () => {
      const me = nostr.pubkey();
      if (!me) return null;
      return [{ kinds: [KIND.DM], '#p': [me], since: Math.max(nowSec() - CATCHUP_S, cursor - 300), limit: 300 }];
    },
    onevent: handleEvent,
  });

  function replaceMessage(pubkey, id, patch) {
    const list = threads[pubkey] ?? [];
    threads = { ...threads, [pubkey]: list.map((m) => (m.id === id ? { ...m, ...patch } : m)) };
    scheduleSave();
    changed(pubkey);
  }

  /** Send a chat message to one friend. Throws friendly Errors. */
  async function send(pubkey, text) {
    const friend = friends.get(pubkey);
    if (!friend) throw new Error('That friend isn’t in your crew any more.');
    const clean = cleanText(text, LIMITS.chatText);
    if (!clean) throw new Error('Type or say a message first.');
    const now = Date.now();
    while (sendTimes.length && sendTimes[0] < now - SEND_WINDOW_MS) sendTimes.shift();
    if (sendTimes.length >= SEND_MAX) throw new Error('Slow down a little — try again in a minute.');
    sendTimes.push(now);
    await nostr.start();
    const event = nostr.sign(dmTemplate(pubkey, buildChat(clean, now)));
    threads = appendMessage(threads, pubkey, { id: event.id, text: clean, at: now, incoming: false });
    scheduleSave();
    changed(pubkey);
    bus.emit('chat:message', { from: publicFriend(friend), text: clean, at: now, incoming: false });
    try {
      await nostr.publishSigned(event);
    } catch (err) {
      replaceMessage(pubkey, event.id, { failed: true });
      throw new Error(`Not sent: ${err.message}`);
    }
  }

  /** Action: sendMessage(friendName, text). */
  async function sendMessage(friendName, text) {
    const friend = matchFriend(friends.all(), friendName);
    if (!friend) throw new Error(`I couldn’t find “${cleanText(friendName, 40)}” in your crew.`);
    await send(friend.pubkey, text);
    return { to: friend.name };
  }

  return Object.freeze({
    start: () => sub.refresh(),
    refresh: () => sub.refresh(),
    send,
    sendMessage,
    sendHello,
    thread: (pubkey) => threads[pubkey] ?? [],
    unread: (pubkey) => unread.get(pubkey) ?? 0,
    totalUnread: () => [...unread.values()].reduce((a, b) => a + b, 0),
    setViewing(pubkey) {
      viewing = pubkey;
      if (pubkey && unread.has(pubkey)) {
        unread = new Map(unread);
        unread.delete(pubkey);
        changed(pubkey);
      }
    },
    setOpener: (fn) => (opener = fn),
    forget(pubkey) {
      const { [pubkey]: _gone, ...rest } = threads;
      threads = rest;
      scheduleSave();
    },
    onChange(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  });
}

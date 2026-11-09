// Friends list state: stored on this phone only, changed through immutable helpers.
// Also holds my own display name (sent in hellos).
import {
  parseFriendCode, sanitizeStoredFriends, upsertFriend, removeFriend, setSharing, renameFriend, MAX_FRIENDS, NAME_MAX,
} from './friendsLogic.js';
import { cleanText } from './sanitize.js';

const FRIENDS_KEY = 'social.friends';
const PROFILE_KEY = 'social.profile';

export function createFriends({ storage, nostr, store }) {
  let list = sanitizeStoredFriends(storage.load(FRIENDS_KEY, []));
  let profile = { name: cleanText(storage.load(PROFILE_KEY, {})?.name, NAME_MAX) };
  const listeners = new Set();

  function commit(next) {
    if (next === list) return;
    list = next;
    storage.save(FRIENDS_KEY, list);
    for (const fn of [...listeners]) {
      try {
        fn(list);
      } catch (err) {
        console.error('[social] friends listener failed', err);
      }
    }
  }

  const get = (pubkey) => list.find((f) => f.pubkey === pubkey) ?? null;

  /** Validate a pasted code and add the friend. Throws friendly Errors. */
  async function addByCode(code, name) {
    await nostr.start();
    const parsed = parseFriendCode(code, nostr.lib().nip19);
    if (parsed.error) throw new Error(parsed.error);
    if (parsed.pubkey === nostr.pubkey()) throw new Error('That’s your own code. Paste a friend’s code instead.');
    if (!get(parsed.pubkey) && list.length >= MAX_FRIENDS) throw new Error(`Your crew is full (${MAX_FRIENDS}). Remove someone first.`);
    commit(upsertFriend(list, { pubkey: parsed.pubkey, name }, Date.now()));
    return get(parsed.pubkey);
  }

  /** Add (or update) a friend from a hello I accepted. */
  function addFromHello(pubkey, { name, car }) {
    commit(upsertFriend(list, { pubkey, name, car, linked: true, fromHello: true }, Date.now()));
    return get(pubkey);
  }

  /** Hello from someone already in my crew: refresh their car, mark the link as mutual. */
  function noteHello(pubkey, { name, car }) {
    const before = get(pubkey);
    if (!before) return null;
    commit(upsertFriend(list, { pubkey, name, car, linked: true, fromHello: true }, Date.now()));
    return { before, after: get(pubkey) };
  }

  function myName() {
    if (profile.name) return profile.name;
    const carName = cleanText(store.get().car?.name, NAME_MAX);
    return carName && carName !== 'You' ? carName : 'A Cars Map driver';
  }

  return Object.freeze({
    all: () => list,
    get,
    has: (pubkey) => !!get(pubkey),
    sharingWith: () => list.filter((f) => f.sharing),
    addByCode,
    addFromHello,
    noteHello,
    remove: (pubkey) => commit(removeFriend(list, pubkey)),
    setSharing: (pubkey, on) => commit(setSharing(list, pubkey, on)),
    rename: (pubkey, name) => commit(renameFriend(list, pubkey, name)),
    myName,
    profileName: () => profile.name,
    setProfileName(name) {
      profile = { name: cleanText(name, NAME_MAX) };
      storage.save(PROFILE_KEY, profile);
    },
    onChange(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  });
}

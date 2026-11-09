// Social module entry: identity & relays, friends, live location, chat, hazards and
// community road changes. Nothing here blocks boot; with no relays everything still works
// locally and the Crew sheet says "Offline". Each feature starts in its own try/catch.
import { createNostr } from './nostr.js';
import { createFriends } from './friends.js';
import { createChat } from './chat.js';
import { createLocation } from './location.js';
import { createHazards } from './hazards.js';
import { createCrewPanel } from './crewPanel.js';

const START_DELAY_MS = 1200;
const FRIENDS_EMIT_MS = 2000;

function safe(label, fn) {
  try {
    return fn();
  } catch (err) {
    console.error(`[social] ${label} failed to start`, err);
    return null;
  }
}

function initHazards(ctx, nostr) {
  const hazards = safe('hazards', () => createHazards(ctx, nostr));
  if (hazards) safe('hazard UI', () => hazards.init());
  ctx.actions.register('reportHazard', (type, opts = {}) => {
    if (!hazards) throw new Error('Hazard reports aren’t available right now.');
    return hazards.reportHazard(type, opts ?? {});
  });
}

function initCrew(ctx, nostr, getRoads) {
  const { ui, bus, actions, storage, store } = ctx;
  const friends = createFriends({ storage, nostr, store });
  const chat = createChat(ctx, nostr, friends);
  const location = createLocation(ctx, nostr, friends);
  const crew = createCrewPanel(ctx, { nostr, friends, chat, location, roads: { summary: () => getRoads()?.summary() ?? null } });
  chat.setOpener((pubkey) => crew.open(pubkey));

  const publicFriends = () => friends.all().map((f) => {
    const loc = location.get(f.pubkey);
    return {
      pubkey: f.pubkey,
      name: f.name,
      sharing: f.sharing,
      theirLocation: loc ? { lng: loc.lng, lat: loc.lat, bearing: loc.bearing, speed: loc.speed, at: loc.at } : undefined,
      car: f.car ?? undefined,
    };
  });
  let emitTimer = null;
  const emitFriends = () => {
    if (emitTimer) return;
    emitTimer = setTimeout(() => {
      emitTimer = null;
      bus.emit('friends:updated', { friends: publicFriends() });
    }, FRIENDS_EMIT_MS);
  };
  const onFriendsOrPlaces = () => {
    crew.refreshFriends();
    emitFriends();
  };
  friends.onChange(onFriendsOrPlaces);
  location.onChange(onFriendsOrPlaces);
  chat.onChange((pubkey) => crew.refreshThread(pubkey));
  nostr.onStatus(() => crew.refreshFriends());

  ui.addDockItem({ id: 'crew', icon: 'users', label: 'Crew', order: 30, onClick: () => crew.open() });
  safe('location', () => location.init());
  actions.register('sendMessage', (friendName, text) => chat.sendMessage(friendName, text));
  actions.register('listFriends', () => publicFriends());
  actions.register('openCrew', () => crew.open());
  return { chat, location, crew };
}

export async function init(ctx) {
  const { storage, config } = ctx;
  const nostr = createNostr({ storage, relays: [...config.NOSTR_RELAYS] });
  let roads = null;

  initHazards(ctx, nostr);
  const crewParts = safe('crew', () => initCrew(ctx, nostr, () => roads));

  // Start networking after boot without blocking it. Offline is fine.
  setTimeout(() => {
    nostr.start()
      .then(() => Promise.allSettled([crewParts?.chat.start(), crewParts?.location.start()]))
      .catch((err) => console.warn('[social] sharing offline:', err?.message));
  }, START_DELAY_MS);

  // Road changes are optional: a failure here must never affect the rest.
  import('./roadwatch.js')
    .then((mod) => {
      roads = mod.createRoadwatch(ctx, nostr, { onChange: () => crewParts?.crew.refreshRoads() });
      roads.init();
    })
    .catch((err) => console.error('[social] road changes failed to start', err));
}

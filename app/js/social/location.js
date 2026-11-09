// Live location between friends. I send one encrypted ephemeral event (kind 20777, never
// stored by relays) per friend I share with; I only show friends who share with me.
// Simulated fixes (demo drive, race replay) are never shared.
import { haversine, formatDistance } from '../core/geo.js';
import { KIND, LIMITS, LOCATION_STALE_MS, buildLocationPayload, buildLocationOff, parseLocationPayload, withAppTag } from './events.js';
import { agoText } from './hazardLogic.js';

const SHARE_MS = 8000;
const SHARE_NAV_MS = 4000;
const FIX_MAX_AGE_MS = 30000;
const LIVE_MS = 45000;
const SWEEP_MS = 5000;
const nowSec = () => Math.floor(Date.now() / 1000);

export function createLocation(ctx, nostr, friends) {
  const { store, bus, ui } = ctx;
  let locations = new Map(); // pubkey -> {lng,lat,bearing,speed,at,car}
  const markers = new Map(); // pubkey -> {handle, kind, look} | {pending:true}
  const listeners = new Set();
  let simActive = false;
  let lastBearing = null;
  let sharingSet = new Set(friends.sharingWith().map((f) => f.pubkey));
  let refreshTimer = null;

  const notify = () => {
    for (const fn of [...listeners]) {
      try {
        fn();
      } catch (err) {
        console.error('[social] location listener failed', err);
      }
    }
  };

  function domMarker(friend, loc) {
    const color = loc.car?.color ?? friend.car?.color ?? null;
    const label = ui.el('span', { class: 'cm-friend-name', text: friend.name });
    const el = ui.el(
      'div',
      { class: 'cm-friend', role: 'img', 'aria-label': `${friend.name}'s location` },
      ui.el('span', { class: 'cm-friend-pin', style: color ? { background: color } : null }, ui.icon('car', { size: 18 })),
      label,
    );
    const marker = new maplibregl.Marker({ element: el, anchor: 'bottom' }).setLngLat([loc.lng, loc.lat]).addTo(ctx.map);
    return {
      setPosition: (ll) => marker.setLngLat(ll),
      setLook: () => {},
      setName: (n) => (label.textContent = n),
      remove: () => marker.remove(),
      el,
    };
  }

  async function createMarker(friend, loc) {
    const placeholder = { pending: true };
    markers.set(friend.pubkey, placeholder);
    let handle = null;
    let kind = 'dom';
    if (ctx.actions.has('createCarMarker')) {
      try {
        handle = await ctx.actions.call('createCarMarker', {
          look: loc.car ?? friend.car ?? undefined, name: friend.name, lngLat: [loc.lng, loc.lat], bearing: loc.bearing,
        });
        kind = 'car';
      } catch (err) {
        console.warn('[social] car marker failed; using a simple marker', err?.message);
      }
    }
    if (!handle && globalThis.maplibregl) handle = domMarker(friend, loc);
    if (!handle) return;
    if (markers.get(friend.pubkey) !== placeholder) {
      handle.remove();
      return;
    }
    markers.set(friend.pubkey, { handle, kind, look: JSON.stringify(loc.car) });
    const latest = locations.get(friend.pubkey);
    if (latest && latest !== loc) handle.setPosition([latest.lng, latest.lat], latest.bearing);
  }

  function updateMarker(friend, loc) {
    const m = markers.get(friend.pubkey);
    if (!m) {
      createMarker(friend, loc).catch((err) => console.error('[social] marker failed', err));
      return;
    }
    if (m.pending) return;
    m.handle.setPosition([loc.lng, loc.lat], loc.bearing);
    m.handle.el?.classList.remove('is-stale');
    const look = JSON.stringify(loc.car);
    if (loc.car && look !== m.look) {
      m.handle.setLook(loc.car);
      markers.set(friend.pubkey, { ...m, look });
    }
  }

  function dropFriend(pubkey) {
    const m = markers.get(pubkey);
    if (m && !m.pending) m.handle.remove();
    markers.delete(pubkey);
    if (locations.has(pubkey)) {
      locations = new Map(locations);
      locations.delete(pubkey);
    }
  }

  function onLocation(ev) {
    const friend = friends.get(ev.pubkey);
    if (!friend) return;
    const loc = parseLocationPayload(nostr.decryptJson(ev.pubkey, ev.content, LIMITS.locationContent), Date.now());
    if (!loc) return;
    const prev = locations.get(ev.pubkey);
    if (prev && prev.at >= loc.at) return;
    if (loc.off) {
      dropFriend(ev.pubkey);
      notify();
      return;
    }
    locations = new Map(locations).set(ev.pubkey, loc);
    updateMarker(friend, loc);
    notify();
  }

  const sub = nostr.live({
    filters: () => {
      const me = nostr.pubkey();
      const authors = friends.all().map((f) => f.pubkey);
      if (!me || authors.length === 0) return null;
      return [{ kinds: [KIND.LOCATION], '#p': [me], authors, since: nowSec() - 60 }];
    },
    onevent: onLocation,
  });

  function publishTo(pubkey, payload) {
    nostr.publish({ kind: KIND.LOCATION, tags: withAppTag(['p', pubkey]), content: nostr.encryptJson(pubkey, payload) })
      .catch(() => {}); // live location is best-effort; the next tick tries again
  }

  function shareNow() {
    if (simActive || !nostr.pubkey() || nostr.status().state !== 'online') return;
    const targets = friends.sharingWith();
    if (targets.length === 0) return;
    const s = store.get();
    const fix = s.position;
    if (!fix || fix.simulated || Date.now() - (fix.timestamp ?? 0) > FIX_MAX_AGE_MS) return;
    const payload = buildLocationPayload({ lng: fix.lng, lat: fix.lat, heading: fix.heading ?? lastBearing, speed: fix.speed }, s.car, Date.now());
    for (const f of targets) publishTo(f.pubkey, payload);
  }

  function loop() {
    try {
      shareNow();
    } catch (err) {
      console.error('[social] location share failed', err);
    }
    setTimeout(loop, store.get().mode === 'navigate' ? SHARE_NAV_MS : SHARE_MS);
  }

  function sweep() {
    const now = Date.now();
    let dirty = false;
    for (const [pk, loc] of locations) {
      const age = now - loc.at;
      if (age > LOCATION_STALE_MS) {
        dropFriend(pk);
        dirty = true;
      } else if (age > LIVE_MS) {
        markers.get(pk)?.handle?.el?.classList.add('is-stale');
      }
    }
    if (dirty) notify();
  }

  function onFriendsChanged(list) {
    const next = new Set(list.filter((f) => f.sharing).map((f) => f.pubkey));
    const stopped = [...sharingSet].filter((pk) => !next.has(pk));
    const started = [...next].some((pk) => !sharingSet.has(pk));
    sharingSet = next;
    if (nostr.pubkey()) for (const pk of stopped) publishTo(pk, buildLocationOff(Date.now()));
    if (started) shareNow();
    const known = new Set(list.map((f) => f.pubkey));
    for (const pk of [...markers.keys()]) if (!known.has(pk)) dropFriend(pk);
    for (const f of list) {
      const m = markers.get(f.pubkey);
      if (m && !m.pending) m.handle.setName?.(f.name);
    }
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => sub.refresh().catch(() => {}), 1000);
    notify();
  }

  /** "2.1 km away · live", "seen 3 min ago", or null when they aren't sharing with me. */
  function describe(pubkey) {
    const loc = locations.get(pubkey);
    if (!loc) return null;
    const me = store.get().position;
    const age = Date.now() - loc.at;
    const when = age < LIVE_MS ? 'live' : `seen ${agoText(loc.at, Date.now())}`;
    if (!me) return `Sharing with you · ${when}`;
    const d = formatDistance(haversine([me.lng, me.lat], [loc.lng, loc.lat]), store.get().settings.units).text;
    return `${d} away · ${when}`;
  }

  function init() {
    bus.on('gps:sim', (p) => {
      simActive = !!p?.active;
    });
    bus.on('pose', (p) => {
      if (Number.isFinite(p?.bearing)) lastBearing = p.bearing;
    });
    friends.onChange(onFriendsChanged);
    setInterval(sweep, SWEEP_MS);
    setTimeout(loop, SHARE_MS);
  }

  return Object.freeze({
    init,
    start: () => sub.refresh(),
    get: (pubkey) => locations.get(pubkey) ?? null,
    describe,
    onChange(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  });
}

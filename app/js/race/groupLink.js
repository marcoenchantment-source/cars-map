// Race group link: encrypted live status between group members over the Crew relays.
// While you're racing, members see each other's cars on the map in their group colours;
// outside a race only your name, colour and best lap are shared (never your position).
// Ghost mode stops all of it.
import {
  GROUP_KIND, GROUP, PALETTE, colourById, createGroup, decodeGroupCode, encodeGroupCode,
  sealJson, openJson, cleanPresence, cleanStart, settleColour, takenColours,
} from './groupModel.js';

const STORE_KEY = 'raceGroup';
const RACE_TICK_MS = 2000;
const IDLE_TICK_MS = 10000;
const SWEEP_MS = 5000;

const validGroup = (g) => g && /^[0-9a-f]{32}$/.test(g.id) && /^[0-9a-f]{64}$/.test(g.key) && typeof g.name === 'string';

export function createGroupLink(ctx, { nostr, myName }) {
  const { store, bus, ui, storage, actions } = ctx;
  const saved = storage.load(STORE_KEY, null);
  let group = validGroup(saved?.group) ? saved.group : null;
  let mine = group && colourById(saved?.mine?.colour) ? saved.mine : null;
  let prevColour = group && /^#[0-9a-f]{6}$/i.test(saved?.prevColour ?? '') ? saved.prevColour : null;
  const members = new Map(); // pubkey → presence + { marker }
  const listeners = new Set();
  let racing = null; // { trackId, trackName, laps, best }
  let bearing = 0;
  let loopTimer = null;

  const notify = () => listeners.forEach((fn) => {
    try {
      fn();
    } catch (err) {
      console.error('[race] group listener failed', err);
    }
  });
  const persist = () => storage.save(STORE_KEY, group ? { group, mine, prevColour } : null);
  const me = () => nostr.pubkey();
  const claims = () => [...members.values()].filter((m) => m.colour).map((m) => ({ pubkey: m.pubkey, colour: m.colour, claimedAt: m.claimedAt, name: m.name }));

  // ---------------------------------------------------------------- my colour on my car
  function applyMyColour() {
    if (!group || !mine) return;
    const hex = colourById(mine.colour).hex;
    const car = store.get().car;
    if (prevColour == null) prevColour = car.color;
    if (car.color !== hex) store.set((s) => ({ car: { ...s.car, color: hex } }));
    persist();
  }
  function restoreColour() {
    if (prevColour) store.set((s) => ({ car: { ...s.car, color: prevColour } }));
    prevColour = null;
  }

  function recheckColour() {
    const before = mine?.colour;
    const next = settleColour(mine, claims(), me());
    if (!next.changed) return;
    mine = { colour: next.colour, claimedAt: next.claimedAt };
    applyMyColour();
    if (before && next.lostTo) ui.toast(`${next.lostTo} picked ${colourById(before).name} first. You’re ${colourById(mine.colour).name} now.`, { tone: 'warn', ms: 4500 });
    sendPresence();
  }

  // ---------------------------------------------------------------- other members' cars
  async function drawMarker(pk) {
    const m = members.get(pk);
    if (!m) return;
    const live = m.lng != null && Date.now() - m.at < GROUP.liveMs;
    if (!live) {
      m.marker?.remove();
      m.marker = null;
      return;
    }
    const look = { ...ctx.config.DEFAULT_CAR, color: colourById(m.colour)?.hex ?? '#9aa0a8', name: m.name };
    if (m.marker) {
      m.marker.setLook?.(look);
      m.marker.setPosition([m.lng, m.lat], m.bearing);
      return;
    }
    if (!actions.has('createCarMarker') || m.pendingMarker) return;
    m.pendingMarker = true;
    try {
      const handle = await actions.call('createCarMarker', { look, name: m.name, lngLat: [m.lng, m.lat], bearing: m.bearing });
      if (members.get(pk) === m) m.marker = handle;
      else handle?.remove?.();
    } catch (err) {
      console.warn('[race] group car marker failed', err?.message);
    } finally {
      m.pendingMarker = false;
    }
  }
  function dropMember(pk) {
    members.get(pk)?.marker?.remove?.();
    members.delete(pk);
  }

  // ---------------------------------------------------------------- network
  async function onEvent(ev) {
    if (!group || ev.pubkey === me()) return;
    const g = group;
    const obj = await openJson(g.key, ev.content);
    if (!obj || g !== group) return;
    if (obj.t === 'p') {
      const p = cleanPresence(obj);
      if (!p || (!members.has(ev.pubkey) && members.size >= GROUP.maxMembers)) return;
      members.set(ev.pubkey, { ...members.get(ev.pubkey), ...p, pubkey: ev.pubkey });
      recheckColour();
      drawMarker(ev.pubkey);
      notify();
    } else if (obj.t === 'l') {
      dropMember(ev.pubkey);
      notify();
    } else if (obj.t === 's') {
      const s = cleanStart(obj);
      if (s) bus.emit('race:countdown', s);
    }
  }

  const sub = nostr.live({
    filters: () => (group ? [{ kinds: [GROUP_KIND], '#h': [group.id], since: Math.floor(Date.now() / 1000) - 30 }] : null),
    onevent: (ev) => {
      onEvent(ev).catch((err) => console.warn('[race] group message ignored', err?.message));
    },
  });

  async function send(payload) {
    if (!group) return;
    const content = await sealJson(group.key, payload);
    await nostr.publish({ kind: GROUP_KIND, tags: [['h', group.id], ['t', 'carsmap']], content });
  }

  async function sendPresence() {
    if (!group || !mine || store.get().settings.ghostMode) return;
    if (nostr.status().state !== 'online') return;
    const pos = store.get().position;
    const share = racing && pos && !pos.simulated && Date.now() - (pos.timestamp ?? 0) < 15000;
    const name = await myName().catch(() => '');
    await send({
      t: 'p', name, colour: mine.colour, claimedAt: mine.claimedAt,
      trackId: racing?.trackId ?? null, trackName: racing?.trackName ?? null,
      lng: share ? Math.round(pos.lng * 1e6) / 1e6 : null, lat: share ? Math.round(pos.lat * 1e6) / 1e6 : null,
      bearing: share ? bearing : 0, speed: share ? pos.speed ?? 0 : 0,
      laps: racing?.laps ?? 0, best: racing?.best ?? null, at: Date.now(),
    }).catch(() => {}); // best effort; the next tick tries again
  }

  function loop() {
    sendPresence();
    loopTimer = setTimeout(loop, store.get().mode === 'race' ? RACE_TICK_MS : IDLE_TICK_MS);
  }

  function sweep() {
    const now = Date.now();
    let dirty = false;
    for (const [pk, m] of members) {
      if (now - m.at > GROUP.staleMs) {
        dropMember(pk);
        dirty = true;
      } else if (m.marker && now - m.at > GROUP.liveMs) drawMarker(pk);
    }
    if (dirty) notify();
  }

  // ---------------------------------------------------------------- joining and leaving
  async function enter(g) {
    if (group) await leave({ quiet: true });
    group = g;
    members.clear();
    mine = settleColour(null, [], me());
    mine = { colour: mine.colour, claimedAt: mine.claimedAt };
    applyMyColour();
    persist();
    await sub.refresh().catch(() => {});
    sendPresence();
    notify();
  }

  async function leave({ quiet = false } = {}) {
    if (!group) return;
    await send({ t: 'l', at: Date.now() }).catch(() => {});
    for (const pk of [...members.keys()]) dropMember(pk);
    restoreColour();
    group = null;
    mine = null;
    persist();
    sub.refresh().catch(() => {});
    if (!quiet) ui.toast('You left the race group');
    notify();
  }

  bus.on('pose', (p) => {
    if (Number.isFinite(p?.bearing)) bearing = Math.round(p.bearing);
  });
  store.select((s) => s.settings.ghostMode === true, (on) => {
    if (on && group) send({ t: 'l', at: Date.now() }).catch(() => {});
  });
  setInterval(sweep, SWEEP_MS);
  if (group) {
    applyMyColour();
    nostr.start().then(() => sub.refresh()).catch(() => {});
  }
  loopTimer = setTimeout(loop, IDLE_TICK_MS);

  return Object.freeze({
    group: () => group,
    code: () => (group ? encodeGroupCode(group) : ''),
    mine: () => mine,
    members: () => [...members.values()].map(({ marker, pendingMarker, ...m }) => m)
      .sort((a, b) => (a.best ?? Infinity) - (b.best ?? Infinity) || a.name.localeCompare(b.name)),
    taken: () => takenColours(claims(), me()),
    palette: PALETTE,
    async create(name) {
      await nostr.start();
      await enter(createGroup(name));
    },
    async join(code) {
      const g = decodeGroupCode(code);
      if (!g) throw new Error('That isn’t a race group code. Ask for the code from the group’s Share button.');
      await nostr.start();
      await enter(g);
    },
    leave,
    chooseColour(id) {
      if (!group || !colourById(id)) return false;
      const owner = takenColours(claims(), me()).get(id);
      if (owner) {
        ui.toast(`${owner.name} already has ${colourById(id).name}`, { tone: 'warn' });
        return false;
      }
      mine = { colour: id, claimedAt: Date.now() };
      applyMyColour();
      sendPresence();
      notify();
      return true;
    },
    /** Everyone in the group gets the same 30-second countdown. */
    async startRace() {
      if (!group) return;
      const at = Date.now() + GROUP.countdownS * 1000;
      const name = await myName().catch(() => '');
      await send({ t: 's', at, by: name }).catch(() => ui.toast('The group may not have got the start signal. Check your signal.', { tone: 'warn' }));
      bus.emit('race:countdown', { at, by: 'You' });
    },
    setRacing(info) {
      racing = info ? { trackId: info.trackId, trackName: info.trackName, laps: 0, best: info.best ?? null } : null;
      clearTimeout(loopTimer);
      loop();
    },
    setLap({ laps, best }) {
      if (racing) racing = { ...racing, laps, best };
      sendPresence();
    },
    onChange(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  });
}

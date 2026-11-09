// Crowd hazard reports: the Report FAB, publishing reports/votes (kept locally so they show
// instantly and offline, retried when signal returns), the area subscription, map markers and
// "hazard ahead" alerts while navigating.
import { geohashEncode, geohashNeighbors, haversine, spokenDistance } from '../core/geo.js';
import { KIND, isEventShape } from './events.js';
import { isLngLat } from './sanitize.js';
import {
  aggregateHazards, hazardTemplate, voteTemplate, parseHazardEvent, parseVoteEvent,
  resolveHazardType, hazardType, hazardsAhead, selectForMap, LIFETIME_FACTOR,
} from './hazardLogic.js';
import { createHazardView, spokenName } from './hazardsView.js';

const MAX_REPORTS = 600;
const MAX_VOTES = 3000;
const MAX_MINE = 60;
const MAX_MY_VOTES = 200;
const REQUERY_MS = 120000;
const RECOMPUTE_DEBOUNCE_MS = 300;
const RATE_WINDOW_MS = 600000;
const RATE_MAX = 12;
const DUPLICATE_M = 150;
const DUPLICATE_MS = 300000;
const AHEAD_GAP_MS = 8000;
const AHEAD_CHECK_MS = 1000;
const nowSec = () => Math.floor(Date.now() / 1000);

export function createHazards(ctx, nostr) {
  const { store, bus, ui, storage, config } = ctx;
  const lookbackS = Math.max(...config.HAZARD_TYPES.map((t) => t.ttlMin)) * 60 * LIFETIME_FACTOR;
  const reports = new Map();
  const votes = new Map();
  let mine = loadSigned('social.myHazards', KIND.HAZARD);
  let myVotes = loadSigned('social.myVotes', KIND.VOTE);
  let hazards = [];
  let lastSignature = '';
  let cell = null;
  let fullQuery = true;
  let lastOpenSec = 0;
  let recomputeTimer = null;
  let lastAheadCheck = 0;
  let lastAheadNotice = 0;
  const announced = new Set();
  const reportTimes = [];

  const view = createHazardView(ctx, { onOpen: (id) => openDetail(id) });

  function loadSigned(key, kind) {
    const raw = storage.load(key, []);
    if (!Array.isArray(raw)) return [];
    const now = nowSec();
    const parse = kind === KIND.HAZARD ? parseHazardEvent : parseVoteEvent;
    return raw
      .filter((r) => r && isEventShape(r.event) && r.event.kind === kind && parse(r.event, now))
      .map((r) => ({ event: r.event, sent: r.sent === true }));
  }

  function ingest(ev) {
    const now = nowSec();
    if (ev.kind === KIND.HAZARD) {
      const r = parseHazardEvent(ev, now);
      if (r) reports.set(r.id, r);
    } else if (ev.kind === KIND.VOTE) {
      const v = parseVoteEvent(ev, now);
      if (v) votes.set(v.id, v);
    }
    scheduleRecompute();
  }

  function prune(nowMs) {
    for (const [id, r] of reports) if (r.hardExpiresAt <= nowMs) reports.delete(id);
    for (const [id, v] of votes) if (v.at < nowMs - lookbackS * 1000) votes.delete(id);
    trimMap(reports, MAX_REPORTS, (r) => r.reportedAt);
    trimMap(votes, MAX_VOTES, (v) => v.at);
  }

  function trimMap(map, max, timeOf) {
    if (map.size <= max) return;
    const oldest = [...map.entries()].sort((a, b) => timeOf(a[1]) - timeOf(b[1])).slice(0, map.size - max);
    for (const [id] of oldest) map.delete(id);
  }

  function center() {
    const p = store.get().position;
    if (p) return [p.lng, p.lat];
    const c = ctx.map.getCenter();
    return [c.lng, c.lat];
  }

  function recompute() {
    const nowMs = Date.now();
    prune(nowMs);
    const now = nowSec();
    // My own reports and votes always count, even when no relay is reachable.
    mine = mine.filter((r) => {
      const parsed = parseHazardEvent(r.event, now);
      if (parsed) reports.set(parsed.id, parsed);
      return !!parsed;
    });
    myVotes = myVotes.filter((r) => {
      const parsed = parseVoteEvent(r.event, now);
      if (parsed) votes.set(parsed.id, parsed);
      return !!parsed;
    });
    hazards = aggregateHazards({ reports: reports.values(), votes: votes.values(), nowMs, me: nostr.pubkey() });
    view.renderMarkers(selectForMap(hazards, center()));
    const signature = hazards.map((h) => `${h.id}:${h.confirms}:${h.denies}`).join('|');
    if (signature !== lastSignature) {
      lastSignature = signature;
      bus.emit('hazards:updated', { hazards: hazards.map((h) => ({ ...h })) });
    }
    checkAhead(true);
  }

  function scheduleRecompute() {
    clearTimeout(recomputeTimer);
    recomputeTimer = setTimeout(recompute, RECOMPUTE_DEBOUNCE_MS);
  }

  const sub = nostr.live({
    filters: () => {
      if (!cell) return null;
      const since = fullQuery ? nowSec() - lookbackS : lastOpenSec - 300;
      fullQuery = false;
      lastOpenSec = nowSec();
      return [{ kinds: [KIND.HAZARD, KIND.VOTE], '#g': geohashNeighbors(cell), since, limit: 500 }];
    },
    onevent: ingest,
    oneose: scheduleRecompute,
  });

  function updateCell(lngLat) {
    if (!isLngLat(lngLat)) return;
    const next = geohashEncode(lngLat[1], lngLat[0], 5);
    if (next === cell) return;
    cell = next;
    fullQuery = true;
    sub.refresh().catch((err) => console.warn('[social] hazard subscription failed', err?.message));
  }

  function persist() {
    storage.save('social.myHazards', mine);
    storage.save('social.myVotes', myVotes);
  }

  const inFlight = new Set();
  const markSent = (list, id) => list.map((r) => (r.event.id === id ? { ...r, sent: true } : r));

  function sendInBackground(rec, why) {
    const id = rec.event.id;
    if (inFlight.has(id)) return;
    inFlight.add(id);
    nostr.publishSigned(rec.event)
      .then(() => {
        mine = markSent(mine, id);
        myVotes = markSent(myVotes, id);
        persist();
      })
      .catch(() => {
        if (why === 'report') ui.toast('Saved on your phone. It will be shared when you have signal.', { tone: 'warn' });
      })
      .finally(() => inFlight.delete(id));
  }

  function retryUnsent() {
    for (const rec of [...mine, ...myVotes]) if (!rec.sent) sendInBackground(rec, 'retry');
  }

  /** reportHazard(type, { lngLat? }) → Promise<void>; throws friendly Errors. */
  async function reportHazard(typeInput, { lngLat } = {}) {
    const type = resolveHazardType(typeInput);
    if (!type) throw new Error('I don’t know that hazard. Try police, speed camera, crash, roadworks, weather, road closed or traffic.');
    const fix = store.get().position;
    const pos = isLngLat(lngLat) ? [lngLat[0], lngLat[1]] : fix ? [fix.lng, fix.lat] : null;
    if (!pos) throw new Error('I need your location to report a hazard. Turn on location and try again.');
    const label = hazardType(type).label;
    const nowMs = Date.now();
    while (reportTimes.length && reportTimes[0] < nowMs - RATE_WINDOW_MS) reportTimes.shift();
    if (reportTimes.length >= RATE_MAX) throw new Error('That’s a lot of reports in a short time. Try again in a few minutes.');
    const dup = hazards.find((h) => h.mine && h.type === type && nowMs - h.reportedAt < DUPLICATE_MS && haversine(pos, [h.lng, h.lat]) < DUPLICATE_M);
    if (dup) {
      ui.toast(`${label} already reported here — thanks`);
      return;
    }
    await nostr.start();
    const heading = isLngLat(lngLat) ? null : fix?.heading ?? null;
    const event = nostr.sign(hazardTemplate({ type, lngLat: pos, heading, nowSec: Math.floor(nowMs / 1000) }));
    const rec = { event, sent: false };
    mine = [...mine, rec].slice(-MAX_MINE);
    reportTimes.push(nowMs);
    persist();
    recompute();
    ui.toast(`${label} reported — thanks`, { tone: 'good' });
    sendInBackground(rec, 'report');
  }

  async function vote(h, v) {
    try {
      await nostr.start();
      const event = nostr.sign(voteTemplate({ hazard: h, vote: v, nowSec: nowSec() }));
      const rec = { event, sent: false };
      myVotes = [...myVotes, rec].slice(-MAX_MY_VOTES);
      persist();
      recompute();
      ui.toast(v === 'confirm' ? 'Thanks — marked as still there' : 'Thanks — marked as gone', { tone: 'good' });
      sendInBackground(rec, 'vote');
    } catch (err) {
      console.error('[social] vote failed', err);
      ui.toast('Could not save that. Try again.', { tone: 'bad' });
    }
  }

  function openDetail(id) {
    const h = hazards.find((x) => x.id === id);
    if (h) view.openDetail(h, vote);
  }

  function checkAhead(force = false) {
    const s = store.get();
    if (s.mode !== 'navigate' || !s.activeRoute || !s.progress) return;
    const nowMs = Date.now();
    if (!force && nowMs - lastAheadCheck < AHEAD_CHECK_MS) return;
    lastAheadCheck = nowMs;
    if (nowMs - lastAheadNotice < AHEAD_GAP_MS) return;
    const candidates = hazards.filter((h) => !h.mine && !announced.has(h.id));
    const [first] = hazardsAhead(candidates, s.activeRoute, s.progress.along);
    if (!first) return;
    announced.add(first.hazard.id);
    lastAheadNotice = nowMs;
    view.aheadNotice(first.hazard, first.distance, vote);
    bus.emit('voice:say', {
      text: `${spokenName(first.hazard.type)} reported ahead, ${spokenDistance(first.distance, s.settings.units)}`,
      priority: 'normal',
    });
  }

  function onReportPick(type) {
    view.closeReportSheet();
    reportHazard(type).catch((err) => ui.toast(err.message, { tone: 'bad', ms: 4200 }));
  }

  function init() {
    ui.addFab({
      id: 'report', icon: 'alert', label: 'Report a hazard', order: 30, tone: 'warn', size: 'lg',
      onClick: () => view.openReportSheet(onReportPick),
    });
    bus.on('gps:fix', (f) => updateCell([f.lng, f.lat]));
    bus.on('map:landed', ({ center: c }) => {
      if (!cell) updateCell(c);
    });
    ctx.map.on('moveend', () => {
      if (!store.get().position) updateCell(center());
      else view.renderMarkers(selectForMap(hazards, center()));
    });
    bus.on('nav:progress', () => checkAhead(false));
    bus.on('nav:start', () => announced.clear());
    nostr.onStatus((st) => {
      if (st.state === 'online') retryUnsent();
    });
    setInterval(() => {
      sub.refresh().catch(() => {});
      recompute();
    }, REQUERY_MS);
    nostr.start().then(() => {
      recompute();
      retryUnsent();
    }).catch((err) => console.warn('[social] hazards offline', err?.message));
    recompute();
  }

  return Object.freeze({ init, reportHazard, list: () => hazards });
}

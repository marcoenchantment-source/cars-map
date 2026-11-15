// Track day: world tracks (from OpenStreetMap), record your own circuit, race with GPS lap
// timing and lap history, and a demo lap to try it at home.
import { TRACK_LIMITS, capTracks, cleanTrackName, nextTrackName, removeTrack, sanitizeTracks, upsertTrack, withLap } from './tracksModel.js';
import { createTrackLayer } from './trackLayer.js';
import { startRaceSession } from './session.js';
import { startRecordSession } from './recordSession.js';
import { createRaceSheet } from './sheet.js';
import { demoCircuit } from './demo.js';
import { createGroupLink } from './groupLink.js';
import { initCountdown } from './countdown.js';

const TRACKS_KEY = 'tracks';

function createTracksStore(storage) {
  let tracks = Object.freeze(capTracks(sanitizeTracks(storage.load(TRACKS_KEY, [])), TRACK_LIMITS));
  const commit = (next) => {
    tracks = Object.freeze(capTracks(next, TRACK_LIMITS));
    if (!storage.save(TRACKS_KEY, tracks)) console.warn('[race] could not save tracks');
    return tracks;
  };
  return Object.freeze({
    list: () => tracks,
    get: (id) => tracks.find((t) => t.id === id) ?? null,
    upsert: (track) => commit(upsertTrack(tracks, track)),
    remove: (id) => commit(removeTrack(tracks, id)),
  });
}

export async function init(ctx) {
  const { ui, store, actions } = ctx;
  const tracks = createTracksStore(ctx.storage);
  let layer = null;
  let session = null; // race or record session, one at a time
  let group = null;
  try {
    const nostr = actions.has('nostrClient') ? await actions.call('nostrClient') : null;
    if (nostr) group = createGroupLink(ctx, { nostr, myName: () => actions.call('myName') });
  } catch (err) {
    console.warn('[race] race groups unavailable', err?.message);
  }
  initCountdown(ctx);

  const ensureLayer = async () => {
    if (!layer) layer = createTrackLayer(await ctx.mapView.ready);
    return layer;
  };

  async function nameTrack(track) {
    if (!actions.has('reverseGeocode') || !store.get().online) return;
    try {
      const place = await actions.call('reverseGeocode', track.start.point);
      const name = cleanTrackName(place?.name || '');
      const current = tracks.get(track.id);
      if (name && current) tracks.upsert({ ...current, name });
    } catch (err) {
      console.warn('[race] could not name the track', err);
    }
  }

  async function race(track, { demo = false } = {}) {
    if (session) return;
    try {
      const l = await ensureLayer();
      session = startRaceSession(ctx, {
        track, layer: l, demo,
        onRecord: (t, lap) => {
          const current = tracks.get(t.id);
          if (!current) return;
          const next = withLap(current, lap.time, lap.endedAt);
          tracks.upsert(next);
          group?.setLap({ laps: next.laps.length, best: next.bestLap });
        },
        onEnd: () => {
          session = null;
          group?.setRacing(null);
        },
      });
      if (!demo) group?.setRacing({ trackId: track.id, trackName: track.name, best: track.bestLap });
    } catch (err) {
      session = null;
      console.error('[race] could not start the session', err);
      ui.toast('Track day could not start. Try again.', { tone: 'bad' });
    }
  }

  async function record() {
    if (session) return;
    try {
      const l = await ensureLayer();
      session = startRecordSession(ctx, {
        layer: l,
        nameFor: () => nextTrackName(tracks.list()),
        onSaved: (track) => {
          session = null;
          tracks.upsert(track);
          ui.toast(`${track.name} saved`, { tone: 'good' });
          nameTrack(track);
          race(track);
        },
        onEnd: () => {
          session = null;
        },
      });
    } catch (err) {
      session = null;
      console.error('[race] could not start recording', err);
      ui.toast('Recording could not start. Try again.', { tone: 'bad' });
    }
  }

  function practiceDemo() {
    const pos = store.get().position;
    const c = ctx.map.getCenter();
    const center = pos && Number.isFinite(pos.lng) ? [pos.lng, pos.lat] : [c.lng, c.lat];
    race(demoCircuit(center), { demo: true });
  }

  /** A world track joins "Your tracks" the first time you use it, keeping laps on later visits. */
  function adopt(world) {
    const saved = tracks.get(world.id);
    const merged = saved
      ? { ...world, createdAt: saved.createdAt, bestLap: saved.bestLap, bestLapAt: saved.bestLapAt, laps: saved.laps }
      : { ...world, createdAt: Date.now() };
    tracks.upsert(merged);
    return tracks.get(world.id) ?? merged;
  }

  const sheet = createRaceSheet(ctx, {
    tracks: () => tracks.list(),
    group: () => group,
    onWorldRace: (w) => race(adopt(w)),
    onWorldDemo: (w) => race(adopt(w), { demo: true }),
    onRace: (t) => race(t),
    onDemo: (t) => race(t, { demo: true }),
    onRecord: () => record(),
    onDelete: (id) => tracks.remove(id),
    onPracticeDemo: practiceDemo,
  });

  const open = () => {
    if (store.get().mode === 'navigate') {
      ui.toast('Finish your trip first, then open Track day.', { tone: 'warn' });
      return;
    }
    sheet.open();
  };
  ui.addDockItem({ id: 'race', icon: 'flag', label: 'Track day', order: 40, onClick: open });
  actions.register('openRace', open);
}

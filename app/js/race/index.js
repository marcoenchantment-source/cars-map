// Track day: record a circuit, race it with GPS lap timing, and a demo lap to try it at home.
import { TRACK_LIMITS, capTracks, cleanTrackName, nextTrackName, removeTrack, sanitizeTracks, upsertTrack, withLap } from './tracksModel.js';
import { createTrackLayer } from './trackLayer.js';
import { startRaceSession } from './session.js';
import { startRecordSession } from './recordSession.js';
import { createRaceSheet } from './sheet.js';
import { demoCircuit } from './demo.js';

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
          if (current) tracks.upsert(withLap(current, lap.time, lap.endedAt));
        },
        onEnd: () => {
          session = null;
        },
      });
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

  const sheet = createRaceSheet(ctx, {
    tracks: () => tracks.list(),
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

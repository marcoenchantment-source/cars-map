// Navigation session control: start/stop, feeding fixes to the engine, voice, route trimming,
// re-routing and arrival. One session at a time; all state lives in this closure.
import { createNavigator } from './engine.js';
import { createTripRecorder } from './trip.js';
import { createRerouter } from './rerouter.js';
import { endPlace } from './route.js';
import { spokenText } from './announce.js';

const TRIM_INTERVAL_MS = 1000;
const TRIM_LAG_MAX_M = 250;

function validPlace(p) {
  return p && Number.isFinite(p.lng) && Number.isFinite(p.lat) ? p : null;
}

export function createController(ctx, { voice, wake, internal }) {
  const { store, bus, ui, geo, mapView } = ctx;
  let session = null; // private, mutable: { engine, route, destination, trip, lastTrimAt, offRoute }
  let lastFix = null;

  const units = () => store.get().settings.units;

  function draw(fn) {
    mapView.ready
      .then(fn)
      .catch((err) => console.error('[nav] map update failed', err));
  }

  const rerouter = createRerouter(ctx, {
    isActive: () => !!session,
    isOffRoute: () => !!session && session.engine.progress().offRoute,
    getFix: () => lastFix,
    getDestination: () => session?.destination ?? null,
    onRoute: applyNewRoute,
    onState: (busy) => internal.emit('rerouting', { active: !!busy }),
  });

  function startNavigation(route, destination) {
    let engine;
    try {
      engine = createNavigator(route, { units: units() });
    } catch (err) {
      console.error('[nav] cannot start navigation', err);
      ui.toast(err?.message || "This route can't be driven. Pick another.", { tone: 'bad', ms: 4500 });
      return false;
    }
    if (session) teardown('replace');
    const r = engine.route();
    const dest = validPlace(destination) ?? validPlace(store.get().destination) ?? endPlace(r);
    const s = { engine, route: r, destination: dest, trip: createTripRecorder(Date.now()), lastTrimAt: 0, offRoute: false };
    session = s;
    store.set({ mode: 'navigate', follow: true, activeRoute: r, destination: dest, progress: engine.progress() });
    draw(() => {
      if (session !== s) return;
      mapView.routes.setActiveRoute(r);
      mapView.setDestination(dest);
    });
    wake.acquire();
    const first = spokenText(r.steps[0]);
    voice.say(first ? `Let's go. ${first}.` : "Let's go.");
    bus.emit('nav:start', { route: r });
    internal.emit('start', { route: r, destination: dest });
    return true;
  }

  function teardown(reason, finishedTrip = null) {
    const s = session;
    if (!s) return;
    session = null;
    rerouter.cancel();
    internal.emit('rerouting', { active: false });
    wake.release();
    if (reason === 'user') voice.cancel();
    if (reason !== 'replace') {
      const keepDest = reason === 'arrived';
      store.set((st) => ({
        mode: st.mode === 'navigate' ? 'explore' : st.mode,
        follow: true,
        activeRoute: null,
        progress: null,
        destination: keepDest ? st.destination : null,
      }));
      draw(() => {
        mapView.routes.clear();
        if (!keepDest) mapView.setDestination(null);
      });
    }
    const trip = finishedTrip ?? s.trip.finish(Date.now());
    bus.emit('nav:stop', { reason: reason === 'arrived' ? 'arrived' : 'user', trip });
    internal.emit('stop', { reason });
  }

  function arrive(s) {
    const trip = s.trip.finish(Date.now());
    const name = String(s.destination?.name ?? '').trim();
    voice.say(name && name !== 'Destination' ? `You've arrived at ${name}.` : "You've arrived.", { priority: 'high' });
    bus.emit('nav:arrive', { destination: s.destination, trip });
    teardown('arrived', trip);
    internal.emit('arrived', { destination: s.destination, trip, route: s.route });
  }

  function applyNewRoute(route) {
    const s = session;
    if (!s) return;
    const progress = s.engine.replaceRoute(route); // throws on an undrivable route → rerouter retries
    const r = s.engine.route();
    s.route = r;
    s.offRoute = false;
    s.lastTrimAt = 0;
    s.trip.noteReroute();
    store.set({ activeRoute: r, progress });
    draw(() => {
      if (session === s) mapView.routes.setActiveRoute(r);
    });
    bus.emit('nav:rerouted', { route: r });
    ui.toast(`New route · ${geo.formatDuration(r.duration)}`, { tone: 'good' });
  }

  function onEvent(s, e) {
    if (e.type === 'step') bus.emit('nav:step', { step: e.step, nextStep: e.nextStep });
    else if (e.type === 'announce') voice.say(e.text, { priority: e.priority });
    else if (e.type === 'offroute') {
      s.trip.noteOffRoute();
      bus.emit('nav:offroute', {});
      voice.say('Re-routing.');
      rerouter.request();
    } else if (e.type === 'arrive') arrive(s);
  }

  function trim(s, progress) {
    const now = Date.now();
    if (now - s.lastTrimAt < TRIM_INTERVAL_MS) return;
    s.lastTrimAt = now;
    // The camera glides to each new pose over ~1 s; start the line one second back so it always
    // begins under the displayed car instead of jumping ahead of it.
    const lag = Math.min(TRIM_LAG_MAX_M, (progress.speed || 0) * 1.2);
    const coords = geo.sliceAlong(s.route.geometry, s.route.cum, Math.max(0, progress.along - lag));
    draw(() => {
      if (session === s) mapView.routes.setRemaining(coords);
    });
  }

  function poseFrom(fix, progress) {
    const accuracy = Number.isFinite(fix.accuracy) ? fix.accuracy : null;
    if (progress.onRoute) {
      return { lng: progress.snapped[0], lat: progress.snapped[1], bearing: progress.bearing, speed: progress.speed, accuracy, onRoute: true };
    }
    const bearing = Number.isFinite(fix.heading) ? fix.heading : progress.bearing;
    return { lng: fix.lng, lat: fix.lat, bearing, speed: progress.speed, accuracy, onRoute: false };
  }

  /** Feed a (stabilised) fix. Returns the pose to display, or null when not navigating. */
  function handleFix(fix) {
    lastFix = fix;
    const s = session;
    if (!s) return null;
    const { progress, events } = s.engine.update(fix);
    s.trip.add(fix);
    store.set({ progress });
    bus.emit('nav:progress', progress);
    trim(s, progress);
    for (const e of events) {
      if (session !== s) break;
      onEvent(s, e);
    }
    if (session === s && s.offRoute && !progress.offRoute) rerouter.backOnRoute();
    if (session === s) s.offRoute = progress.offRoute;
    return poseFrom(fix, progress);
  }

  function navStatus() {
    if (!session) return null;
    const p = store.get().progress ?? session.engine.progress();
    const step = session.route.steps[p.stepIndex];
    return {
      eta: p.eta,
      distanceRemaining: p.distanceRemaining,
      durationRemaining: p.durationRemaining,
      nextInstruction: step ? step.instruction : null,
      destination: session.destination,
    };
  }

  // Leaving navigate mode any other way (e.g. a track day starting) ends the session.
  store.select(
    (s) => s.mode,
    (mode) => {
      if (!session || mode === 'navigate') return;
      queueMicrotask(() => {
        if (session && store.get().mode !== 'navigate') teardown('user');
      });
    },
  );
  store.select(
    (s) => s.settings.units,
    (u) => session?.engine.setUnits(u),
  );

  return Object.freeze({
    startNavigation,
    stopNavigation: () => teardown('user'),
    handleFix,
    navStatus,
    isActive: () => !!session,
    route: () => session?.route ?? null,
    destination: () => session?.destination ?? null,
    rerouteNow: () => rerouter.request(true),
  });
}

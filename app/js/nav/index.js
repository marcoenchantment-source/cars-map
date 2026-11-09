// Nav module: GPS, the fix → pose pipeline, turn-by-turn engine, voice, wake lock, HUD,
// re-routing, arrival and the demo drive.
//
// Every `gps:fix` (real from gps.js, or simulated by the demo drive / anyone else) goes through
// one pipeline: smooth → store.position → navigation engine (when navigating) → `pose`.
import { createBus } from '../core/bus.js';
import { createGps } from './gps.js';
import { createPoseSmoother } from './fixFilter.js';
import { createVoice } from './voice.js';
import { createWakeLock } from './wakelock.js';
import { createController } from './controller.js';
import { createDemoDrive } from './demoDrive.js';
import { createHud } from './hud.js';
import { createArrival } from './arrival.js';

function rawPose(fix, lastBearing) {
  return {
    lng: fix.lng,
    lat: fix.lat,
    bearing: Number.isFinite(fix.heading) ? fix.heading : lastBearing,
    speed: Number.isFinite(fix.speed) ? fix.speed : 0,
    accuracy: Number.isFinite(fix.accuracy) ? fix.accuracy : null,
    onRoute: false,
  };
}

function createPosePipeline({ bus, store }, controller) {
  const smoother = createPoseSmoother();
  let lastBearing = 0;
  let simulated = null;

  bus.on('gps:sim', () => smoother.reset());
  bus.on('gps:fix', (fix) => {
    if (!fix || !Number.isFinite(fix.lng) || !Number.isFinite(fix.lat)) return;
    if (simulated !== !!fix.simulated) {
      simulated = !!fix.simulated;
      smoother.reset();
    }
    const stable = smoother.next(fix);
    store.set({ position: fix });
    let pose = null;
    try {
      pose = controller.handleFix(stable);
    } catch (err) {
      console.error('[nav] navigation update failed', err);
    }
    const out = pose ?? rawPose(stable, lastBearing);
    if (Number.isFinite(out.bearing)) lastBearing = out.bearing;
    bus.emit('pose', out);
  });
}

export async function init(ctx) {
  const { actions } = ctx;
  const internal = createBus(); // nav-private events: start, stop, arrived, rerouting
  const voice = createVoice(ctx);
  const wake = createWakeLock(ctx);
  const controller = createController(ctx, { voice, wake, internal });
  createPosePipeline(ctx, controller);
  const demo = createDemoDrive(ctx, { controller });
  createHud(ctx, { controller, voice, internal });
  createArrival(ctx, { internal, controller });

  actions.register('startNavigation', (route, destination) => controller.startNavigation(route, destination));
  actions.register('stopNavigation', () => {
    if (demo.active()) demo.stop();
    else controller.stopNavigation();
  });
  actions.register('startDemoDrive', (route, opts = {}) => demo.start(route ?? ctx.store.get().activeRoute, opts));
  actions.register('navStatus', () => controller.navStatus());

  // Start GPS last so the pipeline is listening before the first fix.
  createGps(ctx);
}

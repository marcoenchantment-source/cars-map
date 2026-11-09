// Smooth pose animation + follow camera.
// GPS arrives about once a second; we interpolate between poses every animation frame and
// drive both the camera and any frame listeners (the car layer) from the same displayed pose,
// so the car stays glued to the screen position while the map glides underneath.
import { angleDiff, haversine, normalizeBearing } from '../core/geo.js';

const SNAP_DISTANCE_M = 400; // jump instead of gliding across big gaps
const NAV_PITCH_3D = 58;
const EXPLORE_PITCH_3D = 52;
const STREET_ZOOM = 16.2; // the "around my car" level the intro lands on
const AUTO_RESUME_MS = 12000;

/** Target zoom for a speed in m/s: closer in town, further out on the freeway. */
export function zoomForSpeed(mps) {
  const kmh = (mps ?? 0) * 3.6;
  if (kmh < 25) return 17.4;
  if (kmh < 55) return 17.4 - ((kmh - 25) / 30) * 0.8; // 16.6 at 55
  if (kmh < 90) return 16.6 - ((kmh - 55) / 35) * 0.7; // 15.9 at 90
  return Math.max(15.1, 15.9 - ((kmh - 90) / 30) * 0.6);
}

export function lerpPose(a, b, k) {
  return {
    lng: a.lng + (b.lng - a.lng) * k,
    lat: a.lat + (b.lat - a.lat) * k,
    bearing: normalizeBearing(a.bearing + angleDiff(a.bearing, b.bearing) * k),
    speed: (a.speed ?? 0) + ((b.speed ?? 0) - (a.speed ?? 0)) * k,
    accuracy: b.accuracy,
    onRoute: b.onRoute,
  };
}

export function createCamera(map, { store, bus }) {
  let from = null;
  let to = null;
  let displayed = null;
  let t0 = 0;
  let duration = 1000;
  let lastPoseAt = 0;
  let raf = 0;
  let resumeTimer = null;
  let navZoom = null;
  const frameListeners = new Set();

  function onPose(pose) {
    const now = performance.now();
    const p = {
      lng: pose.lng,
      lat: pose.lat,
      bearing: Number.isFinite(pose.bearing) ? pose.bearing : (displayed?.bearing ?? 0),
      speed: pose.speed ?? 0,
      accuracy: pose.accuracy,
      onRoute: pose.onRoute ?? false,
    };
    const interval = lastPoseAt ? Math.min(2000, Math.max(200, now - lastPoseAt)) : 1000;
    lastPoseAt = now;
    const jump = !displayed || haversine([displayed.lng, displayed.lat], [p.lng, p.lat]) > SNAP_DISTANCE_M;
    from = jump ? p : displayed;
    to = p;
    t0 = now;
    duration = jump ? 1 : interval * 1.08;
    if (!raf) raf = requestAnimationFrame(tick);
  }

  function tick(now) {
    raf = 0;
    if (!to) return;
    const k = Math.min(1, (now - t0) / duration);
    displayed = lerpPose(from, to, k);
    for (const fn of frameListeners) {
      try {
        fn(displayed);
      } catch (err) {
        console.error('[camera] frame listener failed', err);
      }
    }
    follow(displayed);
    if (k < 1) raf = requestAnimationFrame(tick);
  }

  const is3d = () => store.get().settings.view3d !== false;
  const navPitch = () => (is3d() ? NAV_PITCH_3D : 0);
  // Car sits in the lower part of the screen while driving, so you see more road ahead.
  const navPadding = () => ({ top: Math.round(map.getContainer().clientHeight * 0.42), bottom: 90, left: 0, right: 0 });

  // Following must wait for the intro fly-down: a per-frame jumpTo would cancel the flight
  // half-way and leave the map stuck flat and zoomed out.
  let landed = false;
  bus.on('map:landed', () => {
    landed = true;
    applyFrame(true);
  });

  function follow(pose) {
    const { follow: following, mode } = store.get();
    if (!following || !landed) return;
    if (mode === 'navigate') {
      const target = zoomForSpeed(pose.speed);
      navZoom = navZoom == null ? target : navZoom + (target - navZoom) * 0.04;
      // Ease toward the chosen tilt if something (an interrupted intro, a fitBounds) changed it.
      const pitch = map.getPitch();
      const want = navPitch();
      const nextPitch = Math.abs(pitch - want) < 0.5 ? want : pitch + (want - pitch) * 0.06;
      // Pitch and padding go in every frame: a one-off easeTo would be cancelled by the next jumpTo.
      map.jumpTo({ center: [pose.lng, pose.lat], bearing: pose.bearing, zoom: navZoom, pitch: nextPitch, padding: navPadding() });
    } else if (mode === 'explore') {
      if (map.isEasing()) return; // let re-centre / tilt animations finish instead of cutting them short
      map.jumpTo({ center: [pose.lng, pose.lat] });
    }
  }

  // Any user gesture releases the camera; in navigation it snaps back after a quiet spell.
  const release = (e) => {
    if (!e.originalEvent) return;
    if (store.get().follow) store.set({ follow: false });
    clearTimeout(resumeTimer);
    if (store.get().mode === 'navigate') {
      resumeTimer = setTimeout(() => {
        if (store.get().mode === 'navigate') store.set({ follow: true });
      }, AUTO_RESUME_MS);
    }
  };
  map.on('dragstart', release);
  map.on('zoomstart', release);
  map.on('rotatestart', release);
  map.on('pitchstart', release);

  bus.on('pose', onPose);

  // Mode and follow transitions set pitch/padding once; per-frame updates only move centre/bearing/zoom.
  store.select((s) => `${s.mode}|${s.follow}`, () => applyFrame(true));

  /** zoomBack: re-centre was pressed, so return to street level if the user had zoomed out. */
  function applyFrame(animate, { zoomBack = false } = {}) {
    const { mode, follow: following } = store.get();
    const h = map.getContainer().clientHeight;
    if (mode === 'navigate' && following) {
      navZoom = null;
      const center = displayed ? [displayed.lng, displayed.lat] : map.getCenter();
      map.easeTo({
        center,
        bearing: displayed?.bearing ?? map.getBearing(),
        pitch: navPitch(),
        zoom: zoomForSpeed(displayed?.speed ?? 0),
        padding: { top: Math.round(h * 0.42), bottom: 90, left: 0, right: 0 },
        duration: animate ? 900 : 0,
      });
    } else if (mode === 'explore' && following && displayed) {
      const zoomedOut = map.getZoom() < STREET_ZOOM - 0.6;
      map.easeTo({
        center: [displayed.lng, displayed.lat],
        ...(zoomBack && zoomedOut ? { zoom: STREET_ZOOM, bearing: 0 } : {}),
        pitch: is3d() ? Math.max(map.getPitch(), EXPLORE_PITCH_3D) : 0,
        padding: { top: 0, bottom: 0, left: 0, right: 0 },
        duration: animate ? (zoomBack && zoomedOut ? 1100 : 700) : 0,
      });
    } else if (mode !== 'navigate') {
      const pad = map.getPadding();
      if (pad.top || pad.bottom) map.easeTo({ padding: { top: 0, bottom: 0, left: 0, right: 0 }, duration: animate ? 500 : 0 });
    }
  }

  // 2D/3D switch: navigation picks it up per frame; elsewhere tilt the map right away.
  store.select((s) => s.settings.view3d, () => {
    if (store.get().mode === 'navigate') return;
    map.easeTo({ pitch: is3d() ? EXPLORE_PITCH_3D : 0, duration: 600 });
  });

  return Object.freeze({
    /** Subscribe to every displayed (interpolated) pose. Returns unsubscribe. */
    onFrame(fn) {
      frameListeners.add(fn);
      if (displayed) fn(displayed);
      return () => frameListeners.delete(fn);
    },
    /** Latest displayed pose or null. */
    pose: () => displayed,
    recenter() {
      clearTimeout(resumeTimer);
      store.set({ follow: true });
      applyFrame(true, { zoomBack: true });
    },
  });
}

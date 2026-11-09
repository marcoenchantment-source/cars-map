// Pure turn-by-turn navigation engine. Feed it fixes; it returns progress and events.
// No DOM, no timers, no globals beyond the injected clock: fully unit tested under Node.
//
// events: {type:'step', index, step, nextStep} | {type:'announce', text, priority, tier, stepIndex}
//       | {type:'offroute', distance} | {type:'arrive'}
import { NAV } from '../config.js';
import { bearing, haversine, pointAlong } from '../core/geo.js';
import { normalizeRoute } from './route.js';
import { matchOnRoute, segmentBearings } from './snap.js';
import { planAnnouncement } from './announce.js';

const HOLD_BACK_M = 12; // small backward snaps are GPS noise: hold position
const STEP_REACHED_M = 2;
const MOVING_MPS = 1.5;
const PREJOIN_OFFROUTE_M = 120; // before first joining the line (car parks, driveways)
const ARRIVE_ALONG_M = 15;
const NEAR_END_ALONG_M = 300;
const LOOKAHEAD_M = 12;
const DEFAULT_ACCURACY_M = 20;
const MAX_DT_S = 60;
const SLACK_M = 30;

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

function durationModel(route) {
  const { steps } = route;
  const suffix = new Array(steps.length + 1).fill(0);
  for (let i = steps.length - 1; i >= 0; i--) suffix[i] = suffix[i + 1] + steps[i].duration;
  const total = suffix[0];
  return { suffix, scale: total > 0 ? route.duration / total : null };
}

function nextStepIndex(steps, along, from) {
  let i = Math.max(0, from);
  while (i < steps.length - 1 && steps[i].along <= along + STEP_REACHED_M) i++;
  return i;
}

function initialState() {
  return { along: 0, joined: false, offCount: 0, offRoute: false, stepIndex: -1, fired: [], arrived: false };
}

/**
 * @param {object} inputRoute Route (see CONTRACTS.md)
 * @param {{units?:string, now?:() => number, nav?:object}} [opts]
 */
export function createNavigator(inputRoute, { units = 'metric', now = () => Date.now(), nav = NAV } = {}) {
  let route = normalizeRoute(inputRoute);
  let segBearing = segmentBearings(route.geometry);
  let durations = durationModel(route);
  let total = route.cum[route.cum.length - 1];
  let st = initialState();
  let unitsNow = units;
  let lastFix = null; // {t, point, speed}
  let last = null;

  function routeBearingAt(along) {
    const a = pointAlong(route.geometry, route.cum, along);
    const b = pointAlong(route.geometry, route.cum, Math.min(total, along + LOOKAHEAD_M));
    if (haversine(a.point, b.point) > 1) return bearing(a.point, b.point);
    return segBearing[a.index] ?? 0;
  }

  function remainingDuration(along, stepIndex) {
    const { steps } = route;
    const left = Math.max(0, total - along);
    if (!durations.scale) return total > 0 ? route.duration * (left / total) : 0;
    let rem = durations.suffix[stepIndex] ?? 0;
    const k = stepIndex - 1;
    if (k >= 0) {
      const span = steps[stepIndex].along - steps[k].along;
      const frac = span > 0 ? clamp((steps[stepIndex].along - along) / span, 0, 1) : 0;
      rem += frac * steps[k].duration;
    }
    return rem * durations.scale;
  }

  function buildProgress({ along, stepIndex, point, onRoute, minDist, speed, accuracy, t }) {
    const steps = route.steps;
    const step = steps[stepIndex];
    const durationRemaining = remainingDuration(along, stepIndex);
    return Object.freeze({
      routeId: route.id,
      snapped: point,
      along,
      total,
      offRouteMeters: minDist,
      onRoute,
      offRoute: st.offRoute,
      distanceRemaining: Math.max(0, total - along),
      durationRemaining,
      eta: now() + durationRemaining * 1000,
      stepIndex,
      distanceToManeuver: Math.max(0, (step?.along ?? total) - along),
      currentRoad: steps[stepIndex - 1]?.road ?? '',
      speed,
      bearing: routeBearingAt(along),
      accuracy,
      arrived: st.arrived,
      timestamp: t,
    });
  }

  function speedOf(fix, t, point) {
    if (isNum(fix.speed) && fix.speed >= 0) return fix.speed;
    if (!lastFix) return 0;
    const dt = (t - lastFix.t) / 1000;
    if (dt > 0.5 && dt <= MAX_DT_S) return haversine(lastFix.point, point) / dt;
    return lastFix.speed;
  }

  function match(point, heading, speed, accuracy, dt) {
    const threshold = Math.max(nav.offRouteMeters, accuracy * 1.5);
    const ahead = speed * dt * 2 + 100 + accuracy;
    const m = matchOnRoute(route, segBearing, {
      point, heading, speed, lastAlong: st.along, ahead, expectedAdvance: speed * dt, slack: SLACK_M + accuracy, threshold,
    });
    return { m, threshold };
  }

  function trackOffRoute(m, onRoute, threshold, speed, events) {
    if (onRoute) {
      st = { ...st, joined: true, offCount: 0, offRoute: false };
      return;
    }
    const offThreshold = st.joined ? threshold : Math.max(threshold, PREJOIN_OFFROUTE_M);
    if (m.minDist > offThreshold && speed >= MOVING_MPS) st = { ...st, offCount: st.offCount + 1 };
    if (!st.offRoute && st.offCount >= nav.offRouteFixes) {
      st = { ...st, offRoute: true };
      events.push({ type: 'offroute', distance: m.minDist });
    }
  }

  function checkArrival(point, along, onRoute, events) {
    if (st.arrived) return;
    const start = route.geometry[0];
    const end = route.geometry[route.geometry.length - 1];
    // Proximity counts only near the end of the line, or when parked off it (car park beside the
    // destination) — never while driving past the destination earlier in the route or at the
    // start of a round trip.
    const offLineNear = !onRoute && (along >= total * 0.5 || haversine(point, start) > nav.arriveMeters * 2);
    const nearEnd = haversine(point, end) <= nav.arriveMeters && (along >= total - NEAR_END_ALONG_M || offLineNear);
    const alongEnd = onRoute && along >= total - ARRIVE_ALONG_M;
    if (nearEnd || alongEnd) {
      st = { ...st, arrived: true };
      events.push({ type: 'arrive' });
    }
  }

  /** Feed one fix. Returns {progress, events}. Invalid fixes return the last progress. */
  function update(fix) {
    if (!fix || !isNum(fix.lng) || !isNum(fix.lat)) return { progress: last ?? initialProgress(), events: [] };
    if (st.arrived && last) return { progress: last, events: [] };
    const events = [];
    const t = isNum(fix.timestamp) ? fix.timestamp : now();
    const point = [fix.lng, fix.lat];
    const accuracy = isNum(fix.accuracy) && fix.accuracy > 0 ? fix.accuracy : DEFAULT_ACCURACY_M;
    const dt = lastFix ? clamp((t - lastFix.t) / 1000, 0, MAX_DT_S) : 0;
    const speed = speedOf(fix, t, point);
    const heading = isNum(fix.heading) ? fix.heading : null;
    lastFix = { t, point, speed };

    const { m, threshold } = match(point, heading, speed, accuracy, dt);
    const onRoute = m.scope !== 'none' && m.dist <= threshold;
    let along = st.along;
    if (onRoute) along = m.along < st.along && st.along - m.along < HOLD_BACK_M ? st.along : m.along;
    trackOffRoute(m, onRoute, threshold, speed, events);

    const stepIndex = nextStepIndex(route.steps, along, st.stepIndex);
    if (stepIndex !== st.stepIndex) {
      st = { ...st, stepIndex, fired: [] };
      events.push({ type: 'step', index: stepIndex, step: route.steps[stepIndex], nextStep: route.steps[stepIndex + 1] ?? null });
    }
    st = { ...st, along };

    const snapped = onRoute && along === m.along ? m.point : pointAlong(route.geometry, route.cum, along).point;
    checkArrival(point, along, onRoute, events);
    const progress = buildProgress({ along, stepIndex, point: snapped, onRoute, minDist: m.minDist, speed, accuracy, t });

    if (onRoute && !st.offRoute && !st.arrived) {
      const a = planAnnouncement({
        steps: route.steps, stepIndex, distance: progress.distanceToManeuver, speed, units: unitsNow, fired: st.fired,
      });
      if (a) {
        st = { ...st, fired: [...new Set([...st.fired, ...a.marks])] };
        events.push({ type: 'announce', text: a.text, priority: a.priority, tier: a.tier, stepIndex });
      }
    }
    last = progress;
    return { progress, events };
  }

  function initialProgress() {
    const stepIndex = nextStepIndex(route.steps, 0, 0);
    return buildProgress({
      along: 0, stepIndex, point: route.geometry[0], onRoute: true, minDist: 0, speed: lastFix?.speed ?? 0, accuracy: null, t: now(),
    });
  }

  /** Swap in a new route (after re-routing). Returns the new initial progress. */
  function replaceRoute(next) {
    const normalized = normalizeRoute(next);
    route = normalized;
    segBearing = segmentBearings(route.geometry);
    durations = durationModel(route);
    total = route.cum[route.cum.length - 1];
    st = initialState();
    last = initialProgress();
    return last;
  }

  return Object.freeze({
    update,
    replaceRoute,
    /** Latest progress (or the starting progress before any fix). */
    progress: () => last ?? initialProgress(),
    /** The normalised route being driven. */
    route: () => route,
    setUnits(u) {
      unitsNow = u === 'imperial' ? 'imperial' : 'metric';
    },
  });
}

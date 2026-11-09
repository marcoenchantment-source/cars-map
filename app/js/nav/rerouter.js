// Re-routing: asks the search module's `computeRoutes` for a new route from the car's position,
// with a cooldown after success, retry backoff after failure, a timeout, and clear notices.

const TIMEOUT_MS = 15000;
const BACKOFF_MS = [4000, 8000, 15000, 30000];
const NOTICE_ID = 'nav-reroute';

function withTimeout(promise, ms) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error('The route service took too long to answer.')), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/** First drivable route from whatever computeRoutes returned (array or single route). */
export function pickRoute(result) {
  const list = Array.isArray(result) ? result : result ? [result] : [];
  return list.find((r) => r && Array.isArray(r.geometry) && r.geometry.length >= 2) ?? null;
}

/**
 * @param {object} ctx app context
 * @param {{ voice, isOffRoute:() => boolean, isActive:() => boolean, getFix:() => object|null,
 *           getDestination:() => object|null, onRoute:(route) => void, onState:(busy:boolean) => void }} deps
 */
export function createRerouter({ actions, store, ui, config }, deps) {
  const cooldown = config.NAV.rerouteCooldownMs;
  let busy = false;
  let lastSuccessAt = -Infinity;
  let attempt = 0;
  let timer = null;
  let notice = null;
  let waitingForSignal = false;

  function setNotice(opts) {
    notice?.close();
    notice = ui.notice({ id: NOTICE_ID, iconName: 'route', ms: 0, ...opts });
  }

  function clearNotice() {
    notice?.close();
    notice = null;
  }

  function schedule(ms) {
    clearTimeout(timer);
    timer = setTimeout(() => request(), Math.max(0, ms));
  }

  function fail(err) {
    attempt += 1;
    const delay = BACKOFF_MS[Math.min(attempt - 1, BACKOFF_MS.length - 1)];
    const offline = !store.get().online;
    waitingForSignal = offline;
    console.warn('[nav] re-route failed', err?.message ?? err);
    const body = offline
      ? "No signal. I'll find a new route as soon as you're back online. Keep driving safely."
      : `${err?.message || 'The route service is busy.'} Trying again in ${Math.round(delay / 1000)} s.`;
    setNotice({ tone: 'warn', title: "Couldn't re-route yet", body, actions: [{ label: 'Try now', primary: true, onClick: () => request(true) }] });
    if (!offline) schedule(delay);
  }

  async function fetchRoute() {
    if (!actions.has('computeRoutes')) throw new Error('Route search is not available right now.');
    const fix = deps.getFix();
    const dest = deps.getDestination();
    if (!fix || !dest) throw new Error('Waiting for your position.');
    const bearing = Number.isFinite(fix.heading) ? fix.heading : undefined;
    const result = await withTimeout(actions.call('computeRoutes', [fix.lng, fix.lat], dest, { bearing }), TIMEOUT_MS);
    const route = pickRoute(result);
    if (!route) throw new Error('No new route came back.');
    return route;
  }

  /** Start (or retry) a re-route. `force` skips the cooldown (user tapped "Try now"). */
  async function request(force = false) {
    clearTimeout(timer);
    timer = null;
    if (busy || !deps.isActive() || !deps.isOffRoute()) return;
    const wait = lastSuccessAt + cooldown - Date.now();
    if (wait > 0 && !force) {
      deps.onState(true);
      schedule(wait);
      return;
    }
    busy = true;
    deps.onState(true);
    if (attempt === 0) setNotice({ tone: 'info', title: 'Re-routing…', body: 'Finding a new way from here.' });
    try {
      const route = await fetchRoute();
      if (!deps.isActive() || !deps.isOffRoute()) return;
      lastSuccessAt = Date.now();
      attempt = 0;
      waitingForSignal = false;
      deps.onRoute(route);
      clearNotice();
    } catch (err) {
      if (deps.isActive() && deps.isOffRoute()) fail(err);
    } finally {
      busy = false;
      deps.onState(deps.isActive() && deps.isOffRoute() && (timer != null || waitingForSignal));
    }
  }

  store.select(
    (s) => s.online,
    (online) => {
      if (online && waitingForSignal) request(true);
    },
  );

  return Object.freeze({
    request,
    /** The car found its way back onto the route by itself. */
    backOnRoute() {
      clearTimeout(timer);
      timer = null;
      attempt = 0;
      waitingForSignal = false;
      clearNotice();
      deps.onState(false);
    },
    cancel() {
      clearTimeout(timer);
      timer = null;
      attempt = 0;
      waitingForSignal = false;
      clearNotice();
    },
  });
}

// Real GPS: watchPosition, status reporting, the location-permission banner and a watchdog that
// restarts the watch after signal loss or when the page comes back to the foreground.
// Accepted fixes go out as `gps:fix`; while a simulation runs (`gps:sim` active) real fixes are ignored.
import { createFixGate, fixFromPosition } from './fixFilter.js';

const WATCH_OPTIONS = Object.freeze({ enableHighAccuracy: true, maximumAge: 1000, timeout: 15000 });
const LOST_AFTER_MS = 25000;
const WATCHDOG_MS = 10000;
const MIN_RESTART_GAP_MS = 20000;
const PROMPT_BANNER_DELAY_MS = 8000;

const IS_IOS = /iPhone|iPad|iPod/.test(globalThis.navigator?.userAgent ?? '');
const MSG = Object.freeze({
  denied: IS_IOS
    ? "Location is blocked for this site. Allow it in your browser's site settings, then reload. On iPhone also check Settings › Privacy & Security › Location Services › Safari Websites."
    : "Location is blocked for this site. Allow it in your browser's site settings, then reload.",
  unavailable: "Can't get a GPS fix. Check Location Services is on and you can see the sky, then try again.",
  insecure: 'Location only works over a secure link. Open Cars Map from its https:// address.',
  missing: "This browser can't share your location. Try Safari or Chrome.",
  prompt: 'Turn on location so Cars Map can find you and guide you.',
  searching: 'Looking for GPS…',
  lost: 'GPS signal lost. Looking again…',
});

export function createGps({ bus, ui }) {
  const geo = globalThis.navigator?.geolocation;
  const gate = createFixGate();
  const banner = {
    root: document.getElementById('loc-banner'),
    text: document.getElementById('loc-banner-text'),
    btn: document.getElementById('loc-banner-btn'),
  };
  let watchId = null;
  let state = null;
  let message = '';
  let simActive = false;
  let lastFixAt = 0;
  let startedAt = 0;
  let hadFix = false;
  let permission = 'unknown';

  function showBanner() {
    if (!banner.root) return;
    const blocking = ['denied', 'unavailable'].includes(state);
    const promptLate = state === 'searching' && !hadFix && permission !== 'granted' && Date.now() - startedAt > PROMPT_BANNER_DELAY_MS;
    // Never cover an open sheet (the banner sits above it); it comes back when the sheet closes.
    const visible = !simActive && !ui.sheet.currentId() && (blocking || promptLate);
    banner.root.hidden = !visible;
    if (!visible) return;
    banner.text.textContent = blocking ? message : MSG.prompt;
    banner.btn.textContent = blocking ? 'Try again' : 'Allow';
  }

  function setStatus(next, msg = '') {
    if (state === next && message === msg) return;
    state = next;
    message = msg;
    bus.emit('gps:status', msg ? { state: next, message: msg } : { state: next });
    showBanner();
  }

  function onPosition(pos) {
    const fix = fixFromPosition(pos);
    if (!fix) return;
    lastFixAt = Date.now();
    hadFix = true;
    if (state !== 'ok') setStatus('ok');
    if (simActive || !gate.accept(fix)) return;
    bus.emit('gps:fix', fix);
  }

  function onError(err) {
    if (err?.code === 1) {
      stopWatch();
      setStatus('denied', MSG.denied);
    } else if (err?.code === 2) {
      setStatus('unavailable', MSG.unavailable);
    } else if (!hadFix || Date.now() - lastFixAt > LOST_AFTER_MS) {
      setStatus('searching', hadFix ? MSG.lost : MSG.searching);
    }
  }

  function stopWatch() {
    if (watchId != null && geo) geo.clearWatch(watchId);
    watchId = null;
  }

  function start() {
    if (!globalThis.isSecureContext) return setStatus('unavailable', MSG.insecure);
    if (!geo) return setStatus('unavailable', MSG.missing);
    stopWatch();
    startedAt = Date.now();
    if (!hadFix) setStatus('searching', MSG.searching);
    try {
      watchId = geo.watchPosition(onPosition, onError, WATCH_OPTIONS);
    } catch (err) {
      console.error('[gps] watchPosition failed', err);
      setStatus('unavailable', MSG.unavailable);
    }
    setTimeout(showBanner, PROMPT_BANNER_DELAY_MS + 200);
  }

  /** From a tap: ask once directly (iPhone re-prompts only from a gesture), then restart the watch. */
  function retryFromGesture() {
    if (!geo) return;
    try {
      geo.getCurrentPosition(onPosition, onError, { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 });
    } catch (err) {
      console.error('[gps] getCurrentPosition failed', err);
    }
    start();
  }

  function watchdog() {
    if (simActive || state === 'denied' || document.visibilityState !== 'visible') return;
    const quiet = Date.now() - Math.max(lastFixAt, startedAt);
    if (quiet < LOST_AFTER_MS) return;
    if (hadFix) setStatus('searching', MSG.lost);
    if (Date.now() - startedAt > MIN_RESTART_GAP_MS) start();
  }

  async function watchPermission() {
    try {
      const status = await navigator.permissions?.query({ name: 'geolocation' });
      if (!status) return;
      permission = status.state;
      if (status.state === 'denied') setStatus('denied', MSG.denied);
      status.addEventListener?.('change', () => {
        permission = status.state;
        if (status.state === 'granted') start();
        else if (status.state === 'denied') setStatus('denied', MSG.denied);
      });
    } catch {
      /* Permissions API missing (older Safari): watchPosition errors tell us instead. */
    }
  }

  banner.btn?.addEventListener('click', retryFromGesture);
  document.addEventListener('carsmap:sheet', () => setTimeout(showBanner, 0));
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && state !== 'denied' && Date.now() - lastFixAt > 5000) start();
  });
  bus.on('gps:sim', (p) => {
    simActive = !!p?.active;
    if (!simActive) gate.reset();
    showBanner();
  });
  setInterval(watchdog, WATCHDOG_MS);

  watchPermission();
  start();

  return Object.freeze({ status: () => state, retry: retryFromGesture });
}

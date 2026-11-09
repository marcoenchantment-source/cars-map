// Boot: store, bus, map, then every feature module. A module that fails to load is logged
// and skipped, so one broken feature can never take navigation down with it.
import { createStore } from './core/store.js';
import { createBus } from './core/bus.js';
import { createActions } from './core/actions.js';
import * as storage from './core/storage.js';
import * as geo from './core/geo.js';
import * as ui from './ui/ui.js';
import * as config from './config.js';
import { createMapView } from './map/mapView.js';
import { initTheme, resolveTheme } from './ui/theme.js';
import { initSettings } from './settings/settings.js';
import { initViewModes } from './map/viewModes.js';
import { initWeather } from './map/weather.js';

/** Load order matters only for dock/fab order ties; each module is independent. */
const FEATURE_MODULES = [
  './nav/index.js', // GPS, navigation engine, voice, HUD
  './search/index.js', // search, routing, route preview
  './car/index.js', // 3D car, flames, garage
  './social/index.js', // friends, chat, hazards, road changes
  './history/index.js', // trips, driven roads
  './race/index.js', // track day
  './assistant/index.js', // voice copilot
];

const INTRO_WAIT_MS = 3500;

function initialState() {
  const settings = { ...config.DEFAULT_SETTINGS, ...storage.load('settings', {}) };
  const car = { ...config.DEFAULT_CAR, ...storage.load('car', {}) };
  return {
    mode: 'explore', // explore | preview | navigate | race
    follow: true, // camera follows the car
    theme: resolveTheme(settings.theme, null, null),
    settings,
    car,
    position: null, // latest raw GPS fix {lng, lat, accuracy, speed, heading, timestamp, simulated}
    destination: null, // Place
    routes: [], // Route[] being previewed
    selectedRoute: 0,
    activeRoute: null, // Route being driven
    progress: null, // NavProgress
    online: navigator.onLine,
  };
}

async function waitForMapLibre() {
  if (window.maplibregl) return;
  await new Promise((resolve) => window.addEventListener('load', resolve, { once: true }));
  if (!window.maplibregl) throw new Error('The map library did not load.');
}

function showFatal(message) {
  const app = document.getElementById('app');
  const box = ui.el(
    'div',
    { class: 'loc-banner', role: 'alert', style: { bottom: '40%' } },
    ui.el('p', { text: message }),
    ui.el('button', { type: 'button', class: 'btn btn-accent btn-sm', text: 'Reload', on: { click: () => location.reload() } }),
  );
  app?.append(box);
}

async function loadModules(ctx) {
  // Download every module in parallel (one slow round trip, not seven), then start them in order.
  const loaded = await Promise.all(
    FEATURE_MODULES.map((path) =>
      import(path).catch((err) => {
        console.error(`[boot] module ${path} failed to load`, err);
        return null;
      }),
    ),
  );
  for (const [i, mod] of loaded.entries()) {
    if (!mod) continue;
    try {
      await mod.init(ctx);
    } catch (err) {
      console.error(`[boot] module ${FEATURE_MODULES[i]} failed to start`, err);
    }
  }
}

function registerServiceWorker() {
  if (!('serviceWorker' in navigator) || location.protocol !== 'https:') return;
  navigator.serviceWorker.register('sw.js').catch((err) => console.warn('[sw] registration failed', err));
}

async function boot() {
  ui.initSheet();
  const store = createStore(initialState());
  const bus = createBus();
  const actions = createActions();

  store.select((s) => s.settings, (v) => storage.save('settings', v));
  store.select((s) => s.car, (v) => storage.save('car', v));
  store.select(
    (s) => s.mode,
    (mode) => {
      document.getElementById('app').dataset.mode = mode;
      ui.applyModeVisibility(mode);
      bus.emit('mode:change', { mode });
    },
    { immediate: true },
  );
  document.addEventListener('carsmap:sheet', (e) => document.body.classList.toggle('sheet-open', e.detail.open));

  window.addEventListener('online', () => {
    store.set({ online: true });
    ui.toast('Back online', { tone: 'good' });
  });
  window.addEventListener('offline', () => {
    store.set({ online: false });
    ui.toast('No signal. Your route keeps working; new searches wait for signal.', { tone: 'warn', ms: 5000 });
  });

  initTheme({ store, bus });

  try {
    await waitForMapLibre();
  } catch (err) {
    console.error(err);
    showFatal('The map could not load. Check your connection and reload.');
    return;
  }

  const mapView = createMapView(document.getElementById('map'), { store, bus, ui, config });
  const ctx = Object.freeze({ store, bus, ui, geo, storage, config, actions, map: mapView.map, mapView });

  initSettings(ctx);
  for (const [name, start] of [['map views', initViewModes], ['weather', initWeather]]) {
    try {
      start(ctx);
    } catch (err) {
      console.error(`[boot] ${name} failed to start`, err);
    }
  }
  actions.register('setMapView', (view) => store.set((s) => ({ settings: { ...s.settings, mapView: view } })));
  actions.register('recenter', () => mapView.camera.recenter());
  actions.register('openMapOptions', () => bus.emit('map:options'));

  // God's-eye intro: wait briefly for the first GPS fix, then fly down to it.
  const firstFix = new Promise((resolve) =>
    bus.once('gps:fix', (f) => {
      const status = document.getElementById('intro-status');
      if (status) status.textContent = 'Locked on';
      resolve([f.lng, f.lat]);
    }),
  );
  const timeout = new Promise((resolve) => setTimeout(() => resolve(null), INTRO_WAIT_MS));
  Promise.race([firstFix, timeout]).then((center) => mapView.land(center ?? config.DEFAULT_CENTER));

  registerServiceWorker(); // early, so the offline copy is saved even if the signal drops mid-load
  await loadModules(ctx);

  if (['localhost', '127.0.0.1'].includes(location.hostname) || new URLSearchParams(location.search).has('debug')) {
    window.__carsmap = ctx; // dev inspection only
  }
  bus.emit('app:ready', {});
}

boot().catch((err) => {
  console.error('[boot] failed', err);
  showFatal('Cars Map hit a problem while starting. Reload to try again.');
});

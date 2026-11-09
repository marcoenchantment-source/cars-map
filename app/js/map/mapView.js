// The map: creation, the god's-eye intro, theme repaint, camera, route drawing and the
// helpers every feature module uses (ready promise, fitBounds that respects the HUD, markers).
import { buildStyle, applyTheme, setBuildings3d } from './style.js';
import { createCamera } from './camera.js';
import { createRouteLayer } from './routeLayer.js';
import { initMapOptions } from './mapOptions.js';

const LONG_PRESS_MS = 550;

function checkeredFlagEl() {
  const node = document.createElement('div');
  node.className = 'dest-marker';
  // Static trusted SVG: checkered flag on a pin.
  node.innerHTML =
    '<svg viewBox="0 0 40 52" width="40" height="52" aria-hidden="true">' +
    '<path d="M20 51C20 51 4 33 4 20a16 16 0 0 1 32 0c0 13-16 31-16 31z" fill="#1d1b24" stroke="#fff" stroke-width="2.5"/>' +
    '<g transform="translate(11 10)"><rect width="18" height="13" fill="#fff"/>' +
    '<path fill="#1d1b24" d="M0 0h4.5v4.33H0zM9 0h4.5v4.33H9zM4.5 4.33H9v4.33H4.5zM13.5 4.33H18v4.33h-4.5zM0 8.66h4.5V13H0zM9 8.66h4.5V13H9z"/>' +
    '<rect x="-1.6" y="-1" width="1.8" height="18" rx=".9" fill="#ff8a00"/></g></svg>';
  return node;
}

/**
 * @param {HTMLElement} container
 * @param {{store, bus, ui, config}} deps
 */
export function createMapView(container, { store, bus, ui, config }) {
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const { settings, theme } = store.get();
  const useGlobeIntro = !reduceMotion;

  const map = new maplibregl.Map({
    container,
    style: buildStyle(theme, { buildings3d: settings.buildings3d, globe: useGlobeIntro }),
    center: useGlobeIntro ? [128, -26] : config.DEFAULT_CENTER,
    zoom: useGlobeIntro ? 1.7 : config.DEFAULT_ZOOM,
    pitch: 0,
    bearing: 0,
    maxPitch: 72,
    attributionControl: { compact: true },
    canvasContextAttributes: { antialias: true },
    fadeDuration: 120,
  });

  let resolveReady;
  const ready = new Promise((resolve) => (resolveReady = resolve));
  map.on('load', () => resolveReady(map));
  map.on('error', (e) => console.warn('[map]', e?.error?.message ?? e));

  const camera = createCamera(map, { store, bus });
  const routes = createRouteLayer(map, { bus });
  ready.then(() => routes.install());

  // Keep the map credits folded into the small "i" button (MapLibre opens them on load).
  const foldAttribution = () => {
    const attrib = container.querySelector('.maplibregl-ctrl-attrib');
    attrib?.classList.remove('maplibregl-compact-show');
    attrib?.removeAttribute('open');
  };
  ready.then(() => setTimeout(foldAttribution, 0));
  store.select((s) => s.mode, foldAttribution);

  // ---- theme & buildings
  store.select((s) => s.theme, (t) => ready.then(() => applyTheme(map, t, { buildings3d: store.get().settings.buildings3d })));
  store.select((s) => s.settings.buildings3d, (on) => ready.then(() => setBuildings3d(map, store.get().theme, on)));

  // ---- destination flag
  let destMarker = null;
  function setDestination(place) {
    destMarker?.remove();
    destMarker = null;
    if (!place) return;
    destMarker = new maplibregl.Marker({ element: checkeredFlagEl(), anchor: 'bottom' }).setLngLat([place.lng, place.lat]).addTo(map);
  }

  // ---- padding-aware fit
  function hudPadding() {
    const cover = ui.sheet.coverage();
    const topHud = document.querySelector('.hud-top')?.getBoundingClientRect().bottom ?? 80;
    const w = container.clientWidth;
    const h = container.clientHeight;
    const pad = {
      top: Math.min(h * 0.4, topHud + 24),
      bottom: Math.min(h * 0.5, Math.max(cover.bottom, 110) + 24),
      left: Math.min(w * 0.6, cover.left + 32),
      right: Math.min(w * 0.3, 76),
    };
    return pad;
  }
  function fitBounds(bbox, { maxZoom = 16.5, duration = 900 } = {}) {
    if (!bbox || !bbox.every(Number.isFinite)) return;
    map.fitBounds([[bbox[0], bbox[1]], [bbox[2], bbox[3]]], {
      padding: hudPadding(),
      maxZoom,
      duration: reduceMotion ? 0 : duration,
      pitch: 0,
      bearing: 0,
    });
  }

  // ---- long press → drop a pin (search module listens)
  let pressTimer = null;
  let pressStart = null;
  map.on('touchstart', (e) => {
    if (e.originalEvent.touches?.length !== 1) return;
    pressStart = e.point;
    clearTimeout(pressTimer);
    pressTimer = setTimeout(() => bus.emit('map:longpress', { lngLat: [e.lngLat.lng, e.lngLat.lat] }), LONG_PRESS_MS);
  });
  map.on('touchmove', (e) => {
    if (pressStart && Math.hypot(e.point.x - pressStart.x, e.point.y - pressStart.y) > 10) clearTimeout(pressTimer);
  });
  map.on('touchend', () => clearTimeout(pressTimer));
  map.on('touchcancel', () => clearTimeout(pressTimer));
  map.on('contextmenu', (e) => bus.emit('map:longpress', { lngLat: [e.lngLat.lng, e.lngLat.lat] }));

  // ---- intro: fly from orbit down to the driver
  let introDone = false;
  // Camera moves work before the style finishes loading, so the flight starts at once;
  // only the projection switch waits for the style. The overlay always clears within ~4.5 s.
  function land(center) {
    const finish = () => {
      if (introDone) return;
      introDone = true;
      document.getElementById('intro')?.classList.add('done');
      setTimeout(() => document.getElementById('intro')?.remove(), 1000);
      ready.then(() => {
        if (!useGlobeIntro) return;
        try {
          map.setProjection({ type: 'mercator' });
        } catch (err) {
          console.warn('[map] projection switch failed', err);
        }
      });
      bus.emit('map:landed', { center });
    };
    if (!useGlobeIntro) {
      map.jumpTo({ center, zoom: 16, pitch: 45 });
      finish();
      return;
    }
    map.once('moveend', finish);
    map.flyTo({ center, zoom: 16.2, pitch: 52, bearing: -18, duration: 3600, curve: 1.5, essential: true });
    setTimeout(finish, 4500); // safety net if moveend never fires
  }
  document.addEventListener('carsmap:sheet', () => {
    if (!introDone) document.getElementById('intro')?.classList.add('done');
  });

  // ---- floating buttons
  const recenterBtn = ui.addFab({
    id: 'recenter', icon: 'locate', label: 'Re-centre on my car', order: 10, tone: 'dark',
    onClick: () => {
      if (!camera.pose()) {
        ui.toast('Waiting for your location…');
        return;
      }
      camera.recenter();
    },
  });
  const compassBtn = ui.addFab({
    id: 'compass', icon: 'compass', label: 'Point north', order: 5, modes: ['explore', 'preview'],
    onClick: () => map.easeTo({ bearing: 0, duration: 600 }),
  });

  // 2D/3D: one tap tilts between the 3D chase view and a flat top-down map (remembered).
  const tiltBtn = ui.addFab({
    id: 'tilt', icon: 'cube', label: 'Switch 2D / 3D view', order: 6,
    onClick: () => store.set((s) => ({ settings: { ...s.settings, view3d: s.settings.view3d === false } })),
  });
  const syncTilt = (on) => {
    const is3d = on !== false;
    tiltBtn.replaceChildren(ui.icon(is3d ? 'flat' : 'cube', { size: 24 }));
    tiltBtn.setAttribute('aria-label', is3d ? 'Switch to flat 2D map' : 'Switch to 3D view');
    tiltBtn.title = tiltBtn.getAttribute('aria-label');
  };
  syncTilt(store.get().settings.view3d);
  store.select((s) => s.settings.view3d, syncTilt);
  const syncButtons = () => {
    recenterBtn.hidden = store.get().follow && !!camera.pose();
    const b = map.getBearing();
    compassBtn.hidden = Math.abs(b) < 1 && map.getPitch() < 1;
    compassBtn.querySelector('svg').style.transform = `rotate(${-b}deg)`;
  };
  store.select((s) => s.follow, syncButtons);
  map.on('rotate', syncButtons);
  map.on('pitch', syncButtons);
  bus.on('pose', () => {
    if (recenterBtn.hidden !== (store.get().follow && true)) syncButtons();
  });
  syncButtons();

  const view = Object.freeze({
    map,
    ready,
    camera,
    routes,
    land,
    fitBounds,
    hudPadding,
    setDestination,
    reduceMotion,
  });
  initMapOptions(view, { store, bus, ui, config });
  return view;
}

// Search + routing module: "Where to?" pill, place search, route preview, dropped pins,
// and the search/route actions other modules (nav rerouting, the copilot) call.
import { computeRoutes } from '../routing/router.js';
import * as geocoder from './geocoder.js';
import { createPlaceMemory } from './memory.js';
import { sanitizePlace } from './places.js';
import { createSearchUi } from './searchUi.js';
import { createPreview } from './preview.js';
import { createPinDrop } from './pin.js';

const LOCAL_ZOOM = 9; // below this the map centre is too vague to route from
const validPoint = (p) => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1]) && Math.abs(p[0]) <= 180 && Math.abs(p[1]) <= 90;

export async function init(ctx) {
  const { store, ui, config, actions, storage, map } = ctx;
  const endpoints = config.ENDPOINTS;
  const memory = createPlaceMemory(storage);

  /**
   * Where routes start and searches are biased: the GPS fix, else the map centre once the map
   * shows a local area (during the globe intro the centre is the middle of Australia).
   */
  function here() {
    const pos = store.get().position;
    if (pos && validPoint([pos.lng, pos.lat])) return { point: [pos.lng, pos.lat], fromGps: true, heading: pos.heading };
    const c = map.getCenter();
    const local = map.getZoom() >= LOCAL_ZOOM && validPoint([c.lng, c.lat]);
    return { point: local ? [c.lng, c.lat] : [...config.DEFAULT_CENTER], fromGps: false, heading: null };
  }

  const services = Object.freeze({
    search: (q, { near, limit, signal, fallbackOnEmpty } = {}) =>
      geocoder.searchPlaces(q, {
        near: validPoint(near) ? near : here().point, limit, signal, endpoints, fallbackOnEmpty,
        tomtomKey: store.get().settings.tomtomKey || '',
      }),
    searchCategory: (id, { near, limit, signal } = {}) =>
      geocoder.searchCategory(id, { near: validPoint(near) ? near : here().point, limit, signal, endpoints }),
    reverse: (point, { signal } = {}) => geocoder.reverseGeocode(point, { signal, endpoints }),
    routes: (from, to, { bearing, alternatives, signal } = {}) =>
      computeRoutes(from, to, { settings: store.get().settings, endpoints, bearing, alternatives, signal }),
  });

  const preview = createPreview(ctx, { services, memory, here });
  const openPreview = (place) => {
    preview.open(place).catch(() => {}); // the sheet shows the error and a retry button
  };
  createSearchUi(ctx, { services, memory, here, onPick: openPreview });
  createPinDrop(ctx, { services, memory, openPreview });

  const goTo = (slot) => {
    const place = slot === 'home' ? memory.home() : memory.work();
    if (!place) {
      const name = slot === 'home' ? 'Home' : 'Work';
      throw new Error(`${name} isn’t set yet. Search for the address, then tap Save as ${name}.`);
    }
    return preview.open(place);
  };

  actions.register('search', (query, { near, limit } = {}) => services.search(String(query ?? ''), { near, limit, fallbackOnEmpty: true }));
  actions.register('reverseGeocode', (point) => {
    if (!validPoint(point)) return Promise.reject(new Error('That spot has no usable location.'));
    return services.reverse(point);
  });
  actions.register('planRoute', (place) => preview.open(place));
  actions.register('computeRoutes', (from, to, opts = {}) => services.routes(from, to, opts));
  actions.register('routeTo', async (query) => {
    const q = String(query ?? '').trim();
    if (!q) throw new Error('Tell me where to go, for example “Fremantle Markets”.');
    const results = await services.search(q, { limit: 5, fallbackOnEmpty: true });
    if (!results.length) throw new Error(`I couldn’t find “${q}” near you. Try adding the suburb.`);
    await preview.open(results[0]);
    return results[0];
  });
  actions.register('setHome', (place) => memory.setHome(sanitizePlace(place)));
  actions.register('setWork', (place) => memory.setWork(sanitizePlace(place)));
  actions.register('goHome', () => goTo('home'));
  actions.register('goWork', () => goTo('work'));

  // Keep the pill reachable if the map isn't ready yet: nothing here needs map layers.
  if (!document.getElementById('search-slot')) ui.toast('Search couldn’t load. Reload the app.', { tone: 'bad' });
}

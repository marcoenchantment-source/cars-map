// "Roads I have driven": every saved trip drawn as a soft violet glow under the route layers,
// plus a crisp highlight for the trip picked in the logbook.
const SRC = 'cm-driven';
const GLOW = 'cm-driven-glow';
const MAIN = 'cm-driven';
const HL_CASING = 'cm-driven-highlight-casing';
const HL = 'cm-driven-highlight';
const OUR_LAYERS = [GLOW, MAIN, HL_CASING, HL];
const ROUTES_BOTTOM = 'cm-routes-alt-casing';
const LABELS = 'label-road';

const COLORS = Object.freeze({
  light: { trail: '#7b4dff', highlight: '#5f2fe8', casing: '#ffffff' },
  dark: { trail: '#b398ff', highlight: '#c9b6ff', casing: '#14111c' },
});
const NONE_FILTER = ['==', ['get', 'id'], ''];

function toCollection(trips) {
  return {
    type: 'FeatureCollection',
    features: trips.map((t) => ({ type: 'Feature', properties: { id: t.id }, geometry: { type: 'LineString', coordinates: t.line } })),
  };
}

function beforeId(map) {
  if (map.getLayer(ROUTES_BOTTOM)) return ROUTES_BOTTOM;
  return map.getLayer(LABELS) ? LABELS : undefined;
}

function addLayers(map, theme) {
  const c = COLORS[theme] ?? COLORS.light;
  const before = beforeId(map);
  const line = { 'line-cap': 'round', 'line-join': 'round' };
  map.addLayer({
    id: GLOW, type: 'line', source: SRC, layout: line,
    paint: { 'line-color': c.trail, 'line-opacity': 0.16, 'line-blur': 6, 'line-width': ['interpolate', ['linear'], ['zoom'], 8, 4, 14, 12, 18, 30] },
  }, before);
  map.addLayer({
    id: MAIN, type: 'line', source: SRC, layout: line,
    paint: { 'line-color': c.trail, 'line-opacity': 0.35, 'line-blur': 1.5, 'line-width': ['interpolate', ['linear'], ['zoom'], 8, 1.5, 14, 4, 18, 11] },
  }, before);
  map.addLayer({
    id: HL_CASING, type: 'line', source: SRC, layout: line, filter: NONE_FILTER,
    paint: { 'line-color': c.casing, 'line-opacity': 0.9, 'line-width': ['interpolate', ['linear'], ['zoom'], 8, 5, 14, 9, 18, 16] },
  }, before);
  map.addLayer({
    id: HL, type: 'line', source: SRC, layout: line, filter: NONE_FILTER,
    paint: { 'line-color': c.highlight, 'line-width': ['interpolate', ['linear'], ['zoom'], 8, 3, 14, 5.5, 18, 10] },
  }, before);
}

/**
 * @param {object} ctx app context
 * @param {{list: Function, subscribe: Function}} tripStore
 * @returns {Promise<{highlight: (id: string|null) => void}>}
 */
export async function createDrivenLayer(ctx, tripStore) {
  const { store, bus } = ctx;
  const map = await ctx.mapView.ready;
  let highlighted = null;

  map.addSource(SRC, { type: 'geojson', data: toCollection(tripStore.list()), tolerance: 0.6 });
  addLayers(map, store.get().theme);

  /** Keep the trail under the route lines even if they were installed after us. */
  function ensureOrder() {
    if (!map.getLayer(ROUTES_BOTTOM) || !map.getLayer(HL)) return;
    const order = map.getLayersOrder();
    if (order.indexOf(HL) < order.indexOf(ROUTES_BOTTOM)) return;
    for (const id of OUR_LAYERS) map.moveLayer(id, ROUTES_BOTTOM);
  }

  function applyVisibility() {
    const v = store.get().settings.showDrivenRoads ? 'visible' : 'none';
    map.setLayoutProperty(GLOW, 'visibility', v);
    map.setLayoutProperty(MAIN, 'visibility', v);
  }

  function applyColors(theme) {
    const c = COLORS[theme] ?? COLORS.light;
    map.setPaintProperty(GLOW, 'line-color', c.trail);
    map.setPaintProperty(MAIN, 'line-color', c.trail);
    map.setPaintProperty(HL_CASING, 'line-color', c.casing);
    map.setPaintProperty(HL, 'line-color', c.highlight);
  }

  function highlight(id) {
    highlighted = id || null;
    const filter = highlighted ? ['==', ['get', 'id'], highlighted] : NONE_FILTER;
    map.setFilter(HL_CASING, filter);
    map.setFilter(HL, filter);
  }

  const guard = (fn) => (...args) => {
    try {
      fn(...args);
    } catch (err) {
      console.error('[history] driven-roads layer update failed', err);
    }
  };

  applyVisibility();
  ensureOrder();
  tripStore.subscribe(guard((trips) => {
    map.getSource(SRC)?.setData(toCollection(trips));
    if (highlighted && !trips.some((t) => t.id === highlighted)) highlight(null);
  }));
  store.select((s) => s.settings.showDrivenRoads, guard(applyVisibility));
  store.select((s) => s.theme, guard(applyColors));
  for (const evt of ['route:ready', 'nav:start', 'mode:change']) bus.on(evt, guard(ensureOrder));
  setTimeout(guard(ensureOrder), 1500);

  return Object.freeze({ highlight: guard(highlight) });
}

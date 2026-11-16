// Route drawing: the "flame ribbon". The chosen route glows violet near the car and burns to
// flame orange at the destination; alternatives sit underneath in muted lavender.
import { sliceAlong } from '../core/geo.js';
import { ROUTE_BEFORE_ID } from './style.js';

const EMPTY = { type: 'FeatureCollection', features: [] };
const ACCENT = '#7b4dff';
const ACCENT_DARK = '#3c1fb0';
const FLAME = '#ff8a00';
const TRAFFIC_COLORS = { slow: '#f9a825', heavy: '#e53935', closed: '#7a1414' };

function lineFeature(coords, props = {}) {
  return { type: 'Feature', properties: props, geometry: { type: 'LineString', coordinates: coords } };
}

/**
 * Traffic colours for a route as GeoJSON; with `along` (metres driven), only the part still
 * ahead of the car, so slow/heavy stretches don't linger behind it.
 */
export function trafficFeatures(route, along = 0) {
  const segs = Array.isArray(route?.congestion) ? route.congestion : [];
  const canTrim = along > 0 && Array.isArray(route?.cum) && route.geometry?.length > 1;
  const features = segs
    .filter((s) => s.coords?.length > 1 && s.level !== 'free')
    .filter((s) => !canTrim || !Number.isFinite(s.to) || s.to > along)
    .map((s) => {
      const partly = canTrim && Number.isFinite(s.from) && s.from < along;
      return lineFeature(partly ? sliceAlong(route.geometry, route.cum, along, s.to) : s.coords, { level: s.level });
    })
    .filter((f) => f.geometry.coordinates.length > 1);
  return { type: 'FeatureCollection', features };
}

export function createRouteLayer(map, { bus }) {
  let installed = false;
  let flowTimer = null;
  let flowStep = 0;

  function install() {
    if (installed) return true;
    if (!map.isStyleLoaded()) return false;
    installed = true;
    map.addSource('cm-routes-alt', { type: 'geojson', data: EMPTY });
    map.addSource('cm-route', { type: 'geojson', data: EMPTY, lineMetrics: true });
    map.addSource('cm-route-traffic', { type: 'geojson', data: EMPTY });

    const before = map.getLayer(ROUTE_BEFORE_ID) ? ROUTE_BEFORE_ID : undefined;
    map.addLayer({
      id: 'cm-routes-alt-casing', type: 'line', source: 'cm-routes-alt',
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': '#6d6488', 'line-width': ['interpolate', ['linear'], ['zoom'], 10, 7, 16, 14], 'line-opacity': 0.55 },
    }, before);
    map.addLayer({
      id: 'cm-routes-alt-line', type: 'line', source: 'cm-routes-alt',
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': '#b7a8e6', 'line-width': ['interpolate', ['linear'], ['zoom'], 10, 4.5, 16, 9] },
    }, before);
    map.addLayer({
      id: 'cm-route-glow', type: 'line', source: 'cm-route',
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': ACCENT, 'line-width': ['interpolate', ['linear'], ['zoom'], 10, 14, 16, 30], 'line-blur': 10, 'line-opacity': 0.35 },
    }, before);
    map.addLayer({
      id: 'cm-route-casing', type: 'line', source: 'cm-route',
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': ACCENT_DARK, 'line-width': ['interpolate', ['linear'], ['zoom'], 10, 8, 16, 17] },
    }, before);
    map.addLayer({
      id: 'cm-route-line', type: 'line', source: 'cm-route',
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-width': ['interpolate', ['linear'], ['zoom'], 10, 5, 16, 11],
        'line-gradient': ['interpolate', ['linear'], ['line-progress'], 0, ACCENT, 0.6, '#b45cf0', 1, FLAME],
      },
    }, before);
    map.addLayer({
      id: 'cm-route-traffic', type: 'line', source: 'cm-route-traffic',
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': ['match', ['get', 'level'], 'heavy', TRAFFIC_COLORS.heavy, 'closed', TRAFFIC_COLORS.closed, TRAFFIC_COLORS.slow],
        'line-width': ['interpolate', ['linear'], ['zoom'], 10, 4, 16, 8],
      },
    }, before);
    map.addLayer({
      id: 'cm-route-flow', type: 'line', source: 'cm-route',
      layout: { 'line-cap': 'butt', 'line-join': 'round' },
      paint: {
        'line-color': '#ffffff', 'line-opacity': 0.75,
        'line-width': ['interpolate', ['linear'], ['zoom'], 10, 1.5, 16, 3],
        'line-dasharray': [0, 4, 3],
      },
    }, before);

    const pick = (e) => {
      const idx = e.features?.[0]?.properties?.index;
      if (Number.isInteger(idx)) bus.emit('route:pick', { index: idx });
    };
    map.on('click', 'cm-routes-alt-line', pick);
    map.on('mouseenter', 'cm-routes-alt-line', () => (map.getCanvas().style.cursor = 'pointer'));
    map.on('mouseleave', 'cm-routes-alt-line', () => (map.getCanvas().style.cursor = ''));
  }

  // Marching dashes along the selected route while previewing (directional cue).
  const DASH_STEPS = [
    [0, 4, 3], [0.5, 4, 2.5], [1, 4, 2], [1.5, 4, 1.5], [2, 4, 1], [2.5, 4, 0.5], [3, 4, 0],
    [0, 0.5, 3, 3.5], [0, 1, 3, 3], [0, 1.5, 3, 2.5], [0, 2, 3, 2], [0, 2.5, 3, 1.5], [0, 3, 3, 1], [0, 3.5, 3, 0.5],
  ];
  function startFlow() {
    if (flowTimer || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    map.setLayoutProperty('cm-route-flow', 'visibility', 'visible');
    flowTimer = setInterval(() => {
      flowStep = (flowStep + 1) % DASH_STEPS.length;
      if (map.getLayer('cm-route-flow')) map.setPaintProperty('cm-route-flow', 'line-dasharray', DASH_STEPS[flowStep]);
    }, 70);
  }
  function stopFlow() {
    clearInterval(flowTimer);
    flowTimer = null;
    if (map.getLayer('cm-route-flow')) map.setLayoutProperty('cm-route-flow', 'visibility', 'none');
  }

  function setMain(coords) {
    map.getSource('cm-route')?.setData(coords && coords.length > 1 ? lineFeature(coords) : EMPTY);
  }

  function setTraffic(route, along = 0) {
    map.getSource('cm-route-traffic')?.setData(trafficFeatures(route, along));
  }

  let generation = 0; // bumped by clear() so a draw waiting for the style can't reappear after it
  /** Run fn now if the layers exist, otherwise once the style has finished loading. */
  function whenReady(fn) {
    if (install()) return fn();
    const mine = generation;
    map.once('idle', () => {
      if (mine === generation && install()) fn();
    });
  }

  return Object.freeze({
    install,
    /** Preview: draw every route, highlight `selected`. */
    showRoutes(routes, selected = 0) {
      if (!install()) return whenReady(() => this.showRoutes(routes, selected));
      const alts = routes
        .map((r, index) => ({ r, index }))
        .filter(({ index }) => index !== selected)
        .map(({ r, index }) => lineFeature(r.geometry, { index }));
      map.getSource('cm-routes-alt')?.setData({ type: 'FeatureCollection', features: alts });
      setMain(routes[selected]?.geometry);
      setTraffic(routes[selected]);
      startFlow();
    },
    /** Navigation: only the active route, no alternatives. */
    setActiveRoute(route) {
      if (!install()) return whenReady(() => this.setActiveRoute(route));
      stopFlow();
      map.getSource('cm-routes-alt')?.setData(EMPTY);
      setMain(route?.geometry);
      setTraffic(route);
    },
    /** Replace the drawn main line (the part still ahead); traffic is trimmed to match. */
    setRemaining(coords, { route = null, along = 0 } = {}) {
      setMain(coords);
      if (route) setTraffic(route, along);
    },
    clear() {
      generation++;
      stopFlow();
      map.getSource('cm-routes-alt')?.setData(EMPTY);
      map.getSource('cm-route-traffic')?.setData(EMPTY);
      setMain(null);
    },
  });
}

// Cars Map basemap: a hand-built MapLibre style over OpenFreeMap's OpenMapTiles vector tiles.
// Paint values can be functions of the palette, so the day/night switch repaints in place
// (applyTheme) without reloading the style or losing custom layers.
import { ENDPOINTS } from '../config.js';

export const PALETTES = Object.freeze({
  light: {
    land: '#f1ecf8', landuse: '#e9e2f3', park: '#d3ebcf', wood: '#c4e2bd', sand: '#f3ead2',
    water: '#b9d7f4', waterLine: '#a3c9ef',
    building: '#e2daef', buildingTop: '#d3c8e6', buildingFlat: '#e4dcf0',
    road: '#ffffff', roadMajor: '#ffffff', motorway: '#ffe1bd', casing: '#d6cfe3', casingMajor: '#c9bfdc', casingMotorway: '#f0b07a',
    path: '#c9bfdc', rail: '#bfb5d3', aeroway: '#e2dbee', boundary: '#b4a7d1',
    label: '#4b4663', labelStrong: '#24212e', labelRoad: '#5d5872', halo: '#f7f4fc', waterLabel: '#4f7fb3',
    sky: '#b9a8f0', horizon: '#f1ecf8', fog: '#efe9f8',
  },
  dark: {
    land: '#24212e', landuse: '#282534', park: '#21352a', wood: '#1e3124', sand: '#36302a',
    water: '#18304a', waterLine: '#1f3d5c',
    building: '#2c2838', buildingTop: '#3b3549', buildingFlat: '#2e2a39',
    road: '#4b4660', roadMajor: '#5d5677', motorway: '#a0662f', casing: '#16141c', casingMajor: '#16141c', casingMotorway: '#2a1d12',
    path: '#4a4558', rail: '#4d475c', aeroway: '#302c3b', boundary: '#5d5374',
    label: '#bdb6d2', labelStrong: '#efebf7', labelRoad: '#a59fbb', halo: '#1d1b24', waterLabel: '#7fa8d4',
    sky: '#0b0912', horizon: '#2c2443', fog: '#25222f',
  },
});

const SRC = 'omt';
const NAME = ['coalesce', ['get', 'name:en'], ['get', 'name_en'], ['get', 'name']];
const FONT = ['Noto Sans Regular'];
const FONT_BOLD = ['Noto Sans Bold'];
const FONT_ITALIC = ['Noto Sans Italic'];

/** Zoom-interpolated width, exponential base 1.5. stops: [zoom, width, zoom, width, ...] */
const zw = (...stops) => ['interpolate', ['exponential', 1.5], ['zoom'], ...stops];
const cls = (...names) => ['match', ['get', 'class'], names, true, false];
const notTunnel = ['!=', ['get', 'brunnel'], 'tunnel'];
const isTunnel = ['==', ['get', 'brunnel'], 'tunnel'];

// Width stops per road class: [zoom, px, zoom, px, ...]
const STOPS = {
  motorway: [5, 0.6, 9, 1.6, 12, 3, 14, 6, 16, 12, 18, 30],
  primary: [7, 0.4, 10, 1.2, 12, 2.4, 14, 5, 16, 10, 18, 26],
  secondary: [9, 0.4, 12, 1.6, 14, 4, 16, 8, 18, 20],
  minor: [12, 0.4, 14, 2, 16, 5.5, 18, 14],
  service: [14, 0.5, 16, 2.5, 18, 7],
};
const W = Object.fromEntries(Object.entries(STOPS).map(([k, s]) => [k, zw(...s)]));

/** Casing = fill width plus an outline that grows from 0.8 px (z10) to 2.6 px (z16+).
 *  Built as its own stop list: MapLibre allows only one zoom curve per expression. */
const casingExtra = (z) => 0.8 + Math.max(0, Math.min(1, (z - 10) / 6)) * 1.8;
const casingOf = (w) => {
  const stops = STOPS[Object.keys(W).find((k) => W[k] === w)];
  const out = [];
  for (let i = 0; i < stops.length; i += 2) out.push(stops[i], +(stops[i + 1] + casingExtra(stops[i])).toFixed(2));
  return zw(...out);
};

/**
 * Layer list. A paint value that is a function receives the palette.
 * The route layers are inserted before ROUTE_BEFORE_ID (above buildings, below labels).
 */
function layerDefs(opts) {
  const roadCasing = (id, classes, width, colorKey, minzoom = 0, extraFilter = notTunnel) => ({
    id, type: 'line', source: SRC, 'source-layer': 'transportation', minzoom,
    filter: ['all', cls(...classes), extraFilter],
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': (p) => p[colorKey], 'line-width': casingOf(width) },
  });
  const roadFill = (id, classes, width, colorKey, minzoom = 0, extraFilter = notTunnel) => ({
    id, type: 'line', source: SRC, 'source-layer': 'transportation', minzoom,
    filter: ['all', cls(...classes), extraFilter],
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': (p) => p[colorKey], 'line-width': width },
  });

  return [
    { id: 'background', type: 'background', paint: { 'background-color': (p) => p.land } },
    {
      id: 'landuse', type: 'fill', source: SRC, 'source-layer': 'landuse',
      filter: cls('residential', 'commercial', 'retail', 'industrial', 'school', 'university', 'hospital', 'railway'),
      paint: { 'fill-color': (p) => p.landuse, 'fill-opacity': ['interpolate', ['linear'], ['zoom'], 9, 0.8, 16, 0.5] },
    },
    {
      id: 'landcover-wood', type: 'fill', source: SRC, 'source-layer': 'landcover', filter: cls('wood', 'forest'),
      paint: { 'fill-color': (p) => p.wood, 'fill-opacity': 0.7 },
    },
    {
      id: 'landcover-grass', type: 'fill', source: SRC, 'source-layer': 'landcover', filter: cls('grass', 'farmland', 'wetland'),
      paint: { 'fill-color': (p) => p.park, 'fill-opacity': 0.55 },
    },
    {
      id: 'landcover-sand', type: 'fill', source: SRC, 'source-layer': 'landcover', filter: cls('sand', 'beach'),
      paint: { 'fill-color': (p) => p.sand, 'fill-opacity': 0.8 },
    },
    {
      id: 'park', type: 'fill', source: SRC, 'source-layer': 'park',
      paint: { 'fill-color': (p) => p.park, 'fill-opacity': 0.85 },
    },
    {
      id: 'landuse-green', type: 'fill', source: SRC, 'source-layer': 'landuse',
      filter: cls('pitch', 'stadium', 'playground', 'cemetery', 'golf_course', 'park', 'recreation_ground'),
      paint: { 'fill-color': (p) => p.park, 'fill-opacity': 0.8 },
    },
    { id: 'water', type: 'fill', source: SRC, 'source-layer': 'water', paint: { 'fill-color': (p) => p.water } },
    {
      id: 'waterway', type: 'line', source: SRC, 'source-layer': 'waterway', minzoom: 8,
      paint: { 'line-color': (p) => p.waterLine, 'line-width': zw(8, 0.5, 14, 2, 18, 6) },
    },
    {
      id: 'aeroway', type: 'line', source: SRC, 'source-layer': 'aeroway', minzoom: 10, filter: cls('runway', 'taxiway'),
      paint: { 'line-color': (p) => p.aeroway, 'line-width': zw(10, 1, 14, 12, 18, 60) },
    },
    // tunnels: faint, no casing
    {
      id: 'road-tunnel', type: 'line', source: SRC, 'source-layer': 'transportation', minzoom: 12,
      filter: ['all', cls('motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'minor'), isTunnel],
      layout: { 'line-join': 'round' },
      paint: { 'line-color': (p) => p.casing, 'line-width': W.secondary, 'line-opacity': 0.5, 'line-dasharray': [1.2, 0.8] },
    },
    {
      id: 'road-path', type: 'line', source: SRC, 'source-layer': 'transportation', minzoom: 15, filter: cls('path', 'track'),
      paint: { 'line-color': (p) => p.path, 'line-width': zw(15, 1, 18, 2.5), 'line-dasharray': [1.5, 1.5] },
    },
    roadCasing('road-service-casing', ['service'], W.service, 'casing', 14),
    roadCasing('road-minor-casing', ['minor'], W.minor, 'casing', 12.5),
    roadCasing('road-secondary-casing', ['secondary', 'tertiary'], W.secondary, 'casingMajor', 9),
    roadCasing('road-primary-casing', ['primary', 'trunk'], W.primary, 'casingMajor', 7),
    roadCasing('road-motorway-casing', ['motorway'], W.motorway, 'casingMotorway', 5),
    roadFill('road-service', ['service'], W.service, 'road', 14),
    roadFill('road-minor', ['minor'], W.minor, 'road', 12.5),
    roadFill('road-secondary', ['secondary', 'tertiary'], W.secondary, 'roadMajor', 9),
    roadFill('road-primary', ['primary', 'trunk'], W.primary, 'roadMajor', 7),
    roadFill('road-motorway', ['motorway'], W.motorway, 'motorway', 5),
    {
      id: 'rail', type: 'line', source: SRC, 'source-layer': 'transportation', minzoom: 11, filter: cls('rail', 'transit'),
      paint: { 'line-color': (p) => p.rail, 'line-width': zw(11, 0.6, 16, 2), 'line-dasharray': [3, 2] },
    },
    {
      id: 'boundary', type: 'line', source: SRC, 'source-layer': 'boundary',
      filter: ['all', ['<=', ['get', 'admin_level'], 4], ['!=', ['get', 'maritime'], 1]],
      paint: { 'line-color': (p) => p.boundary, 'line-width': zw(3, 0.6, 10, 1.4), 'line-dasharray': [3, 2], 'line-opacity': 0.7 },
    },
    opts.buildings3d
      ? {
          id: 'building', type: 'fill-extrusion', source: SRC, 'source-layer': 'building', minzoom: 14,
          paint: {
            'fill-extrusion-color': (p) => ['interpolate', ['linear'], ['coalesce', ['get', 'render_height'], 6], 0, p.building, 80, p.buildingTop],
            'fill-extrusion-height': ['interpolate', ['linear'], ['zoom'], 14, 0, 15.2, ['coalesce', ['get', 'render_height'], 6]],
            'fill-extrusion-base': ['coalesce', ['get', 'render_min_height'], 0],
            'fill-extrusion-opacity': 0.88,
          },
        }
      : {
          id: 'building', type: 'fill', source: SRC, 'source-layer': 'building', minzoom: 14,
          paint: { 'fill-color': (p) => p.buildingFlat, 'fill-opacity': 0.9 },
        },
    // ---- labels (route layers go before this one) ----
    {
      id: 'label-road', type: 'symbol', source: SRC, 'source-layer': 'transportation_name', minzoom: 13,
      layout: {
        'symbol-placement': 'line', 'text-field': NAME, 'text-font': FONT, 'text-size': zw(13, 11, 18, 15),
        'text-max-angle': 30, 'symbol-spacing': 320, 'text-padding': 4,
      },
      paint: { 'text-color': (p) => p.labelRoad, 'text-halo-color': (p) => p.halo, 'text-halo-width': 1.6 },
    },
    {
      id: 'label-water', type: 'symbol', source: SRC, 'source-layer': 'water_name', minzoom: 8,
      layout: { 'text-field': NAME, 'text-font': FONT_ITALIC, 'text-size': 13, 'text-max-width': 8 },
      paint: { 'text-color': (p) => p.waterLabel, 'text-halo-color': (p) => p.halo, 'text-halo-width': 1.2 },
    },
    {
      id: 'label-poi', type: 'symbol', source: SRC, 'source-layer': 'poi', minzoom: 16.5,
      filter: ['<=', ['coalesce', ['get', 'rank'], 99], 8],
      layout: { 'text-field': NAME, 'text-font': FONT, 'text-size': 12, 'text-max-width': 9, 'text-padding': 6 },
      paint: { 'text-color': (p) => p.label, 'text-halo-color': (p) => p.halo, 'text-halo-width': 1.4 },
    },
    {
      id: 'label-place-minor', type: 'symbol', source: SRC, 'source-layer': 'place', minzoom: 11,
      filter: cls('suburb', 'neighbourhood', 'quarter', 'village', 'hamlet'),
      layout: {
        'text-field': NAME, 'text-font': FONT_BOLD, 'text-size': zw(11, 11, 16, 15), 'text-transform': 'uppercase',
        'text-letter-spacing': 0.08, 'text-max-width': 8, 'text-padding': 8,
      },
      paint: { 'text-color': (p) => p.label, 'text-halo-color': (p) => p.halo, 'text-halo-width': 1.6 },
    },
    {
      id: 'label-place-major', type: 'symbol', source: SRC, 'source-layer': 'place', maxzoom: 15,
      filter: cls('city', 'town'),
      layout: {
        'text-field': NAME, 'text-font': FONT_BOLD,
        'text-size': ['interpolate', ['linear'], ['zoom'], 4, ['match', ['get', 'class'], 'city', 13, 11], 12, ['match', ['get', 'class'], 'city', 22, 17]],
        'text-max-width': 8,
      },
      paint: { 'text-color': (p) => p.labelStrong, 'text-halo-color': (p) => p.halo, 'text-halo-width': 2 },
    },
    {
      id: 'label-country', type: 'symbol', source: SRC, 'source-layer': 'place', maxzoom: 7, filter: cls('country', 'state'),
      layout: { 'text-field': NAME, 'text-font': FONT_BOLD, 'text-size': 13, 'text-transform': 'uppercase', 'text-letter-spacing': 0.15 },
      paint: { 'text-color': (p) => p.label, 'text-halo-color': (p) => p.halo, 'text-halo-width': 1.5 },
    },
  ];
}

export const ROUTE_BEFORE_ID = 'label-road';

function resolvePaint(paint, palette) {
  const out = {};
  for (const [k, v] of Object.entries(paint ?? {})) out[k] = typeof v === 'function' ? v(palette) : v;
  return out;
}

export function skyFor(theme) {
  const p = PALETTES[theme] ?? PALETTES.light;
  return {
    'sky-color': p.sky,
    'horizon-color': p.horizon,
    'fog-color': p.fog,
    'sky-horizon-blend': 0.6,
    'horizon-fog-blend': 0.7,
    'fog-ground-blend': 0.85,
    'atmosphere-blend': ['interpolate', ['linear'], ['zoom'], 0, 1, 6, 0.6, 10, 0],
  };
}

/**
 * Full MapLibre style object.
 * @param {'light'|'dark'} theme
 * @param {{buildings3d?: boolean, globe?: boolean}} [opts]
 */
export function buildStyle(theme, opts = {}) {
  const palette = PALETTES[theme] ?? PALETTES.light;
  const defs = layerDefs({ buildings3d: opts.buildings3d !== false });
  return {
    version: 8,
    name: 'Cars Map',
    glyphs: ENDPOINTS.glyphs,
    sources: {
      [SRC]: {
        type: 'vector',
        url: ENDPOINTS.tiles,
        attribution: '<a href="https://openfreemap.org" target="_blank" rel="noopener">OpenFreeMap</a> © <a href="https://www.openmaptiles.org/" target="_blank" rel="noopener">OpenMapTiles</a> Data from <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>',
      },
    },
    projection: { type: opts.globe ? 'globe' : 'mercator' },
    sky: skyFor(theme),
    layers: defs.map((d) => ({ ...d, paint: resolvePaint(d.paint, palette) })),
  };
}

/** Repaint the basemap for a theme in place. */
export function applyTheme(map, theme, opts = {}) {
  const palette = PALETTES[theme] ?? PALETTES.light;
  for (const d of layerDefs({ buildings3d: opts.buildings3d !== false })) {
    if (!map.getLayer(d.id)) continue;
    for (const [prop, v] of Object.entries(d.paint ?? {})) {
      if (typeof v === 'function') map.setPaintProperty(d.id, prop, v(palette));
    }
  }
  map.setSky(skyFor(theme));
}

/** Swap the building layer between 3D extrusions and flat footprints. */
export function setBuildings3d(map, theme, on) {
  if (!map.getLayer('building')) return;
  const palette = PALETTES[theme] ?? PALETTES.light;
  const def = layerDefs({ buildings3d: on }).find((d) => d.id === 'building');
  map.removeLayer('building');
  map.addLayer({ ...def, paint: resolvePaint(def.paint, palette) }, firstLabelAfterBuilding(map));
}

function firstLabelAfterBuilding(map) {
  // Re-insert below any route layers so the route stays drawn above buildings.
  const order = map.getStyle().layers.map((l) => l.id);
  const routeIdx = order.findIndex((id) => id.startsWith('route-') || id.startsWith('cm-'));
  return routeIdx >= 0 ? order[routeIdx] : ROUTE_BEFORE_ID;
}

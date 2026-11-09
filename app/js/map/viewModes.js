// Map views: Standard, Satellite (Esri imagery under our roads and labels), Terrain (hillshade
// from open elevation data) and Weather (standard map + radar, see weather.js).
import { applyTheme } from './style.js';

export const MAP_VIEWS = Object.freeze([
  { value: 'standard', label: 'Standard' },
  { value: 'satellite', label: 'Satellite' },
  { value: 'terrain', label: 'Terrain' },
  { value: 'weather', label: 'Weather' },
]);

const SAT = 'cm-sat';
const DEM = 'cm-dem';
const HILL = 'cm-hillshade';
const BELOW_ROADS = 'road-tunnel';
const FILL_LAYERS = ['landuse', 'landcover-wood', 'landcover-grass', 'landcover-sand', 'park', 'landuse-green', 'building'];
const ROAD_LAYER_RE = /^road-(?!tunnel)/; // tunnels keep their own faint opacity
const LABEL_LAYER_RE = /^label-/;

function before(map) {
  return map.getLayer(BELOW_ROADS) ? BELOW_ROADS : undefined;
}

function addSatellite(map, endpoint) {
  if (!map.getSource(SAT)) {
    map.addSource(SAT, {
      type: 'raster',
      tiles: [`${endpoint}/{z}/{y}/{x}`],
      tileSize: 256,
      maxzoom: 19,
      attribution: 'Imagery © Esri, Maxar, Earthstar Geographics',
    });
  }
  if (!map.getLayer(SAT)) map.addLayer({ id: SAT, type: 'raster', source: SAT, paint: { 'raster-fade-duration': 150 } }, before(map));
}

function addTerrain(map, endpoint, theme) {
  if (!map.getSource(DEM)) {
    map.addSource(DEM, {
      type: 'raster-dem',
      tiles: [`${endpoint}/{z}/{x}/{y}.png`],
      tileSize: 256,
      maxzoom: 15,
      encoding: 'terrarium',
      attribution: 'Elevation: Mapzen Terrain Tiles (AWS Open Data)',
    });
  }
  if (!map.getLayer(HILL)) map.addLayer({ id: HILL, type: 'hillshade', source: DEM }, before(map));
  const dark = theme === 'dark';
  map.setPaintProperty(HILL, 'hillshade-exaggeration', 0.65);
  map.setPaintProperty(HILL, 'hillshade-shadow-color', dark ? '#06050a' : '#5b4f7d');
  map.setPaintProperty(HILL, 'hillshade-highlight-color', dark ? '#4a4360' : '#ffffff');
  map.setPaintProperty(HILL, 'hillshade-accent-color', dark ? '#1b1824' : '#3d3358');
}

function removeLayerAndSource(map, id) {
  if (map.getLayer(id)) map.removeLayer(id);
  if (map.getSource(id)) map.removeSource(id);
}

function styleForSatellite(map, on) {
  for (const id of FILL_LAYERS) {
    if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', on ? 'none' : 'visible');
  }
  for (const { id, type } of map.getStyle().layers) {
    if (ROAD_LAYER_RE.test(id) && type === 'line') map.setPaintProperty(id, 'line-opacity', on ? 0.55 : 1);
    if (LABEL_LAYER_RE.test(id) && type === 'symbol' && on) {
      map.setPaintProperty(id, 'text-color', '#ffffff');
      map.setPaintProperty(id, 'text-halo-color', 'rgba(10, 8, 16, 0.85)');
    }
  }
}

/** Apply a view to the map. Safe to call repeatedly (e.g. after a theme or building change). */
export function applyMapView(map, view, { theme, buildings3d, endpoints }) {
  const satellite = view === 'satellite';
  const terrain = view === 'terrain';
  if (satellite) addSatellite(map, endpoints.satellite);
  else removeLayerAndSource(map, SAT);
  if (terrain) {
    addTerrain(map, endpoints.terrain, theme);
  } else {
    if (map.getLayer(HILL)) map.removeLayer(HILL);
    if (map.getSource(DEM)) map.removeSource(DEM);
  }
  if (!satellite) applyTheme(map, theme, { buildings3d }); // restore label colours
  styleForSatellite(map, satellite);
}

export function initViewModes(ctx) {
  const { store, mapView, config, ui } = ctx;
  const { map } = mapView;
  const apply = () => {
    const { settings, theme } = store.get();
    try {
      applyMapView(map, settings.mapView, { theme, buildings3d: settings.buildings3d, endpoints: config.ENDPOINTS });
    } catch (err) {
      if (/not done loading/i.test(err?.message ?? '')) {
        map.once('idle', apply); // style still loading: try again once it settles
        return;
      }
      console.error('[map] view change failed', err);
      ui.toast('That map view could not load. Showing the standard map.', { tone: 'warn' });
      store.set((s) => ({ settings: { ...s.settings, mapView: 'standard' } }));
    }
  };
  mapView.ready.then(() => {
    apply();
    // Re-apply after anything that repaints or re-adds basemap layers.
    store.select((s) => `${s.settings.mapView}|${s.theme}|${s.settings.buildings3d}`, () => setTimeout(apply, 0));
  });
  map.on('error', (e) => {
    if ((e?.sourceId === SAT || e?.sourceId === DEM) && !initViewModes.warned) {
      initViewModes.warned = true;
      ui.toast('Some imagery tiles did not load. Check your signal.', { tone: 'warn' });
    }
  });
}

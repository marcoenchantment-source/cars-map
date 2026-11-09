// "Map" panel (layers button): look, 3D buildings, live traffic, driven roads.
// Also owns the optional TomTom live-traffic overlay.
import { ROUTE_BEFORE_ID } from './style.js';
import { MAP_VIEWS } from './viewModes.js';

const TRAFFIC_SOURCE = 'cm-traffic';
const TRAFFIC_LAYER = 'cm-traffic';

function trafficTiles(base, key, theme) {
  const style = theme === 'dark' ? 'relative0-dark' : 'relative0';
  return `${base}/traffic/map/4/tile/flow/${style}/{z}/{x}/{y}.png?key=${encodeURIComponent(key)}&tileSize=256&thickness=8`;
}

export function initMapOptions(view, { store, bus, ui, config }) {
  const { map, ready } = view;

  function syncTraffic() {
    const { settings, theme } = store.get();
    const want = Boolean(settings.traffic && settings.tomtomKey);
    if (map.getLayer(TRAFFIC_LAYER)) map.removeLayer(TRAFFIC_LAYER);
    if (map.getSource(TRAFFIC_SOURCE)) map.removeSource(TRAFFIC_SOURCE);
    if (!want) return;
    map.addSource(TRAFFIC_SOURCE, {
      type: 'raster',
      tiles: [trafficTiles(config.ENDPOINTS.tomtom, settings.tomtomKey, theme)],
      tileSize: 256,
      attribution: 'Traffic © TomTom',
    });
    const before = map.getLayer('cm-routes-alt-casing') ? 'cm-routes-alt-casing' : ROUTE_BEFORE_ID;
    map.addLayer({ id: TRAFFIC_LAYER, type: 'raster', source: TRAFFIC_SOURCE, paint: { 'raster-opacity': 0.9 } }, before);
  }
  ready.then(syncTraffic);
  store.select((s) => `${s.settings.traffic}|${s.settings.tomtomKey}|${s.theme}`, () => ready.then(syncTraffic));
  map.on('error', (e) => {
    if (e?.sourceId === TRAFFIC_SOURCE && !syncTraffic.warned) {
      syncTraffic.warned = true;
      ui.toast('Live traffic could not load. Check your TomTom key in Settings.', { tone: 'warn', ms: 5000 });
    }
  });

  const setSetting = (key, value) => store.set((s) => ({ settings: { ...s.settings, [key]: value } }));

  function openPanel() {
    ui.sheet.open({
      id: 'map-options',
      title: 'Map',
      render(body) {
        const { settings } = store.get();
        body.append(
          ui.el('p', { class: 'section-title', text: 'View' }),
          ui.segmented({
            id: 'map-view',
            label: 'Map view',
            value: settings.mapView ?? 'standard',
            options: MAP_VIEWS,
            onChange: (v) => setSetting('mapView', v),
          }),
          ui.el('p', { class: 'small muted', text: 'Weather shows live rain radar and conditions. Tap anywhere on the map to check there.' }),
          ui.el('p', { class: 'section-title', text: 'Look' }),
          ui.segmented({
            id: 'map-theme',
            label: 'Map look',
            value: settings.theme,
            options: [
              { value: 'auto', label: 'Day / night' },
              { value: 'light', label: 'Day' },
              { value: 'dark', label: 'Night' },
              { value: 'system', label: 'Phone setting' },
            ],
            onChange: (v) => setSetting('theme', v),
          }),
          ui.el(
            'div',
            { class: 'list' },
            ui.toggleRow({
              id: 'opt-buildings', label: '3D buildings', hint: 'City blocks rise as you zoom in',
              checked: settings.buildings3d, onChange: (v) => setSetting('buildings3d', v),
            }),
            ui.toggleRow({
              id: 'opt-traffic', label: 'Live traffic',
              hint: settings.tomtomKey ? 'Road colours show live speeds (TomTom)' : 'Add a free TomTom key in Settings to turn this on',
              checked: settings.traffic && !!settings.tomtomKey,
              onChange: (v) => {
                if (v && !store.get().settings.tomtomKey) {
                  ui.toast('Add your TomTom key in Settings first', { tone: 'warn' });
                  bus.emit('settings:open', { focus: 'tomtomKey' });
                  return;
                }
                setSetting('traffic', v);
              },
            }),
            ui.toggleRow({
              id: 'opt-driven', label: 'Roads I have driven', hint: 'A glowing trail over every road you have used',
              checked: settings.showDrivenRoads, onChange: (v) => setSetting('showDrivenRoads', v),
            }),
          ),
        );
      },
    });
  }

  ui.addFab({ id: 'layers', icon: 'layers', label: 'Map options', order: 8, modes: ['explore', 'preview'], onClick: openPanel });
  bus.on('map:options', openPanel);
}

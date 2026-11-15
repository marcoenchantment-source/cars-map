// "Map" panel (layers button): base view (Standard / Satellite) with Terrain and Weather add-ons,
// the look, 3D buildings and driven roads. Live traffic is not drawn over the whole map: it shows
// only along the chosen route (medium and heavy), drawn by routeLayer from the route's congestion.
import { MAP_BASES } from './viewModes.js';

export function initMapOptions(view, { store, bus, ui }) {
  const setSettings = (patch) => store.set((s) => ({ settings: { ...s.settings, ...patch } }));

  function viewControls(settings) {
    const satellite = settings.mapBase === 'satellite';
    const terrainRow = ui.toggleRow({
      id: 'opt-terrain', label: 'Terrain', hint: satellite ? 'Works with the Standard map' : 'Shaded hills and valleys',
      checked: !satellite && settings.mapTerrain === true,
      onChange: (v) => setSettings({ mapTerrain: v }),
    });
    const terrainInput = terrainRow.querySelector('input');
    if (terrainInput) terrainInput.disabled = satellite;
    terrainRow.classList.toggle('is-disabled', satellite);
    return [
      ui.segmented({
        id: 'map-base',
        label: 'Map view',
        value: satellite ? 'satellite' : 'standard',
        options: MAP_BASES,
        onChange: (v) => {
          setSettings(v === 'satellite' ? { mapBase: 'satellite', mapTerrain: false } : { mapBase: 'standard' });
          openPanel(); // redraw so Terrain enables/disables
        },
      }),
      ui.el(
        'div',
        { class: 'list' },
        terrainRow,
        ui.toggleRow({
          id: 'opt-weather', label: 'Weather', hint: 'Live rain radar and conditions. Tap the map to check anywhere.',
          checked: settings.mapWeather === true,
          onChange: (v) => setSettings({ mapWeather: v }),
        }),
      ),
    ];
  }

  function openPanel() {
    ui.sheet.open({
      id: 'map-options',
      title: 'Map',
      render(body) {
        const { settings } = store.get();
        body.append(
          ui.el('p', { class: 'section-title', text: 'View' }),
          ...viewControls(settings),
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
            onChange: (v) => setSettings({ theme: v }),
          }),
          ui.el(
            'div',
            { class: 'list' },
            ui.toggleRow({
              id: 'opt-buildings', label: '3D buildings', hint: 'City blocks rise as you zoom in',
              checked: settings.buildings3d, onChange: (v) => setSettings({ buildings3d: v }),
            }),
            ui.toggleRow({
              id: 'opt-driven', label: 'Roads I have driven', hint: 'A glowing trail over every road you have used',
              checked: settings.showDrivenRoads, onChange: (v) => setSettings({ showDrivenRoads: v }),
            }),
          ),
          ui.el('p', { class: 'small muted', text: 'Live traffic shows on your route once you pick a destination: amber for slow, red for heavy.' }),
        );
      },
    });
  }

  ui.addFab({ id: 'layers', icon: 'layers', label: 'Map options', order: 8, modes: ['explore', 'preview'], onClick: openPanel });
  bus.on('map:options', openPanel);
}

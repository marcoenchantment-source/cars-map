import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateStyleMin } from '@maplibre/maplibre-gl-style-spec';
import { buildStyle, applyTheme, setBuildings3d, overlayBeforeId, PALETTES, GLOW_LAYERS } from '../app/js/map/style.js';
import { trafficFeatures } from '../app/js/map/routeLayer.js';
import { cumulativeDistances } from '../app/js/core/geo.js';

const THEMES = ['light', 'dark'];

/** WCAG relative-luminance contrast between two #rrggbb colours. */
function contrast(a, b) {
  const lum = (hex) => {
    const [r, g, bl] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** Minimal stand-in for a MapLibre map: an ordered layer list plus recorded paint calls. */
function fakeMap(ids, buildingType = 'fill-extrusion') {
  let layers = ids.map((id) => ({ id, type: id === 'building' ? buildingType : 'line' }));
  const paints = [];
  return {
    getLayer: (id) => layers.find((l) => l.id === id),
    getStyle: () => ({ layers: layers.map((l) => ({ ...l })) }),
    removeLayer: (id) => (layers = layers.filter((l) => l.id !== id)),
    addLayer: (l, before) => {
      const i = layers.findIndex((x) => x.id === before);
      layers = i < 0 ? [...layers, { id: l.id, type: l.type }] : [...layers.slice(0, i), { id: l.id, type: l.type }, ...layers.slice(i)];
    },
    setPaintProperty: (id, prop, value) => paints.push({ id, prop, value }),
    setSky: () => {},
    order: () => layers.map((l) => l.id),
    paints,
  };
}

test('both looks pass MapLibre style validation, flat and 3D, map and globe', () => {
  for (const theme of THEMES) {
    for (const buildings3d of [true, false]) {
      const errors = validateStyleMin(buildStyle(theme, { buildings3d, globe: buildings3d }));
      assert.deepEqual(errors.map((e) => e.message), [], `${theme} buildings3d=${buildings3d}`);
    }
  }
});

test('layer order: grid floor over the land and under the water, glow under road edges', () => {
  const ids = buildStyle('dark').layers.map((l) => l.id);
  assert.equal(new Set(ids).size, ids.length, 'layer ids are unique');
  const at = (id) => ids.indexOf(id);
  assert.ok(at('landuse-green') < at('grid') && at('grid') < at('water'));
  assert.ok(at('water') < at('water-edge'));
  for (const g of GLOW_LAYERS) assert.ok(at(g) > 0 && at(g) < at('road-service-casing'), g);
  assert.ok(at('boundary') < at('building') && at('building') < at('label-road'));
});

test('night glows and day stays clean; each look points at its own grid tile', () => {
  const glow = (theme) => buildStyle(theme).layers.find((l) => l.id === 'glow-major').paint['line-opacity'];
  assert.equal(glow('light'), 0);
  assert.ok(glow('dark') > 0);
  const grid = (theme) => buildStyle(theme).layers.find((l) => l.id === 'grid').paint['background-pattern'];
  assert.equal(grid('light'), PALETTES.light.gridImage);
  assert.equal(grid('dark'), PALETTES.dark.gridImage);
  assert.notEqual(PALETTES.light.gridImage, PALETTES.dark.gridImage);
});

test('readable in sunlight and at night: labels, road edges, water vs land', () => {
  for (const theme of THEMES) {
    const p = PALETTES[theme];
    for (const key of ['label', 'labelStrong', 'labelRoad']) assert.ok(contrast(p[key], p.halo) >= 7, `${theme} ${key} ${contrast(p[key], p.halo).toFixed(1)}`);
    assert.ok(contrast(p.waterLabel, p.halo) >= 4.5, `${theme} water label`);
    for (const key of ['casing', 'casingMajor', 'casingMotorway']) {
      assert.ok(contrast(p[key], p.land) >= 2.5, `${theme} ${key} vs land ${contrast(p[key], p.land).toFixed(2)}`);
    }
  }
  // Day roads: the edge must stand out from the white lane and the land under a bright sky.
  assert.ok(contrast(PALETTES.light.casing, PALETTES.light.road) >= 2.2);
});

test('3D-buildings toggle puts buildings back above the roads, not under satellite/terrain', () => {
  const map = fakeMap(['background', 'cm-sat', 'cm-hillshade', 'road-tunnel', 'road-primary', 'boundary', 'building', 'cm-radar-0', 'cm-route-line', 'label-road']);
  setBuildings3d(map, 'dark', false);
  const order = map.order();
  assert.equal(order.indexOf('building'), order.indexOf('boundary') + 1);
  assert.equal(map.getLayer('building').type, 'fill');
});

test('overlays go straight above the buildings, skipping the caller’s own layers', () => {
  const map = fakeMap(['road-primary', 'boundary', 'building', 'cm-radar-0', 'cm-route-line', 'label-road']);
  assert.equal(overlayBeforeId(map, 'cm-radar-'), 'cm-route-line');
  assert.equal(overlayBeforeId(map), 'cm-radar-0');
  assert.equal(overlayBeforeId(fakeMap(['label-road'])), 'label-road', 'falls back to the labels');
});

test('theme repaint matches the building layer on the map even if the setting disagrees', () => {
  const map = fakeMap(['background', 'building', 'label-road'], 'fill');
  assert.doesNotThrow(() => applyTheme(map, 'dark', { buildings3d: true }));
  const props = map.paints.filter((x) => x.id === 'building').map((x) => x.prop);
  assert.ok(props.includes('fill-color') && !props.includes('fill-extrusion-color'), props.join());
});

test('traffic colours drop behind the car and the stretch it is on is cut at the car', () => {
  const geometry = [[0, 0], [0.01, 0], [0.02, 0], [0.03, 0], [0.04, 0]];
  const cum = cumulativeDistances(geometry);
  const seg = (a, b, level) => ({ coords: geometry.slice(a, b + 1), level, from: cum[a], to: cum[b] });
  const route = { geometry, cum, congestion: [seg(0, 1, 'heavy'), seg(1, 3, 'slow'), seg(3, 4, 'free')] };
  assert.equal(trafficFeatures(route).features.length, 2, 'free-flowing roads are not drawn');
  const ahead = trafficFeatures(route, cum[2]).features;
  assert.deepEqual(ahead.map((f) => f.properties.level), ['slow'], 'the heavy stretch behind is gone');
  assert.ok(Math.abs(ahead[0].geometry.coordinates[0][0] - 0.02) < 1e-9, 'slow stretch starts at the car');
  assert.equal(trafficFeatures({ congestion: [seg(0, 1, 'heavy')] }, 500).features.length, 1, 'no geometry: left as is');
});

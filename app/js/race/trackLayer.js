// Map drawing for track day: the circuit (`cm-track`), a checkered start/finish line and a
// bright "you" dot. Everything is removed again when the session ends.
import { makeStartLine } from './laps.js';

const SRC = 'cm-track';
const YOU_SRC = 'cm-track-you';
const CHECKER = 'cm-checker';
const LAYERS = ['cm-track-casing', 'cm-track', 'cm-track-start-line', 'cm-track-start', 'cm-track-you'];
const EMPTY = { type: 'FeatureCollection', features: [] };
const FLAME = '#ff8a00';
const INK = '#1d1b24';
const VIOLET = '#7b4dff';

/** 12 × 4 checker squares, drawn at 2× for sharp phones. */
function checkerImage() {
  const sq = 8;
  const cols = 12;
  const rows = 4;
  const width = cols * sq;
  const height = rows * sq;
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const edge = x < 2 || y < 2 || x >= width - 2 || y >= height - 2;
      const dark = !edge && (Math.floor(x / sq) + Math.floor(y / sq)) % 2 === 0;
      const v = edge ? 29 : dark ? 18 : 255;
      const i = (y * width + x) * 4;
      data[i] = v;
      data[i + 1] = v;
      data[i + 2] = edge ? 36 : v;
      data[i + 3] = 255;
    }
  }
  return { width, height, data };
}

function lineFeature(coords, kind) {
  return { type: 'Feature', properties: { kind }, geometry: { type: 'LineString', coordinates: coords } };
}

function trackData(track) {
  const features = [lineFeature(track.line, 'track')];
  if (track.start?.point && Number.isFinite(track.start.heading)) {
    const sl = makeStartLine(track.start.point, track.start.heading);
    features.push(lineFeature([sl.a, sl.b], 'start'));
    features.push({ type: 'Feature', properties: { kind: 'flag', rot: track.start.heading }, geometry: { type: 'Point', coordinates: track.start.point } });
  }
  return { type: 'FeatureCollection', features };
}

export function createTrackLayer(map) {
  let installed = false;

  function install() {
    if (installed) return;
    installed = true;
    if (!map.hasImage(CHECKER)) map.addImage(CHECKER, checkerImage(), { pixelRatio: 2 });
    map.addSource(SRC, { type: 'geojson', data: EMPTY });
    map.addSource(YOU_SRC, { type: 'geojson', data: EMPTY });
    const before = map.getLayer('label-road') ? 'label-road' : undefined;
    const round = { 'line-cap': 'round', 'line-join': 'round' };
    const isTrack = ['==', ['get', 'kind'], 'track'];
    map.addLayer({
      id: 'cm-track-casing', type: 'line', source: SRC, filter: isTrack, layout: round,
      paint: { 'line-color': INK, 'line-opacity': 0.85, 'line-width': ['interpolate', ['linear'], ['zoom'], 12, 7, 16, 14, 19, 34] },
    }, before);
    map.addLayer({
      id: 'cm-track', type: 'line', source: SRC, filter: isTrack, layout: round,
      paint: { 'line-color': FLAME, 'line-width': ['interpolate', ['linear'], ['zoom'], 12, 3.5, 16, 8, 19, 24] },
    }, before);
    map.addLayer({
      id: 'cm-track-start-line', type: 'line', source: SRC, filter: ['==', ['get', 'kind'], 'start'],
      paint: { 'line-color': '#ffffff', 'line-width': ['interpolate', ['linear'], ['zoom'], 14, 2, 18, 6], 'line-dasharray': [1, 1] },
    });
    map.addLayer({
      id: 'cm-track-start', type: 'symbol', source: SRC, filter: ['==', ['get', 'kind'], 'flag'],
      layout: {
        'icon-image': CHECKER, 'icon-rotate': ['get', 'rot'], 'icon-rotation-alignment': 'map',
        'icon-allow-overlap': true, 'icon-ignore-placement': true,
        'icon-size': ['interpolate', ['linear'], ['zoom'], 13, 0.7, 16, 1, 19, 1.8],
      },
    });
    map.addLayer({
      id: 'cm-track-you', type: 'circle', source: YOU_SRC,
      paint: {
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 13, 6, 18, 10], 'circle-color': VIOLET,
        'circle-stroke-color': '#ffffff', 'circle-stroke-width': 3, 'circle-pitch-alignment': 'map',
      },
    });
  }

  return Object.freeze({
    /** Draw a saved (closed) track with its start/finish line. */
    showTrack(track) {
      install();
      map.getSource(SRC)?.setData(trackData(track));
    },
    /** Draw the line being recorded (no start line yet). */
    showLine(coords, start) {
      install();
      const features = coords.length > 1 ? [lineFeature(coords, 'track')] : [];
      if (start) features.push({ type: 'Feature', properties: { kind: 'flag', rot: start.heading ?? 0 }, geometry: { type: 'Point', coordinates: start.point } });
      map.getSource(SRC)?.setData({ type: 'FeatureCollection', features });
    },
    setYou(point) {
      if (!installed) return;
      const data = point ? { type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: point } } : EMPTY;
      map.getSource(YOU_SRC)?.setData(data);
    },
    remove() {
      if (!installed) return;
      installed = false;
      for (const id of LAYERS) if (map.getLayer(id)) map.removeLayer(id);
      for (const id of [SRC, YOU_SRC]) if (map.getSource(id)) map.removeSource(id);
    },
  });
}

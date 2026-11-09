// Fallback "me" car: a top-down car drawn flat on the map (rotates and tilts with it),
// painted in the driver's colour, with flames that pop out of the exhausts.
// Used when the 3D car is off in Settings or WebGL 2 / three.js is not available.
import { normaliseLook } from './flames.js';
import { svgEl, restartPop } from './car2d.js';

// viewBox 40 x 92: the car (y 12..80) is centred so the marker's centre is the car's centre.
const BODY = 'M20 12C30 12 34 16 34 26L34 70C34 77 30 80 20 80C10 80 6 77 6 70L6 26C6 16 10 12 20 12Z';
const GLASS = '#cde6f7';

function tyres() {
  return [[3, 20], [32, 20], [3, 60], [32, 60]].map(([x, y]) => svgEl('rect', { x, y, width: 5, height: 12, rx: 2, fill: '#17171a' }));
}

function cabin(body, paint) {
  if (body === 'ute') {
    return [
      svgEl('path', { d: 'M10 33Q20 27 30 33L28 42Q20 39 12 42Z', fill: GLASS }),
      svgEl('rect', { x: 11, y: 42, width: 18, height: 11, rx: 3, fill: paint }),
      svgEl('rect', { x: 11, y: 42, width: 18, height: 11, rx: 3, fill: '#000', 'fill-opacity': 0.12 }),
      svgEl('rect', { x: 9, y: 56, width: 22, height: 21, rx: 2, fill: '#2a2a30' }),
      svgEl('rect', { x: 9, y: 56, width: 22, height: 21, rx: 2, fill: 'none', stroke: paint, 'stroke-width': 1.6 }),
    ];
  }
  const roofEnd = body === 'hatch' ? 66 : 60;
  return [
    svgEl('path', { d: 'M10 34Q20 28 30 34L28 44Q20 41 12 44Z', fill: GLASS }),
    svgEl('rect', { x: 11, y: 44, width: 18, height: roofEnd - 44, rx: 3, fill: paint }),
    svgEl('rect', { x: 11, y: 44, width: 18, height: roofEnd - 44, rx: 3, fill: '#000', 'fill-opacity': 0.12 }),
    svgEl('path', { d: `M12 ${roofEnd}Q20 ${roofEnd + 3} 28 ${roofEnd}L30 ${roofEnd + 7}Q20 ${roofEnd + 10} 10 ${roofEnd + 7}Z`, fill: GLASS, 'fill-opacity': 0.85 }),
  ];
}

function flames() {
  const one = (x) => svgEl('g', { class: 'car-flame car-flame-top' }, [
    svgEl('polygon', { points: `${x - 3},80 ${x + 3},80 ${x + 2},86 ${x + 4},88 ${x},92 ${x - 4},88 ${x - 2},86`, fill: '#ff8a00' }),
    svgEl('polygon', { points: `${x - 1.6},80 ${x + 1.6},80 ${x + 1},85 ${x},88 ${x - 1},85`, fill: '#ffe14d' }),
  ]);
  return [one(14), one(26)];
}

/** Top-down car SVG for a validated look. */
export function topCarArt(look) {
  const paint = look.color;
  return svgEl('svg', { class: 'car-top', viewBox: '0 0 40 92', width: 40, height: 92, 'aria-hidden': 'true', focusable: 'false' }, [
    ...flames(),
    ...tyres(),
    svgEl('path', { d: BODY, fill: paint }),
    svgEl('path', { d: 'M20 14C27 14 31 17 32 24', fill: 'none', stroke: '#fff', 'stroke-opacity': 0.35, 'stroke-width': 1.5, 'stroke-linecap': 'round' }),
    ...cabin(look.body, paint),
    svgEl('rect', { x: 9, y: 13, width: 6, height: 3, rx: 1.2, fill: '#fff3b0' }),
    svgEl('rect', { x: 25, y: 13, width: 6, height: 3, rx: 1.2, fill: '#fff3b0' }),
    svgEl('rect', { x: 8, y: 77, width: 7, height: 2.4, rx: 1, fill: '#ff3b4a' }),
    svgEl('rect', { x: 25, y: 77, width: 7, height: 2.4, rx: 1, fill: '#ff3b4a' }),
  ]);
}

/**
 * The flat "me" marker, driven by camera.onFrame.
 * @returns {{kind:'2d', setLook, pop, destroy}}
 */
export function createMarker2D(ctx, look) {
  const { map, mapView } = ctx;
  let current = normaliseLook(look);
  const el = document.createElement('div');
  el.className = 'car-me-2d';
  el.setAttribute('role', 'img');
  el.setAttribute('aria-label', 'Your car');
  el.append(topCarArt(current));

  const marker = new maplibregl.Marker({ element: el, anchor: 'center', rotationAlignment: 'map', pitchAlignment: 'map' });
  let added = false;

  const offFrame = mapView.camera.onFrame((pose) => {
    if (!pose || !Number.isFinite(pose.lng) || !Number.isFinite(pose.lat)) return;
    marker.setLngLat([pose.lng, pose.lat]);
    marker.setRotation(Number.isFinite(pose.bearing) ? pose.bearing : 0);
    if (!added) {
      marker.addTo(map);
      added = true;
    }
  });

  return Object.freeze({
    kind: '2d',
    setLook(next) {
      current = normaliseLook(next, current);
      el.replaceChildren(topCarArt(current));
    },
    pop() {
      for (const f of el.querySelectorAll('.car-flame')) restartPop(f);
    },
    destroy() {
      offFrame();
      marker.remove();
    },
  });
}

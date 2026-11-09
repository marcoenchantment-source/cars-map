// Fit a whole circuit to the screen. Padding and the zoom cap come from the viewport size and
// devicePixelRatio; the map may rotate so the circuit's long side runs along the screen's long
// side (a long track on a portrait phone fills the height instead of a thin strip).
import { bboxOf } from '../core/geo.js';
import { projector } from './laps.js';

export const FIT = Object.freeze({
  marginRatio: 0.06,
  minMargin: 12,
  maxMargin: 44,
  /** Room for the track line width and the start/finish marker at the edge. */
  markerPad: 14,
  /** The track always keeps at least this share of each screen dimension. */
  minShare: 0.45,
  /** Rotate only when it makes the track this much bigger. */
  rotateGain: 1.1,
  /** Prefer a quarter turn over an arbitrary tilt unless the tilt gains this much. */
  snapGain: 1.08,
  bearingStepDeg: 5,
});

const TILE = 512;
const EARTH_CIRCUMFERENCE = 2 * Math.PI * 6378137;
const D2R = Math.PI / 180;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/**
 * Screen padding (CSS px) around the track.
 * @param {{width:number, height:number, dpr?:number, insets?:{top?,right?,bottom?,left?}}} vp
 */
export function fitPadding({ width, height, dpr = 1, insets = {} }, opts = FIT) {
  const short = Math.min(width, height);
  const crisp = dpr >= 2 ? 0.85 : 1; // sharper screens keep thin lines legible nearer the edge
  const margin = clamp(short * opts.marginRatio * crisp, opts.minMargin, opts.maxMargin) + opts.markerPad;
  const side = (k) => margin + Math.max(0, insets[k] ?? 0);
  const squeeze = (a, b, total) => {
    const room = total * (1 - opts.minShare);
    const k = a + b > room ? room / (a + b) : 1;
    return [Math.round(a * k), Math.round(b * k)];
  };
  const [top, bottom] = squeeze(side('top'), side('bottom'), height);
  const [left, right] = squeeze(side('left'), side('right'), width);
  return { top, right, bottom, left };
}

/** Zoom cap: tiny karting tracks stop at a level that still shows the surroundings. */
export function maxZoomFor({ width, height, dpr = 1 }) {
  const big = Math.min(width, height) >= 700 ? 0.5 : 0;
  const z = 17.5 + 0.5 * Math.log2(Math.max(1, dpr)) + big;
  return Math.round(clamp(z, 16.5, 19.5) * 10) / 10;
}

/** MapLibre zoom (512 px tiles) giving `mpp` metres per CSS pixel at latitude `lat`. */
export function zoomForMpp(mpp, lat) {
  return Math.log2((EARTH_CIRCUMFERENCE * Math.cos(lat * D2R)) / (TILE * mpp));
}

export function mppForZoom(zoom, lat) {
  return (EARTH_CIRCUMFERENCE * Math.cos(lat * D2R)) / (TILE * 2 ** zoom);
}

/** Screen-frame coordinates (u right, v up) of local metres for map bearing `deg`. */
export function rotate([x, y], deg) {
  const c = Math.cos(deg * D2R);
  const s = Math.sin(deg * D2R);
  return [x * c - y * s, x * s + y * c];
}

function unrotate([u, v], deg) {
  const c = Math.cos(deg * D2R);
  const s = Math.sin(deg * D2R);
  return [u * c + v * s, -u * s + v * c];
}

function extentsAt(points, deg) {
  let minU = Infinity;
  let maxU = -Infinity;
  let minV = Infinity;
  let maxV = -Infinity;
  for (const p of points) {
    const [u, v] = rotate(p, deg);
    if (u < minU) minU = u;
    if (u > maxU) maxU = u;
    if (v < minV) minV = v;
    if (v > maxV) maxV = v;
  }
  return { w: Math.max(1, maxU - minU), h: Math.max(1, maxV - minV), uc: (minU + maxU) / 2, vc: (minV + maxV) / 2 };
}

function bestBearing(points, availW, availH, allowRotate, opts) {
  const mppAt = (deg) => {
    const e = extentsAt(points, deg);
    return { deg, e, mpp: Math.max(e.w / availW, e.h / availH) };
  };
  const north = mppAt(0);
  if (!allowRotate) return north;
  let best = north;
  for (let deg = -85; deg <= 90; deg += opts.bearingStepDeg) {
    const c = mppAt(deg);
    if (c.mpp < best.mpp) best = c;
  }
  if (north.mpp / best.mpp < opts.rotateGain) return north;
  // A quarter turn reads better than an odd tilt; take it unless the tilt is clearly bigger.
  const quarter = mppAt(90);
  return quarter.mpp / best.mpp < opts.snapGain ? quarter : best;
}

/**
 * Camera that shows the whole circuit inside the padded area of the screen.
 * Padding is folded into the centre, so the map keeps zero padding.
 * @param {number[][]} line track [lng, lat] points
 * @param {{width:number, height:number, dpr?:number, insets?:object}} viewport
 * @returns {{center:number[], zoom:number, bearing:number, padding:object, maxZoom:number}|null}
 */
export function computeTrackCamera(line, viewport, { allowRotate = true } = {}, opts = FIT) {
  if (!Array.isArray(line) || line.length < 2 || !(viewport?.width > 0) || !(viewport?.height > 0)) return null;
  const bbox = bboxOf(line);
  const origin = [(bbox[0] + bbox[2]) / 2, (bbox[1] + bbox[3]) / 2];
  const proj = projector(origin);
  const points = line.map(proj.toXY);
  const padding = fitPadding(viewport, opts);
  const availW = viewport.width - padding.left - padding.right;
  const availH = viewport.height - padding.top - padding.bottom;
  const pick = bestBearing(points, availW, availH, allowRotate, opts);
  const maxZoom = maxZoomFor(viewport);
  const zoom = Math.floor(Math.min(maxZoom, zoomForMpp(pick.mpp, origin[1])) * 100) / 100;
  const mpp = mppForZoom(zoom, origin[1]);
  // Centre of the padded box relative to the screen centre, in px (x right, y down).
  const dx = (padding.left - padding.right) / 2;
  const dy = (padding.top - padding.bottom) / 2;
  const cam = unrotate([pick.e.uc - dx * mpp, pick.e.vc + dy * mpp], pick.deg);
  const bearing = ((pick.deg % 360) + 360) % 360;
  return { center: proj.toLngLat(cam), zoom, bearing, padding, maxZoom };
}

/**
 * Where a [lng, lat] lands on screen (CSS px) for a camera from computeTrackCamera.
 * Used by tests and to sanity-check a fit.
 */
export function projectToScreen(p, camera, viewport) {
  const proj = projector(camera.center);
  const mpp = mppForZoom(camera.zoom, camera.center[1]);
  const [u, v] = rotate(proj.toXY(p), camera.bearing);
  return [viewport.width / 2 + u / mpp, viewport.height / 2 - v / mpp];
}

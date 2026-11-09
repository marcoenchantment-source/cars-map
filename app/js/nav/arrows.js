// Manoeuvre arrows drawn as SVG (48×48 box, built with createElementNS — no markup strings).
// Right-hand shapes are drawn once and mirrored for left. Roundabouts circulate clockwise
// (left-hand traffic, as in Australia) unless the step says the country drives on the right.
import { maneuverKind } from './maneuver.js';

const NS = 'http://www.w3.org/2000/svg';
const HEAD_L = 9;
const HEAD_W = 7.5;
const MAIN_W = 5.2;

export function svgEl(tag, attrs = {}, ...children) {
  const node = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null) node.setAttribute(k, String(v));
  for (const c of children.flat()) if (c) node.append(c);
  return node;
}

const r1 = (n) => Math.round(n * 10) / 10;

/** Filled arrow head with its tip at (x, y) pointing along compass angle `deg` (0 = up). */
function head(x, y, deg, cls = 'nav-a-head') {
  const a = (deg * Math.PI) / 180;
  const dx = Math.sin(a);
  const dy = -Math.cos(a);
  const bx = x - dx * HEAD_L;
  const by = y - dy * HEAD_L;
  const px = Math.cos(a) * HEAD_W;
  const py = Math.sin(a) * HEAD_W;
  const pts = [[x, y], [bx + px, by + py], [bx - px, by - py]].map(([u, v]) => `${r1(u)},${r1(v)}`).join(' ');
  return svgEl('polygon', { points: pts, class: cls, fill: 'currentColor', 'stroke-linejoin': 'round' });
}

function stroke(d, cls = 'nav-a-main', width = MAIN_W) {
  return svgEl('path', { d, class: cls, fill: 'none', stroke: 'currentColor', 'stroke-width': width, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' });
}

const dim = (d) => stroke(d, 'nav-a-dim', MAIN_W - 1);

function straight() {
  return [stroke('M24 42V15'), head(24, 6, 0)];
}

function turn(degree) {
  if (degree === 'slight') return [stroke('M18 42V30C18 24 21.6 21.4 27.6 15.4'), head(34, 9, 45)];
  if (degree === 'sharp') return [stroke('M15 42V21C15 12 24 14 30 27'), head(35, 35, 150)];
  return [stroke('M15 42V28C15 23.6 18.6 20 23 20H33'), head(42, 20, 90)];
}

function uturn() {
  return [stroke('M14 42V20A9 9 0 0 1 32 20V27'), head(32, 36, 180)];
}

function merge() {
  return [dim('M28 42V8'), stroke('M12 42V37C12 30 28 29 28 21V15'), head(28, 6, 0)];
}

function fork() {
  return [dim('M24 30C24 24 22.4 20.4 17.6 15.6L13 11'), stroke('M24 42V30C24 24 25.6 20.4 30.4 15.6'), head(36.8, 9.2, 45)];
}

function ramp() {
  return [dim('M18 42V6'), stroke('M18 42V33C18 27 23.6 23.4 28.6 18.4'), head(35, 12, 45)];
}

function depart() {
  return [svgEl('circle', { cx: 24, cy: 39, r: 4.2, fill: 'currentColor', class: 'nav-a-main' }), stroke('M24 33V15'), head(24, 6, 0)];
}

function arrive() {
  const squares = [];
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 4; col++) {
      if ((row + col) % 2 === 0) squares.push(svgEl('rect', { x: 15 + col * 5.5, y: 7 + row * 5, width: 5.5, height: 5, fill: 'currentColor' }));
    }
  }
  return [
    stroke('M14 43V6'),
    svgEl('rect', { x: 15, y: 7, width: 22, height: 15, fill: 'none', stroke: 'currentColor', 'stroke-width': 2, class: 'nav-a-main' }),
    ...squares,
  ];
}

/** Point on a circle at compass angle (0 = up, clockwise). */
function onCircle(cx, cy, r, deg) {
  const a = (deg * Math.PI) / 180;
  return [cx + r * Math.sin(a), cy - r * Math.cos(a)];
}

function roundabout(angle, exit, ccw) {
  const cx = 24;
  const cy = 24;
  const r = 7;
  // Entry at the bottom (180°). Clockwise sweep to the exit for left-hand traffic.
  const rel = ccw ? -angle : angle;
  let sweep = (((rel - 180) % 360) + 360) % 360;
  if (sweep < 20) sweep = 340; // U-turn: all the way round
  const exitDeg = ccw ? 180 - sweep : 180 + sweep;
  const [ex, ey] = onCircle(cx, cy, r, exitDeg);
  const [sx, sy] = onCircle(cx, cy, r + 5, exitDeg);
  const [tx, ty] = onCircle(cx, cy, r + 5 + HEAD_L, exitDeg);
  const large = sweep > 180 ? 1 : 0;
  const dir = ccw ? 0 : 1;
  const d = `M24 44V${cy + r}A${r} ${r} 0 ${large} ${dir} ${r1(ex)} ${r1(ey)}L${r1(sx)} ${r1(sy)}`;
  const parts = [svgEl('circle', { cx, cy, r, fill: 'none', stroke: 'currentColor', 'stroke-width': 3, class: 'nav-a-dim' }), stroke(d), head(tx, ty, exitDeg)];
  if (exit && exit < 10) {
    const label = svgEl('text', { x: cx, y: cy + 0.5, 'text-anchor': 'middle', 'dominant-baseline': 'central', class: 'nav-a-exit', fill: 'currentColor' });
    label.textContent = String(exit);
    parts.push(label);
  }
  return parts;
}

function shapes(m) {
  switch (m.kind) {
    case 'turn':
      return turn(m.degree);
    case 'uturn':
      return uturn();
    case 'merge':
      return merge();
    case 'fork':
      return fork();
    case 'ramp':
      return ramp();
    case 'depart':
      return depart();
    case 'arrive':
      return arrive();
    case 'roundabout':
      return roundabout(m.angle, m.exit, m.ccw);
    default:
      return m.degree === 'slight' && m.side ? turn('slight') : straight();
  }
}

/** SVG arrow for a Step (or a maneuverKind result). */
export function arrowFor(stepOrKind, { size = 64, className = 'nav-arrow-svg' } = {}) {
  const m = stepOrKind?.kind ? stepOrKind : maneuverKind(stepOrKind);
  const mirror = m.kind !== 'roundabout' && m.side === 'left';
  const group = svgEl('g', mirror ? { transform: 'matrix(-1 0 0 1 48 0)' } : {}, shapes(m));
  return svgEl('svg', { viewBox: '0 0 48 48', width: size, height: size, class: className, 'aria-hidden': 'true', focusable: 'false' }, group);
}

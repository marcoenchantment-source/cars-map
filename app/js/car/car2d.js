// The owner's side-view car from the prototype, rebuilt with createElementNS (no innerHTML):
// same body path, glass, headlight, rims (5 spoke / mesh / deep dish) and flame polygons,
// plus ute and hatch silhouettes drawn in the same style.
import { normaliseLook } from './flames.js';

const NS = 'http://www.w3.org/2000/svg';
const VIEWBOX = '-20 0 140 56';
const ASPECT = 56 / 140;

/** Static path data in prototype units (car faces right, ground at y = 53). */
export const SIDE_ART = Object.freeze({
  coupe: {
    body: 'M6 40L8 29Q10 25 20 24L40 21Q48 8 64 8L82 8Q94 9 100 21L110 24Q116 27 116 35L116 40Z',
    glass: 'M45 21Q51 12 64 12L80 12Q88 13 92 21Z',
    pillars: [68],
    tail: 7,
  },
  ute: {
    body: 'M6 40L6 25L53 25L55 11Q56 9 62 9L80 9Q92 10 99 21L110 24Q116 27 116 35L116 40Z',
    glass: 'M58 21L59 13L79 13Q87 14 92 21Z',
    pillars: [],
    tray: 'M6 26L53 26',
    tail: 6,
  },
  hatch: {
    body: 'M8 40L8 23Q8 21 11 21L15 10Q16 8 22 8L78 8Q90 9 98 21L110 24Q116 27 116 35L116 40Z',
    glass: 'M18 20L20 12L76 12Q85 13 91 20Z',
    pillars: [44, 64],
    tail: 8,
  },
});

/** Build an SVG element. attrs values are strings/numbers we control or validated colours. */
export function svgEl(tag, attrs = {}, children = []) {
  const node = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null) node.setAttribute(k, String(v));
  for (const child of children) if (child) node.append(child);
  return node;
}

/** One wheel exactly as in the prototype. */
export function wheelArt(cx, rim, cy = 42) {
  const g = svgEl('g', { class: 'car-wheel' }, [
    svgEl('circle', { cx, cy, r: 11, fill: '#17171a' }),
    svgEl('circle', { cx, cy, r: 7.6, fill: '#2a2a30' }),
  ]);
  if (rim === 'dish') {
    g.append(svgEl('circle', { cx, cy, r: 6.6, fill: '#cfd3d8' }), svgEl('circle', { cx, cy, r: 3.4, fill: '#9aa0a8' }));
    return g;
  }
  const n = rim === 'mesh' ? 14 : 5;
  const w = rim === 'mesh' ? 0.8 : 2;
  for (let i = 0; i < n; i += 1) {
    g.append(svgEl('line', { x1: cx, y1: cy, x2: cx, y2: cy - 6.6, stroke: '#cfd3d8', 'stroke-width': w, transform: `rotate(${(i * 360) / n} ${cx} ${cy})` }));
  }
  g.append(svgEl('circle', { cx, cy, r: 1.9, fill: '#cfd3d8' }));
  return g;
}

function flameArt() {
  return svgEl('g', { class: 'car-flame' }, [
    svgEl('polygon', { points: '8,40 -12,38 -3,42 -17,46 8,46', fill: '#ff8a00' }),
    svgEl('polygon', { points: '8,41 -4,40 1,43 -5,45 8,45', fill: '#ffe14d' }),
  ]);
}

/** The car drawing (body, glass, lights, wheels, flame) for a validated look. */
export function sideCarArt(look) {
  const art = SIDE_ART[look.body] ?? SIDE_ART.coupe;
  const paint = look.color;
  const g = svgEl('g', { class: 'car-art' }, [
    flameArt(),
    svgEl('path', { d: art.body, fill: paint }),
    svgEl('path', { d: art.glass, fill: '#cde6f7' }),
  ]);
  for (const x of art.pillars) g.append(svgEl('path', { d: `M${x} 12L${x} 21`, stroke: paint, 'stroke-width': 1.5 }));
  if (art.tray) g.append(svgEl('path', { d: art.tray, stroke: '#000', 'stroke-opacity': 0.28, 'stroke-width': 1.6 }));
  g.append(
    svgEl('rect', { x: 108, y: 29, width: 7, height: 4, rx: 1.5, fill: '#fff3b0' }),
    svgEl('rect', { x: art.tail - 1, y: 28, width: 3.5, height: 4, rx: 1, fill: '#ff3b4a' }),
    wheelArt(30, look.rim),
    wheelArt(90, look.rim),
  );
  return g;
}

/** Restart a CSS pop animation on a flame group. */
export function restartPop(flame) {
  if (!flame) return;
  flame.classList.remove('on');
  void flame.getBoundingClientRect(); // reflow so the animation runs again
  flame.classList.add('on');
}

/**
 * Side-view car element with a gentle bob.
 * @param {object} look CarLook (validated here)
 * @param {{size?:number, bob?:boolean, bobDelay?:number, label?:string}} [opts]
 */
export function createSideCar(look, { size = 70, bob = true, bobDelay = 0, label = '' } = {}) {
  let current = normaliseLook(look);
  const holder = svgEl('g', { class: bob ? 'car-bob' : null });
  if (bob && bobDelay) holder.style.animationDelay = `-${Math.abs(Number(bobDelay) || 0)}s`;
  const el = svgEl('svg', {
    class: 'car-side',
    viewBox: VIEWBOX,
    width: size,
    height: Math.round(size * ASPECT),
    overflow: 'visible',
    role: label ? 'img' : null,
    'aria-label': label || null,
    'aria-hidden': label ? null : 'true',
    focusable: 'false',
  }, [holder]);

  function draw() {
    while (holder.firstChild) holder.removeChild(holder.firstChild);
    holder.append(sideCarArt(current));
  }
  draw();

  return Object.freeze({
    el,
    look: () => current,
    setLook(next) {
      current = normaliseLook(next, current);
      draw();
    },
    pop() {
      restartPop(holder.querySelector('.car-flame'));
    },
    destroy() {
      el.remove();
    },
  });
}

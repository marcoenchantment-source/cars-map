// Motorcycles for the Garage and the map: a sport bike and a cruiser, drawn in the same
// prototype units as the cars (side view faces right, ground at y = 53, wheels r 11 at y 42)
// so they share wheels, rims, paint and exhaust flames. The 3D model extrudes these paths too.
import { svgEl, wheelArt } from './car2d.js';

const DARK = '#1d1c22';
const METAL = '#2a2a30';
const CHROME = '#cfd3d8';
const PIPE = '#9aa0a8';
const GLASS = '#cde6f7';
const SUIT = '#45424f'; // rider's leathers: lighter than the bike's black parts so the rider reads

/** Side-view paths and positions per bike (prototype units). */
export const BIKE_ART = Object.freeze({
  sport: {
    wheels: [30, 92],
    body: 'M12 27L40 23L48 18Q53 13 64 13L74 15L80 9L88 9Q99 15 103 25L100 32L84 33L72 36L52 34L46 30L22 31Z',
    seat: 'M22 26L40 23L46 22L44 25L24 28Z',
    glass: 'M80 9L88 9Q94 12 97 17L84 16Z',
    engine: 'M50 30L74 30L72 41L56 41Z',
    fork: [[92, 42], [84, 16]],
    swingarm: [[30, 42], [54, 36]],
    pipes: [[[58, 39], [30, 33], [16, 31]]],
    bars: [80, 15],
    head: [99, 22],
    tail: [11, 25.5],
    flame: [6, -12], // shifts the car flame (base x 8, y 40..46) to the exhaust tip
    rider: {
      torso: 'M40 23L58 12Q62 9 66 11L70 14L64 17L58 16L48 25Z',
      leg: 'M42 24L56 27L60 34L56 35L50 30L42 28Z',
      arm: [[62, 13], [80, 15]],
      helmet: [72, 10.5],
    },
  },
  cruiser: {
    wheels: [26, 96],
    body: 'M50 25Q54 15 66 15Q76 15 80 21L78 25Z',
    fenders: ['M12 38Q14 26 26 26Q38 26 42 34L38 36Q34 30 26 30Q18 30 16 39Z', 'M86 37Q88 29 96 29Q104 29 107 36L103 37Q101 33 96 33Q91 33 90 38Z'],
    seat: 'M30 27L44 25Q48 28 52 26L52 29L32 31Z',
    engine: 'M44 30L74 26L80 30L76 41L50 41Z',
    cylinders: [[[56, 40], [52, 28]], [[66, 40], [72, 28]]],
    fork: [[96, 42], [84, 12]],
    pipes: [[[60, 40], [8, 39]], [[66, 36], [10, 35]]],
    bars: [78, 9],
    head: [89, 17],
    tail: [12, 30],
    flame: [0, -6],
    rider: {
      torso: 'M44 26L50 13Q52 10 56 11L60 14L58 17L54 27Z',
      leg: 'M44 27L62 28L66 38L62 39L58 31L44 31Z',
      arm: [[56, 15], [78, 10]],
      helmet: [55, 9.5],
    },
  },
});

const line = ([x1, y1], [x2, y2], stroke, width) => svgEl('path', { d: `M${x1} ${y1}L${x2} ${y2}`, stroke, 'stroke-width': width, 'stroke-linecap': 'round', fill: 'none' });
const poly = (pts, stroke, width) => svgEl('path', { d: `M${pts.map((p) => p.join(' ')).join('L')}`, stroke, 'stroke-width': width, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', fill: 'none' });

function riderArt(r, paint) {
  return svgEl('g', { class: 'bike-rider' }, [
    svgEl('path', { d: r.leg, fill: SUIT }),
    svgEl('path', { d: r.torso, fill: SUIT }),
    line(r.arm[0], r.arm[1], SUIT, 3),
    svgEl('circle', { cx: r.helmet[0], cy: r.helmet[1], r: 4.4, fill: paint }),
    svgEl('path', { d: `M${r.helmet[0]} ${r.helmet[1] - 1}l4.2 0.6l-0.4 2.4l-3.8 0Z`, fill: DARK }), // visor
  ]);
}

/**
 * Side view of a bike for a validated look, with the same flame group the cars use.
 * @param {object} look validated CarLook with a bike body
 * @param {SVGElement} flame the shared flame art (placed at the exhaust)
 */
export function sideBikeArt(look, flame) {
  const a = BIKE_ART[look.body] ?? BIKE_ART.sport;
  const paint = look.color;
  const g = svgEl('g', { class: 'car-art bike-art' }, [
    svgEl('g', { transform: `translate(${a.flame[0]} ${a.flame[1]})` }, [flame]),
    svgEl('path', { d: a.engine, fill: METAL }),
  ]);
  for (const [p, q] of a.cylinders ?? []) g.append(line(p, q, PIPE, 5));
  if (a.swingarm) g.append(line(a.swingarm[0], a.swingarm[1], METAL, 3.2));
  for (const pipe of a.pipes) g.append(poly(pipe, PIPE, 3));
  g.append(wheelArt(a.wheels[0], look.rim), wheelArt(a.wheels[1], look.rim));
  for (const d of a.fenders ?? []) g.append(svgEl('path', { d, fill: paint }));
  g.append(svgEl('path', { d: a.body, fill: paint }), svgEl('path', { d: a.seat, fill: DARK }));
  if (a.glass) g.append(svgEl('path', { d: a.glass, fill: GLASS }));
  g.append(
    line(a.fork[0], a.fork[1], CHROME, 2.6),
    svgEl('rect', { x: a.tail[0], y: a.tail[1], width: 3, height: 3, rx: 1, fill: '#ff3b4a' }),
    riderArt(a.rider, paint),
    line([a.bars[0], a.bars[1]], [a.bars[0] - 5, a.bars[1] - (look.body === 'cruiser' ? 3 : 0)], CHROME, 2.2),
    look.body === 'cruiser'
      ? svgEl('circle', { cx: a.head[0], cy: a.head[1], r: 3.2, fill: '#fff3b0', stroke: CHROME, 'stroke-width': 1 })
      : svgEl('rect', { x: a.head[0], y: a.head[1], width: 5, height: 3, rx: 1.2, fill: '#fff3b0' }),
  );
  return g;
}

// ---------------------------------------------------------------- top-down (map marker)

/** Exhaust x positions and the y where flames start, per bike, in the 40 x 92 marker box. */
export const BIKE_TOP_EXHAUST = Object.freeze({ sport: { xs: [25], y: 72 }, cruiser: { xs: [10.5, 29.5], y: 74 } });

/** Top-down bike (front at the top), drawn inside the cars' 40 x 92 marker box. */
export function topBikeArt(look) {
  const paint = look.color;
  if (look.body === 'cruiser') {
    return [
      svgEl('rect', { x: 16.5, y: 58, width: 7, height: 20, rx: 3, fill: '#17171a' }),
      svgEl('rect', { x: 17.5, y: 8, width: 5, height: 18, rx: 2.5, fill: '#17171a' }),
      svgEl('rect', { x: 9, y: 50, width: 3, height: 24, rx: 1.5, fill: PIPE }),
      svgEl('rect', { x: 28, y: 50, width: 3, height: 24, rx: 1.5, fill: PIPE }),
      svgEl('rect', { x: 15.5, y: 56, width: 9, height: 16, rx: 4, fill: paint }),
      svgEl('path', { d: 'M20 26C24 26 25 30 25 36L24 50C24 54 22 56 20 56C18 56 16 54 16 50L15 36C15 30 16 26 20 26Z', fill: paint }),
      svgEl('path', { d: 'M7 22Q20 28 33 22', stroke: CHROME, 'stroke-width': 2.2, fill: 'none', 'stroke-linecap': 'round' }),
      svgEl('path', { d: 'M12 44Q20 38 28 44L27 54Q20 51 13 54Z', fill: DARK }),
      svgEl('circle', { cx: 20, cy: 41, r: 4.4, fill: DARK }),
      svgEl('circle', { cx: 20, cy: 24, r: 2.5, fill: '#fff3b0' }),
      svgEl('rect', { x: 17, y: 72, width: 6, height: 2, rx: 1, fill: '#ff3b4a' }),
    ];
  }
  return [
    svgEl('rect', { x: 17.5, y: 58, width: 5, height: 20, rx: 2.5, fill: '#17171a' }),
    svgEl('rect', { x: 18, y: 9, width: 4, height: 17, rx: 2, fill: '#17171a' }),
    svgEl('rect', { x: 23.5, y: 52, width: 3, height: 20, rx: 1.5, fill: PIPE }),
    svgEl('path', { d: 'M20 21C24 21 26 25 26 31L25 58C25 64 23 68 20 68C17 68 15 64 15 58L14 31C14 25 16 21 20 21Z', fill: paint }),
    svgEl('path', { d: 'M20 23C23 23 24.5 26 25 30', fill: 'none', stroke: '#fff', 'stroke-opacity': 0.35, 'stroke-width': 1.2, 'stroke-linecap': 'round' }),
    svgEl('rect', { x: 10, y: 28, width: 20, height: 2.4, rx: 1.2, fill: METAL }),
    svgEl('path', { d: 'M13 42Q20 36 27 42L26 52Q20 49 14 52Z', fill: DARK }),
    svgEl('circle', { cx: 20, cy: 38, r: 4.2, fill: DARK }),
    svgEl('rect', { x: 17.5, y: 19.5, width: 5, height: 2, rx: 1, fill: '#fff3b0' }),
    svgEl('rect', { x: 17, y: 67.5, width: 6, height: 2, rx: 1, fill: '#ff3b4a' }),
  ];
}

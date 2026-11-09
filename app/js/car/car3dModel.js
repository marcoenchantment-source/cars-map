// Procedural low-poly car for the 3D layer, extruded from the owner's side-view art so the
// map car and the garage drawing share one silhouette. Frame: metres, x = right, y = up,
// nose toward -Z (the layer rotates the whole car by the heading).
import * as THREE from '../../vendor/three/three.module.js';

const U = 0.04; // metres per prototype unit along the car
const V = 0.034; // metres per prototype unit upward (a touch flatter than the cartoon)
const MID = 61; // prototype x of the car's middle (art spans 6..116)
const GROUND = 53; // prototype y of the road
export const BASE_LENGTH = 4.4;
export const WHEEL_RADIUS = 0.37;
const BODY_W = 1.72;
const CABIN_W = 1.36;
const TRACK = 0.8;
const TYRE_W = 0.3;
const R = WHEEL_RADIUS;

const PIECES = {
  coupe: {
    lower: 'M6 40L8 29Q10 25 20 24L40 21L100 21L110 24Q116 27 116 35L116 40Z',
    rearGlass: 'M40 21Q48 8 64 8L64 21Z',
    roof: 'M64 8L82 8L82 21L64 21Z',
    frontGlass: 'M82 8Q94 9 100 21L82 21Z',
    sideGlass: 'M45 21Q51 12 64 12L80 12Q88 13 92 21Z',
    pillars: [68],
    rearX: 7,
  },
  ute: {
    lower: 'M6 40L6 25L53 25L53 21L99 21L110 24Q116 27 116 35L116 40Z',
    rearGlass: 'M53 21L55 11Q56 9 62 9L62 21Z',
    roof: 'M62 9L80 9L80 21L62 21Z',
    frontGlass: 'M80 9Q92 10 99 21L80 21Z',
    sideGlass: 'M58 21L59 13L79 13Q87 14 92 21Z',
    pillars: [],
    rearX: 6,
    tray: { from: 6, to: 53, top: 25 },
  },
  hatch: {
    lower: 'M8 40L8 23Q8 21 11 21L98 21L110 24Q116 27 116 35L116 40Z',
    rearGlass: 'M11 21L15 10Q16 8 22 8L26 8L26 21Z',
    roof: 'M26 8L78 8L78 21L26 21Z',
    frontGlass: 'M78 8Q90 9 98 21L78 21Z',
    sideGlass: 'M18 20L20 12L76 12Q85 13 91 20Z',
    pillars: [44, 64],
    rearX: 8,
  },
};

const toS = (x) => (x - MID) * U; // along the car, + = front
const toY = (y) => (GROUND - y) * V;
const toZ = (x) => -toS(x); // three.js z (front is -Z)

/** Parse the absolute M/L/Q/Z subset used by the art into a THREE.Shape (x = along, y = up). */
function shapeFromPath(d) {
  const tokens = d.match(/[MLQZ]|-?\d*\.?\d+/g) ?? [];
  const shape = new THREE.Shape();
  let i = 0;
  let cmd = null;
  const num = () => Number(tokens[i++]);
  while (i < tokens.length) {
    if (/^[MLQZ]$/.test(tokens[i])) {
      cmd = tokens[i++];
      if (cmd === 'Z') shape.closePath();
      continue;
    }
    if (cmd === 'M') {
      shape.moveTo(toS(num()), toY(num()));
      cmd = 'L';
    } else if (cmd === 'L') shape.lineTo(toS(num()), toY(num()));
    else if (cmd === 'Q') {
      const cx = toS(num());
      const cy = toY(num());
      shape.quadraticCurveTo(cx, cy, toS(num()), toY(num()));
    } else i += 1;
  }
  return shape;
}

/** Extrude a side profile across the car's width, centred, nose to -Z. */
function extrudeSide(d, width, bevel = 0) {
  const depth = Math.max(0.01, width - 2 * bevel);
  const geo = new THREE.ExtrudeGeometry(shapeFromPath(d), {
    depth, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel * 0.8, bevelSegments: 3, curveSegments: 10,
  });
  geo.translate(0, 0, -depth / 2);
  geo.rotateY(Math.PI / 2); // shape x (front) -> -Z, extrusion -> X
  return geo;
}

/** Concatenate geometries (position + normal only) into one, disposing the parts. */
function merge(parts) {
  const flat = parts.map((g) => (g.index ? g.toNonIndexed() : g));
  const count = flat.reduce((n, g) => n + g.getAttribute('position').count, 0);
  const pos = new Float32Array(count * 3);
  const nor = new Float32Array(count * 3);
  let offset = 0;
  for (const g of flat) {
    pos.set(g.getAttribute('position').array, offset);
    nor.set(g.getAttribute('normal').array, offset);
    offset += g.getAttribute('position').array.length;
  }
  for (const g of new Set([...parts, ...flat])) g.dispose();
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  return out;
}

function spokes(n, width, from, to) {
  const parts = [];
  for (let i = 0; i < n; i += 1) {
    const g = new THREE.BoxGeometry(width, to - from, 0.035);
    g.translate(0, from + (to - from) / 2, 0.012);
    g.rotateZ((i / n) * Math.PI * 2);
    parts.push(g);
  }
  return parts;
}

const ring = (radius, tube) => new THREE.TorusGeometry(radius, tube, 6, 32);
function hub(radius, depth, z) {
  const g = new THREE.CylinderGeometry(radius, radius, depth, 16);
  g.rotateX(Math.PI / 2);
  g.translate(0, 0, z);
  return g;
}

/** Rim face geometry (XY plane, facing +Z) for a rim style. */
function rimGeometry(rim) {
  if (rim === 'dish') {
    const profile = [[0.001, -0.02], [R * 0.16, -0.02], [R * 0.2, -0.09], [R * 0.46, -0.09], [R * 0.62, -0.004], [R * 0.74, 0]];
    const lathe = new THREE.LatheGeometry(profile.map(([r, h]) => new THREE.Vector2(r, h)), 32);
    lathe.rotateX(Math.PI / 2);
    return merge([lathe, ring(R * 0.73, 0.02), hub(R * 0.12, 0.05, -0.01)]);
  }
  if (rim === 'mesh') {
    return merge([...spokes(14, 0.022, R * 0.12, R * 0.7), ring(R * 0.42, 0.012), ring(R * 0.72, 0.02), hub(R * 0.14, 0.06, 0.01)]);
  }
  return merge([...spokes(5, 0.08, R * 0.12, R * 0.68), ring(R * 0.72, 0.02), hub(R * 0.17, 0.07, 0.01)]);
}

function flameCone(radius, height, base, tip) {
  const g = new THREE.ConeGeometry(radius, height, 14, 4, true);
  g.translate(0, height / 2, 0); // base at the exhaust, apex behind
  const colors = [];
  const p = g.getAttribute('position');
  for (let i = 0; i < p.count; i += 1) {
    const t = p.getY(i) / height;
    colors.push(base[0] + (tip[0] - base[0]) * t, base[1] + (tip[1] - base[1]) * t, base[2] + (tip[2] - base[2]) * t);
  }
  g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  g.rotateX(Math.PI / 2); // apex toward +Z (the back of the car)
  return g;
}

function materials(color, textures) {
  const additive = { transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide };
  return {
    paint: new THREE.MeshStandardMaterial({ color, metalness: 0.5, roughness: 0.35 }),
    glass: new THREE.MeshStandardMaterial({ color: '#36506a', metalness: 0.3, roughness: 0.06 }),
    trim: new THREE.MeshStandardMaterial({ color: '#1d1c22', roughness: 0.7 }),
    rubber: new THREE.MeshStandardMaterial({ color: '#141416', roughness: 0.92 }),
    barrel: new THREE.MeshStandardMaterial({ color: '#2a2a30', metalness: 0.4, roughness: 0.5, side: THREE.DoubleSide }),
    silver: new THREE.MeshStandardMaterial({ color: '#d4d8de', metalness: 0.9, roughness: 0.22, side: THREE.DoubleSide }),
    chrome: new THREE.MeshStandardMaterial({ color: '#9aa0a8', metalness: 1, roughness: 0.3 }),
    head: new THREE.MeshBasicMaterial({ color: '#fff3b0' }),
    tail: new THREE.MeshBasicMaterial({ color: '#ff2a3d' }),
    flame: new THREE.MeshBasicMaterial({ ...additive, vertexColors: true }),
    core: new THREE.MeshBasicMaterial({ ...additive, vertexColors: true }),
    shadow: new THREE.MeshBasicMaterial({ color: '#000000', map: textures.shadow, transparent: true, depthWrite: false, opacity: 0.55 }),
    glow: new THREE.MeshBasicMaterial({ ...additive, map: textures.glow, opacity: 0 }),
  };
}

function box(w, h, d, x, y, z, mat) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  return m;
}

function buildBody(art, mat, group) {
  group.add(new THREE.Mesh(extrudeSide(art.lower, BODY_W, 0.05), mat.paint));
  group.add(new THREE.Mesh(extrudeSide(art.rearGlass, CABIN_W), mat.glass));
  group.add(new THREE.Mesh(extrudeSide(art.roof, CABIN_W + 0.02, 0.01), mat.paint));
  group.add(new THREE.Mesh(extrudeSide(art.frontGlass, CABIN_W), mat.glass));
  group.add(new THREE.Mesh(extrudeSide(art.sideGlass, CABIN_W + 0.03), mat.glass));
  for (const x of art.pillars) group.add(box(CABIN_W + 0.05, toY(12) - toY(21), 0.06, 0, (toY(12) + toY(21)) / 2, toZ(x), mat.paint));
  if (art.tray) {
    const { from, to, top } = art.tray;
    const len = (to - from) * U;
    const zMid = (toZ(from) + toZ(to)) / 2;
    const y = toY(top);
    group.add(box(BODY_W - 0.14, 0.02, len - 0.08, 0, y + 0.012, zMid, mat.trim));
    for (const side of [-1, 1]) group.add(box(0.07, 0.12, len, side * (BODY_W / 2 - 0.04), y + 0.06, zMid, mat.paint));
    group.add(box(BODY_W, 0.12, 0.07, 0, y + 0.06, toZ(from) - 0.03, mat.paint));
  }
}

function buildLights(art, mat, group) {
  const rearZ = toZ(art.rearX);
  const frontZ = toZ(114);
  for (const side of [-1, 1]) {
    group.add(box(0.36, 0.13, 0.12, side * 0.55, 0.76, frontZ - 0.02, mat.head));
    group.add(box(0.34, 0.14, 0.08, side * 0.58, 0.72, rearZ + 0.03, mat.tail));
    const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.065, 0.065, 0.22, 12), mat.chrome);
    pipe.rotation.x = Math.PI / 2;
    pipe.position.set(side * 0.42, 0.47, rearZ + 0.05);
    group.add(pipe);
  }
  group.add(box(1.1, 0.05, 0.06, 0, 0.72, rearZ + 0.04, mat.tail)); // full-width light bar
  return rearZ;
}

function buildWheels(rim, mat, group) {
  const tyreGeo = new THREE.CylinderGeometry(R, R, TYRE_W, 28);
  tyreGeo.rotateZ(Math.PI / 2);
  const barrelGeo = new THREE.CircleGeometry(R * 0.74, 28);
  const rimGeo = rimGeometry(rim);
  const spinners = [];
  for (const z of [toZ(30), toZ(90)]) {
    for (const side of [-1, 1]) {
      const mount = new THREE.Group();
      mount.position.set(side * TRACK, R, z);
      const spinner = new THREE.Group();
      spinner.add(new THREE.Mesh(tyreGeo, mat.rubber));
      const face = new THREE.Group();
      face.position.x = side * (TYRE_W / 2 + 0.004);
      face.rotation.y = (side * Math.PI) / 2; // +Z face -> outward
      face.add(new THREE.Mesh(barrelGeo, mat.barrel), new THREE.Mesh(rimGeo, mat.silver));
      spinner.add(face);
      mount.add(spinner);
      group.add(mount);
      spinners.push(spinner);
    }
  }
  return spinners;
}

function buildFlames(rearZ, mat, group) {
  const outerGeo = flameCone(0.17, 0.95, [1, 0.78, 0.35], [0.35, 0.05, 0]);
  const coreGeo = flameCone(0.085, 0.5, [1, 1, 0.75], [1, 0.55, 0.1]);
  const flames = [];
  for (const side of [-1, 1]) {
    const f = new THREE.Group();
    f.position.set(side * 0.42, 0.47, rearZ + 0.16);
    f.add(new THREE.Mesh(outerGeo, mat.flame), new THREE.Mesh(coreGeo, mat.core));
    f.visible = false;
    group.add(f);
    flames.push(f);
  }
  const glowGeo = new THREE.PlaneGeometry(1.8, 2);
  glowGeo.rotateX(-Math.PI / 2);
  const glow = new THREE.Mesh(glowGeo, mat.glow);
  glow.position.set(0, 0.03, rearZ + 0.9);
  glow.visible = false;
  group.add(glow);
  return { flames, glow };
}

/** A soft radial texture (shadow blob, flame glow on the road). */
export function radialTexture(inner, outer, size = 128) {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const g = canvas.getContext('2d');
  const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, inner);
  grad.addColorStop(0.55, inner.replace(/[\d.]+\)$/, (a) => `${Number.parseFloat(a) * 0.55})`));
  grad.addColorStop(1, outer);
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/**
 * @param {{color:string, rim:string, body:string}} look validated CarLook
 * @param {{shadow: THREE.Texture, glow: THREE.Texture}} textures shared textures
 */
export function buildCarModel(look, textures) {
  const art = PIECES[look.body] ?? PIECES.coupe;
  const mat = materials(look.color, textures);
  const group = new THREE.Group();
  buildBody(art, mat, group);
  const rearZ = buildLights(art, mat, group);
  const spinners = buildWheels(look.rim, mat, group);
  const { flames, glow } = buildFlames(rearZ, mat, group);

  const shadowGeo = new THREE.PlaneGeometry(BODY_W * 1.4, BASE_LENGTH * 1.14);
  shadowGeo.rotateX(-Math.PI / 2);
  const shadow = new THREE.Mesh(shadowGeo, mat.shadow);
  shadow.position.y = 0.015;
  shadow.renderOrder = -1;
  group.add(shadow);
  group.traverse((o) => {
    o.frustumCulled = false; // the layer supplies a custom projection; never cull the car
  });

  return {
    group,
    look: { ...look },
    setPaint(color) {
      mat.paint.color.set(color);
    },
    setSpin(angle) {
      for (const s of spinners) s.rotation.x = angle;
    },
    /** frame: {scale, opacity} from flameFrame, or null to hide. stretch: per-pop length jitter. */
    setFlame(frame, stretch = 1) {
      const on = !!frame;
      for (const f of flames) {
        f.visible = on;
        if (on) f.scale.set(frame.scale, frame.scale, frame.scale * stretch);
      }
      glow.visible = on;
      if (on) {
        mat.flame.opacity = frame.opacity;
        mat.core.opacity = frame.opacity;
        mat.glow.opacity = 0.75 * frame.opacity;
      }
    },
    dispose() {
      const geos = new Set();
      group.traverse((o) => o.geometry && geos.add(o.geometry));
      for (const g of geos) g.dispose();
      for (const m of Object.values(mat)) m.dispose();
    },
  };
}

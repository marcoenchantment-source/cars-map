// Procedural low-poly motorcycle for the 3D layer: the Garage side-view paths (bikeArt.js)
// extruded to a bike's narrow width, two wheels on the centre line, chrome fork and pipes, and
// a rider in a helmet painted to match. Same frame and API as the car (car3dModel.js).
import * as THREE from '../../vendor/three/three.module.js';
import { BIKE_ART } from './bikeArt.js';
import { parts, WHEEL_RADIUS as R } from './car3dModel.js';

const TYRE_W = 0.2;
const BODY_W = 0.36; // sport fairing: slim, so the tucked rider's shoulders and knees show
const SUIT = '#45424f';
const TANK_W = 0.44;
const FENDER_W = 0.26;

/** A rod (cylinder) between two points in prototype units, at side offset x (metres). */
function rod(p, q, radius, mat, x = 0) {
  const { toY, toZ } = parts;
  const a = new THREE.Vector3(x, toY(p[1]), toZ(p[0]));
  const b = new THREE.Vector3(x, toY(q[1]), toZ(q[0]));
  const dir = b.clone().sub(a);
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, dir.length(), 10), mat);
  mesh.position.copy(a.add(b).multiplyScalar(0.5));
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
  return mesh;
}

function buildWheels(art, rim, mat, group) {
  const { toZ } = parts;
  const tyreGeo = new THREE.CylinderGeometry(R, R, TYRE_W, 28);
  tyreGeo.rotateZ(Math.PI / 2);
  const barrelGeo = new THREE.CircleGeometry(R * 0.74, 28);
  const rimGeo = parts.rimGeometry(rim);
  return art.wheels.map((x) => {
    const mount = new THREE.Group();
    mount.position.set(0, R, toZ(x));
    const spinner = new THREE.Group();
    spinner.add(new THREE.Mesh(tyreGeo, mat.rubber));
    for (const side of [-1, 1]) {
      const face = new THREE.Group();
      face.position.x = side * (TYRE_W / 2 + 0.004);
      face.rotation.y = (side * Math.PI) / 2;
      face.add(new THREE.Mesh(barrelGeo, mat.barrel), new THREE.Mesh(rimGeo, mat.silver));
      spinner.add(face);
    }
    mount.add(spinner);
    group.add(mount);
    return spinner;
  });
}

function buildFrame(art, mat, group) {
  const { extrudeSide } = parts;
  group.add(new THREE.Mesh(extrudeSide(art.engine, 0.42, 0.03), mat.trim));
  group.add(new THREE.Mesh(extrudeSide(art.body, art.fenders ? TANK_W : BODY_W, 0.04), mat.paint));
  for (const d of art.fenders ?? []) group.add(new THREE.Mesh(extrudeSide(d, FENDER_W, 0.02), mat.paint));
  group.add(new THREE.Mesh(extrudeSide(art.seat, 0.36, 0.03), mat.trim));
  if (art.glass) group.add(new THREE.Mesh(extrudeSide(art.glass, 0.38), mat.glass));
  for (const side of [-1, 1]) {
    group.add(rod(art.fork[0], art.fork[1], 0.035, mat.chrome, side * 0.09));
    if (art.swingarm) group.add(rod(art.swingarm[0], art.swingarm[1], 0.04, mat.trim, side * 0.12));
  }
  for (const [p, q] of art.cylinders ?? []) group.add(rod(p, q, 0.09, mat.chrome));
  const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, art.fenders ? 0.9 : 0.62, 8), mat.chrome);
  bar.rotation.z = Math.PI / 2;
  bar.position.set(0, parts.toY(art.bars[1]), parts.toZ(art.bars[0] - 3));
  group.add(bar);
}

/** Exhaust pipes; returns the tip positions (metres) where flames come out. */
function buildPipes(art, mat, group) {
  const { toY, toZ } = parts;
  const tips = [];
  art.pipes.forEach((pipe, i) => {
    const x = art.pipes.length > 1 ? (i === 0 ? 0.22 : -0.22) : 0.2;
    for (let k = 1; k < pipe.length; k += 1) group.add(rod(pipe[k - 1], pipe[k], 0.05, mat.chrome, x));
    const end = pipe[pipe.length - 1];
    tips.push(new THREE.Vector3(x, toY(end[1]), toZ(end[0])));
  });
  return tips;
}

function buildRider(r, mat, group) {
  const { extrudeSide, toY, toZ } = parts;
  group.add(new THREE.Mesh(extrudeSide(r.torso, 0.5, 0.06), mat.suit));
  for (const side of [-1, 1]) {
    const leg = new THREE.Mesh(extrudeSide(r.leg, 0.13, 0.03), mat.suit);
    leg.position.x = side * 0.22;
    group.add(leg, rod(r.arm[0], r.arm[1], 0.05, mat.suit, side * 0.22));
  }
  const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.17, 18, 12), mat.paint);
  helmet.position.set(0, toY(r.helmet[1]), toZ(r.helmet[0]));
  const visor = new THREE.Mesh(new THREE.SphereGeometry(0.172, 18, 8, -Math.PI * 0.35, Math.PI * 0.7, Math.PI * 0.32, Math.PI * 0.24), mat.glass);
  visor.position.copy(helmet.position);
  visor.rotation.y = Math.PI; // faces the front (-Z)
  group.add(helmet, visor);
}

function buildLights(art, mat, group) {
  const { toY, toZ, box } = parts;
  group.add(box(0.22, 0.12, 0.08, 0, toY(art.head[1] + 1.5), toZ(art.head[0] + 4), mat.head));
  group.add(box(0.2, 0.1, 0.06, 0, toY(art.tail[1] + 1.5), toZ(art.tail[0]) + 0.03, mat.tail));
}

function buildFlames(tips, mat, group) {
  const outerGeo = parts.flameCone(0.12, 0.8, [1, 0.78, 0.35], [0.35, 0.05, 0]);
  const coreGeo = parts.flameCone(0.06, 0.42, [1, 1, 0.75], [1, 0.55, 0.1]);
  const flames = tips.map((tip) => {
    const f = new THREE.Group();
    f.position.set(tip.x, tip.y, tip.z + 0.06);
    f.add(new THREE.Mesh(outerGeo, mat.flame), new THREE.Mesh(coreGeo, mat.core));
    f.visible = false;
    group.add(f);
    return f;
  });
  const glowGeo = new THREE.PlaneGeometry(1.2, 1.8);
  glowGeo.rotateX(-Math.PI / 2);
  const glow = new THREE.Mesh(glowGeo, mat.glow);
  glow.position.set(0, 0.03, Math.max(...tips.map((t) => t.z)) + 0.8);
  glow.visible = false;
  group.add(glow);
  return { flames, glow };
}

/**
 * @param {{color:string, rim:string, body:'sport'|'cruiser'}} look validated CarLook
 * @param {{shadow: THREE.Texture, glow: THREE.Texture}} textures shared textures
 * @returns the same shape as buildCarModel
 */
export function buildBikeModel(look, textures) {
  const art = BIKE_ART[look.body] ?? BIKE_ART.sport;
  const mat = { ...parts.materials(look.color, textures), suit: new THREE.MeshStandardMaterial({ color: SUIT, roughness: 0.6 }) };
  const group = new THREE.Group();
  const spinners = buildWheels(art, look.rim, mat, group);
  buildFrame(art, mat, group);
  const tips = buildPipes(art, mat, group);
  buildRider(art.rider, mat, group);
  buildLights(art, mat, group);
  const { flames, glow } = buildFlames(tips, mat, group);

  const shadowGeo = new THREE.PlaneGeometry(1.1, 4.2);
  shadowGeo.rotateX(-Math.PI / 2);
  const shadow = new THREE.Mesh(shadowGeo, mat.shadow);
  shadow.position.y = 0.015;
  shadow.renderOrder = -1;
  group.add(shadow);
  group.traverse((o) => {
    o.frustumCulled = false; // the layer supplies a custom projection; never cull the bike
  });

  return parts.modelApi({ group, look, mat, spinners, flames, glow });
}

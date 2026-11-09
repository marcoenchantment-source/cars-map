// The driver's 3D car: a MapLibre custom layer (renderingMode '3d') drawn with three.js on
// the map's own WebGL 2 context. The car is glued to camera.onFrame poses, kept ~70 px long
// at any zoom, turned to the heading, and pops additive flames from the exhausts.
//
// Transform (debug notes): local frame is metres, x = east, y = up, z = south, origin at the
// car. modelToMercator = T(mercator x,y,z) * S(m, -m, m) * Rx(90deg), m = metres in mercator
// units; full = mainMatrix * modelToMercator. For proper lighting it is split into
// projection P = args.projectionMatrix and view V = P^-1 * full (P * V == full exactly).
// Heading: the nose is -Z (north at rotation 0); bearings are clockwise seen from above,
// three's +Y rotation is counter-clockwise, so rotation.y = -bearing.
import * as THREE from '../../vendor/three/three.module.js';
import { buildCarModel, radialTexture, BASE_LENGTH, WHEEL_RADIUS } from './car3dModel.js';
import { normaliseLook, flameFrame, carLengthMetres, smallDistance, POP_MS } from './flames.js';

export const LAYER_ID = 'cm-car-3d';
const CAR_PX = 70;
const DEG = Math.PI / 180;
const MAX_FAILURES = 3;
const RETRY_MS = 300;
const RETRY_LIMIT = 30;
const MAX_SPIN_STEP_M = 60; // ignore jumps when spinning the wheels
const ROT_X = new THREE.Matrix4().makeRotationX(Math.PI / 2);

function environmentTexture() {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 128;
  const g = c.getContext('2d');
  const sky = g.createLinearGradient(0, 0, 0, 128);
  sky.addColorStop(0, '#c9d0ff');
  sky.addColorStop(0.42, '#f6f3ff');
  sky.addColorStop(0.5, '#ffffff');
  sky.addColorStop(0.54, '#8e88a3');
  sky.addColorStop(1, '#25212e');
  g.fillStyle = sky;
  g.fillRect(0, 0, 256, 128);
  g.fillStyle = 'rgba(255,255,255,0.95)'; // two softboxes for crisp paint highlights
  g.fillRect(36, 16, 64, 14);
  g.fillRect(150, 24, 72, 10);
  const tex = new THREE.CanvasTexture(c);
  tex.mapping = THREE.EquirectangularReflectionMapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function createGfx(map, gl, look) {
  if (typeof WebGL2RenderingContext === 'undefined' || !(gl instanceof WebGL2RenderingContext)) {
    throw new Error('The 3D car needs WebGL 2');
  }
  const renderer = new THREE.WebGLRenderer({ canvas: map.getCanvas(), context: gl, antialias: true });
  renderer.autoClear = false;
  const scene = new THREE.Scene();
  const camera = new THREE.Camera();
  camera.matrixAutoUpdate = false;
  camera.matrixWorldAutoUpdate = false; // we set matrixWorld / matrixWorldInverse ourselves
  const root = new THREE.Group();
  scene.add(root);
  const key = new THREE.DirectionalLight('#ffffff', 2.6);
  scene.add(new THREE.HemisphereLight('#f4f0ff', '#2e2a3a', 1.5), key, key.target);
  const textures = {
    shadow: radialTexture('rgba(0,0,0,0.85)', 'rgba(0,0,0,0)'),
    glow: radialTexture('rgba(255,150,40,0.9)', 'rgba(255,90,0,0)'),
  };
  const model = buildCarModel(look, textures);
  root.add(model.group);
  return { renderer, scene, camera, root, key, model, textures, envSource: environmentTexture(), env: null };
}

function disposeGfxObject(gfx) {
  if (!gfx) return;
  try {
    gfx.model.dispose();
    gfx.textures.shadow.dispose();
    gfx.textures.glow.dispose();
    gfx.envSource.dispose();
    if (gfx.env) gfx.env.dispose();
    gfx.renderer.dispose();
  } catch (err) {
    console.warn('[car] 3D cleanup failed', err);
  }
}

const tmp = { full: new THREE.Matrix4(), model: new THREE.Matrix4(), proj: new THREE.Matrix4(), inv: new THREE.Matrix4(), s: new THREE.Vector3() };

/** Point the three.js camera at the car: see the header comment for the maths. */
export function applyMatrices(camera, args, pose) {
  const merc = maplibregl.MercatorCoordinate.fromLngLat([pose.lng, pose.lat], 0);
  const m = merc.meterInMercatorCoordinateUnits();
  tmp.model.makeTranslation(merc.x, merc.y, merc.z).scale(tmp.s.set(m, -m, m)).multiply(ROT_X);
  tmp.full.fromArray(args.defaultProjectionData.mainMatrix).multiply(tmp.model);
  const p = args.projectionMatrix;
  if (p && p.length === 16) {
    tmp.proj.fromArray(p);
    if (Math.abs(tmp.proj.determinant()) > 1e-12) {
      tmp.inv.copy(tmp.proj).invert();
      camera.projectionMatrix.copy(tmp.proj);
      camera.projectionMatrixInverse.copy(tmp.inv);
      camera.matrixWorldInverse.multiplyMatrices(tmp.inv, tmp.full);
      camera.matrixWorld.copy(camera.matrixWorldInverse).invert();
      return;
    }
  }
  // Fallback (MapLibre's own example): everything in the projection, identity view.
  camera.projectionMatrix.copy(tmp.full);
  camera.projectionMatrixInverse.copy(tmp.full).invert();
  camera.matrixWorldInverse.identity();
  camera.matrixWorld.identity();
}

/** Key light from behind the viewer's left shoulder, so the side we see is lit at any heading. */
function aimKeyLight(key, mapBearing) {
  const b = mapBearing * DEG;
  const fx = Math.sin(b);
  const fz = -Math.cos(b);
  const lx = -Math.cos(b);
  const lz = -Math.sin(b);
  key.position.set((-fx * 0.6 + lx * 0.5) * 10, 12, (-fz * 0.6 + lz * 0.5) * 10);
}

/**
 * Add the 3D car. Rejects (and leaves nothing behind) if WebGL 2 / three.js cannot start.
 * @param {object} ctx app context
 * @param {object} initialLook CarLook
 * @param {{onFail?: (err: Error) => void}} [opts] called (async) if the car breaks later
 */
export async function createCar3D(ctx, initialLook, { onFail } = {}) {
  const { map, mapView } = ctx;
  const reduced = !!mapView.reduceMotion || matchMedia('(prefers-reduced-motion: reduce)').matches;
  let look = normaliseLook(initialLook);
  let gfx = null;
  let setupError = null;
  let pose = null;
  let pendingDistance = 0;
  let spin = 0;
  let lastPopAt = -Infinity;
  let stretch = 1;
  let failures = 0;
  let lost = false;
  let broken = false;
  let destroyed = false;
  let moving = false;

  function disposeGfx() {
    const old = gfx;
    gfx = null;
    disposeGfxObject(old);
  }

  function fail(err) {
    if (broken) return;
    broken = true;
    setTimeout(() => onFail?.(err), 0); // never tear down layers inside MapLibre's render
  }

  function ensureEnvironment(gl) {
    if (gfx.env !== null) return;
    try {
      const pm = new THREE.PMREMGenerator(gfx.renderer);
      gfx.env = pm.fromEquirectangular(gfx.envSource);
      pm.dispose();
      gfx.scene.environment = gfx.env.texture;
    } catch (err) {
      console.warn('[car] paint reflections unavailable', err);
      gfx.env = false;
    }
    gfx.renderer.resetState();
    gfx.renderer.setViewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
  }

  function placeCar() {
    const len = carLengthMetres({ zoom: map.getZoom(), lat: pose.lat, pitch: map.getPitch(), px: CAR_PX });
    const scale = len / BASE_LENGTH;
    gfx.root.scale.setScalar(scale);
    gfx.root.rotation.set(0, -pose.bearing * DEG, 0);
    if (!reduced && pendingDistance > 0) spin = (spin - pendingDistance / (WHEEL_RADIUS * scale)) % (Math.PI * 2);
    pendingDistance = 0;
    gfx.model.setSpin(spin);
    aimKeyLight(gfx.key, map.getBearing());
  }

  /** @returns {boolean} true while a pop is on screen (keep repainting) */
  function animateFlames() {
    const frame = flameFrame(performance.now() - lastPopAt, POP_MS, reduced);
    gfx.model.setFlame(frame, stretch);
    return !!frame;
  }

  function render(gl, args) {
    if (!gfx || lost || broken || destroyed || !pose) return;
    const data = args?.defaultProjectionData;
    if (!data?.mainMatrix) return;
    if ((data.projectionTransition ?? 0) > 0.001) return; // globe intro: the car appears on landing
    try {
      const { renderer, scene, camera } = gfx;
      renderer.resetState();
      renderer.setViewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
      ensureEnvironment(gl);
      applyMatrices(camera, args, pose);
      placeCar();
      const animating = animateFlames();
      renderer.clearDepth(); // the car always sits on top of buildings
      renderer.render(scene, camera);
      failures = 0;
      if (animating) map.triggerRepaint();
    } catch (err) {
      failures += 1;
      console.error('[car] 3D car frame failed', err);
      if (failures >= MAX_FAILURES) fail(err);
    }
  }

  function makeLayer() {
    return {
      id: LAYER_ID,
      type: 'custom',
      renderingMode: '3d',
      onAdd(m, gl) {
        try {
          gfx = createGfx(m, gl, look);
        } catch (err) {
          setupError = err;
          disposeGfx();
        }
      },
      onRemove() {
        disposeGfx();
      },
      render,
    };
  }

  function addLayer() {
    setupError = null;
    map.addLayer(makeLayer());
    if (setupError) {
      const err = setupError;
      try {
        if (map.getLayer(LAYER_ID)) map.removeLayer(LAYER_ID);
      } catch {
        /* already gone */
      }
      throw err;
    }
  }

  const keepOnTop = () => {
    if (moving || destroyed || !map.getLayer(LAYER_ID)) return;
    const order = map.getLayersOrder?.();
    if (!order?.length || order[order.length - 1] === LAYER_ID) return;
    moving = true;
    try {
      map.moveLayer(LAYER_ID);
    } catch (err) {
      console.warn('[car] could not keep the car on top', err);
    } finally {
      moving = false;
    }
  };

  const onLost = () => {
    lost = true;
  };
  const onRestored = () => {
    lost = false;
    disposeGfx();
    let tries = 0;
    const attempt = () => {
      if (destroyed || lost || map.getLayer(LAYER_ID)) return;
      try {
        addLayer();
        map.triggerRepaint();
      } catch (err) {
        tries += 1;
        if (tries < RETRY_LIMIT) setTimeout(attempt, RETRY_MS);
        else fail(err);
      }
    };
    setTimeout(attempt, RETRY_MS);
  };

  await mapView.ready;
  if (map.getLayer(LAYER_ID)) map.removeLayer(LAYER_ID);
  addLayer(); // throws → caller falls back to the 2D marker

  const offFrame = mapView.camera.onFrame((p) => {
    if (!p || !Number.isFinite(p.lng) || !Number.isFinite(p.lat)) return;
    const d = smallDistance(pose, p);
    if (d < MAX_SPIN_STEP_M) pendingDistance += d;
    pose = { lng: p.lng, lat: p.lat, bearing: Number.isFinite(p.bearing) ? p.bearing : 0 };
    map.triggerRepaint();
  });
  map.on('styledata', keepOnTop);
  map.on('webglcontextlost', onLost);
  map.on('webglcontextrestored', onRestored);
  keepOnTop();

  return Object.freeze({
    kind: '3d',
    setLook(next) {
      const prev = look;
      look = normaliseLook(next, prev);
      if (!gfx) return;
      try {
        if (look.body !== prev.body || look.rim !== prev.rim) {
          gfx.root.remove(gfx.model.group);
          gfx.model.dispose();
          gfx.model = buildCarModel(look, gfx.textures);
          gfx.root.add(gfx.model.group);
        } else if (look.color !== prev.color) gfx.model.setPaint(look.color);
      } catch (err) {
        console.error('[car] could not restyle the 3D car', err);
        fail(err);
      }
      map.triggerRepaint();
    },
    pop() {
      lastPopAt = performance.now();
      stretch = 0.85 + Math.random() * 0.35;
      map.triggerRepaint();
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      offFrame();
      map.off('styledata', keepOnTop);
      map.off('webglcontextlost', onLost);
      map.off('webglcontextrestored', onRestored);
      try {
        if (map.getLayer(LAYER_ID)) map.removeLayer(LAYER_ID);
      } catch (err) {
        console.warn('[car] could not remove the 3D layer', err);
      }
      disposeGfx();
      map.triggerRepaint();
    },
  });
}

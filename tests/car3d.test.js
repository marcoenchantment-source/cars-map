// Headless checks of the 3D car: every body/rim builds, and the layer maths puts the nose on
// the heading (bearing clockwise from north, mercator y pointing south).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../app/vendor/three/three.module.js';
import { buildCarModel, BASE_LENGTH } from '../app/js/car/car3dModel.js';
import { applyMatrices } from '../app/js/car/car3d.js';
import { RIMS, BODIES, flameFrame } from '../app/js/car/flames.js';

// Minimal stand-in for maplibregl.MercatorCoordinate (web mercator, 0..1, y down).
globalThis.maplibregl = {
  MercatorCoordinate: {
    fromLngLat([lng, lat], alt = 0) {
      const x = (180 + lng) / 360;
      const y = (180 - (180 / Math.PI) * Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360))) / 360;
      const metres = 1 / (40075016.686 * Math.cos((lat * Math.PI) / 180));
      return { x, y, z: alt * metres, meterInMercatorCoordinateUnits: () => metres };
    },
  },
};

const textures = { shadow: new THREE.Texture(), glow: new THREE.Texture() };

test('every body and rim builds a car with geometry and disposes cleanly', () => {
  for (const body of BODIES) {
    for (const rim of RIMS) {
      const model = buildCarModel({ color: '#ff4fa3', rim, body }, textures);
      let meshes = 0;
      model.group.traverse((o) => {
        if (o.isMesh) {
          meshes += 1;
          assert.ok(o.geometry.getAttribute('position').count > 0, `${body}/${rim} empty mesh`);
          assert.equal(o.frustumCulled, false);
        }
      });
      assert.ok(meshes > 15, `${body}/${rim} has ${meshes} meshes`);
      model.group.updateMatrixWorld(true);
      const box = new THREE.Box3();
      model.group.traverse((o) => {
        if (o.isMesh && !o.material.transparent) box.expandByObject(o); // body, wheels, lights
      });
      const size = box.getSize(new THREE.Vector3());
      assert.ok(Math.abs(size.z - BASE_LENGTH) < 0.3, `${body} length ${size.z}`);
      assert.ok(size.x > 1.6 && size.x < 2.6, `${body} width ${size.x}`);
      assert.ok(box.min.y > -0.01 && box.max.y < 2, `${body} height ${box.max.y}`);
      model.setPaint('#00ff00');
      model.setSpin(1.2);
      model.setFlame(flameFrame(50), 1.1);
      model.setFlame(null);
      model.dispose();
    }
  }
});

test('the car body sits nose to -Z with the exhaust flames at +Z', () => {
  const model = buildCarModel({ color: '#1e88e5', rim: 'five', body: 'coupe' }, textures);
  const flames = [];
  model.group.traverse((o) => {
    if (o.isGroup && o.children.length === 2 && o.children.every((c) => c.material?.blending === THREE.AdditiveBlending)) flames.push(o);
  });
  assert.equal(flames.length, 2);
  for (const f of flames) assert.ok(f.position.z > 2, `flame z ${f.position.z}`);
  model.dispose();
});

function noseInMercator(bearing) {
  const camera = new THREE.Camera();
  const identity = new THREE.Matrix4().toArray();
  const pose = { lng: 115.86, lat: -31.95, bearing };
  applyMatrices(camera, { defaultProjectionData: { mainMatrix: identity }, projectionMatrix: identity }, pose);
  const root = new THREE.Object3D();
  root.rotation.set(0, (-bearing * Math.PI) / 180, 0);
  root.updateMatrixWorld();
  const nose = new THREE.Vector3(0, 0, -100).applyMatrix4(root.matrixWorld); // 100 m ahead
  const centre = new THREE.Vector3(0, 0, 0);
  const full = camera.projectionMatrix.clone().multiply(camera.matrixWorldInverse);
  return { nose: nose.applyMatrix4(full), centre: centre.applyMatrix4(full), up: new THREE.Vector3(0, 10, 0).applyMatrix4(full) };
}

test('heading 0 points north (mercator y decreases) and 90 points east', () => {
  const north = noseInMercator(0);
  assert.ok(north.nose.y < north.centre.y, 'north is up');
  assert.ok(Math.abs(north.nose.x - north.centre.x) < 1e-12);
  const east = noseInMercator(90);
  assert.ok(east.nose.x > east.centre.x, 'east is +x');
  assert.ok(Math.abs(east.nose.y - east.centre.y) < 1e-12);
  const west = noseInMercator(270);
  assert.ok(west.nose.x < west.centre.x, 'west is -x');
  assert.ok(north.up.z > north.centre.z, 'car up is mercator +z (altitude)');
});

test('projection/view split reproduces the full matrix exactly', () => {
  const camera = new THREE.Camera();
  const P = new THREE.Matrix4().makePerspective(-0.5, 0.5, 0.4, -0.4, 1, 5000);
  const view = new THREE.Matrix4().makeRotationX(-1).setPosition(0, 0, -800);
  // Same shape as MapLibre's mercator matrix: perspective * flip(1,-1,1) * camera * worldSize.
  const flip = new THREE.Matrix4().makeScale(1, -1, 1);
  const main = P.clone().multiply(flip).multiply(view).multiply(new THREE.Matrix4().makeScale(5e6, 5e6, 5e6));
  const pose = { lng: 115.86, lat: -31.95, bearing: 30 };
  applyMatrices(camera, { defaultProjectionData: { mainMatrix: main.toArray() }, projectionMatrix: P.toArray() }, pose);
  const split = camera.projectionMatrix.clone().multiply(camera.matrixWorldInverse);
  assert.ok(camera.matrixWorldInverse.determinant() > 0, "view keeps handedness (no mirrored winding)");
  applyMatrices(camera, { defaultProjectionData: { mainMatrix: main.toArray() } }, pose); // fallback path
  const whole = camera.projectionMatrix.clone();
  split.elements.forEach((v, i) => assert.ok(Math.abs(v - whole.elements[i]) <= 1e-6 * Math.max(1, Math.abs(v)), `element ${i}`));
  assert.ok(new THREE.Matrix4().copy(camera.matrixWorldInverse).determinant() === 1);
});

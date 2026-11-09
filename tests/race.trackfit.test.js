import { test } from 'node:test';
import assert from 'node:assert/strict';
import { destination } from '../app/js/core/geo.js';
import { computeTrackCamera, fitPadding, maxZoomFor, mppForZoom, projectToScreen, zoomForMpp } from '../app/js/race/trackFit.js';
import { demoCircuit } from '../app/js/race/demo.js';

const CENTER = [115.7845, -31.6626];
const PHONES = [
  { name: 'small phone', width: 360, height: 740, dpr: 3 },
  { name: 'iPhone portrait', width: 390, height: 844, dpr: 3 },
  { name: 'iPhone landscape', width: 844, height: 390, dpr: 3 },
  { name: 'tablet', width: 820, height: 1180, dpr: 2 },
  { name: 'old phone', width: 320, height: 568, dpr: 1 },
];

/** Oval stretched east-west: lengthX by lengthY metres. */
function oval(lengthX, lengthY) {
  const pts = [];
  for (let i = 0; i <= 120; i++) {
    const t = (i / 120) * 2 * Math.PI;
    const east = destination(CENTER, (lengthX / 2) * Math.cos(t), 90);
    pts.push(destination(east, (lengthY / 2) * Math.sin(t), 0));
  }
  return pts;
}

function screenBox(line, cam, vp) {
  const xs = [];
  const ys = [];
  for (const p of line) {
    const [x, y] = projectToScreen(p, cam, vp);
    xs.push(x);
    ys.push(y);
  }
  return { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
}

test('padding is positive, scales with the screen and always leaves room for the track', () => {
  for (const vp of PHONES) {
    const p = fitPadding(vp);
    for (const k of ['top', 'right', 'bottom', 'left']) assert.ok(p[k] >= 12 && p[k] <= 80, `${vp.name} ${k}=${p[k]}`);
    assert.ok(vp.width - p.left - p.right >= vp.width * 0.45);
    assert.ok(vp.height - p.top - p.bottom >= vp.height * 0.45);
  }
  assert.ok(fitPadding({ width: 1200, height: 1600, dpr: 1 }).left > fitPadding({ width: 320, height: 568, dpr: 1 }).left);
  assert.ok(fitPadding({ width: 390, height: 844, dpr: 3 }).left <= fitPadding({ width: 390, height: 844, dpr: 1 }).left);
  const huge = fitPadding({ width: 390, height: 844, dpr: 3, insets: { top: 500, bottom: 500 } });
  assert.ok(844 - huge.top - huge.bottom >= 844 * 0.45 - 1, 'HUD insets are squeezed');
  const withHud = fitPadding({ width: 390, height: 844, dpr: 3, insets: { bottom: 120 } });
  assert.ok(withHud.bottom > withHud.top + 100);
});

test('max zoom grows with pixel density and stays in a sane range', () => {
  const lo = maxZoomFor({ width: 360, height: 740, dpr: 1 });
  const hi = maxZoomFor({ width: 360, height: 740, dpr: 3 });
  assert.ok(hi > lo);
  for (const vp of PHONES) {
    const z = maxZoomFor(vp);
    assert.ok(z >= 16.5 && z <= 19.5, `${vp.name} ${z}`);
  }
});

test('zoom and metres-per-pixel are inverse', () => {
  const z = zoomForMpp(2.5, -32);
  assert.ok(Math.abs(mppForZoom(z, -32) - 2.5) < 1e-9);
});

test('the whole track fits inside the padded area on every screen and fills it', () => {
  for (const line of [oval(1800, 600), demoCircuit(CENTER).line, oval(400, 380)]) {
    for (const vp of PHONES) {
      const insets = { top: 70, bottom: 110 };
      const view = { ...vp, insets };
      const cam = computeTrackCamera(line, view);
      const pad = cam.padding;
      const box = screenBox(line, cam, vp);
      const eps = 1.5;
      assert.ok(box.minX >= pad.left - eps && box.maxX <= vp.width - pad.right + eps, `${vp.name} x ${box.minX}..${box.maxX}`);
      assert.ok(box.minY >= pad.top - eps && box.maxY <= vp.height - pad.bottom + eps, `${vp.name} y ${box.minY}..${box.maxY}`);
      if (cam.zoom < cam.maxZoom) {
        const fillX = (box.maxX - box.minX) / (vp.width - pad.left - pad.right);
        const fillY = (box.maxY - box.minY) / (vp.height - pad.top - pad.bottom);
        assert.ok(Math.max(fillX, fillY) > 0.97, `${vp.name} fills ${fillX.toFixed(2)} / ${fillY.toFixed(2)}`);
      }
    }
  }
});

test('a long east-west track is rotated on a portrait phone but not on a landscape one', () => {
  const line = oval(2000, 500);
  const portrait = computeTrackCamera(line, { width: 390, height: 844, dpr: 3 });
  const landscape = computeTrackCamera(line, { width: 844, height: 390, dpr: 3 });
  const rotated = Math.min(Math.abs(portrait.bearing - 90), Math.abs(portrait.bearing - 270));
  assert.ok(rotated <= 10, `portrait bearing ${portrait.bearing}`);
  assert.equal(landscape.bearing, 0);
  assert.ok(portrait.zoom > computeTrackCamera(line, { width: 390, height: 844, dpr: 3 }, { allowRotate: false }).zoom);
});

test('tiny tracks stop at the zoom cap; bad input returns null', () => {
  const kart = oval(60, 40);
  const cam = computeTrackCamera(kart, { width: 390, height: 844, dpr: 3 });
  assert.equal(cam.zoom, cam.maxZoom);
  assert.equal(computeTrackCamera([], { width: 390, height: 844 }), null);
  assert.equal(computeTrackCamera(kart, { width: 0, height: 844 }), null);
});

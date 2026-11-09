// Draws the Cars Map app icons (PNG + SVG) with a tiny supersampled rasterizer. No dependencies.
// Design: ink-dark tile, a bold route swoosh burning from violet to flame orange, a white start
// dot and a checkered-flag finish.
import { writeFile, mkdir } from 'node:fs/promises';
import { deflateSync } from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const outDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'app', 'icons');

const INK = [29, 27, 36];
const VIOLET = [123, 77, 255];
const MAGENTA = [180, 92, 240];
const FLAME = [255, 138, 0];
const WHITE = [255, 255, 255];

const lerp = (a, b, t) => a + (b - a) * t;
const mix = (c1, c2, t) => c1.map((v, i) => lerp(v, c2[i], t));
function gradient(t) {
  return t < 0.6 ? mix(VIOLET, MAGENTA, t / 0.6) : mix(MAGENTA, FLAME, (t - 0.6) / 0.4);
}

// Route: cubic bezier in unit space (0..1), y down.
const P0 = [0.22, 0.8];
const P1 = [0.62, 0.86];
const P2 = [0.3, 0.3];
const P3 = [0.74, 0.25];
const SAMPLES = 200;
const curve = Array.from({ length: SAMPLES + 1 }, (_, i) => {
  const t = i / SAMPLES;
  const u = 1 - t;
  return [
    u * u * u * P0[0] + 3 * u * u * t * P1[0] + 3 * u * t * t * P2[0] + t * t * t * P3[0],
    u * u * u * P0[1] + 3 * u * u * t * P1[1] + 3 * u * t * t * P2[1] + t * t * t * P3[1],
  ];
});

function nearestOnCurve(x, y) {
  let best = { d: Infinity, t: 0 };
  for (let i = 0; i < SAMPLES; i++) {
    const [ax, ay] = curve[i];
    const [bx, by] = curve[i + 1];
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy;
    const k = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / len2));
    const px = ax + k * dx - x;
    const py = ay + k * dy - y;
    const d = Math.hypot(px, py);
    if (d < best.d) best = { d, t: (i + k) / SAMPLES };
  }
  return best;
}

function roundRectInside(x, y, inset, r) {
  const lo = inset;
  const hi = 1 - inset;
  const cx = Math.max(lo + r, Math.min(hi - r, x));
  const cy = Math.max(lo + r, Math.min(hi - r, y));
  return Math.hypot(x - cx, y - cy) <= r && x >= lo && x <= hi && y >= lo && y <= hi;
}

/** Colour (rgba 0..255) of the icon at unit coords; scale <1 shrinks the art for maskable safe zones. */
function shade(x, y, { maskable }) {
  const bgInside = maskable ? true : roundRectInside(x, y, 0.02, 0.2);
  if (!bgInside) return [0, 0, 0, 0];
  // shrink art toward centre for maskable icons (safe zone = 80%)
  const s = maskable ? 0.78 : 0.92;
  const ux = (x - 0.5) / s + 0.5;
  const uy = (y - 0.5) / s + 0.5;
  let c = [...INK];
  // subtle vignette glow
  const glow = Math.max(0, 1 - Math.hypot(ux - 0.55, uy - 0.45) / 0.75);
  c = mix(c, [52, 40, 92], glow * 0.55);
  const { d, t } = nearestOnCurve(ux, uy);
  if (d < 0.105) c = mix(c, gradient(t), Math.min(1, (0.105 - d) / 0.05) * 0.35); // soft glow
  if (d < 0.062) c = gradient(t);
  // start dot
  if (Math.hypot(ux - P0[0], uy - P0[1]) < 0.075) c = WHITE;
  if (Math.hypot(ux - P0[0], uy - P0[1]) < 0.04) c = VIOLET;
  // finish flag: 3x3 checkered square at the end
  const fx = P3[0] - 0.02;
  const fy = P3[1] - 0.2;
  if (ux >= fx && ux <= fx + 0.18 && uy >= fy && uy <= fy + 0.135) {
    const col = Math.floor(((ux - fx) / 0.18) * 4);
    const row = Math.floor(((uy - fy) / 0.135) * 3);
    c = (col + row) % 2 === 0 ? WHITE : INK;
  }
  if (ux >= fx - 0.022 && ux <= fx && uy >= fy - 0.01 && uy <= P3[1] + 0.02) c = FLAME;
  return [...c.map(Math.round), 255];
}

function render(size, opts) {
  const SS = 4;
  const data = Buffer.alloc(size * size * 4);
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      const acc = [0, 0, 0, 0];
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const [r, g, b, a] = shade((px + (sx + 0.5) / SS) / size, (py + (sy + 0.5) / SS) / size, opts);
          acc[0] += r * a;
          acc[1] += g * a;
          acc[2] += b * a;
          acc[3] += a;
        }
      }
      const i = (py * size + px) * 4;
      const n = SS * SS;
      data[i + 3] = Math.round(acc[3] / n);
      for (let k = 0; k < 3; k++) data[i + k] = acc[3] ? Math.round(acc[k] / acc[3]) : 0;
    }
  }
  return encodePng(size, size, data);
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, body) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(body.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), body]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function encodePng(w, h, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0;
    rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
<defs><linearGradient id="g" x1="0" y1="1" x2="1" y2="0"><stop offset="0" stop-color="#7b4dff"/><stop offset=".6" stop-color="#b45cf0"/><stop offset="1" stop-color="#ff8a00"/></linearGradient></defs>
<rect x="2" y="2" width="96" height="96" rx="20" fill="#1d1b24"/>
<path d="M24 77C61 83 31 31 72 27" fill="none" stroke="url(#g)" stroke-width="11" stroke-linecap="round"/>
<circle cx="24" cy="77" r="7" fill="#fff"/><circle cx="24" cy="77" r="3.6" fill="#7b4dff"/>
<rect x="68.5" y="8.5" width="2" height="21" fill="#ff8a00"/>
<g transform="translate(70.5 9)"><rect width="16" height="12" fill="#fff"/><path fill="#1d1b24" d="M4 0h4v4H4zM12 0h4v4h-4zM0 4h4v4H0zM8 4h4v4H8zM4 8h4v4H4zM12 8h4v4h-4z"/></g>
</svg>
`;

await mkdir(outDir, { recursive: true });
await writeFile(path.join(outDir, 'icon-192.png'), render(192, { maskable: false }));
await writeFile(path.join(outDir, 'icon-512.png'), render(512, { maskable: false }));
await writeFile(path.join(outDir, 'icon-maskable-512.png'), render(512, { maskable: true }));
await writeFile(path.join(outDir, 'icon.svg'), SVG);
process.stdout.write('icons written\n');

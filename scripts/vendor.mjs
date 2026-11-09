// Copy pinned third-party builds from node_modules into app/vendor so the app is self-hosted.
import { copyFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const nm = (p) => path.join(root, 'node_modules', p);
const out = (p) => path.join(root, 'app', 'vendor', p);

const FILES = [
  [nm('maplibre-gl/dist/maplibre-gl.js'), out('maplibre-gl.js')],
  [nm('maplibre-gl/dist/maplibre-gl.css'), out('maplibre-gl.css')],
  [nm('three/build/three.module.js'), out('three/three.module.js')],
  [nm('three/build/three.core.js'), out('three/three.core.js')],
  [nm('nostr-tools/lib/nostr.bundle.js'), out('nostr.bundle.js')],
  [nm('qrcode-generator/dist/qrcode.mjs'), out('qrcode.mjs')],
  [nm('maplibre-gl/LICENSE.txt'), out('LICENSE-maplibre.txt')],
  [nm('three/LICENSE'), out('LICENSE-three.txt')],
  [nm('nostr-tools/LICENSE'), out('LICENSE-nostr-tools.txt')],
];

for (const [from, to] of FILES) {
  await mkdir(path.dirname(to), { recursive: true });
  await copyFile(from, to);
  process.stdout.write(`vendored ${path.relative(root, to)}\n`);
}

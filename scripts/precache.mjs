// Writes app/precache.json: every app file the service worker should cache, plus a content hash
// as the version so phones pick up a new build automatically.
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'app');
const SKIP = new Set(['sw.js', 'precache.json']);
const SKIP_EXT = new Set(['.map', '.txt']);

async function walk(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await walk(full)));
    else out.push(full);
  }
  return out;
}

const files = (await walk(appDir))
  .filter((f) => !SKIP.has(path.basename(f)) && !SKIP_EXT.has(path.extname(f)))
  .sort();
const hash = createHash('sha256');
for (const f of files) hash.update(f).update(await readFile(f));
const rel = files.map((f) => `./${path.relative(appDir, f).split(path.sep).join('/')}`);
const manifest = { version: hash.digest('hex').slice(0, 12), files: ['./', ...rel] };
await writeFile(path.join(appDir, 'precache.json'), `${JSON.stringify(manifest, null, 1)}\n`);
process.stdout.write(`precache.json: ${manifest.files.length} files, version ${manifest.version}\n`);

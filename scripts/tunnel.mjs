// Keeps a Cloudflare quick tunnel (free HTTPS, no account) in front of the local server.
// Restarts the tunnel if it exits or stops answering, and writes the live URL to tools/tunnel-url.txt.
import { spawn } from 'node:child_process';
import { writeFile, appendFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BIN = path.join(root, 'tools', 'cloudflared.exe');
const URL_FILE = path.join(root, 'tools', 'tunnel-url.txt');
const LOG_FILE = path.join(root, 'tools', 'tunnel.log');
const ORIGIN = process.env.ORIGIN || 'http://127.0.0.1:8787';
const HEALTH_EVERY_MS = 60_000;
const MAX_FAILS = 3;

let child = null;
let currentUrl = null;
let fails = 0;
let restarts = 0;

const log = (msg) => appendFile(LOG_FILE, `${new Date().toISOString()} ${msg}\n`).catch(() => {});

function start() {
  currentUrl = null;
  child = spawn(BIN, ['tunnel', '--no-autoupdate', '--url', ORIGIN], { windowsHide: true });
  const onData = (buf) => {
    const text = buf.toString();
    const m = text.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
    if (m && m[0] !== currentUrl) {
      currentUrl = m[0];
      fails = 0;
      writeFile(URL_FILE, `${currentUrl}\n`).catch(() => {});
      log(`URL ${currentUrl}`);
      process.stdout.write(`TUNNEL ${currentUrl}\n`);
    }
  };
  child.stdout.on('data', onData);
  child.stderr.on('data', onData);
  child.on('exit', (code) => {
    log(`cloudflared exited (${code}); restarting`);
    child = null;
    const wait = Math.min(30_000, 2000 * 2 ** Math.min(restarts++, 4));
    setTimeout(start, wait);
  });
}

async function health() {
  if (!currentUrl) return;
  try {
    const r = await fetch(`${currentUrl}/manifest.webmanifest`, { signal: AbortSignal.timeout(15_000) });
    if (!r.ok) throw new Error(`status ${r.status}`);
    fails = 0;
    restarts = 0;
  } catch (err) {
    fails += 1;
    log(`health check failed (${fails}/${MAX_FAILS}): ${err.message}`);
    if (fails >= MAX_FAILS && child) {
      fails = 0;
      child.kill();
    }
  }
}

start();
setInterval(health, HEALTH_EVERY_MS);

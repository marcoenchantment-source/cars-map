// Minimal hardened static server for the app/ folder. No dependencies.
// Binds to localhost only; the Cloudflare tunnel provides public HTTPS in front of it.
import http from 'node:http';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'app');
const PORT = Number(process.env.PORT) || 8787;
const HOST = process.env.HOST || '127.0.0.1';

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.woff2': 'font/woff2',
};

export const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  "img-src 'self' data: blob: https:",
  "connect-src 'self' https: wss:",
  "worker-src 'self' blob:",
  "child-src 'self' blob:",
  "media-src 'self' blob: https:",
  "object-src 'none'",
  "base-uri 'self'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  "manifest-src 'self'",
].join('; ');

const BASE_HEADERS = {
  'Content-Security-Policy': CSP,
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Strict-Transport-Security': 'max-age=31536000',
  'Permissions-Policy':
    'geolocation=(self), microphone=(self), camera=(self), screen-wake-lock=(self), accelerometer=(self), gyroscope=(self), magnetometer=(self), payment=(), usb=()',
};

function send(res, status, body, headers = {}) {
  res.writeHead(status, { ...BASE_HEADERS, 'Content-Type': 'text/plain; charset=utf-8', ...headers });
  res.end(body);
}

/** Map a URL path to a file inside ROOT, or null if it escapes ROOT or names a hidden file. */
export function resolveSafe(urlPath) {
  let decoded;
  try {
    decoded = decodeURIComponent(urlPath);
  } catch {
    return null;
  }
  if (decoded.includes('\0')) return null;
  const rel = path.normalize(decoded).replace(/^([/\\])+/, '');
  if (rel.split(/[/\\]/).some((seg) => seg.startsWith('.'))) return null;
  const full = path.resolve(ROOT, rel || 'index.html');
  if (full !== ROOT && !full.startsWith(ROOT + path.sep)) return null;
  return full;
}

async function handle(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Method not allowed', { Allow: 'GET, HEAD' });
  const url = new URL(req.url, 'http://localhost');
  let file = resolveSafe(url.pathname);
  if (!file) return send(res, 400, 'Bad request');
  try {
    let info = await stat(file);
    if (info.isDirectory()) {
      file = path.join(file, 'index.html');
      info = await stat(file);
    }
    const ext = path.extname(file).toLowerCase();
    const type = TYPES[ext];
    if (!type) return send(res, 404, 'Not found');
    const longCache = file.includes(`${path.sep}vendor${path.sep}`) || file.includes(`${path.sep}icons${path.sep}`);
    res.writeHead(200, {
      ...BASE_HEADERS,
      'Content-Type': type,
      'Content-Length': info.size,
      'Cache-Control': longCache ? 'public, max-age=86400' : 'no-cache',
      'Last-Modified': info.mtime.toUTCString(),
      ...(path.basename(file) === 'sw.js' ? { 'Service-Worker-Allowed': '/' } : {}),
    });
    if (req.method === 'HEAD') return res.end();
    createReadStream(file).on('error', () => res.destroy()).pipe(res);
  } catch {
    send(res, 404, 'Not found');
  }
}

const server = http.createServer((req, res) => {
  handle(req, res).catch(() => send(res, 500, 'Server error'));
});
server.headersTimeout = 15_000;
server.requestTimeout = 30_000;

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  server.listen(PORT, HOST, () => process.stdout.write(`Cars Map serving ${ROOT} on http://${HOST}:${PORT}\n`));
}

export { server };

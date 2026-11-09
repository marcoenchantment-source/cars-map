// Cars Map service worker.
// - App files: precached on install (list + version from precache.json), served network-first
//   with a short timeout so updates arrive when online and the app still opens with no signal.
// - Map tiles, glyphs and fonts: stale-while-revalidate, capped, so areas you've seen work offline.
// - Routing, search, relays and other APIs: network only (never cache live data).

const APP_CACHE_PREFIX = 'carsmap-app-';
const TILE_CACHE = 'carsmap-tiles-v1';
const FONT_CACHE = 'carsmap-fonts-v1';
const TILE_LIMIT = 3000;
const NETWORK_TIMEOUT_MS = 3500;

async function loadManifest() {
  const res = await fetch('precache.json', { cache: 'no-store' });
  if (!res.ok) throw new Error(`precache.json ${res.status}`);
  const data = await res.json();
  if (!data || typeof data.version !== 'string' || !Array.isArray(data.files)) throw new Error('bad precache.json');
  return data;
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const { version, files } = await loadManifest();
      const cache = await caches.open(APP_CACHE_PREFIX + version);
      await cache.addAll(files.map((f) => new Request(f, { cache: 'reload' })));
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keep = new Set([TILE_CACHE, FONT_CACHE]);
      const names = await caches.keys();
      const appCaches = names.filter((n) => n.startsWith(APP_CACHE_PREFIX));
      // keep only the newest app cache (the one created by this worker's install)
      const newest = appCaches.at(-1);
      if (newest) keep.add(newest);
      await Promise.all(names.filter((n) => !keep.has(n)).map((n) => caches.delete(n)));
      await self.clients.claim();
    })(),
  );
});

function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout')), ms);
    promise.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

async function appCache() {
  const names = (await caches.keys()).filter((n) => n.startsWith(APP_CACHE_PREFIX));
  return caches.open(names.at(-1) ?? `${APP_CACHE_PREFIX}runtime`);
}

async function networkFirst(request) {
  const cache = await appCache();
  try {
    const res = await withTimeout(fetch(request), NETWORK_TIMEOUT_MS);
    if (res.ok) cache.put(request, res.clone());
    return res;
  } catch {
    const hit = await cache.match(request, { ignoreSearch: true });
    if (hit) return hit;
    if (request.mode === 'navigate') {
      const shell = await cache.match('./index.html');
      if (shell) return shell;
    }
    return new Response('Offline', { status: 503, headers: { 'Content-Type': 'text/plain' } });
  }
}

async function trim(cacheName, limit) {
  const cache = await caches.open(cacheName);
  const keys = await cache.keys();
  if (keys.length <= limit) return;
  await Promise.all(keys.slice(0, keys.length - limit).map((k) => cache.delete(k)));
}

async function staleWhileRevalidate(event, cacheName, limit) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(event.request);
  const refresh = fetch(event.request)
    .then((res) => {
      if (res.ok) {
        cache.put(event.request, res.clone()).then(() => trim(cacheName, limit));
      }
      return res;
    })
    .catch(() => hit);
  if (hit) {
    event.waitUntil(refresh);
    return hit;
  }
  return refresh;
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin === self.location.origin) {
    if (url.pathname.endsWith('/precache.json')) return;
    event.respondWith(networkFirst(request));
    return;
  }
  if (url.hostname === 'tiles.openfreemap.org') {
    event.respondWith(staleWhileRevalidate(event, TILE_CACHE, TILE_LIMIT));
    return;
  }
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    event.respondWith(staleWhileRevalidate(event, FONT_CACHE, 60));
  }
  // everything else (routing, search, relays, TomTom, Claude): straight to the network
});

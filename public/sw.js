// videoresize service worker. The app is static and client-side, so offline is caching.
// The two tokens below are replaced at build time by the precache plugin in vite.config.ts.
// Navigations are network-first (a new deploy lands on the next online load, and an old
// index.html is never served while online); hashed build assets are cache-first.
const VERSION = '__VR_VERSION__';
const PRECACHE = '__VR_PRECACHE__'.split('\n');
const PREFIX = 'videoresize-';
const CACHE = PREFIX + VERSION;

const scoped = (path) => new URL(path, self.registration.scope).href;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(PRECACHE.map((path) => new Request(scoped(path), { cache: 'reload' }))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key.startsWith(PREFIX) && key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

async function networkFirst(request) {
  const cache = await caches.open(CACHE);
  try {
    const response = await fetch(request);
    if (response.ok) await cache.put(request, response.clone());
    return response;
  } catch (err) {
    const hit = (await cache.match(request, { ignoreSearch: true })) || (await cache.match(scoped('./index.html')));
    if (hit) return hit;
    throw err;
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(request);
  if (hit) return hit;
  const response = await fetch(request);
  // Never pin an HTML fallback page under an asset URL.
  const isHtml = (response.headers.get('content-type') || '').includes('text/html');
  if (response.ok && !isHtml) await cache.put(request, response.clone());
  return response;
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== location.origin) return;
  event.respondWith(request.mode === 'navigate' ? networkFirst(request) : cacheFirst(request));
});

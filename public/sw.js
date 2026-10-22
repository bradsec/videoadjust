// videomate service worker. The app is static and client-side, so offline is caching.
// The two tokens below are replaced at build time by the precache plugin in vite.config.ts.
// Navigations are network-first and revalidate with the server (cache: 'no-cache'), so the
// host's max-age cannot hand back an old index.html after a deploy; if the network is down or
// slower than NAV_TIMEOUT_MS the cached page is used. Hashed build assets are cache-first.
// On activate the previous version's cache is kept (only older ones are deleted) and lookups
// search every cache, so a tab opened before a deploy can still import its lazy AAC chunk.
const VERSION = '__VM_VERSION__';
const PRECACHE = '__VM_PRECACHE__'.split('\n');
const PREFIX = 'videomate-';
// The app was called videoresize; its caches share this origin and are never used again.
const LEGACY_PREFIX = 'videoresize-';
const CACHE = PREFIX + VERSION;
const NAV_TIMEOUT_MS = 4000;

const scoped = (path) => new URL(path, self.registration.scope).href;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) =>
        cache.addAll(PRECACHE.map((path) => new Request(scoped(path), { cache: 'reload' }))),
      )
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => {
        // keys() is in creation order: the last other entry is the previous version.
        const others = keys.filter((key) => key.startsWith(PREFIX) && key !== CACHE);
        const legacy = keys.filter((key) => key.startsWith(LEGACY_PREFIX));
        return Promise.all([...others.slice(0, -1), ...legacy].map((key) => caches.delete(key)));
      })
      .then(() => self.clients.claim()),
  );
});

// Navigations read the current cache only: an older version's index.html names assets this
// version may not have, and must never be served in its place.
async function cachedPage(request) {
  const cache = await caches.open(CACHE);
  return (
    (await cache.match(request, { ignoreSearch: true })) ||
    (await cache.match(scoped('./index.html')))
  );
}

async function networkFirst(request) {
  const cache = await caches.open(CACHE);
  const network = fetch(request, { cache: 'no-cache' }).then(async (response) => {
    if (response.ok) await cache.put(request, response.clone());
    return response;
  });
  const fallback = await cachedPage(request);
  if (!fallback) return network;
  const timeout = new Promise((resolve) => setTimeout(() => resolve(fallback), NAV_TIMEOUT_MS));
  // A network error or a timeout both end in the cached page.
  return Promise.race([network.catch(() => fallback), timeout]);
}

async function cacheFirst(request) {
  // Hashed assets may come from any cache so an open tab's lazy chunk survives a deploy.
  // ignoreVary: the preview server sends Vary: Origin, and module imports carry an Origin header
  // that the precache request lacked, so a plain match misses and the lazy chunk fails offline.
  const opts = { ignoreVary: true };
  const hit =
    (await (await caches.open(CACHE)).match(request, opts)) || (await caches.match(request, opts));
  if (hit) return hit;
  const response = await fetch(request);
  // Cache only complete 200 responses (not 206 ranges) and never an HTML fallback page.
  const isHtml = (response.headers.get('content-type') || '').includes('text/html');
  if (response.status === 200 && !isHtml)
    await (await caches.open(CACHE)).put(request, response.clone());
  return response;
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== location.origin) return;
  event.respondWith(request.mode === 'navigate' ? networkFirst(request) : cacheFirst(request));
});

const APP_CACHE = 'walk-wildlife-shell-v3';
const TILE_CACHE = 'walk-wildlife-osm-viewed-tiles-v1';
const LIBRARY_CACHE = 'walk-wildlife-library-v1';
const shell = ['./', './index.html', './styles.css', './app.js', './manifest.webmanifest', './supabase-config.js', './data/norfolk-poi.json'];
const libraryAssets = [
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js'
];

self.addEventListener('install', (event) => event.waitUntil(Promise.all([
  caches.open(APP_CACHE).then((cache) => cache.addAll(shell)),
  caches.open(LIBRARY_CACHE).then(async (cache) => {
    await Promise.all(libraryAssets.map(async (asset) => {
      try {
        const response = await fetch(asset, { mode: 'no-cors' });
        await cache.put(asset, response);
      } catch (_) { /* The app can still install if a CDN is briefly unavailable. */ }
    }));
  })
]).then(() => self.skipWaiting())));
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  const isMapTile = /(^|\.)tile\.openstreetmap\.org$/.test(url.hostname);
  if (isMapTile) {
    event.respondWith(caches.open(TILE_CACHE).then(async (cache) => {
      const saved = await cache.match(event.request);
      if (saved) return saved;
      const response = await fetch(event.request);
      if (response.ok || response.type === 'opaque') cache.put(event.request, response.clone());
      return response;
    }));
    return;
  }
  if (url.hostname === 'unpkg.com' && url.pathname.includes('/leaflet@1.9.4/')) {
    event.respondWith(caches.open(LIBRARY_CACHE).then(async (cache) => {
      const saved = await cache.match(event.request);
      if (saved) return saved;
      const response = await fetch(event.request);
      if (response.ok || response.type === 'opaque') cache.put(event.request, response.clone());
      return response;
    }));
    return;
  }
  if (url.origin === self.location.origin) event.respondWith(caches.match(event.request).then((saved) => saved || fetch(event.request)));
});

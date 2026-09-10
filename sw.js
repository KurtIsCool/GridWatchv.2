const CACHE = 'gridwatch-v2.8.2-shell';
const CORE = [
  './',
  './index.html',
  './ops.html',
  './manifest.webmanifest',
  './data/feeder-mapping.json',
  './data/feeder-bundle.js',
  './data/geography-bundle.js',
  './data/geography-manifest.json',
  './data/iloilo-city-barangays.geojson',
  './data/iloilo-city-boundary.geojson',
  './assets/brand/gridwatch-icon-192.png',
  './assets/brand/gridwatch-icon-512.png'
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(CORE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  event.respondWith(
    caches.match(req).then(cached => cached || fetch(req).then(res => {
      if (res && res.ok) {
        const clone = res.clone();
        caches.open(CACHE).then(cache => cache.put(req, clone));
      }
      return res;
    }))
  );
});

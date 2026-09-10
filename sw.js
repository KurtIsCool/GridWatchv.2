const CACHE = 'gridwatch-v2.9.0-shell';
const CORE = [
  './',
  './index.html',
  './ops.html',
  './manifest.webmanifest',
  './404.html',
  './data/advisories.json',
  './data/advisories-bundle.js',
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
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith('gridwatch-') && key !== CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim()));
});

async function cacheSuccessful(req,res){
  if(res?.ok){const cache=await caches.open(CACHE);await cache.put(req,res.clone());}
  return res;
}

async function navigationResponse(req){
  try{return await cacheSuccessful(req,await fetch(req));}
  catch{return (await caches.match(req))||(await caches.match('./index.html'));}
}

async function dataResponse(req){
  try{return await cacheSuccessful(req,await fetch(req));}
  catch{return caches.match(req);}
}

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if(req.mode==='navigate'){event.respondWith(navigationResponse(req));return;}
  if(url.pathname.includes('/data/')){event.respondWith(dataResponse(req));return;}
  event.respondWith(caches.match(req).then(cached=>cached||fetch(req).then(res=>cacheSuccessful(req,res))));
});

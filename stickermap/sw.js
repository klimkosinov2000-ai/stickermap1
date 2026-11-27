const CACHE_VERSION = 'stickermap-v6';
const STATIC_CACHE = `${CACHE_VERSION}-static`;
const CDN_CACHE = `${CACHE_VERSION}-cdn`;

const CORE_ASSETS = [
  './',
  './index.html',
  './css/style.css',
  './js/app.js',
  './manifest.json',
  './icon-192.png',
  './icon-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE)
      .then((cache) => Promise.allSettled(CORE_ASSETS.map((asset) => cache.add(asset))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys
          .filter((key) => !key.startsWith(CACHE_VERSION))
          .map((key) => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;

  // Пропускаем любые не-GET запросы (POST, PATCH, DELETE и т.д.)
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // Никогда не кэшируем серверный API, Supabase, Firebase, геокодинг и тайлы карты
  if (
    url.pathname.startsWith('/api/') ||
    url.hostname.includes('supabase.co') ||
    url.hostname.includes('googleapis.com') ||
    url.hostname.includes('firebaseio.com') ||
    url.hostname.includes('nominatim.openstreetmap.org') ||
    url.hostname.includes('tile.openstreetmap.org') ||
    url.hostname.includes('res.cloudinary.com')
  ) {
    return;
  }

  // Внешние CDN (Leaflet, Turf, Firebase SDK, Supabase SDK) — Cache-First
  if (url.origin !== self.location.origin) {
    event.respondWith(
      caches.open(CDN_CACHE).then(async (cache) => {
        const cached = await cache.match(req);
        if (cached) return cached;
        const fresh = await fetch(req);
        if (fresh && fresh.ok) {
          cache.put(req, fresh.clone());
        }
        return fresh;
      })
    );
    return;
  }

  // Локальные файлы приложения (HTML, CSS, JS) — Network-First с быстрым откатом в кэш
  event.respondWith(
    fetch(req)
      .then((fresh) => {
        if (fresh && fresh.ok) {
          const copy = fresh.clone();
          caches.open(STATIC_CACHE).then((cache) => cache.put(req, copy));
        }
        return fresh;
      })
      .catch(() => caches.match(req))
  );
});

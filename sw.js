// Poseidon Offline and Autonomous Pocket Sanctum Service Worker
// Caches the entire Poseidon UI, all 30 Ancient Books, Dreams, Rants, and Brain state
// so Henri has 100% access even when his Mac is turned off or he has zero internet in the bush.

const CACHE_NAME = 'poseidon-sanctum-v17';
const STATIC_ASSETS = [
  './',
  './index.html',
  './style.css',
  './theme.css',
  './icon-192.png',
  './icon-512.png',
  './apple-touch-icon.png',
  './apple-touch-icon-precomposed.png',
  './favicon.png',
  './favicon.ico',
  './app.js',
  './manifest.json',
  './icon.svg',
  './data_state.json'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      for (const u of STATIC_ASSETS) {
        try {
          const req = new Request(u, {
            headers: { 'ngrok-skip-browser-warning': 'true' }
          });
          const res = await fetch(req);
          if (res && res.status === 200) {
            await cache.put(u, res);
          }
        } catch (e) {}
      }
    }).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  const ngHeaders = new Headers(req.headers);
  ngHeaders.set('ngrok-skip-browser-warning', 'true');
  const modReq = new Request(req, { headers: ngHeaders, mode: 'cors' });

  // Network-first with instant cache fallback so when Mac is off, cached brain and UI load seamlessly
  event.respondWith(
    fetch(modReq)
      .then((res) => {
        if (res && res.status === 200) {
          const clone = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, clone));
          return res;
        }
        // When Mac is sleeping or off, ngrok edge returns 502, 503, or 504
        if (res && (res.status >= 500 || res.status === 502 || res.status === 504 || res.status === 503)) {
          return caches.match(req).then((cached) => {
            if (cached) return cached;
            if (req.mode === 'navigate' || url.pathname === '/' || url.pathname.endsWith('.html')) {
              return caches.match('/index.html');
            }
            if (url.pathname.startsWith('/api/state')) {
              return caches.match('/api/state');
            }
            if (url.pathname.startsWith('/api/brain')) {
              return caches.match('/api/brain');
            }
            return caches.match('/index.html');
          });
        }
        return res;
      })
      .catch(() => {
        return caches.match(req).then((cached) => {
          if (cached) return cached;
          if (req.mode === 'navigate' || url.pathname === '/' || url.pathname.endsWith('.html')) {
            return caches.match('/index.html');
          }
          if (url.pathname.startsWith('/api/state')) {
            return caches.match('/api/state');
          }
          if (url.pathname.startsWith('/api/brain')) {
            return caches.match('/api/brain');
          }
          return caches.match('/index.html');
        });
      })
  );
});

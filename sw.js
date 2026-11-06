// Poseidon Offline and Autonomous Pocket Sanctum Service Worker
// Caches the entire Poseidon UI, all 30 Ancient Books, Dreams, Rants, and Brain state
// so Henri has 100% access even when his Mac is turned off or he has zero internet in the bush.

const CACHE_NAME = 'poseidon-sanctum-v23';
const STATIC_ASSETS = [
  './',
  './index.html',
  './style.css',
  './theme.css',
  './icon-192.png',
  './icon-512.png',
  './apple-touch-icon.png',
  './apple-touch-icon-precomposed.png',
  './apple-touch-icon-180x180.png',
  './apple-touch-icon-152x152.png',
  './apple-touch-icon-120x120.png',
  './favicon.png',
  './favicon.ico',
  './app.js',
  './manifest.json',
  './icon.svg',
  './data_state.json'
];

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      for (const u of STATIC_ASSETS) {
        try {
          const res = await fetch(u, { cache: 'no-store' });
          if (res && res.status === 200) {
            await cache.put(u, res);
          }
        } catch (e) {}
      }
    })
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)));
      await self.clients.claim();
      const allClients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const client of allClients) {
        try {
          client.postMessage({ type: 'POSEIDON_SW_UPDATED', version: CACHE_NAME });
        } catch (e) {}
      }
    })()
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  let fetchReq = req;
  if (url.hostname.includes('ngrok')) {
    const ngHeaders = new Headers(req.headers);
    ngHeaders.set('ngrok-skip-browser-warning', 'true');
    fetchReq = new Request(req, { headers: ngHeaders, mode: 'cors' });
  }

  // Always bypass stale browser HTTP disk cache when online, with instant cache fallback when offline
  event.respondWith(
    fetch(fetchReq, { cache: 'no-store' })
      .then((res) => {
        if (res && res.status === 200) {
          const clone = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, clone));
          return res;
        }
        if (res && (res.status >= 500 || res.status === 502 || res.status === 504 || res.status === 503)) {
          return caches.match(req, { ignoreSearch: true }).then((cached) => {
            if (cached) return cached;
            if (req.mode === 'navigate' || url.pathname === '/' || url.pathname.endsWith('.html')) {
              return caches.match('./index.html') || caches.match('/index.html');
            }
            if (url.pathname.startsWith('/api/state')) {
              return caches.match('/api/state') || caches.match('./data_state.json');
            }
            if (url.pathname.startsWith('/api/brain')) {
              return caches.match('/api/brain');
            }
            return res;
          });
        }
        return res;
      })
      .catch(() => {
        return caches.match(req, { ignoreSearch: true }).then((cached) => {
          if (cached) return cached;
          if (req.mode === 'navigate' || url.pathname === '/' || url.pathname.endsWith('.html')) {
            return caches.match('./index.html') || caches.match('/index.html');
          }
          if (url.pathname.startsWith('/api/state')) {
            return caches.match('/api/state') || caches.match('./data_state.json');
          }
          if (url.pathname.startsWith('/api/brain')) {
            return caches.match('/api/brain');
          }
          return new Response('', { status: 504 });
        });
      })
  );
});


// device-pwa/frontend/views/sw-device.js
const VERSION = 'xr-device-v1.1';
const STATIC_CACHE = `xr-static-${VERSION}`;

// IMPORTANT: use RELATIVE paths (SW scope is /device/)
const STATIC_ASSETS = [
  './',                         // HTML shell (/device)
  './device.webmanifest',

  // CSS (device-pwa/frontend/public/css)
  './assets/css/common.css',
  './assets/css/device.css',

  // JS (device-pwa/frontend/public/js)
  './assets/js/config.js',
  './assets/js/ui.js',
  './assets/js/device.js',
  './assets/js/signaling.js',
  './assets/js/voice.js',
  './assets/js/telemetry.js',
  './assets/js/webrtc-quality.js',
  './assets/js/messages.js',

  // Images (device-pwa/frontend/public/images) – include only if present
  './assets/images/xr-logo-192.png',
  './assets/images/xr-logo-512.png'
];

// ----- install: pre-cache static assets -----
self.addEventListener('install', (evt) => {
  evt.waitUntil((async () => {
    const cache = await caches.open(STATIC_CACHE);
    await cache.addAll(STATIC_ASSETS);  // will fail if any URL 404s
    await self.skipWaiting();
  })());
});

// ----- activate: delete old caches -----
self.addEventListener('activate', (evt) => {
  evt.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== STATIC_CACHE).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

// ----- fetch strategy -----
// - never touch /socket.io
// - network-first for documents (keeps UI fresh)
// - cache-first for assets under /device/
self.addEventListener('fetch', (evt) => {
  const req = evt.request;
  const url = new URL(req.url);

  // Never proxy socket.io or websockets
  if (url.pathname.startsWith('/socket.io')) return;

  if (req.method !== 'GET') return;

  // Network-first for pages
  if (req.destination === 'document') {
    evt.respondWith((async () => {
      try {
        return await fetch(req, { cache: 'no-store' });
      } catch {
        const cache = await caches.open(STATIC_CACHE);
        // fallback to the shell
        return (await cache.match('./')) || Response.error();
      }
    })());
    return;
  }

  // Cache-first for assets
  evt.respondWith((async () => {
    const cache = await caches.open(STATIC_CACHE);
    const cached = await cache.match(req);
    if (cached) return cached;

    const res = await fetch(req).catch(() => null);
    if (res && res.ok && url.origin === self.location.origin) {
      cache.put(req, res.clone());
    }
    return res || Response.error();
  })());
});

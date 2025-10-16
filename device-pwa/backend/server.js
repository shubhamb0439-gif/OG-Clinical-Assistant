// device-pwa/backend/server.js
// Load env from repo root
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') });
const express = require('express');
const { createProxyMiddleware } = require('http-proxy-middleware');

const PORT = process.env.FRONTEND_PORT || 3000;
const HUB = process.env.HUB_URL || 'http://localhost:8080';

const app = express();

/* -------------------------------------------
 * 1) Proxy Socket.IO HTTP + WebSocket 3000 → 8080
 * ----------------------------------------- */
const sioProxy = createProxyMiddleware({
  target: HUB,
  changeOrigin: true,
  ws: true,
  logLevel: 'warn',
});
app.use('/socket.io', sioProxy);

// (Optional) if you previously proxied REST endpoints to the hub, keep them here:
['/api', '/notes', '/soap', '/ai', '/openai', '/scribe'].forEach((p) => {
  app.use(
    p,
    createProxyMiddleware({
      target: HUB,
      changeOrigin: true,
      logLevel: 'warn',
    })
  );
});

/* -------------------------------------------
 * 2) Static asset roots for Dock + PWA (UPDATED PATHS)
 * ----------------------------------------- */
// From device-pwa/backend → ../../desktop-web/frontend
const DOCK_ROOT = path.join(__dirname, '..', '..', 'desktop-web', 'frontend');
const VIEWS_DIR = path.join(DOCK_ROOT, 'views');   // Dock HTML
const PUBLIC_DIR = path.join(DOCK_ROOT, 'public');  // Dock static

// From device-pwa/backend → ../frontend
const PWA_ROOT = path.join(__dirname, '..', 'frontend');
const PWA_PUBLIC = path.join(PWA_ROOT, 'public');   // PWA css/js/images
const PWA_VIEWS = path.join(PWA_ROOT, 'views');    // PWA device.html + manifest + SW

// Serve Dock static at /public/*
app.use('/public', express.static(PUBLIC_DIR));

// Serve PWA static at /device/assets/*
app.use('/device/assets', express.static(PWA_PUBLIC));

/* -------------------------------------------
 * 3) PWA routes (scoped to /device)
 * ----------------------------------------- */

// PWA entry
app.get(['/device', '/device/'], (_req, res) =>
  res.sendFile(path.join(PWA_VIEWS, 'device.html'))
);

// PWA manifest at a stable path
app.get('/device.webmanifest', (_req, res) => {
  res.type('application/manifest+json');
  res.sendFile(path.join(PWA_VIEWS, 'device.webmanifest'));
});

// Service worker limited to /device/ scope
app.get('/sw-device.js', (_req, res) => {
  res.set('Service-Worker-Allowed', '/device/');
  res.type('application/javascript');
  res.sendFile(path.join(PWA_VIEWS, 'sw-device.js'));
});

// Back-compat aliases (safe to keep)
app.get('/manifest.webmanifest', (_req, res) => {
  res.type('application/manifest+json');
  res.sendFile(path.join(PWA_VIEWS, 'device.webmanifest'));
});
app.get('/sw.js', (_req, res) => {
  res.type('application/javascript');
  res.sendFile(path.join(PWA_VIEWS, 'sw-device.js'));
});
app.get('/device/sw.js', (_req, res) => {
  res.set('Service-Worker-Allowed', '/device/');
  res.type('application/javascript');
  res.sendFile(path.join(PWA_VIEWS, 'sw-device.js'));
});

/* -------------------------------------------
 * 4) Cache rule: keep HTML fresh
 * ----------------------------------------- */
app.use((req, res, next) => {
  if (req.method === 'GET' && req.headers.accept && req.headers.accept.includes('text/html')) {
    res.set('Cache-Control', 'no-store');
  }
  next();
});

/* -------------------------------------------
 * 5) Dock pages (pretty routes)
 * ----------------------------------------- */
const sendView = (name) => (_req, res) => res.sendFile(path.join(VIEWS_DIR, name));

app.get(['/dashboard', '/dashboard/'], sendView('dashboard.html'));
app.get(['/scribe-cockpit', '/scribe-cockpit/'], sendView('scribe-cockpit.html'));

// If you have operator.html, point /operator to it; otherwise keep index.html.
app.get(['/operator', '/operator/'], sendView('index.html'));

// Block direct .html access (so /device.html etc. 404)
app.get('/*.html', (_req, res) => res.status(404).send('Not found'));

// Root → Dock landing
app.get('/', sendView('index.html'));

/* -------------------------------------------
 * 6) Start server + attach WS upgrade to proxy
 * ----------------------------------------- */
const server = app.listen(PORT, () => {
  console.log(`🟢 Frontend running at http://localhost:${PORT}`);
  console.log(`↪  Proxy /socket.io → ${HUB}/socket.io`);
});

server.on('upgrade', (req, socket, head) => {
  if (req.url && req.url.startsWith('/socket.io')) {
    sioProxy.upgrade(req, socket, head);
  }
});

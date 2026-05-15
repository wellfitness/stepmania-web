// Service Worker de Sincro
// =========================
// Estrategia de cache mixta intencionalmente:
//  - install: precache del shell estático (HTMLs principales + CSS + JS modules
//    + iconos + manifest). Si alguno falla la instalación entera aborta —
//    Promise.all del addAll().
//  - fetch HTML navigation: network-first con fallback a precache (para que un
//    deploy nuevo se note sin necesidad de "vaciar caché"). Cuando hay red, se
//    refresca el RUNTIME para futuros offline.
//  - fetch CSS/JS/iconos same-origin: cache-first con runtime fallback. Es el
//    shell que arranca instantáneo offline.
//  - Google Fonts: stale-while-revalidate. Sirve lo cacheado y refresca en BG.
//  - Resto cross-origin: passthrough sin tocar (no queremos cachear blobs de
//    audio que pesan MB y que el usuario carga ad-hoc por File API; viven en
//    IndexedDB de todas formas).
//
// Cuando cambien los assets cacheados, bumpear CACHE_VERSION.
// Aviso: NO interceptamos requests POST ni con header Range (audio range
// requests del motor son delicados — los dejamos pasar a network).

const CACHE_VERSION = 'sincro-v82';
const PRECACHE      = `${CACHE_VERSION}-shell`;
const RUNTIME       = `${CACHE_VERSION}-runtime`;

const PRECACHE_URLS = [
  '/',
  '/app.html',
  '/index.html',
  '/play.html',
  '/stepmania-play.html',
  '/gh-play.html',
  '/autostepper.html',
  '/gh-autostepper.html',
  '/test-pad.html',
  '/tutorial.html',
  '/calibration.html',
  '/rankings.html',
  '/manifest.webmanifest',
  '/icons/icon.svg',
  '/icons/icon-maskable.svg',
  '/sincro-logo-img-transp.webp',
  '/fondo_dashboard.webp',
  '/stepmania-web/css/styles.css',
  '/stepmania-web/js/pwa-bootstrap.js',
  '/stepmania-web/js/scores.js',
  '/stepmania-web/js/core.js',
  '/stepmania-web/js/parser.js',
  '/stepmania-web/js/audio-pipeline.js',
  '/stepmania-web/js/difficulty-tiers.js',
  '/stepmania-web/js/audio-metadata.js',
  '/stepmania-web/js/radar.js',
  '/stepmania-web/js/library.js',
  '/stepmania-web/js/backup.js',
  '/stepmania-web/js/song-select.js',
  '/stepmania-web/js/pad-test.js',
  '/stepmania-web/js/mat-layout.js',
  '/stepmania-web/js/sm-flow.js',
  '/stepmania-web/js/game.js',
  '/stepmania-web/js/gh-db.js',
  '/stepmania-web/js/gh-backup.js',
  '/stepmania-web/js/app.js'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(PRECACHE)
      // CRÍTICO: `cache: 'reload'` fuerza al SW a saltarse el HTTP cache del
      // browser y pedir cada asset directo al servidor. Sin esto, addAll
      // reusa la versión cacheada por el browser desde el deploy anterior,
      // dejando al SW nuevo sirviendo JS viejo aunque el servidor tenga el
      // nuevo. Bug descubierto el 2026-05-12 tras bumpear v25→v27 sin
      // detectar que el precache contenía aún el audio-metadata.js v25.
      .then((cache) => cache.addAll(
        PRECACHE_URLS.map((url) => new Request(url, { cache: 'reload' }))
      ))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys
          .filter((k) => k.startsWith('sincro-') && k !== PRECACHE && k !== RUNTIME)
          .map((k) => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  // Range requests (audio del motor pidiendo segmentos) → passthrough.
  if (req.headers.has('range')) return;

  const url = new URL(req.url);
  const sameOrigin = url.origin === self.location.origin;

  // Google Fonts → stale-while-revalidate
  if (url.host.endsWith('fonts.googleapis.com') || url.host.endsWith('fonts.gstatic.com')) {
    event.respondWith(staleWhileRevalidate(req));
    return;
  }

  if (!sameOrigin) return;

  // Navigation HTML → network-first con fallback a cache
  if (req.mode === 'navigate' || (req.headers.get('accept') || '').includes('text/html')) {
    event.respondWith(networkFirst(req));
    return;
  }

  // Resto same-origin → cache-first con runtime fallback
  event.respondWith(cacheFirst(req));
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

function networkFirst(req) {
  return fetch(req)
    .then((res) => {
      if (res && res.ok) {
        const copy = res.clone();
        caches.open(RUNTIME).then((c) => c.put(req, copy));
      }
      return res;
    })
    .catch(() => caches.match(req).then((m) => {
      if (m) return m;
      // Fallback offline: si la URL solicitada es del shell SPA (app.html y
      // todas las rutas hash que monta), caemos a app.html para no perder
      // contexto. Cualquier otra URL navegacional cae a la landing pública.
      const url = new URL(req.url);
      const isShellRoute = url.pathname === '/' ||
                           url.pathname.startsWith('/app') ||
                           url.pathname.startsWith('/play') ||
                           url.pathname.startsWith('/stepmania-play') ||
                           url.pathname.startsWith('/gh-') ||
                           url.pathname.startsWith('/autostepper') ||
                           url.pathname.startsWith('/test-pad') ||
                           url.pathname.startsWith('/tutorial') ||
                           url.pathname.startsWith('/calibration');
      return caches.match(isShellRoute ? '/app.html' : '/index.html');
    }));
}

function cacheFirst(req) {
  return caches.match(req).then((cached) => {
    if (cached) return cached;
    return fetch(req).then((res) => {
      if (res && res.ok && res.type !== 'opaque') {
        const copy = res.clone();
        caches.open(RUNTIME).then((c) => c.put(req, copy));
      }
      return res;
    });
  });
}

function staleWhileRevalidate(req) {
  return caches.open(RUNTIME).then((cache) => {
    return cache.match(req).then((cached) => {
      const fetchPromise = fetch(req).then((res) => {
        if (res && res.ok) cache.put(req, res.clone());
        return res;
      }).catch(() => cached);
      return cached || fetchPromise;
    });
  });
}

/**
 * Service Worker de TruckCar (PWA offline-first del conductor).
 *
 *  - App shell (HTML, CSS, JS propios): precargado al instalar; se sirve desde caché y se actualiza en segundo plano
 *    (stale-while-revalidate). La navegación usa la red primero y cae al index.html guardado sin señal.
 *  - Librerías de CDN (Tailwind, Leaflet, Font Awesome, fuentes): caché en tiempo de ejecución.
 *  - Teselas de OpenStreetMap: caché primero, con un máximo de entradas (las más antiguas se descartan).
 *  - API REST (api-gateway), WebSocket, evidencias (/pod-media/) y rutas OSRM: nunca se sirven desde caché; lo que
 *    se haga sin señal lo guarda la cola durable de IndexedDB (js/offlineQueue.js).
 *
 * Cambiar VERSION invalida el app shell anterior en la activación.
 */
const VERSION = 'v2';
const SHELL_CACHE = `truckcar-shell-${VERSION}`;
const RUNTIME_CACHE = `truckcar-runtime-${VERSION}`;
const TILE_CACHE = 'truckcar-tiles-v1';
const MAX_TILES = 1500;

const SHELL = [
    './',
    'index.html',
    'manifest.webmanifest',
    'assets/icon.svg',
    'assets/icon-192.png',
    'assets/icon-512.png',
    'assets/icon-maskable-512.png',
    'assets/apple-touch-icon.png',
    'css/main.css',
    'css/navigation.css',
    'js/config.js',
    'js/api.js',
    'js/mockData.js',
    'js/state.js',
    'js/ui/toaster.js',
    'js/ui/sheet.js',
    'js/offlineQueue.js',
    'js/podEvidence.js',
    'js/dataService.js',
    'js/telemetry.js',
    'js/ui/native.js',
    'js/speechEngine.js',
    'js/mapController.js',
    'js/views/loginView.js',
    'js/views/driverApp.js',
    'js/views/driverActions.js',
    'js/views/coordinatorPanel.js',
    'js/views/podModals.js',
    'js/views/generatorPanel.js',
    'js/app.js'
];

const CDN_HOSTS = ['cdn.tailwindcss.com', 'cdnjs.cloudflare.com', 'unpkg.com', 'fonts.googleapis.com', 'fonts.gstatic.com'];
const TILE_HOSTS = /(^|\.)tile\.openstreetmap\.org$/;

self.addEventListener('install', (event) => {
    event.waitUntil(caches.open(SHELL_CACHE).then(cache => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
    event.waitUntil(caches.keys()
        .then(keys => Promise.all(keys
            .filter(key => key.startsWith('truckcar-') && ![SHELL_CACHE, RUNTIME_CACHE, TILE_CACHE].includes(key))
            .map(key => caches.delete(key))))
        .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (event) => {
    const request = event.request;
    if (request.method !== 'GET') return; // POST/PATCH/PUT van siempre a la red (la cola offline los reintenta)
    const url = new URL(request.url);

    if (TILE_HOSTS.test(url.hostname)) {
        event.respondWith(cacheFirstTile(request));
        return;
    }
    if (CDN_HOSTS.includes(url.hostname)) {
        event.respondWith(staleWhileRevalidate(request, RUNTIME_CACHE));
        return;
    }
    // Todo lo demás de otros orígenes (api-gateway en :8000, OSRM) y las evidencias firmadas: sin caché.
    if (url.origin !== self.location.origin || url.pathname.startsWith('/pod-media/')) return;

    if (request.mode === 'navigate') {
        event.respondWith(networkFirstNavigation(request));
        return;
    }
    event.respondWith(staleWhileRevalidate(request, SHELL_CACHE));
});

async function networkFirstNavigation(request) {
    try {
        const response = await fetch(request);
        const cache = await caches.open(SHELL_CACHE);
        cache.put('index.html', response.clone());
        return response;
    } catch (error) {
        return (await caches.match('index.html')) || Response.error();
    }
}

async function staleWhileRevalidate(request, cacheName) {
    const cache = await caches.open(cacheName);
    const cached = await cache.match(request);
    const network = fetch(request).then(response => {
        // Respuestas opacas (CDN sin CORS) también sirven sin señal; los errores HTTP no se guardan.
        if (response.ok || response.type === 'opaque') cache.put(request, response.clone());
        return response;
    }).catch(() => cached || Response.error());
    return cached || network;
}

async function cacheFirstTile(request) {
    const cache = await caches.open(TILE_CACHE);
    const cached = await cache.match(request);
    if (cached) return cached;
    try {
        const response = await fetch(request);
        if (response.ok || response.type === 'opaque') {
            await cache.put(request, response.clone());
            trimTiles(cache);
        }
        return response;
    } catch (error) {
        // Sin señal y sin la tesela: Leaflet muestra el cuadro vacío y el resto del mapa sigue funcionando.
        return Response.error();
    }
}

async function trimTiles(cache) {
    const keys = await cache.keys();
    const excess = keys.length - MAX_TILES;
    for (let i = 0; i < excess; i++) await cache.delete(keys[i]);
}

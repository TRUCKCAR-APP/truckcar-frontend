/**
 * Service Worker de TruckCar (PWA offline-first del conductor).
 *
 *  - App shell (HTML, CSS, JS propios): precargado al instalar (sin pasar por la caché HTTP). Con red se sirve la
 *    versión vigente (red primero, revalidada); sin señal, la copia guardada. Así nunca se mezcla HTML nuevo con CSS viejo.
 *  - CSS de Tailwind: compilado en el despliegue (css/tailwind.css), parte del app shell.
 *  - Librerías de CDN (Leaflet, Font Awesome): caché en tiempo de ejecución.
 *  - Teselas del mapa (Stadia Maps; CARTO como plan B): caché propia, separada del app shell, con la política de
 *    js/tileStore.js: solo las teselas ya vistas (nunca precarga), vencimiento según sus cabeceras (7 días si no traen),
 *    tope de 100 MB y expulsión de vencidas y menos usadas. Sin señal y sin tesela: un cuadro transparente.
 *  - API REST (api-gateway), WebSocket, evidencias (/pod-media/) y rutas OSRM: nunca se sirven desde caché; lo que
 *    se haga sin señal lo guarda la cola durable de IndexedDB (js/offlineQueue.js).
 *
 * Cambiar VERSION invalida el app shell anterior en la activación.
 */
importScripts('js/tileStore.js');

const VERSION = 'v20';
const SHELL_CACHE = `truckcar-shell-${VERSION}`;
const RUNTIME_CACHE = `truckcar-runtime-${VERSION}`;
// v1 guardaba hasta 1.500 teselas de OpenStreetMap sin vencimiento: al activarse esta versión se borra entera.
const TILE_CACHE = 'truckcar-tiles-v2';
const PURGE_EVERY_MS = 15 * 60 * 1000;
// PNG transparente de 1×1: sin señal y sin la tesela, el mapa muestra su fondo oscuro sin cuadros rotos ni errores.
const EMPTY_TILE = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAXpeqz8AAAAASUVORK5CYII=';

const SHELL = [
    './',
    'index.html',
    'manifest.webmanifest',
    'assets/icon.svg',
    'assets/icon-192.png',
    'assets/icon-512.png',
    'assets/icon-maskable-512.png',
    'assets/apple-touch-icon.png',
    'assets/icons.svg',
    'assets/brand/truckcar-logo.png',
    'assets/brand/truckcar-logo-blanco.png',
    'css/tokens.css',
    'fonts/manrope-latin-wght-normal.woff2',
    'css/main.css',
    'css/navigation.css',
    'css/tailwind.css',
    'js/config.js',
    'js/theme.js',
    'js/api.js',
    'js/mockData.js',
    'js/state.js',
    'js/ui/toaster.js',
    'js/ui/sheet.js',
    'js/offlineQueue.js',
    'js/tileStore.js',
    'js/podEvidence.js',
    'js/dataService.js',
    'js/geolocation.js',
    'js/telemetry.js',
    'js/navigation.js',
    'js/ui/native.js',
    'js/speechEngine.js',
    'js/mapController.js',
    'js/views/loginView.js',
    'js/views/driverApp.js',
    'js/views/driverActions.js',
    'js/views/coordinatorPanel.js',
    'js/views/podModals.js',
    'js/views/generatorPanel.js',
    'js/views/sosMonitor.js',
    'js/views/publicTracking.js',
    'assets/vendor/leaflet/leaflet.css',
    'assets/vendor/leaflet/leaflet.js',
    'js/messagingService.js',
    'js/notifications.js',
    'js/app.js'
];

const CDN_HOSTS = ['cdnjs.cloudflare.com', 'unpkg.com'];
// Proveedores de teselas de js/config.js (cambiar de uno a otro no requiere tocar este archivo).
const TILE_HOSTS = /^(tiles\.stadiamaps\.com|([a-d]\.)?basemaps\.cartocdn\.com)$/;

// Cada archivo se pide con cache: 'reload' para saltarse la caché HTTP del navegador: con addAll() una versión nueva
// del Service Worker podía guardar el CSS o el JS viejo que el navegador aún tenía en su caché.
self.addEventListener('install', (event) => {
    event.waitUntil(caches.open(SHELL_CACHE)
        .then(cache => Promise.all(SHELL.map(url => fetch(url, { cache: 'reload' }).then(response => {
            if (!response.ok) throw new Error('No se pudo precargar ' + url + ' (' + response.status + ')');
            return cache.put(url, response);
        }))))
        .then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
    event.waitUntil(caches.keys()
        .then(keys => Promise.all(keys
            .filter(key => key.startsWith('truckcar-') && ![SHELL_CACHE, RUNTIME_CACHE, TILE_CACHE].includes(key))
            .map(key => caches.delete(key))))
        .then(() => reconcileTiles())
        .then(() => purgeTiles())
        .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (event) => {
    const request = event.request;
    if (request.method !== 'GET') return; // POST/PATCH/PUT van siempre a la red (la cola offline los reintenta)
    const url = new URL(request.url);

    if (TILE_HOSTS.test(url.hostname)) {
        event.respondWith(tile(request));
        if (Date.now() - lastPurge > PURGE_EVERY_MS && event.waitUntil) event.waitUntil(purgeTiles());
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
    event.respondWith(networkFirstShell(request));
});

/**
 * App shell (CSS, JS, íconos): con red siempre la versión vigente, revalidada con el servidor (no-cache: un 304 si no
 * cambió); sin red, la copia guardada. Servirlo primero desde la caché mezclaba un index.html nuevo con el CSS viejo
 * hasta la recarga siguiente.
 */
async function networkFirstShell(request) {
    const cache = await caches.open(SHELL_CACHE);
    try {
        const response = await fetch(request, { cache: 'no-cache' });
        if (response.ok) cache.put(request, response.clone());
        return response;
    } catch (error) {
        return (await cache.match(request)) || Response.error();
    }
}

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

// ------------------------------------------------------------------ teselas del mapa
let lastPurge = 0;
let budget = Promise.resolve();

function emptyTile() {
    const bytes = Uint8Array.from(atob(EMPTY_TILE), c => c.charCodeAt(0));
    return new Response(bytes, { status: 200, headers: { 'Content-Type': 'image/png', 'Cache-Control': 'no-store' } });
}

/**
 * Una tesela que el mapa pidió: vigente en la caché, se sirve de ahí; si no, de la red, y se guarda con su vencimiento
 * si sus cabeceras lo permiten. Una vencida nunca se sirve: se borra. Sin red ni copia vigente, cuadro transparente.
 */
async function tile(request) {
    const cache = await caches.open(TILE_CACHE);
    const now = Date.now();
    const record = await self.TileStore.get(request.url).catch(() => null);
    if (record && record.expires > now) {
        const cached = await cache.match(request.url);
        if (cached) {
            if (now - record.used > 60000) self.TileStore.put({ ...record, used: now }).catch(() => {});
            return cached;
        }
    }
    if (record) {
        await cache.delete(request.url);
        await self.TileStore.remove(request.url).catch(() => {});
    }
    let response;
    try {
        response = await fetch(request);
    } catch (error) {
        return emptyTile();
    }
    // Solo respuestas legibles (CORS): de una opaca no se conocen el vencimiento ni el tamaño, así que no se guarda.
    if (response.ok && (response.type === 'cors' || response.type === 'basic')) {
        const ttl = self.TileStore.ttlFrom(response.headers, now);
        if (ttl > 0) await store(cache, request.url, response.clone(), now + ttl, now);
    }
    return response;
}

async function store(cache, url, response, expires, now) {
    try {
        const body = await response.blob();
        await cache.put(url, new Response(body, { headers: { 'Content-Type': response.headers.get('content-type') || 'image/png' } }));
        await self.TileStore.put({ url, bytes: body.size, expires, used: now });
        budget = budget.then(enforceBudget, enforceBudget);
        await budget;
    } catch (error) {
        // Sin espacio o sin IndexedDB: la tesela se muestra igual, solo no queda para usar sin señal.
        await cache.delete(url).catch(() => {});
    }
}

/** Tope de 100 MB: fuera las vencidas y, si no alcanza, las de uso menos reciente. */
async function enforceBudget() {
    const records = await self.TileStore.all();
    const total = records.reduce((sum, r) => sum + r.bytes, 0);
    const now = Date.now();
    if (total <= self.TileStore.MAX_BYTES && !records.some(r => r.expires <= now)) return;
    await evict(self.TileStore.planEviction(records, now, self.TileStore.MAX_BYTES));
}

async function evict(urls) {
    if (!urls.length) return;
    const cache = await caches.open(TILE_CACHE);
    await Promise.all(urls.map(url => cache.delete(url)));
    await self.TileStore.remove(urls);
}

/** Borra las teselas vencidas (al activarse el Service Worker y cada 15 min mientras se usa el mapa). */
async function purgeTiles() {
    lastPurge = Date.now();
    try {
        const now = Date.now();
        await evict((await self.TileStore.all()).filter(r => r.expires <= now).map(r => r.url));
    } catch (error) { /* sin IndexedDB: nada que purgar */ }
}

/** Caché e índice coinciden: una tesela sin vencimiento conocido no se conserva; un registro sin tesela, tampoco. */
async function reconcileTiles() {
    try {
        const cache = await caches.open(TILE_CACHE);
        const keys = (await cache.keys()).map(key => (typeof key === 'string' ? key : key.url));
        const known = new Set((await self.TileStore.all()).map(r => r.url));
        const cached = new Set(keys);
        await Promise.all(keys.filter(url => !known.has(url)).map(url => cache.delete(url)));
        const orphans = [...known].filter(url => !cached.has(url));
        if (orphans.length) await self.TileStore.remove(orphans);
    } catch (error) { /* sin IndexedDB: nada que reconciliar */ }
}


self.addEventListener('push', (event) => {
    let data = {};
    try {
        data = event.data ? event.data.json() : {};
    } catch (e) {
        data = { title: 'TruckCar', body: event.data ? event.data.text() : 'Nueva actualización' };
    }
    const title = data.title || 'TruckCar';
    const options = {
        body: data.body || 'Novedad en su ruta o asignación.',
        icon: 'assets/icon-192.png',
        badge: 'assets/icon-192.png',
        vibrate: [100, 50, 100],
        data: data.data || { url: './' }
    };
    event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
    event.notification.close();
    const targetUrl = (event.notification.data && event.notification.data.url) || './';
    event.waitUntil(
        clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
            for (const client of clientList) {
                if (client.url.includes(self.location.origin) && 'focus' in client) {
                    return client.focus();
                }
            }
            if (clients.openWindow) return clients.openWindow(targetUrl);
        })
    );
});

self.addEventListener('sync', (event) => {
    if (event.tag === 'truckcar-outbox-sync') {
        event.waitUntil(
            clients.matchAll().then(clientList => {
                clientList.forEach(client => client.postMessage({ type: 'TRUCKCAR_BACKGROUND_SYNC' }));
            })
        );
    }
});

/**
 * Índice de las teselas del mapa guardadas para usar sin señal (IndexedDB "truckcar-tiles"). Lo comparten el Service
 * Worker (sw.js, con importScripts), que decide qué guardar, hasta cuándo y qué expulsar, y la app, que lee hasta
 * cuándo hay mapa sin señal (pantalla Offline).
 *
 * Política (términos de Stadia Maps, docs/redesign/REPORTE.md §7):
 *  - Solo las teselas que el conductor ya vio: nunca se precargan zonas ni se descargan en bloque.
 *  - Cada tesela vence cuando lo dicen sus cabeceras (Cache-Control max-age, si no Expires); sin cabeceras, 7 días.
 *    Una tesela vencida no se sirve y se borra.
 *  - Tope de 100 MB por dispositivo, contado con el tamaño real de cada respuesta (las @2x pesan más y cuentan más).
 *    Al superarlo se expulsan primero las vencidas y después las de uso menos reciente.
 *
 * Cada registro: { url, bytes, expires, used } (fechas en ms).
 */
(function (scope) {
    const DB_NAME = 'truckcar-tiles';
    const STORE = 'tiles';
    const MAX_BYTES = 100 * 1024 * 1024;
    const DEFAULT_TTL_MS = 7 * 24 * 60 * 60 * 1000;

    let dbPromise = null;

    function open() {
        if (!dbPromise) {
            dbPromise = new Promise((resolve, reject) => {
                const request = indexedDB.open(DB_NAME, 1);
                request.onupgradeneeded = () => request.result.createObjectStore(STORE, { keyPath: 'url' });
                request.onsuccess = () => resolve(request.result);
                request.onerror = () => { dbPromise = null; reject(request.error); };
            });
        }
        return dbPromise;
    }

    function run(mode, work) {
        return open().then(db => new Promise((resolve, reject) => {
            const tx = db.transaction(STORE, mode);
            const result = work(tx.objectStore(STORE));
            tx.oncomplete = () => resolve(result && 'result' in result ? result.result : undefined);
            tx.onerror = () => reject(tx.error);
            tx.onabort = () => reject(tx.error);
        }));
    }

    /**
     * Milisegundos que la respuesta puede guardarse según sus cabeceras; 0 si no puede guardarse (no-store, no-cache,
     * max-age=0, Expires vencido o inválido). Sin Cache-Control ni Expires: 7 días.
     */
    function ttlFrom(headers, now) {
        const cacheControl = (headers.get('cache-control') || '').toLowerCase();
        if (/(^|,)\s*(no-store|no-cache)\b/.test(cacheControl)) return 0;
        const maxAge = /(^|,)\s*max-age\s*=\s*"?(\d+)/.exec(cacheControl);
        if (maxAge) return Number(maxAge[2]) * 1000;
        const expires = headers.get('expires');
        if (expires != null) {
            const at = Date.parse(expires);
            return Number.isFinite(at) ? Math.max(0, at - now) : 0;
        }
        return DEFAULT_TTL_MS;
    }

    /**
     * Qué expulsar para quedar bajo el tope: primero todas las vencidas, luego las de uso menos reciente hasta que el
     * total quepa. Función pura (se prueba sin IndexedDB).
     */
    function planEviction(records, now, maxBytes = MAX_BYTES) {
        const evict = [];
        let total = 0;
        const fresh = [];
        records.forEach(r => {
            if (r.expires <= now) evict.push(r.url);
            else { fresh.push(r); total += r.bytes; }
        });
        fresh.sort((a, b) => a.used - b.used);
        for (let i = 0; total > maxBytes && i < fresh.length; i++) {
            evict.push(fresh[i].url);
            total -= fresh[i].bytes;
        }
        return evict;
    }

    const TileStore = {
        MAX_BYTES,
        DEFAULT_TTL_MS,
        ttlFrom,
        planEviction,
        get: (url) => run('readonly', store => store.get(url)),
        put: (record) => run('readwrite', store => { store.put(record); }),
        remove: (urls) => run('readwrite', store => { [].concat(urls).forEach(url => store.delete(url)); }),
        all: () => run('readonly', store => store.getAll()),

        /**
         * Para la pantalla Offline: cuántas teselas vigentes hay, cuánto pesan y hasta cuándo dura la que vence antes
         * (desde ahí, parte del mapa ya no estará sin señal) y la que vence después.
         */
        async summary(now = Date.now()) {
            const fresh = (await TileStore.all()).filter(r => r.expires > now);
            return {
                count: fresh.length,
                bytes: fresh.reduce((sum, r) => sum + r.bytes, 0),
                firstExpiry: fresh.length ? Math.min(...fresh.map(r => r.expires)) : null,
                lastExpiry: fresh.length ? Math.max(...fresh.map(r => r.expires)) : null
            };
        }
    };

    scope.TileStore = TileStore;
})(typeof self !== 'undefined' ? self : window);

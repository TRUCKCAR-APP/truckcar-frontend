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

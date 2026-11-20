(function (scope) {
    const DB_NAME = 'truckcar-route';
    const STORE = 'trips';
    const MAX_AGE_MS = 3 * 24 * 60 * 60 * 1000;

    let dbPromise = null;

    function open() {
        if (!dbPromise) {
            dbPromise = new Promise((resolve, reject) => {
                const idb = scope.indexedDB;
                if (!idb) { dbPromise = null; reject(new Error('IndexedDB no disponible')); return; }
                const request = idb.open(DB_NAME, 1);
                request.onupgradeneeded = () => request.result.createObjectStore(STORE, { keyPath: 'loadId' });
                request.onsuccess = () => resolve(request.result);
                request.onerror = () => { dbPromise = null; reject(request.error); };
            });
        }
        return dbPromise;
    }

    function run(mode, work) {
        return open().then(db => new Promise((resolve, reject) => {
            const tx = db.transaction(STORE, mode);
            const request = work(tx.objectStore(STORE));
            tx.oncomplete = () => resolve(request && 'result' in request ? request.result : undefined);
            tx.onerror = () => reject(tx.error);
            tx.onabort = () => reject(tx.error);
        }));
    }

    function plain(value) {
        return value == null ? null : JSON.parse(JSON.stringify(value));
    }

    const RouteStore = {
        MAX_AGE_MS,

        async save(loadId, route, extra = {}) {
            if (loadId == null || !route || !Array.isArray(route.geometry)) return false;
            try {
                await run('readwrite', store => store.put({
                    loadId,
                    driverId: extra.driver && extra.driver.id != null ? extra.driver.id : null,
                    load: plain(extra.load),
                    driver: plain(extra.driver),
                    key: route.key,
                    source: route.source,
                    geometry: route.geometry,
                    steps: plain(route.steps),
                    totalM: route.totalM,
                    durationS: route.durationS,
                    choice: plain(route.choice),
                    clearance: plain(route.clearance),
                    provider: route.provider || null,
                    tolls: plain(route.tolls || []),
                    computedAt: route.computedAt || null,
                    nearby: plain(extra.nearby || []),
                    avoidPoints: plain(extra.avoidPoints || []),
                    savedAt: Date.now()
                }));
                return true;
            } catch (e) {
                return false;
            }
        },

        async load(loadId, now = Date.now()) {
            if (loadId == null) return null;
            try {
                const record = await run('readonly', store => store.get(loadId));
                return record && now - record.savedAt <= MAX_AGE_MS ? record : null;
            } catch (e) {
                return null;
            }
        },

        async latest(driverId, now = Date.now()) {
            try {
                const records = (await run('readonly', store => store.getAll())) || [];
                return records
                    .filter(r => r.load && now - r.savedAt <= MAX_AGE_MS && (driverId == null || r.driverId === driverId))
                    .sort((a, b) => b.savedAt - a.savedAt)[0] || null;
            } catch (e) {
                return null;
            }
        },

        async clear(loadId) {
            try {
                if (loadId == null) await run('readwrite', store => store.clear());
                else await run('readwrite', store => store.delete(loadId));
            } catch (e) {
            }
        }
    };

    scope.RouteStore = RouteStore;
})(typeof self !== 'undefined' ? self : window);

/**
 * Ruta del viaje activo guardada en el dispositivo (IndexedDB "truckcar-route"), para seguir guiando sin señal.
 *
 * Al aceptar o iniciar un viaje, la guía (navigation.js) guarda aquí la geometría, las maniobras, las restricciones de
 * gálibo y peso de la ruta elegida y las restricciones vecinas del corredor ampliado. Si la app se recarga o se abre
 * sin conexión con el viaje en curso, la guía se restaura desde este registro: siguen las instrucciones, el aviso de
 * las restricciones a 3 km (pantalla y voz) y, fuera de ruta, el aviso de los puentes bajos cercanos.
 *
 * Un registro por carga: { loadId, driverId, load, driver, key, source, geometry, steps, totalM, durationS, choice,
 * clearance, nearby, avoidPoints, savedAt }. load (la carga tal como la devolvió /loads/mine) y driver (el perfil del
 * propio conductor) permiten reabrir el viaje sin red: dataService los usa si /loads/mine o el perfil no responden.
 * Todo queda en el dispositivo del conductor y se borra al entregar o al cerrar sesión.
 */
(function (scope) {
    const DB_NAME = 'truckcar-route';
    const STORE = 'trips';
    // Un viaje guardado hace más de 3 días ya no es el viaje en curso.
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

    /** Copia sin funciones ni referencias circulares (IndexedDB guarda con structured clone). */
    function plain(value) {
        return value == null ? null : JSON.parse(JSON.stringify(value));
    }

    const RouteStore = {
        MAX_AGE_MS,

        /** Guarda (o reemplaza) la ruta del viaje de la carga. Nunca lanza: sin IndexedDB la guía sigue en memoria. */
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
                    nearby: plain(extra.nearby || []),
                    avoidPoints: plain(extra.avoidPoints || []),
                    savedAt: Date.now()
                }));
                return true;
            } catch (e) {
                return false;
            }
        },

        /** La ruta guardada de la carga, o null si no hay, no se puede leer o es de hace más de 3 días. */
        async load(loadId, now = Date.now()) {
            if (loadId == null) return null;
            try {
                const record = await run('readonly', store => store.get(loadId));
                return record && now - record.savedAt <= MAX_AGE_MS ? record : null;
            } catch (e) {
                return null;
            }
        },

        /** El viaje guardado más reciente del conductor (para reabrir la app sin red), o null. */
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

        /** Borra la ruta guardada (viaje entregado o cancelado). */
        async clear(loadId) {
            try {
                if (loadId == null) await run('readwrite', store => store.clear());
                else await run('readwrite', store => store.delete(loadId));
            } catch (e) {
                // Sin IndexedDB no hay nada que borrar.
            }
        }
    };

    scope.RouteStore = RouteStore;
})(typeof self !== 'undefined' ? self : window);

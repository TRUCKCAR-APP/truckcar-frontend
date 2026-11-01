/**
 * Ubicación real del dispositivo (GPS del teléfono vía navigator.geolocation). Es la única fuente de coordenadas para
 * el SOS y los reportes viales: nunca recibe posiciones simuladas ni del backend.
 *
 *  - watch(): seguimiento continuo mientras el conductor tiene sesión (telemetría, navigación y SOS lo comparten).
 *  - fix(): una lectura nueva (p. ej. al activar el SOS); si no llega a tiempo devuelve null.
 *  - last(): la última posición real confirmada. Se guarda en el dispositivo para sobrevivir a una recarga.
 */
window.DeviceLocation = (function () {
    const STORAGE_KEY = 'truckcar.lastGpsFix';
    const listeners = new Set();
    let watchId = null;
    let lastFix = restore();
    let error = null;

    function restore() {
        try {
            const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
            return saved && Array.isArray(saved.coords) && Number.isFinite(saved.time) ? saved : null;
        } catch (e) {
            return null;
        }
    }

    function record(position) {
        const c = position.coords;
        const previous = lastFix;
        lastFix = {
            coords: [c.latitude, c.longitude],
            accuracy: Number.isFinite(c.accuracy) ? c.accuracy : null,
            speedKmH: Number.isFinite(c.speed) && c.speed != null ? Math.round(c.speed * 3.6 * 10) / 10 : null,
            heading: Number.isFinite(c.heading) && c.heading != null ? c.heading : null,
            time: position.timestamp || Date.now()
        };
        error = null;
        try { localStorage.setItem(STORAGE_KEY, JSON.stringify(lastFix)); } catch (e) { /* sin almacenamiento */ }
        listeners.forEach(listener => { try { listener(lastFix, previous); } catch (e) { /* listener roto */ } });
        return lastFix;
    }

    function describeError(err) {
        if (!navigator.geolocation) return 'Este dispositivo no tiene GPS disponible.';
        if (err && err.code === 1) return 'Permiso de ubicación denegado: actívelo en los ajustes del navegador.';
        if (err && err.code === 3) return 'El GPS no respondió a tiempo.';
        return 'Sin señal GPS.';
    }

    return {
        get supported() { return !!navigator.geolocation; },
        get watching() { return watchId != null; },
        get error() { return error; },

        /** Última posición real; con maxAgeMs solo si es más reciente que eso. */
        last(maxAgeMs) {
            if (!lastFix) return null;
            if (maxAgeMs != null && Date.now() - lastFix.time > maxAgeMs) return null;
            return lastFix;
        },

        /** Lectura GPS nueva con alta precisión; resuelve null si no hay permiso, señal o se agota el tiempo. */
        fix({ timeoutMs = 6000, maximumAgeMs = 0 } = {}) {
            if (!navigator.geolocation) {
                error = describeError(null);
                return Promise.resolve(null);
            }
            return new Promise((resolve) => {
                let done = false;
                // Algunos navegadores no respetan timeout si el permiso está pendiente: se corta igual.
                const guard = setTimeout(() => { if (!done) { done = true; resolve(null); } }, timeoutMs + 500);
                navigator.geolocation.getCurrentPosition(
                    (position) => { if (done) return; done = true; clearTimeout(guard); resolve(record(position)); },
                    (err) => { if (done) return; done = true; clearTimeout(guard); error = describeError(err); resolve(null); },
                    { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: maximumAgeMs });
            });
        },

        watch() {
            if (watchId != null || !navigator.geolocation) return;
            watchId = navigator.geolocation.watchPosition(record, (err) => { error = describeError(err); },
                { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 });
        },

        stop() {
            if (watchId != null && navigator.geolocation) navigator.geolocation.clearWatch(watchId);
            watchId = null;
        },

        /** Al cerrar sesión se olvida la última posición: no debe quedar para el siguiente usuario del teléfono. */
        forget() {
            this.stop();
            lastFix = null;
            try { localStorage.removeItem(STORAGE_KEY); } catch (e) { /* sin almacenamiento */ }
        },

        onFix(listener) {
            listeners.add(listener);
            return () => listeners.delete(listener);
        },

        /** El conductor autenticado mantiene el GPS activo (SOS, reportes, telemetría y navegación). */
        sync(state) {
            if (state.isAuthenticated && state.activeRole === 'driver' && state.sessionRole === 'CONDUCTOR') this.watch();
            else this.stop();
        },

        /** "hace 2 min" para mostrar cuán vieja es la última posición confirmada. */
        age(fix = lastFix) {
            if (!fix) return '';
            const s = Math.max(0, Math.round((Date.now() - fix.time) / 1000));
            return s < 60 ? 'hace ' + s + ' s' : s < 3600 ? 'hace ' + Math.round(s / 60) + ' min' : 'hace ' + Math.round(s / 3600) + ' h';
        }
    };
})();

window.DeviceLocation = (function () {
    const STORAGE_KEY = 'truckcar.lastGpsFix';
    const listeners = new Set();
    let watchId = null;
    let bgWatcherId = null;
    let lastFix = restore();
    let error = null;
    let status = 'searching';

    function restore() {
        try {
            const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
            return saved && Array.isArray(saved.coords) && Number.isFinite(saved.time) ? saved : null;
        } catch (e) {
            return null;
        }
    }

    function record(position) {
        const c = position.coords || position;
        const previous = lastFix;
        lastFix = {
            coords: [c.latitude, c.longitude],
            accuracy: Number.isFinite(c.accuracy) ? c.accuracy : null,
            speedKmH: Number.isFinite(c.speed) && c.speed != null ? Math.round(c.speed * 3.6 * 10) / 10 : (c.speedKmH != null ? c.speedKmH : null),
            heading: Number.isFinite(c.heading) && c.heading != null ? c.heading : null,
            time: position.timestamp || Date.now()
        };
        error = null;
        status = 'active';
        try { localStorage.setItem(STORAGE_KEY, JSON.stringify(lastFix)); } catch (e) {}
        listeners.forEach(listener => { try { listener(lastFix, previous); } catch (e) {} });
        return lastFix;
    }

    function describeError(err) {
        status = 'denied';
        if (typeof navigator !== 'undefined' && !navigator.geolocation) return 'Este dispositivo no tiene GPS disponible.';
        if (err && (err.code === 1 || err.message === 'User denied Geolocation')) {
            status = 'denied';
            return 'Permiso de ubicación denegado: actívelo en los ajustes del dispositivo.';
        }
        if (err && err.code === 3) {
            status = 'searching';
            return 'El GPS no respondió a tiempo. Verifique tener vista despejada al cielo.';
        }
        status = 'offline';
        return 'Sin señal GPS.';
    }

    const isCapacitor = typeof window.Capacitor !== 'undefined';

    return {
        get supported() { return isCapacitor || (typeof navigator !== 'undefined' && !!navigator.geolocation); },
        get watching() { return watchId != null || bgWatcherId != null; },
        get error() { return error; },
        get status() { return status; },

        async requestPermission() {
            if (isCapacitor && window.Capacitor.Plugins.Geolocation) {
                try {
                    const perm = await window.Capacitor.Plugins.Geolocation.requestPermissions();
                    return perm.location === 'granted';
                } catch (e) {}
            }
            return (await this.fix({ timeoutMs: 5000 })) !== null;
        },

        last(maxAgeMs) {
            if (!lastFix) return null;
            if (maxAgeMs != null && Date.now() - lastFix.time > maxAgeMs) return null;
            return lastFix;
        },

        async fix({ timeoutMs = 7000, maximumAgeMs = 0 } = {}) {
            if (isCapacitor && window.Capacitor.Plugins.Geolocation) {
                try {
                    const pos = await window.Capacitor.Plugins.Geolocation.getCurrentPosition({
                        enableHighAccuracy: true,
                        timeout: timeoutMs,
                        maximumAge: maximumAgeMs
                    });
                    if (pos && pos.coords) return record(pos);
                } catch (e) {
                    error = describeError(e);
                }
            }

            if (typeof navigator === 'undefined' || !navigator.geolocation) {
                error = describeError(null);
                return null;
            }
            return new Promise((resolve) => {
                let done = false;
                const guard = setTimeout(() => { if (!done) { done = true; status = 'searching'; resolve(null); } }, timeoutMs + 500);
                navigator.geolocation.getCurrentPosition(
                    (position) => { if (done) return; done = true; clearTimeout(guard); resolve(record(position)); },
                    (err) => { if (done) return; done = true; clearTimeout(guard); error = describeError(err); resolve(null); },
                    { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: maximumAgeMs }
                );
            });
        },

        async watch() {
            if (this.watching) return;
            status = 'searching';

            if (isCapacitor && window.Capacitor.Plugins.BackgroundGeolocation) {
                try {
                    const bgPlugin = window.Capacitor.Plugins.BackgroundGeolocation;
                    bgWatcherId = await bgPlugin.addWatcher({
                        backgroundMessage: 'TruckCar: Transmitiendo ubicación de carga en tiempo real a la central de despacho.',
                        backgroundTitle: 'Navegación de carga activa',
                        requestPermissions: true,
                        stale: false,
                        distanceFilter: 10
                    }, (location, err) => {
                        if (err) { error = describeError(err); return; }
                        if (location) record(location);
                    });
                    return;
                } catch (e) {
                    console.warn('[TruckCar] Fallback a geolocalización estándar:', e);
                }
            }

            if (typeof navigator !== 'undefined' && navigator.geolocation) {
                watchId = navigator.geolocation.watchPosition(
                    record,
                    (err) => { error = describeError(err); },
                    { enableHighAccuracy: true, maximumAge: 3000, timeout: 20000 }
                );
            }
        },

        stop() {
            if (watchId != null && typeof navigator !== 'undefined' && navigator.geolocation) {
                navigator.geolocation.clearWatch(watchId);
                watchId = null;
            }
            if (bgWatcherId != null && isCapacitor && window.Capacitor.Plugins.BackgroundGeolocation) {
                try {
                    window.Capacitor.Plugins.BackgroundGeolocation.removeWatcher({ id: bgWatcherId });
                } catch (e) {}
                bgWatcherId = null;
            }
            status = 'offline';
        },

        forget() {
            this.stop();
            lastFix = null;
            try { localStorage.removeItem(STORAGE_KEY); } catch (e) {}
        },

        onFix(listener) {
            listeners.add(listener);
            return () => listeners.delete(listener);
        },

        sync(state) {
            if (state.isAuthenticated && state.activeRole === 'driver' && state.sessionRole === 'CONDUCTOR') {
                this.watch();
            } else {
                this.stop();
            }
        },

        age(fix = lastFix) {
            if (!fix) return '';
            const s = Math.max(0, Math.round((Date.now() - fix.time) / 1000));
            return s < 60 ? 'hace ' + s + ' s' : s < 3600 ? 'hace ' + Math.round(s / 60) + ' min' : 'hace ' + Math.round(s / 3600) + ' h';
        }
    };
})();

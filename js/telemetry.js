/**
 * Telemetría GPS en tiempo real (STOMP 1.2 sobre WebSocket) a través del api-gateway: ws://<gateway>/ws-telemetry.
 *
 * - TruckCarTelemetry: cliente STOMP mínimo (sin dependencias) con reconexión, heartbeats y re-suscripción.
 * - DriverTelemetry: el conductor transmite su posición cada 3 s mientras la carga está IN_TRANSIT, con el GPS del
 *   dispositivo o, si no hay señal (o en pruebas locales), con una simulación fluida sobre la ruta OSRM.
 * - LiveTracking: la torre de control (/topic/fleet-locations) y "Mis envíos" (/topic/trip/{loadId}) mueven los
 *   marcadores del mapa sin recargar la vista ni consultar la API por HTTP.
 *
 * El navegador no puede enviar cabeceras al abrir un WebSocket: el JWT viaja como ?access_token= y el gateway lo
 * valida y lo retira antes de reenviar el handshake a fleets-drivers.
 */
(function () {
    const config = window.TruckCarConfig;
    const api = window.TruckCarApi;
    const WS_URL = config.gatewayUrl.replace(/^http/i, 'ws') + '/ws-telemetry';
    const HEARTBEAT_MS = 10000;
    const MAX_RETRY_MS = 15000;

    // =================================================================== cliente STOMP
    const listeners = new Set();
    const subscriptions = new Map();   // id -> { destination, handler, onDenied }
    let ws = null;
    let status = 'offline';            // offline | connecting | online | reconnecting
    let publishers = 0;                // emisores activos (conductor) que necesitan la conexión
    let retryDelay = 2000;
    let retryTimer = null;
    let heartbeatTimer = null;
    let sequence = 0;

    function setStatus(next) {
        if (status === next) return;
        status = next;
        listeners.forEach(listener => { try { listener(status); } catch (e) { /* listener roto */ } });
        document.querySelectorAll('[data-telemetry-status]').forEach(renderStatusBadge);
    }

    /** Badges de estado ("En vivo" / "Reconectando") actualizados por DOM, sin re-render de la vista. */
    function renderStatusBadge(el) {
        const labels = { online: 'En vivo', connecting: 'Conectando…', reconnecting: 'Reconectando…', offline: 'Sin conexión en vivo' };
        const colors = { online: 'bg-emerald-500', connecting: 'bg-amber-400', reconnecting: 'bg-amber-400', offline: 'bg-slate-500' };
        el.innerHTML = `<span class="inline-block w-2 h-2 rounded-full ${colors[status]} ${status === 'online' ? 'animate-pulse' : ''}"></span> ${labels[status]}`;
    }

    function frame(command, headers = {}, body = '') {
        if (!ws || ws.readyState !== WebSocket.OPEN) return false;
        const lines = Object.entries(headers).map(([key, value]) => key + ':' + value);
        ws.send(command + '\n' + lines.join('\n') + '\n\n' + body + '\0');
        return true;
    }

    function wanted() {
        const session = api.session.get();
        return !!(session && session.accessToken) && (subscriptions.size > 0 || publishers > 0);
    }

    function connect() {
        if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;
        clearTimeout(retryTimer);
        if (!wanted()) {
            setStatus('offline');
            return;
        }
        const token = api.session.get().accessToken;
        setStatus(status === 'reconnecting' ? 'reconnecting' : 'connecting');
        const socket = new WebSocket(WS_URL + '?access_token=' + encodeURIComponent(token));
        ws = socket;
        socket.onopen = () => frame('CONNECT', { 'accept-version': '1.2', host: 'truckcar', 'heart-beat': HEARTBEAT_MS + ',' + HEARTBEAT_MS });
        socket.onmessage = (event) => handleData(String(event.data));
        socket.onclose = () => {
            if (ws !== socket) return;
            ws = null;
            clearInterval(heartbeatTimer);
            if (wanted()) {
                setStatus('reconnecting');
                retryTimer = setTimeout(connect, retryDelay);
                retryDelay = Math.min(retryDelay * 2, MAX_RETRY_MS);
            } else {
                setStatus('offline');
            }
        };
        // Los errores del socket terminan en onclose, que decide si reconectar.
        socket.onerror = () => {};
    }

    function handleData(data) {
        data.split('\0').forEach(raw => {
            const text = raw.replace(/^[\r\n]+/, '');
            if (!text) return;                                   // heartbeat del servidor
            const split = text.indexOf('\n\n');
            const head = split >= 0 ? text.slice(0, split) : text;
            const body = split >= 0 ? text.slice(split + 2) : '';
            const [command, ...headerLines] = head.split('\n');
            const headers = {};
            headerLines.forEach(line => {
                const colon = line.indexOf(':');
                if (colon > 0) headers[line.slice(0, colon)] = line.slice(colon + 1);
            });
            if (command === 'CONNECTED') onConnected();
            else if (command === 'MESSAGE') onMessage(headers, body);
            else if (command === 'ERROR') onServerError(headers.message || body);
        });
    }

    function onConnected() {
        retryDelay = 2000;
        setStatus('online');
        clearInterval(heartbeatTimer);
        heartbeatTimer = setInterval(() => { if (ws && ws.readyState === WebSocket.OPEN) ws.send('\n'); }, HEARTBEAT_MS);
        subscriptions.forEach((sub, id) => frame('SUBSCRIBE', { id, destination: sub.destination }));
    }

    function onMessage(headers, body) {
        const sub = subscriptions.get(headers.subscription);
        if (!sub) return;
        try {
            sub.handler(JSON.parse(body));
        } catch (e) {
            // Mensaje no JSON o error del manejador: se ignora para no cortar el flujo.
        }
    }

    /** El servidor cierra la sesión tras un ERROR; una suscripción denegada no se vuelve a intentar. */
    function onServerError(message) {
        const denied = /suscribirse a (\S+)/.exec(message || '');
        if (denied) {
            subscriptions.forEach((sub, id) => {
                if (sub.destination === denied[1]) {
                    subscriptions.delete(id);
                    if (sub.onDenied) sub.onDenied(message);
                }
            });
        }
    }

    const TruckCarTelemetry = {
        get status() { return status; },
        get isOnline() { return status === 'online'; },

        onStatusChange(listener) {
            listeners.add(listener);
            return () => listeners.delete(listener);
        },

        renderStatusBadges() {
            document.querySelectorAll('[data-telemetry-status]').forEach(renderStatusBadge);
        },

        /** Suscribe y devuelve la función para cancelar. Se re-suscribe sola tras cada reconexión. */
        subscribe(destination, handler, onDenied) {
            const id = 'sub-' + (++sequence);
            subscriptions.set(id, { destination, handler, onDenied });
            if (status === 'online') frame('SUBSCRIBE', { id, destination });
            else connect();
            return () => {
                if (!subscriptions.delete(id)) return;
                frame('UNSUBSCRIBE', { id });
                if (!wanted()) TruckCarTelemetry.disconnect(false);
            };
        },

        send(destination, payload) {
            if (status !== 'online') return false;
            return frame('SEND', { destination, 'content-type': 'application/json' }, JSON.stringify(payload));
        },

        acquirePublisher() {
            publishers++;
            connect();
        },

        releasePublisher() {
            publishers = Math.max(0, publishers - 1);
            if (!wanted()) TruckCarTelemetry.disconnect(false);
        },

        /** Cierra la conexión; con clearAll también olvida suscripciones y emisores (cierre de sesión). */
        disconnect(clearAll = true) {
            if (clearAll) {
                subscriptions.clear();
                publishers = 0;
            }
            clearTimeout(retryTimer);
            clearInterval(heartbeatTimer);
            const socket = ws;
            if (socket && socket.readyState === WebSocket.OPEN) frame('DISCONNECT');
            ws = null;
            if (socket) {
                try { socket.close(); } catch (e) { /* ya cerrado */ }
            }
            setStatus('offline');
        }
    };

    // =================================================================== geometría
    const toRad = (deg) => deg * Math.PI / 180;

    function distanceKm(a, b) {
        const dLat = toRad(b[0] - a[0]);
        const dLng = toRad(b[1] - a[1]);
        const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a[0])) * Math.cos(toRad(b[0])) * Math.sin(dLng / 2) ** 2;
        return 6371 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
    }

    function bearing(a, b) {
        const y = Math.sin(toRad(b[1] - a[1])) * Math.cos(toRad(b[0]));
        const x = Math.cos(toRad(a[0])) * Math.sin(toRad(b[0]))
            - Math.sin(toRad(a[0])) * Math.cos(toRad(b[0])) * Math.cos(toRad(b[1] - a[1]));
        return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
    }

    /** Punto a una distancia (km) a lo largo de la polilínea, con el rumbo del tramo. */
    function pointAlong(path, cumulative, km) {
        const total = cumulative[cumulative.length - 1];
        const target = Math.max(0, Math.min(km, total));
        let i = 1;
        while (i < cumulative.length - 1 && cumulative[i] < target) i++;
        const segment = cumulative[i] - cumulative[i - 1] || 1e-9;
        const t = (target - cumulative[i - 1]) / segment;
        const a = path[i - 1];
        const b = path[i];
        return { coords: [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t], heading: bearing(a, b), atEnd: target >= total };
    }

    // =================================================================== emisor del conductor
    const SIMULATION_KM_PER_TICK = 1.2;    // avance visual por envío (≈ recorrido acelerado para demos)
    const GPS_FRESH_MS = 10000;
    const MODE_KEY = 'truckcar.telemetryMode';

    const driver = {
        loadId: null, driverId: null, timer: null, watchId: null, lastGps: null, previousGps: null,
        path: null, cumulative: null, travelledKm: 0, simulatedSpeed: 62, mode: null, lastSent: null, lastPoint: null
    };

    /** auto: simulación en local, GPS (con respaldo de simulación) en despliegue. Se puede forzar desde la app. */
    function preferredMode() {
        let stored = null;
        try { stored = localStorage.getItem(MODE_KEY); } catch (e) { /* sin almacenamiento */ }
        if (stored === 'gps' || stored === 'simulation') return stored;
        return config.environment === 'local' ? 'simulation' : 'gps';
    }

    async function buildPath(load) {
        const routes = window.TruckCarData.routes;
        const waypoints = routes && routes.optimal && routes.optimal.waypoints && routes.optimal.waypoints.length >= 2
            ? routes.optimal.waypoints.map(w => w.coords)
            : [load.origin && load.origin.coords, load.destination && load.destination.coords].filter(Boolean);
        if (waypoints.length < 2) return null;
        if (window.mapCtrl && window.mapCtrl.cachedOptimalRoadGeometry && window.mapCtrl.cachedOptimalRoadGeometry.length > 1) {
            return window.mapCtrl.cachedOptimalRoadGeometry;
        }
        try {
            const url = 'https://router.project-osrm.org/route/v1/driving/'
                + waypoints.map(c => c[1] + ',' + c[0]).join(';') + '?overview=full&geometries=geojson';
            const response = await fetch(url);
            if (response.ok) {
                const json = await response.json();
                const coords = json.routes && json.routes[0] && json.routes[0].geometry.coordinates;
                if (coords && coords.length > 1) return coords.map(pt => [pt[1], pt[0]]);
            }
        } catch (e) {
            // Sin OSRM: se recorren los tramos rectos entre los puntos de la ruta.
        }
        return waypoints;
    }

    function nextSimulatedPoint() {
        if (!driver.path) return null;
        driver.simulatedSpeed = Math.max(45, Math.min(80, driver.simulatedSpeed + (Math.random() * 8 - 4)));
        driver.travelledKm += SIMULATION_KM_PER_TICK;
        const point = pointAlong(driver.path, driver.cumulative, driver.travelledKm);
        return { ...point, speed: point.atEnd ? 0 : Math.round(driver.simulatedSpeed * 10) / 10 };
    }

    function currentPoint() {
        const gpsFresh = driver.lastGps && Date.now() - driver.lastGps.time < GPS_FRESH_MS;
        if (preferredMode() === 'gps' && gpsFresh) {
            driver.mode = 'gps';
            const gps = driver.lastGps;
            const heading = gps.heading != null ? gps.heading
                : driver.previousGps ? bearing(driver.previousGps.coords, gps.coords) : null;
            return { coords: gps.coords, heading, speed: gps.speed };
        }
        driver.mode = 'simulation';
        return nextSimulatedPoint();
    }

    function tick() {
        const point = currentPoint();
        if (!point) return;
        driver.lastPoint = point;
        const sent = TruckCarTelemetry.send('/app/telemetry', {
            driverId: driver.driverId,
            latitude: Math.round(point.coords[0] * 1e6) / 1e6,
            longitude: Math.round(point.coords[1] * 1e6) / 1e6,
            speedKmH: point.speed,
            heading: point.heading == null ? null : Math.round(point.heading),
            loadId: driver.loadId
        });
        if (sent) driver.lastSent = Date.now();
        renderDriverBadge();
    }

    function renderDriverBadge() {
        const el = document.getElementById('driver-telemetry-badge');
        if (!el) return;
        const live = status === 'online' && driver.lastSent && Date.now() - driver.lastSent < 8000;
        const source = driver.mode === 'gps' ? 'GPS del dispositivo' : 'Simulación de ruta';
        const p = driver.lastPoint;
        el.innerHTML = `
            <span class="inline-block w-2 h-2 rounded-full ${live ? 'bg-emerald-400 animate-pulse' : 'bg-amber-400'}"></span>
            <span class="font-bold">${live ? 'Transmitiendo' : 'Sin transmitir'}</span>
            <span class="opacity-80">· ${source}${p ? ' · ' + p.speed + ' km/h' : ''}</span>
            <button type="button" onclick="window.DriverTelemetry.toggleMode()" class="ml-1 underline opacity-90">
                ${preferredMode() === 'gps' ? 'Usar simulación' : 'Usar GPS real'}
            </button>`;
    }

    function startGps() {
        if (driver.watchId != null || !navigator.geolocation || preferredMode() !== 'gps') return;
        driver.watchId = navigator.geolocation.watchPosition((position) => {
            driver.previousGps = driver.lastGps;
            const c = position.coords;
            driver.lastGps = {
                coords: [c.latitude, c.longitude],
                speed: c.speed != null ? Math.round(c.speed * 3.6 * 10) / 10 : 0,
                heading: c.heading != null && !isNaN(c.heading) ? c.heading : null,
                time: Date.now()
            };
        }, () => {
            // Sin permiso o sin señal: se transmite con la simulación de ruta.
        }, { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 });
    }

    function stopGps() {
        if (driver.watchId != null && navigator.geolocation) navigator.geolocation.clearWatch(driver.watchId);
        driver.watchId = null;
        driver.lastGps = null;
        driver.previousGps = null;
    }

    const DriverTelemetry = {
        get isRunning() { return driver.timer != null; },
        get loadId() { return driver.loadId; },

        /** Inicia (o mantiene) la transmisión de una carga IN_TRANSIT. Idempotente para la misma carga. */
        async start(load, driverId) {
            if (!load || load.status !== 'IN_TRANSIT' || !driverId) return;
            if (driver.timer && driver.loadId === load.backendId) return;
            this.stop();
            driver.loadId = load.backendId;
            driver.driverId = driverId;
            driver.travelledKm = 0;
            driver.timer = setInterval(tick, 3000);
            TruckCarTelemetry.acquirePublisher();
            startGps();
            const path = await buildPath(load);
            if (driver.loadId !== load.backendId) return;    // se detuvo mientras se calculaba la ruta
            driver.path = path;
            driver.cumulative = path ? path.reduce((acc, point, i) => {
                acc.push(i === 0 ? 0 : acc[i - 1] + distanceKm(path[i - 1], point));
                return acc;
            }, []) : null;
            tick();
        },

        stop() {
            if (driver.timer) {
                clearInterval(driver.timer);
                TruckCarTelemetry.releasePublisher();
            }
            stopGps();
            Object.assign(driver, { loadId: null, timer: null, path: null, cumulative: null, lastSent: null, lastPoint: null });
        },

        toggleMode() {
            const next = preferredMode() === 'gps' ? 'simulation' : 'gps';
            try { localStorage.setItem(MODE_KEY, next); } catch (e) { /* sin almacenamiento */ }
            if (next === 'gps') startGps(); else stopGps();
            window.ui.toast(next === 'gps'
                ? 'Telemetría con el GPS del dispositivo (con simulación si no hay señal).'
                : 'Telemetría con simulación sobre la ruta.', 'info');
            renderDriverBadge();
        },

        renderBadge: renderDriverBadge
    };

    // =================================================================== receptores (torre y generador)
    let fleetUnsubscribe = null;
    const tripSubscriptions = new Map();   // loadId -> unsubscribe

    function applyFleetLocation(msg) {
        const data = window.TruckCarData;
        const coords = [msg.latitude, msg.longitude];
        const fleet = data.fleetVehicles || (data.fleetVehicles = []);
        let truck = fleet.find(t => t.driverId === msg.driverId);
        if (!truck) {
            truck = { id: msg.driverId, driverId: msg.driverId, driverName: msg.driverName || msg.driverId,
                      plate: msg.vehiclePlate, vehicleType: '—', hoursActive: '—' };
            fleet.push(truck);
        }
        Object.assign(truck, {
            coords,
            speed: Math.round(msg.speedKmH || 0),
            heading: msg.heading,
            status: (msg.speedKmH || 0) > 0 || msg.loadStatus === 'IN_TRANSIT' ? 'EN_TRANSITO' : truck.status || 'DISPONIBLE',
            lastCheckin: 'ahora',
            currentLoadId: msg.loadId
        });
        return truck;
    }

    const LiveTracking = {
        /** Torre de control: posiciones de toda la flota. */
        followFleet(onUpdate) {
            if (fleetUnsubscribe) return;
            fleetUnsubscribe = TruckCarTelemetry.subscribe('/topic/fleet-locations', (msg) => {
                const truck = applyFleetLocation(msg);
                if (onUpdate) onUpdate(truck, msg);
            }, () => { fleetUnsubscribe = null; });
        },

        unfollowFleet() {
            if (fleetUnsubscribe) fleetUnsubscribe();
            fleetUnsubscribe = null;
        },

        /** "Mis envíos": mantiene una suscripción por cada carga aceptada o en ruta. */
        followTrips(loadIds, onUpdate) {
            const wantedIds = new Set(loadIds);
            tripSubscriptions.forEach((unsubscribe, loadId) => {
                if (!wantedIds.has(loadId)) {
                    unsubscribe();
                    tripSubscriptions.delete(loadId);
                }
            });
            wantedIds.forEach(loadId => {
                if (tripSubscriptions.has(loadId)) return;
                tripSubscriptions.set(loadId, TruckCarTelemetry.subscribe('/topic/trip/' + loadId, (msg) => {
                    const data = window.TruckCarData;
                    const trucks = data.shipmentTrucks || (data.shipmentTrucks = {});
                    const truck = Object.assign(trucks[msg.driverId] || { driverId: msg.driverId, id: msg.driverId }, {
                        driverName: msg.driverName || msg.driverId,
                        plate: msg.vehiclePlate,
                        coords: [msg.latitude, msg.longitude],
                        speed: Math.round(msg.speedKmH || 0),
                        heading: msg.heading,
                        status: (msg.speedKmH || 0) > 0 ? 'EN_TRANSITO' : 'DISPONIBLE',
                        lastCheckin: 'ahora'
                    });
                    trucks[msg.driverId] = truck;
                    if (onUpdate) onUpdate(truck, msg);
                }, () => tripSubscriptions.delete(loadId)));
            });
        },

        unfollowTrips() {
            this.followTrips([]);
        },

        stopAll() {
            this.unfollowFleet();
            this.unfollowTrips();
        }
    };

    window.TruckCarTelemetry = TruckCarTelemetry;
    window.DriverTelemetry = DriverTelemetry;
    window.LiveTracking = LiveTracking;
})();

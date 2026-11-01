/**
 * Telemetría GPS en tiempo real (STOMP 1.2 sobre WebSocket) a través del api-gateway: ws://<gateway>/ws-telemetry.
 *
 * - TruckCarTelemetry: cliente STOMP mínimo (sin dependencias) con reconexión, heartbeats y re-suscripción.
 * - DriverTelemetry: el conductor transmite su posición cada 3 s mientras la carga está IN_TRANSIT con el GPS real del
 *   dispositivo. La simulación sobre la ruta OSRM solo se usa si se activa en las herramientas de prueba.
 * - LiveTracking: la torre de control (/topic/fleet-locations) y "Mis envíos" (/topic/trip.{loadId}) mueven los
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

    let opening = false;

    function connect() {
        if (opening || (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING))) return;
        clearTimeout(retryTimer);
        if (!wanted()) {
            setStatus('offline');
            return;
        }
        setStatus(status === 'reconnecting' ? 'reconnecting' : 'connecting');
        // El gateway valida el JWT solo en el handshake: al reconectar tras 15 min hay que renovarlo antes.
        opening = true;
        api.ensureFreshSession()
            .catch(() => null)
            .then(() => {
                opening = false;
                if (!wanted()) {
                    setStatus('offline');
                    return;
                }
                openSocket(api.session.get().accessToken);
            });
    }

    function openSocket(token) {
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
    /**
     * Fuente de posición: el GPS real del dispositivo (window.DeviceLocation). Sin señal no se inventa nada: no se
     * transmite y el indicador lo dice. La simulación sobre la ruta solo existe como interruptor explícito de las
     * herramientas de prueba (barra de escritorio, "Simular GPS") y queda marcada como tal en la interfaz.
     */
    const SIMULATION_KM_PER_TICK = 1.2;    // avance por envío en la simulación de prueba (recorrido acelerado)
    const GPS_FRESH_MS = 10000;
    const MODE_KEY = 'truckcar.telemetryMode';

    const driver = {
        loadId: null, driverId: null, timer: null, load: null, previousPoint: null,
        path: null, cumulative: null, travelledKm: 0, simulatedSpeed: 62, mode: null, lastSent: null, lastPoint: null
    };

    function simulating() {
        try { return localStorage.getItem(MODE_KEY) === 'simulation'; } catch (e) { return false; }
    }

    async function buildPath(load) {
        const routes = window.TruckCarData.routes;
        const waypoints = routes && routes.optimal && routes.optimal.waypoints && routes.optimal.waypoints.length >= 2
            ? routes.optimal.waypoints.map(w => w.coords)
            : [load.origin && load.origin.coords, load.destination && load.destination.coords].filter(Boolean);
        if (waypoints.length < 2) return null;
        const guided = window.RouteGuidance && window.RouteGuidance.route;
        if (guided && guided.geometry.length > 1) return guided.geometry;
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

    async function prepareSimulation() {
        if (!driver.load || driver.path) return;
        const loadId = driver.loadId;
        const path = await buildPath(driver.load);
        if (driver.loadId !== loadId || !path) return;
        driver.path = path;
        driver.cumulative = path.reduce((acc, point, i) => {
            acc.push(i === 0 ? 0 : acc[i - 1] + distanceKm(path[i - 1], point));
            return acc;
        }, []);
    }

    function nextSimulatedPoint() {
        if (!driver.path) return null;
        driver.simulatedSpeed = Math.max(45, Math.min(80, driver.simulatedSpeed + (Math.random() * 8 - 4)));
        driver.travelledKm += SIMULATION_KM_PER_TICK;
        const point = pointAlong(driver.path, driver.cumulative, driver.travelledKm);
        return { ...point, speed: point.atEnd ? 0 : Math.round(driver.simulatedSpeed * 10) / 10, source: 'simulation' };
    }

    function currentPoint() {
        if (simulating()) {
            driver.mode = 'simulation';
            return nextSimulatedPoint();
        }
        const fix = window.DeviceLocation.last(GPS_FRESH_MS);
        if (!fix) {
            driver.mode = 'waiting';
            return null;
        }
        driver.mode = 'gps';
        const previous = driver.lastPoint;
        const heading = fix.heading != null ? fix.heading
            : previous && previous.source === 'gps' && distanceKm(previous.coords, fix.coords) > 0.005
                ? bearing(previous.coords, fix.coords) : null;
        return { coords: fix.coords, heading, speed: fix.speedKmH != null ? fix.speedKmH : 0, accuracy: fix.accuracy, source: 'gps' };
    }

    function tick() {
        const point = currentPoint();
        if (!point) {
            renderDriverBadge();
            return;
        }
        driver.lastPoint = point;
        // Con la red caída (o la simulación de pérdida de señal) no se intenta el envío en vivo.
        const offline = window.OfflineQueue && window.OfflineQueue.isOffline();
        const sent = !offline && TruckCarTelemetry.send('/app/telemetry', {
            driverId: driver.driverId,
            latitude: Math.round(point.coords[0] * 1e6) / 1e6,
            longitude: Math.round(point.coords[1] * 1e6) / 1e6,
            speedKmH: point.speed,
            heading: point.heading == null ? null : Math.round(point.heading),
            loadId: driver.loadId
        });
        if (sent) {
            driver.lastSent = Date.now();
        } else {
            queueOfflinePosition(point);
        }
        if (window.RouteGuidance) window.RouteGuidance.update(point);
        if (window.mapCtrl && window.mapCtrl.map && window.store.state.driverScreen === 'navigation') {
            window.mapCtrl.updateTruckPosition(point.coords);
        }
        renderDriverBadge();
    }

    /**
     * Sin conexión en vivo la posición va a la cola durable (máx. 1 cada 15 s para acotar el almacenamiento): al
     * reconectar se sincroniza el recorrido completo y el mapa recibe solo la última posición.
     */
    const OFFLINE_POSITION_INTERVAL_MS = 15000;
    function queueOfflinePosition(point) {
        if (!window.OfflineQueue || !driver.driverId) return;
        const now = Date.now();
        if (driver.lastQueued && now - driver.lastQueued < OFFLINE_POSITION_INTERVAL_MS) return;
        driver.lastQueued = now;
        window.OfflineQueue.enqueue('position', {
            latitude: Math.round(point.coords[0] * 1e6) / 1e6,
            longitude: Math.round(point.coords[1] * 1e6) / 1e6,
            speedKmH: point.speed,
            heading: point.heading == null ? null : Math.round(point.heading),
            loadId: driver.loadId
        }, { tripId: driver.loadId }).catch(() => { /* sin IndexedDB: la posición se pierde como antes */ });
    }

    function renderDriverBadge() {
        const el = document.getElementById('driver-telemetry-badge');
        if (!el) return;
        const live = status === 'online' && driver.lastSent && Date.now() - driver.lastSent < 8000;
        const p = driver.lastPoint;
        if (driver.mode === 'waiting' || !driver.mode) {
            const reason = window.DeviceLocation.error || 'Esperando la señal GPS del dispositivo…';
            el.innerHTML = `<span class="inline-block w-2 h-2 rounded-full bg-amber-400"></span>
                <span class="font-bold">Sin posición</span><span class="opacity-80">· ${window.ui.escape(reason)}</span>`;
            return;
        }
        const source = driver.mode === 'gps'
            ? 'GPS del dispositivo' + (p && p.accuracy ? ' ±' + Math.round(p.accuracy) + ' m' : '')
            : '<b class="text-amber-300">Simulación de prueba</b>';
        el.innerHTML = `
            <span class="inline-block w-2 h-2 rounded-full ${live ? 'bg-emerald-400 animate-pulse' : 'bg-amber-400'}"></span>
            <span class="font-bold">${live ? 'Transmitiendo' : 'Sin transmitir'}</span>
            <span class="opacity-80">· ${source}${p ? ' · ' + p.speed + ' km/h' : ''}</span>`;
    }

    function renderSimulationToggle() {
        const button = document.getElementById('sim-toggle-btn');
        if (!button) return;
        const on = simulating();
        button.setAttribute('aria-pressed', String(on));
        button.classList.toggle('is-active', on);
        const label = button.querySelector('[data-sim-label]');
        if (label) label.textContent = on ? 'Simulando GPS' : 'Simular GPS';
    }

    const DriverTelemetry = {
        get isRunning() { return driver.timer != null; },
        get loadId() { return driver.loadId; },
        get lastPoint() { return driver.lastPoint; },
        get simulating() { return simulating(); },

        /** Inicia (o mantiene) la transmisión de una carga IN_TRANSIT. Idempotente para la misma carga. */
        async start(load, driverId) {
            if (!load || load.status !== 'IN_TRANSIT' || !driverId) return;
            if (driver.timer && driver.loadId === load.backendId) return;
            this.stop();
            driver.loadId = load.backendId;
            driver.load = load;
            driver.driverId = driverId;
            driver.travelledKm = 0;
            driver.timer = setInterval(tick, 3000);
            TruckCarTelemetry.acquirePublisher();
            window.DeviceLocation.watch();
            if (simulating()) await prepareSimulation();
            if (driver.loadId !== load.backendId) return;    // se detuvo mientras se calculaba la ruta
            tick();
        },

        stop() {
            if (driver.timer) {
                clearInterval(driver.timer);
                TruckCarTelemetry.releasePublisher();
            }
            Object.assign(driver, { loadId: null, load: null, timer: null, path: null, cumulative: null, lastSent: null,
                lastPoint: null, mode: null });
        },

        /** Herramientas de prueba: alterna la simulación de movimiento sobre la ruta (por defecto, GPS real). */
        async toggleSimulation() {
            const next = !simulating();
            try {
                if (next) localStorage.setItem(MODE_KEY, 'simulation');
                else localStorage.removeItem(MODE_KEY);
            } catch (e) { /* sin almacenamiento */ }
            driver.lastPoint = null;
            renderSimulationToggle();
            window.ui.toast(next ? 'Simulación de GPS activada (herramienta de prueba)' : 'GPS real del dispositivo',
                next ? 'warning' : 'success', {
                    description: next
                        ? 'La telemetría y la guía avanzan sobre la ruta. El SOS y los reportes siguen usando solo el GPS real.'
                        : 'La telemetría y la guía usan la ubicación del teléfono.'
                });
            if (next) await prepareSimulation();
            if (driver.timer) tick();
            renderDriverBadge();
        },

        renderBadge: renderDriverBadge,
        renderSimulationToggle
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
                tripSubscriptions.set(loadId, TruckCarTelemetry.subscribe('/topic/trip.' + loadId, (msg) => {
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

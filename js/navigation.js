window.RouteGuidance = (function () {
    const OFF_ROUTE_M = 250;
    const REROUTE_COOLDOWN_MS = 30000;
    const CLEARANCE_ANNOUNCE_M = 3000;
    const CLEARANCE_MAX_POINTS = 400;
    const MAX_ALTERNATIVES = 3;
    // Una ruta alterna más larga que esto (en tiempo o en distancia) se pregunta antes de tomarla.
    const LONGER_ASK_S = 300;
    const LONGER_ASK_M = 5000;
    const AVOID_RADIUS_M = 300;
    const TRUCK_CODE = /^[A-Z][A-Z0-9_]{2,39}$/;
    const ARRIVED_M = 60;
    const NEAR_ANNOUNCE_M = 300;
    const NEARBY_CORRIDOR_M = 500;
    const BLOCKAGE_NEAR_M = 150;
    const DETOUR_OFFSET_DEG = 0.03;
    const RETRY_ONLINE_MS = 60000;
    const AI_ALERT_OK_MS = 20000;
    // Parada elegida por el conductor (restaurante, estación, hotel…) dentro de la ruta guiada.
    const STOP_ARRIVED_M = 80;
    const STOP_PASSED_M = 250;
    const STOP_LEFT_M = 400;
    const STOP_GRACE_MS = 15000;
    const STOP_AHEAD_M = 60000;
    const STOP_MAX_DETOUR_M = 5000;
    // Recogida: si el conductor arranca lejos del origen, la guía lo lleva primero al punto de cargue.
    const PICKUP_FAR_M = 1000;
    const PICKUP_ARRIVED_M = 150;
    const PICKUP_KEY = 'truckcar.pickup.';

    let route = null;
    let status = 'idle';
    let progress = null;
    let pendingKey = null;
    let lastReroute = 0;
    const announced = new Set();
    const listeners = new Set();
    let clearance = null;
    let wakeLock = null;
    let loadId = null;
    let currentLoad = null;
    let nearby = [];
    let avoidPoints = [];
    let aiAlert = null;
    const handledBlockages = new Set();
    let lastNetworkTry = 0;
    let aiAlertTimer = null;
    /**
     * Parada intermedia: { title, address, phone, coords, destination, alongM, addedAt, reached, skipped, arrivedAt }.
     * La ruta guiada pasa por ella y sigue al destino (destination); al llegar se anuncia y al arrancar se sigue sola.
     */
    let stop = null;
    /** Punto de cargue mientras falta recoger: { kind: 'pickup', title, coords, destination, alongM, reached, arrivedAt }. */
    let pickup = null;
    const MAX_HUD_ALERTS = 2;
    const EXPANDED_ALERTS_MS = 15000;
    let alertsExpanded = false;
    let expandedTimer = null;

    const toRad = (deg) => deg * Math.PI / 180;

    function distanceM(a, b) {
        const dLat = toRad(b[0] - a[0]);
        const dLng = toRad(b[1] - a[1]);
        const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a[0])) * Math.cos(toRad(b[0])) * Math.sin(dLng / 2) ** 2;
        return 6371000 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
    }

    function project(geometry, cumulative, point) {
        const cos = Math.cos(toRad(point[0]));
        let best = { alongM: 0, offM: Infinity };
        for (let i = 1; i < geometry.length; i++) {
            const a = geometry[i - 1];
            const b = geometry[i];
            const ax = a[1] * cos, ay = a[0], bx = b[1] * cos, by = b[0], px = point[1] * cos, py = point[0];
            const dx = bx - ax, dy = by - ay;
            const len2 = dx * dx + dy * dy;
            const t = len2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2)) : 0;
            const closest = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
            const off = distanceM(point, closest);
            if (off < best.offM) {
                best = { alongM: cumulative[i - 1] + (cumulative[i] - cumulative[i - 1]) * t, offM: off };
            }
        }
        return best;
    }

    const MODIFIERS = {
        right: 'a la derecha', left: 'a la izquierda', 'slight right': 'ligeramente a la derecha',
        'slight left': 'ligeramente a la izquierda', 'sharp right': 'cerrado a la derecha',
        'sharp left': 'cerrado a la izquierda', straight: 'derecho', uturn: 'en U'
    };

    function street(step) {
        if (step.name && step.ref) return step.name + ' (' + step.ref + ')';
        return step.name || step.ref || '';
    }

    function instruction(step, isLast) {
        const m = step.maneuver || {};
        if (step.hereText && m.type !== 'arrive') {
            const text = step.hereText.replace(/\s*Siga durante[^.]*\.?\s*$/i, '').replace(/[.\s]+$/, '').trim();
            if (text) return text;
        }
        const mod = MODIFIERS[m.modifier] || '';
        const road = street(step);
        const via = road ? ' por ' + road : '';
        const toward = road ? ' hacia ' + road : '';
        if (m.modifier === 'uturn' && m.type !== 'arrive' && m.type !== 'depart') return 'Haga un giro en U' + via;
        switch (m.type) {
            case 'depart': return 'Inicie el recorrido' + via;
            case 'arrive': return isLast ? 'Llegó al destino de la carga' : 'Llegó a un punto de la ruta';
            case 'turn': return 'Gire ' + mod + via;
            case 'merge': return 'Incorpórese ' + (mod ? mod + ' ' : '') + (road ? 'a ' + road : 'a la vía');
            case 'on ramp': return 'Tome la rampa ' + mod + toward;
            case 'off ramp': return 'Tome la salida ' + mod + toward;
            case 'fork': return 'En la bifurcación, manténgase ' + mod + via;
            case 'end of road': return 'Al final de la vía, gire ' + mod + via;
            case 'roundabout':
            case 'rotary': return 'En la glorieta, tome la ' + (m.exit ? m.exit + '.ª ' : '') + 'salida' + toward;
            case 'exit roundabout':
            case 'exit rotary': return 'Salga de la glorieta' + via;
            default: return (m.modifier && m.modifier !== 'straight' ? 'Continúe ' + mod : 'Continúe derecho') + via;
        }
    }

    function icon(step) {
        const m = step.maneuver || {};
        if (m.type === 'arrive') return 'fa-flag-checkered';
        if (m.type === 'depart') return 'fa-location-arrow';
        if (m.type === 'roundabout' || m.type === 'rotary') return 'fa-arrows-spin';
        if (m.modifier === 'uturn') return 'fa-arrow-rotate-left';
        if ((m.modifier || '').includes('right')) return 'fa-arrow-right';
        if ((m.modifier || '').includes('left')) return 'fa-arrow-left';
        return 'fa-arrow-up';
    }

    function glyph(step) {
        const m = step.maneuver || {};
        const mod = m.modifier || '';
        if (m.type === 'arrive') return 'flag-checkered-fill';
        if (m.type === 'depart') return 'navigation-arrow-fill';
        if (m.type === 'roundabout' || m.type === 'rotary') return 'arrows-counter-clockwise';
        if (mod === 'uturn') return 'arrow-u-up-left';
        if (mod === 'slight left') return 'arrow-up-left';
        if (mod === 'slight right') return 'arrow-up-right';
        if (mod.includes('left')) return 'arrow-bend-up-left';
        if (mod.includes('right')) return 'arrow-bend-up-right';
        return 'arrow-up';
    }

    function formatDistance(m) {
        if (m == null || !Number.isFinite(m)) return '—';
        if (m < 1000) return Math.max(10, Math.round(m / 10) * 10) + ' m';
        return (m / 1000).toLocaleString('es-CO', { maximumFractionDigits: m < 10000 ? 1 : 0 }) + ' km';
    }

    function spokenDistance(m) {
        return m < 1000 ? 'En ' + Math.max(50, Math.round(m / 50) * 50) + ' metros, ' : 'En ' + formatDistance(m).replace(' km', ' kilómetros') + ', ';
    }

    function waypointsFor(load) {
        const routes = window.TruckCarData.routes;
        const plan = routes && routes.optimal && routes.optimal.waypoints && routes.optimal.waypoints.length >= 2
            && (!routes.planForLoadId || routes.planForLoadId === load.backendId) ? routes.optimal : null;
        if (plan) return { key: plan.id, source: 'Route-AI', points: plan.waypoints.map(w => w.coords) };
        const points = [load.origin && load.origin.coords, load.destination && load.destination.coords].filter(Boolean);
        return points.length >= 2 ? { key: 'CARGA-' + load.backendId, source: 'carga', points } : null;
    }

    /** Maniobra de HERE → forma de OSRM que entienden instruction(), icon() y glyph(). */
    const HERE_TYPES = { depart: 'depart', arrive: 'arrive', turn: 'turn', uTurn: 'turn', keep: 'fork',
        roundaboutEnter: 'roundabout', roundaboutPass: 'roundabout', roundaboutExit: 'roundabout',
        ramp: 'on ramp', exit: 'off ramp', enterHighway: 'merge' };

    function hereModifier(step) {
        if (step.action === 'uTurn') return 'uturn';
        if (step.direction === 'middle') return 'straight';
        if (step.direction !== 'left' && step.direction !== 'right') return undefined;
        if (step.severity === 'light') return 'slight ' + step.direction;
        if (step.severity === 'heavy') return 'sharp ' + step.direction;
        return step.direction;
    }

    function fromHere(option) {
        const steps = (option.steps || []).map(s => ({
            distance: Number(s.distanceMeters) || 0,
            duration: Number(s.durationSeconds) || 0,
            name: '',
            hereText: s.instruction || '',
            maneuver: { type: HERE_TYPES[s.action] || 'continue', modifier: hereModifier(s), exit: s.exit || undefined,
                location: Number.isFinite(s.longitude) && Number.isFinite(s.latitude) ? [s.longitude, s.latitude] : undefined }
        }));
        return { geometry: { coordinates: option.geometry.map(p => [p[1], p[0]]) }, legs: [{ steps }],
            duration: option.durationSeconds, distance: option.distanceMeters, provider: 'HERE',
            violations: Array.isArray(option.violations) ? option.violations : [],
            // Peajes con la tarifa de HERE para este camión (el Copiloto dice cuánto falta y cuánto cuesta).
            tolls: (Array.isArray(option.tolls) ? option.tolls : [])
                .filter(t => t && Number.isFinite(t.latitude) && Number.isFinite(t.longitude))
                .map(t => ({ name: String(t.name || 'Peaje').slice(0, 80), latitude: t.latitude, longitude: t.longitude,
                    cost: Number.isFinite(t.cost) ? t.cost : null, currency: typeof t.currency === 'string' ? t.currency : null })) };
    }

    /**
     * Rutas de HERE para el camión (altura, peso, ejes y tráfico) desde la posición actual, evitando las zonas dadas.
     * null si no hay vehículo, si el servicio no responde o si no devuelve rutas: quien llama usa el respaldo OSRM.
     */
    async function hereRoutes(position, destination, avoid, via = []) {
        const api = window.TruckCarApi && window.TruckCarApi.routes;
        const vehicle = currentVehicle();
        if (!api || !api.reroute || !vehicle || !position || !destination) return null;
        try {
            const response = await api.reroute({
                originLatitude: position[0], originLongitude: position[1],
                destinationLatitude: destination[0], destinationLongitude: destination[1],
                heightMeters: vehicle.height, grossWeightTons: vehicle.grossWeight,
                ...(TRUCK_CODE.test(vehicle.category || '') ? { truckType: vehicle.category } : {}),
                avoid: avoid.slice(-10).map(p => ({ latitude: p.lat, longitude: p.lng, radiusMeters: AVOID_RADIUS_M })),
                ...(via.length ? { via: via.map(p => ({ latitude: p[0], longitude: p[1] })) } : {})
            });
            const routes = (response && Array.isArray(response.routes) ? response.routes : [])
                .filter(r => Array.isArray(r.geometry) && r.geometry.length >= 2).slice(0, MAX_ALTERNATIVES);
            return routes.length ? routes.map(fromHere) : null;
        } catch (e) {
            return null;
        }
    }

    async function requestRoutes(points) {
        const found = await window.TruckCarApi.routing.drivingRoutes(points, { steps: true, alternatives: points.length === 2 });
        const routes = found.filter(r => r.legs).slice(0, MAX_ALTERNATIVES);
        if (!routes.length) throw new Error('El servicio de rutas no devolvió maniobras');
        return routes;
    }

    function buildRoute(osrm, key, source) {
        const geometry = osrm.geometry.coordinates.map(pt => [pt[1], pt[0]]);
        const cumulative = geometry.reduce((acc, point, i) => {
            acc.push(i === 0 ? 0 : acc[i - 1] + distanceM(geometry[i - 1], point));
            return acc;
        }, []);
        const raw = osrm.legs.flatMap(leg => leg.steps || []);
        const kept = raw.filter((s, i) => !(s.maneuver && s.maneuver.type === 'arrive' && i < raw.length - 1));
        let start = 0;
        const steps = kept.map((s, i) => {
            const step = {
                startM: start,
                distanceM: s.distance,
                text: instruction(s, i === kept.length - 1),
                street: street(s),
                icon: icon(s),
                glyph: glyph(s),
                location: s.maneuver && s.maneuver.location ? [s.maneuver.location[1], s.maneuver.location[0]] : null
            };
            start += s.distance;
            return step;
        });
        return { key, source, geometry, cumulative, steps, totalM: cumulative[cumulative.length - 1], durationS: osrm.duration,
            provider: osrm.provider || 'OSRM', violations: osrm.violations || [], tolls: osrm.tolls || [], computedAt: Date.now() };
    }

    function notify() {
        listeners.forEach(listener => { try { listener(snapshot()); } catch (e) { } });
        renderHud();
    }

    async function prepare(load) {
        if (!load) return;
        // Un destino elegido por el conductor manda hasta que termine esa navegación.
        if (freeDestination) return;
        if (loadId !== load.backendId) {
            pickup = null;
            clearStop();
            avoidPoints = [];
            aiAlert = null;
            handledBlockages.clear();
            nearby = [];
        }
        loadId = load.backendId;
        currentLoad = load;
        if (route && route.restored && route.loadId === load.backendId && Date.now() - lastNetworkTry < RETRY_ONLINE_MS) return;
        const target = waypointsFor(load);
        if (!target) {
            route = null;
            status = 'unavailable';
            notify();
            return;
        }
        if ((route && route.key === target.key && !route.restored) || pendingKey === target.key) return;
        const restoredBefore = route && route.restored && route.loadId === load.backendId;
        pendingKey = target.key;
        lastNetworkTry = Date.now();
        if (!restoredBefore) {
            status = 'loading';
            progress = null;
            announced.clear();
            notify();
        }
        try {
            const candidates = avoiding((await requestRoutes(target.points)).map(osrm => buildRoute(osrm, target.key, target.source)));
            if (pendingKey !== target.key) return;
            const chosen = await chooseRoute(candidates);
            if (pendingKey !== target.key) return;
            if (restoredBefore) announced.clear();
            useRoute(chosen, candidates);
            status = 'ready';
            acquireWakeLock();
            announceChoice(chosen);
            persist();
            refreshNearby(chosen);
            const fix = window.DriverTelemetry && window.DriverTelemetry.lastPoint;
            if (fix) update(fix); else notify();
        } catch (e) {
            if (pendingKey !== target.key) return;
            if (restoredBefore) return;
            const saved = await restore(load.backendId);
            if (pendingKey !== target.key) return;
            if (saved) {
                status = 'ready';
                persist();
                const fix = window.DriverTelemetry && window.DriverTelemetry.lastPoint;
                if (fix) update(fix); else notify();
                return;
            }
            route = null;
            status = 'unavailable';
            notify();
        } finally {
            if (pendingKey === target.key) pendingKey = null;
        }
    }

    async function reroute(position) {
        if (!route || Date.now() - lastReroute < REROUTE_COOLDOWN_MS) return;
        lastReroute = Date.now();
        const destination = finalDestination();
        const key = route.key;
        try {
            const candidates = avoiding((await requestRoutes([position, ...pendingVia(position), destination]))
                .map(osrm => buildRoute(osrm, key, 'recalculada')));
            if (!route || route.key !== key) return;
            const chosen = await chooseRoute(candidates);
            if (!route || route.key !== key) return;
            announced.clear();
            useRoute(chosen, candidates);
            if (window.voiceEngine) window.voiceEngine.speak('Ruta recalculada.', false);
            announceChoice(chosen);
            persist();
            refreshNearby(chosen);
            update({ coords: position });
        } catch (e) {
        }
    }

    /** Punto de la ruta a `targetM` metros del inicio (o el último si se pasa). */
    function pointAlong(targetM) {
        const i = route.cumulative.findIndex(c => c >= targetM);
        return route.geometry[i === -1 ? route.geometry.length - 1 : i];
    }

    /**
     * Recálculo pedido por el conductor (copiloto de voz). Sin cooldown: es una orden explícita.
     *  - avoidAhead=false: nueva ruta desde la posición actual hasta el destino.
     *  - avoidAhead=true: evita el tramo que tiene adelante (≈1,5 km) con el mismo mecanismo de desvío de los bloqueos.
     * Devuelve { ok, remainingM, durationS, restricted } o { ok: false, reason } sin hablar: quien llama lo anuncia.
     */
    /**
     * Calcula una ruta nueva sin aplicarla. Primero HERE para camión; si no responde, OSRM.
     *  - avoidAhead=false: nueva ruta desde la posición actual hasta el destino.
     *  - avoidAhead=true: evita el tramo de adelante (≈1,5 km), con las mismas zonas evitadas de los bloqueos.
     * Reglas: nunca propone una ruta con restricciones de gálibo o peso si la actual no las tiene
     * (reason 'restricted-alternatives'); needsConfirmation si es más larga (5 min o 5 km) o no se pudo verificar.
     */
    async function planReroute({ avoidAhead = false } = {}) {
        if (!route) return { ok: false, reason: 'no-route' };
        const key = route.key;
        const position = currentPosition();
        try {
            let extraAvoid = null;
            if (avoidAhead) {
                const done = progress && progress.alongM != null ? progress.alongM : project(route.geometry, route.cumulative, position).alongM;
                const point = pointAlong(done + 1500);
                extraAvoid = { lat: point[0], lng: point[1], alertId: null };
            }
            const avoidList = extraAvoid ? [...avoidPoints, extraAvoid] : avoidPoints;
            const candidates = await rerouteCandidates(position, avoidList, extraAvoid ? [extraAvoid.lat, extraAvoid.lng] : null);
            if (!route || route.key !== key) return { ok: false, reason: 'changed' };
            if (!candidates.length) return { ok: false, reason: 'no-detour' };
            const chosen = await chooseRoute(candidates);
            if (!route || route.key !== key) return { ok: false, reason: 'changed' };
            const choice = chosen.choice;
            const currentRestricted = Boolean((clearance && clearance.key === route.key && clearance.blocking > 0)
                || (route.choice && route.choice.restricted));
            if (choice.restricted && !currentRestricted) {
                return { ok: false, reason: 'restricted-alternatives', blocking: choice.blocking };
            }
            const left = remaining();
            const extraM = left && Number.isFinite(left.remainingM) ? chosen.totalM - left.remainingM : null;
            const extraS = left && Number.isFinite(left.durationS) && Number.isFinite(chosen.durationS) ? chosen.durationS - left.durationS : null;
            const longer = (extraS != null && extraS > LONGER_ASK_S) || (extraM != null && extraM > LONGER_ASK_M);
            const unchecked = !choice.verified;
            return { ok: true, key, chosen, candidates, extraAvoid, position,
                remainingM: chosen.totalM, durationS: chosen.durationS, restricted: Boolean(choice.restricted),
                provider: chosen.provider, longer, unchecked, extraM, extraS, needsConfirmation: longer || unchecked };
        } catch (e) {
            return { ok: false, reason: 'offline' };
        }
    }

    /** Aplica una ruta de planReroute (si la ruta guiada no cambió mientras el conductor confirmaba). */
    function applyReroute(plan) {
        if (!plan || !plan.ok) return plan || { ok: false, reason: 'no-plan' };
        if (!route || route.key !== plan.key) return { ok: false, reason: 'changed' };
        if (plan.extraAvoid) avoidPoints.push(plan.extraAvoid);
        announced.clear();
        useRoute(plan.chosen, plan.candidates);
        lastReroute = Date.now();
        persist();
        refreshNearby(plan.chosen);
        update({ coords: plan.position });
        return { ok: true, remainingM: plan.remainingM, durationS: plan.durationS, restricted: plan.restricted, provider: plan.provider };
    }

    /** Calcula y aplica sin preguntar (sigue sin aceptar una ruta con restricciones si la actual está limpia). */
    async function recalculate(options) {
        const plan = await planReroute(options);
        return plan.ok ? applyReroute(plan) : plan;
    }

    let freeDestination = null;

    function deviceFix() {
        const point = window.DriverTelemetry && window.DriverTelemetry.lastPoint;
        if (point && point.coords) return point.coords;
        const fix = window.DeviceLocation && window.DeviceLocation.last(2 * 60 * 1000);
        return fix ? fix.coords : null;
    }

    /**
     * Navegación libre: ruta para el camión (HERE, respaldo OSRM) desde la posición actual hasta un lugar elegido por el
     * conductor, aunque no sea el destino de una carga. place: { title, address, latitude, longitude }.
     */
    async function navigateTo(place) {
        if (!place || !Number.isFinite(place.latitude) || !Number.isFinite(place.longitude)) return { ok: false, reason: 'no-place' };
        const here = deviceFix();
        if (!here) return { ok: false, reason: 'no-position' };
        const destination = [place.latitude, place.longitude];
        const key = 'DESTINO-' + Date.now();
        freeDestination = { key, title: place.title, address: place.address || null, coords: destination };
        pickup = null;
        clearStop();
        loadId = null;
        currentLoad = null;
        avoidPoints = [];
        aiAlert = null;
        handledBlockages.clear();
        nearby = [];
        status = 'loading';
        progress = null;
        announced.clear();
        notify();
        try {
            const viaHere = await hereRoutes(here, destination, []);
            const candidates = viaHere
                ? viaHere.map(option => buildRoute(option, key, 'destino'))
                : (await requestRoutes([here, destination])).map(osrm => buildRoute(osrm, key, 'destino'));
            if (!freeDestination || freeDestination.key !== key) return { ok: false, reason: 'changed' };
            if (!candidates.length) throw new Error('sin rutas');
            const chosen = await chooseRoute(candidates);
            if (!freeDestination || freeDestination.key !== key) return { ok: false, reason: 'changed' };
            const last = chosen.steps[chosen.steps.length - 1];
            if (last) last.text = 'Llegó a ' + place.title;
            useRoute(chosen, candidates);
            status = 'ready';
            acquireWakeLock();
            announceChoice(chosen);
            refreshNearby(chosen);
            update({ coords: here });
            return { ok: true, title: place.title, remainingM: chosen.totalM, durationS: chosen.durationS,
                provider: chosen.provider, restricted: Boolean(chosen.choice && chosen.choice.restricted) };
        } catch (e) {
            if (!freeDestination || freeDestination.key !== key) return { ok: false, reason: 'changed' };
            freeDestination = null;
            route = null;
            status = 'unavailable';
            notify();
            return { ok: false, reason: 'offline' };
        }
    }

    /** Termina la navegación libre; si hay una carga en tránsito, la guía vuelve a su destino. */
    function endFreeNavigation() {
        if (!freeDestination) return false;
        reset();
        notify();
        return true;
    }

    /** Distancia y tiempo que faltan según la ruta guiada (el tiempo se prorratea con la duración de la ruta). */
    function remaining() {
        if (!route) return null;
        const remainingM = progress && progress.remainingM != null ? progress.remainingM : route.totalM;
        const durationS = Number.isFinite(route.durationS) && route.totalM > 0 ? route.durationS * (remainingM / route.totalM) : null;
        return { remainingM, durationS, arrived: !!(progress && progress.arrived) };
    }

    function update(point) {
        if (!point || !point.coords) return;
        if (!route) {
            progress = { position: point };
            notify();
            return;
        }
        const { alongM, offM } = project(route.geometry, route.cumulative, point.coords);
        let stepIndex = 0;
        while (stepIndex < route.steps.length - 1 && route.steps[stepIndex + 1].startM <= alongM) stepIndex++;
        const next = route.steps[Math.min(stepIndex + 1, route.steps.length - 1)];
        const remainingM = Math.max(0, route.totalM - alongM);
        progress = {
            stepIndex,
            nextIndex: Math.min(stepIndex + 1, route.steps.length - 1),
            toNextM: Math.max(0, next.startM - alongM),
            remainingM,
            offRoute: offM > OFF_ROUTE_M,
            arrived: remainingM < ARRIVED_M && offM < OFF_ROUTE_M,
            position: point
        };
        progress.alongM = alongM;
        if (ensurePickup(point.coords)) {
            notify();
            return;
        }
        // Un aviso de la parada (llegó, la pasó, seguimos) no lo corta la maniobra de ese momento, que va con prioridad.
        if (trackStop(point.coords, alongM, offM)) {
            announced.add(progress.nextIndex + ':near');
            announced.add(progress.nextIndex + ':far');
        } else {
            announce(next, progress);
        }
        const restriction = nextClearance(alongM);
        if (restriction && window.voiceEngine && restriction.alongM - alongM <= CLEARANCE_ANNOUNCE_M
            && !announced.has('clearance:' + restriction.id)) {
            announced.add('clearance:' + restriction.id);
            window.voiceEngine.speak('Atención: ' + spokenDistance(Math.max(0, restriction.alongM - alongM)).trim() + ' '
                + restriction.spoken + '.', true);
        }
        if (progress.offRoute) {
            const hazard = nearbyHazard(point.coords);
            if (hazard && window.voiceEngine && !announced.has('nearby:' + hazard.item.id)) {
                announced.add('nearby:' + hazard.item.id);
                window.voiceEngine.speak('Atención, fuera de ruta: ' + hazard.item.spoken + ', a '
                    + spokenDistance(hazard.distanceM).replace(/^En /, '').replace(/, $/, '') + ' de su posición.', true);
            }
            reroute(point.coords);
        }
        notify();
    }

    function samplePath(geometry) {
        if (geometry.length <= CLEARANCE_MAX_POINTS) return geometry.slice();
        const step = (geometry.length - 1) / (CLEARANCE_MAX_POINTS - 1);
        return Array.from({ length: CLEARANCE_MAX_POINTS }, (_, i) => geometry[Math.round(i * step)]);
    }

    const metres = (value) => Number(value).toLocaleString('es-CO', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const tons = (value) => Number(value).toLocaleString('es-CO', { maximumFractionDigits: 1 });

    function clearanceItem(item, vehicle, warning) {
        const r = item.restriction || {};
        const base = { id: r.id, kind: item.kind, alongM: item.alongRouteMeters, warning,
            lat: Number.isFinite(r.latitude) ? r.latitude : null, lng: Number.isFinite(r.longitude) ? r.longitude : null };
        const title = window.ui.orNotAvailable(r.title);
        if (item.kind === 'GALIBO_ALTURA') {
            return { ...base, text: 'Gálibo de ' + metres(r.maxClearanceMeters) + ' m',
                sub: 'su vehículo mide ' + metres(vehicle.height) + ' m',
                spoken: 'gálibo de ' + metres(r.maxClearanceMeters) + ' metros; su vehículo mide ' + metres(vehicle.height) };
        }
        if (item.kind === 'PESO_BRUTO' || item.kind === 'PESO_POR_EJE') {
            const limit = item.kind === 'PESO_BRUTO' ? r.maxGrossWeightTons : r.maxAxleWeightTons;
            return { ...base, text: 'Límite de ' + tons(limit) + ' t' + (item.kind === 'PESO_POR_EJE' ? ' por eje' : ''),
                sub: 'su peso bruto es ' + tons(vehicle.grossWeight) + ' t',
                spoken: 'límite de peso de ' + tons(limit) + ' toneladas' };
        }
        if (item.kind === 'BLOQUEO_TOTAL') return { ...base, text: 'Paso cerrado', sub: title, spoken: 'paso cerrado: ' + title };
        return { ...base, text: 'Precaución', sub: title, spoken: 'precaución: ' + title };
    }

    function currentVehicle() {
        const driver = window.TruckCarData && window.TruckCarData.currentDriver;
        const vehicle = driver && driver.vehicle;
        return vehicle && Number.isFinite(vehicle.height) && Number.isFinite(vehicle.grossWeight) ? vehicle : null;
    }

    async function validateRoute(candidate, corridorMeters) {
        const vehicle = currentVehicle();
        const api = window.TruckCarApi && window.TruckCarApi.restrictions;
        if (!vehicle) return { key: candidate.key, status: 'no-vehicle', items: [], blocking: 0 };
        if (!api || !api.validateRoute) return { key: candidate.key, status: 'unavailable', items: [], blocking: 0 };
        try {
            const result = await api.validateRoute({
                vehiclePlate: vehicle.plate,
                heightMeters: vehicle.height,
                grossWeightTons: vehicle.grossWeight,
                path: samplePath(candidate.geometry),
                ...(corridorMeters ? { corridorMeters } : {})
            });
            const items = [
                ...(result.blocking || []).map(item => clearanceItem(item, vehicle, false)),
                ...(result.warnings || []).map(item => clearanceItem(item, vehicle, true))
            ].sort((a, b) => a.alongM - b.alongM);
            return { key: candidate.key, status: items.length ? 'found' : 'ok', items,
                blocking: items.filter(item => !item.warning).length };
        } catch (e) {
            return { key: candidate.key, status: 'unavailable', items: [], blocking: 0 };
        }
    }

    async function chooseRoute(candidates) {
        const validated = await Promise.all(candidates.map(candidate => validateRoute(candidate)));
        // Una restricción que HERE marca en la ruta (violations) cuenta igual que una de Routing-Restrictions.
        const results = validated.map((r, i) => {
            const extra = (candidates[i].violations || []).length;
            return extra ? { ...r, blocking: r.blocking + extra } : r;
        });
        const checked = results.every(r => r.status === 'ok' || r.status === 'found');
        // HERE calcula para el camión: sus rutas ya vienen verificadas contra altura y peso aunque Routing-Restrictions
        // no responda.
        const byHere = candidates.every(c => c.provider === 'HERE');
        let index = 0;
        if (!checked && byHere) {
            const fit = candidates.findIndex(c => !(c.violations || []).length);
            index = fit >= 0 ? fit : 0;
        }
        if (checked) {
            const clean = results.findIndex(r => r.blocking === 0);
            index = clean >= 0 ? clean : results.reduce((best, r, i) =>
                (r.blocking < results[best].blocking
                    || (r.blocking === results[best].blocking && candidates[i].totalM < candidates[best].totalM)) ? i : best, 0);
        }
        const chosen = candidates[index];
        chosen.clearance = results[index];
        chosen.choice = {
            evaluated: candidates.length,
            index,
            checked,
            verified: checked || byHere,
            provider: chosen.provider,
            restricted: (checked || byHere) && results[index].blocking > 0,
            blocking: results[index].blocking,
            avoided: checked && index > 0 && results[index].blocking === 0
                ? results.slice(0, index).reduce((sum, r) => sum + r.blocking, 0) : 0
        };
        return chosen;
    }

    function useRoute(chosen, candidates) {
        route = chosen;
        clearance = chosen.clearance;
        if (stop && !stop.reached) stop.alongM = project(route.geometry, route.cumulative, stop.coords).alongM;
        if (pickup && !pickup.reached) pickup.alongM = project(route.geometry, route.cumulative, pickup.coords).alongM;
        showStopMarker();
        if (window.mapCtrl && window.mapCtrl.drawGuidanceLine) {
            window.mapCtrl.drawGuidanceLine(route.geometry, candidates.filter(c => c !== chosen).map(c => c.geometry));
        }
        if (window.mapCtrl && window.mapCtrl.useGuidedRoute) window.mapCtrl.useGuidedRoute(route);
    }

    function persist() {
        if (!route || loadId == null || !window.RouteStore) return;
        window.RouteStore.save(loadId, route, {
            nearby, avoidPoints,
            load: currentLoad && currentLoad.raw ? { ...currentLoad.raw, status: currentLoad.status } : null,
            driver: window.TruckCarData && window.TruckCarData.currentDriver
        });
    }

    async function restore(id) {
        if (!window.RouteStore) return false;
        const saved = await window.RouteStore.load(id);
        if (!saved || !Array.isArray(saved.geometry) || saved.geometry.length < 2) return false;
        const geometry = saved.geometry;
        const cumulative = geometry.reduce((acc, point, i) => {
            acc.push(i === 0 ? 0 : acc[i - 1] + distanceM(geometry[i - 1], point));
            return acc;
        }, []);
        route = { key: saved.key, source: 'guardada', geometry, cumulative, steps: saved.steps || [], totalM: saved.totalM,
            durationS: saved.durationS, choice: saved.choice, clearance: saved.clearance, restored: true, loadId: id,
            provider: saved.provider || null, tolls: saved.tolls || [], computedAt: saved.computedAt || null };
        clearance = saved.clearance;
        nearby = saved.nearby || [];
        avoidPoints = saved.avoidPoints || [];
        if (window.mapCtrl && window.mapCtrl.drawGuidanceLine) window.mapCtrl.drawGuidanceLine(route.geometry, []);
        if (window.mapCtrl && window.mapCtrl.useGuidedRoute) window.mapCtrl.useGuidedRoute(route);
        return true;
    }

    async function refreshNearby(forRoute) {
        const result = await validateRoute(forRoute, NEARBY_CORRIDOR_M);
        if (route !== forRoute || (result.status !== 'ok' && result.status !== 'found')) return;
        nearby = nearbyItems(result);
        persist();
    }

    function nearbyItems(result) {
        return result.items.filter(item => !item.warning && item.lat != null && item.lng != null);
    }

    const prefetched = new Set();
    async function prefetch(load) {
        if (!load || !window.RouteStore || prefetched.has(load.backendId)) return false;
        const target = waypointsFor(load);
        if (!target) return false;
        prefetched.add(load.backendId);
        try {
            const candidates = (await requestRoutes(target.points)).map(osrm => buildRoute(osrm, target.key, target.source));
            const chosen = await chooseRoute(candidates);
            const near = await validateRoute(chosen, NEARBY_CORRIDOR_M);
            return await window.RouteStore.save(load.backendId, chosen, {
                nearby: near.status === 'ok' || near.status === 'found' ? nearbyItems(near) : [],
                load: load.raw ? { ...load.raw, status: load.status } : null,
                driver: window.TruckCarData && window.TruckCarData.currentDriver
            });
        } catch (e) {
            prefetched.delete(load.backendId);
            return false;
        }
    }

    function nearbyHazard(position) {
        let best = null;
        nearby.forEach(item => {
            const d = distanceM(position, [item.lat, item.lng]);
            if (d <= CLEARANCE_ANNOUNCE_M && (!best || d < best.distanceM)) best = { item, distanceM: d };
        });
        return best;
    }

    function passesNear(candidate, points) {
        return points.some(p => project(candidate.geometry, candidate.cumulative, [p.lat, p.lng]).offM <= BLOCKAGE_NEAR_M);
    }

    function avoiding(candidates) {
        if (!avoidPoints.length) return candidates;
        const clean = candidates.filter(c => !passesNear(c, avoidPoints));
        return clean.length ? clean : candidates;
    }

    function detourVias(point) {
        const { alongM } = project(route.geometry, route.cumulative, point);
        let i = route.cumulative.findIndex(c => c >= alongM);
        i = Math.max(1, Math.min(route.geometry.length - 1, i < 0 ? route.geometry.length - 1 : i));
        const a = route.geometry[i - 1];
        const b = route.geometry[i];
        const dLat = b[0] - a[0];
        const dLng = (b[1] - a[1]) * Math.cos(toRad(point[0]));
        const len = Math.hypot(dLat, dLng) || 1;
        const nLat = -dLng / len * DETOUR_OFFSET_DEG;
        const nLng = dLat / len * DETOUR_OFFSET_DEG / Math.cos(toRad(point[0]));
        return [[point[0] + nLat, point[1] + nLng], [point[0] - nLat, point[1] - nLng]];
    }

    function currentPosition() {
        if (progress && progress.position && progress.position.coords) return progress.position.coords;
        const fix = window.DriverTelemetry && window.DriverTelemetry.lastPoint;
        return fix && fix.coords ? fix.coords : route.geometry[0];
    }

    async function detourCandidates(position, point, avoidList = avoidPoints) {
        const destination = finalDestination();
        const stopVia = pendingVia(position);
        const key = route.key;
        const direct = (await requestRoutes([position, ...stopVia, destination])).map(osrm => buildRoute(osrm, key, 'desvío'));
        let clean = direct.filter(c => !passesNear(c, avoidList));
        if (clean.length) return clean;
        const viaRoutes = await Promise.all(detourVias(point).map(via =>
            requestRoutes([position, via, ...stopVia, destination]).then(rs => rs.map(osrm => buildRoute(osrm, key, 'desvío')), () => [])));
        clean = viaRoutes.flat().filter(c => !passesNear(c, avoidList));
        return clean;
    }

    /**
     * Candidatas de un recálculo: HERE para camión evitando las zonas; si HERE no está disponible, OSRM (con el desvío
     * por puntos laterales cuando hay un tramo que evitar).
     */
    async function rerouteCandidates(position, avoidList, avoidPoint) {
        const destination = finalDestination();
        const stopVia = pendingVia(position);
        const key = route.key;
        const here = await hereRoutes(position, destination, avoidList, stopVia);
        if (here) {
            return here.map(option => buildRoute(option, key, avoidPoint ? 'desvío' : 'recalculada'))
                .filter(c => !passesNear(c, avoidList));
        }
        if (avoidPoint) return detourCandidates(position, avoidPoint, avoidList);
        const found = (await requestRoutes([position, ...stopVia, destination])).map(osrm => buildRoute(osrm, key, 'recalculada'));
        const clean = found.filter(c => !passesNear(c, avoidList));
        return clean.length ? clean : found;
    }

    // ── Paradas: la del conductor (restaurante, hotel…) y el punto de cargue ─────────────────────────────────────
    //
    // Conviven: camino al cargue, el conductor puede pedir dónde comer y la ruta pasa primero por la parada que esté
    // antes en el recorrido (aquí → restaurante → cargue → destino). Ninguna de las dos se pierde ni se reemplaza.

    /** Recogida registrada: en Load-Allocation (pickedUpAt) o en este teléfono (también sin señal). */
    function pickupDone(id) {
        if (currentLoad && currentLoad.backendId === id && currentLoad.pickedUpAt) return true;
        try { return localStorage.getItem(PICKUP_KEY + id) === '1'; } catch (e) { return false; }
    }

    /** Llegada o recogida en Load-Allocation (la cola offline la guarda sin señal). Repinta al terminar. */
    function recordPickup(step) {
        const service = window.TruckCarService;
        const call = service && (step === 'arrive' ? service.arriveAtPickup : service.completePickup);
        if (!call) return;
        Promise.resolve(call.call(service))
            .then(() => { if (window.store) window.store.setState({}); })
            .catch(() => { });
    }

    function markPickupDone(id) {
        try { localStorage.setItem(PICKUP_KEY + id, '1'); } catch (e) { }
    }

    function originLabel(load) {
        const origin = load && load.origin;
        return (origin && (origin.city || origin.name || origin.address)) || 'el origen';
    }

    /** Hacia dónde sigue la ruta después de una parada: el cargue si falta recoger, si no el destino. */
    function nextTargetLabel() {
        return pickup && !pickup.reached ? 'el punto de cargue en ' + originLabel(currentLoad) : 'el destino';
    }

    /**
     * La carga se recoge en el origen: si aún no pasó por ahí, el origen queda como parada obligatoria y, si está a
     * más de 1 km, la ruta va de su posición al origen y luego al destino. Sin esto, al salir lejos del origen el
     * recálculo iba directo al destino y dejaba la carga atrás. true si recalculó.
     */
    function ensurePickup(position) {
        if (!route || !currentLoad || loadId == null || freeDestination || pickupDone(loadId) || pickup) return false;
        const origin = currentLoad.origin && currentLoad.origin.coords;
        if (!origin || !Number.isFinite(origin[0]) || !Number.isFinite(origin[1])) return false;
        const label = originLabel(currentLoad);
        pickup = { kind: 'pickup', title: 'Punto de cargue en ' + label, address: currentLoad.origin.address || null, phone: null,
            coords: origin, destination: finalDestination(), alongM: project(route.geometry, route.cumulative, origin).alongM,
            reached: !!currentLoad.arrivedAtPickupAt, arrivedAt: currentLoad.arrivedAtPickupAt ? Date.now() : null };
        showStopMarker();
        // Cerca del origen la ruta ya empieza ahí: solo se vigila la llegada. Lejos, se recalcula pasando por el cargue.
        if (pickup.reached || distanceM(position, origin) <= PICKUP_FAR_M) return false;
        speak('Primero vamos al punto de cargue en ' + label + ' a recoger la carga. Después sigo hacia el destino.');
        lastReroute = 0;
        reroute(position);
        return true;
    }

    /** La recogida se registró (botón «Carga recogida» o voz): se quita la parada del cargue. */
    function pickupCompleted(id) {
        markPickupDone(id);
        if (id === loadId && pickup) {
            pickup = null;
            showStopMarker();
            notify();
        }
    }

    /** Destino final de la ruta guiada: cada parada guarda el destino real al que sigue la ruta después de ella. */
    function finalDestination() {
        if (pickup) return pickup.destination;
        return stop ? stop.destination : route.geometry[route.geometry.length - 1];
    }

    /** La del conductor sigue pendiente si no llegó; si el camión ya la pasó sin parar, la marca como pasada. */
    function stopPending(position) {
        if (!stop || stop.reached) return false;
        if (position && route && stop.alongM != null) {
            const at = project(route.geometry, route.cumulative, position);
            if (at.offM <= OFF_ROUTE_M && at.alongM > stop.alongM + STOP_PASSED_M) {
                stop.reached = true;
                stop.skipped = true;
                showStopMarker();
                return false;
            }
        }
        return true;
    }

    /**
     * Paradas pendientes en el orden en que se pasa por ellas: por su posición sobre la ruta actual; si alguna no la
     * tiene todavía, por cercanía a la posición del camión.
     */
    function orderStops(items, position) {
        const known = items.every(item => item.alongM != null);
        return items.slice().sort((a, b) => known ? a.alongM - b.alongM
            : position ? distanceM(position, a.coords) - distanceM(position, b.coords) : 0);
    }

    /** [coords] de las paradas que faltan, en orden (la recogida nunca se da por pasada por proyección). */
    function pendingVia(position) {
        const items = [];
        if (stopPending(position)) items.push(stop);
        if (pickup && !pickup.reached) items.push(pickup);
        return orderStops(items, position).map(item => item.coords);
    }

    /** La próxima parada sin alcanzar (la que muestra el HUD y el mapa). */
    function nextStop() {
        const items = [stop, pickup].filter(item => item && !item.reached);
        return items.length ? orderStops(items, progress && progress.position ? progress.position.coords : null)[0] : null;
    }

    function speak(text) {
        if (window.voiceEngine) window.voiceEngine.speak(text, true);
    }

    function clearStop() {
        stop = null;
        showStopMarker();
    }

    function showStopMarker() {
        if (window.mapCtrl && window.mapCtrl.showStopMarker) {
            const next = nextStop();
            window.mapCtrl.showStopMarker(next ? { coords: next.coords, title: next.title } : null);
        }
    }

    /** Llegada al cargue y salida con la carga (la salida registra la recogida). true si dijo algo. */
    function trackPickup(position) {
        if (!pickup) return false;
        const away = distanceM(position, pickup.coords);
        if (!pickup.reached) {
            if (away > PICKUP_ARRIVED_M) return false;
            pickup.reached = true;
            pickup.arrivedAt = Date.now();
            showStopMarker();
            recordPickup('arrive');
            speak('Llegó al punto de cargue en ' + originLabel(currentLoad) + '. Cuando termine de cargar, toque «Carga recogida» o diga «seguimos».');
            return true;
        }
        // Salir del punto de cargue después de llegar es salir con la carga: se registra la recogida.
        if (away <= STOP_LEFT_M) return false;
        pickup = null;
        showStopMarker();
        markPickupDone(loadId);
        recordPickup('complete');
        speak('Salió del punto de cargue: registré la recogida. Vamos hacia el destino.');
        return true;
    }

    /** Parada del conductor: llegada, paso de largo sin parar y salida después de parar. true si dijo algo. */
    function trackUserStop(position, alongM, offM) {
        if (!stop) return false;
        const away = distanceM(position, stop.coords);
        if (!stop.reached) {
            if (away <= STOP_ARRIVED_M && Date.now() - stop.addedAt > STOP_GRACE_MS) {
                stop.reached = true;
                stop.arrivedAt = Date.now();
                showStopMarker();
                speak('Llegó a su parada: ' + stop.title + '. Cuando quiera seguir, diga «seguimos» o arranque; la ruta continúa hacia ' + nextTargetLabel() + '.');
                return true;
            }
            if (stop.alongM != null && offM <= OFF_ROUTE_M && alongM > stop.alongM + STOP_PASSED_M) {
                const title = stop.title;
                clearStop();
                speak('Dejó atrás la parada ' + title + '. Sigo hacia ' + nextTargetLabel() + '.');
                return true;
            }
            return false;
        }
        if (!stop.skipped && away > STOP_LEFT_M) {
            clearStop();
            speak('Seguimos hacia ' + nextTargetLabel() + '.');
            return true;
        }
        return false;
    }

    /** true si dijo algo (la maniobra de ese momento no se anuncia encima). */
    function trackStop(position, alongM, offM) {
        const spokeStop = trackUserStop(position, alongM, offM);
        const spokePickup = trackPickup(position);
        return spokeStop || spokePickup;
    }

    /** Metros y segundos desde la posición actual hasta una parada (por defecto la próxima), por la ruta. */
    function toStop(item = nextStop()) {
        if (!item || item.reached || !route || item.alongM == null) return null;
        const done = progress && progress.alongM != null ? progress.alongM : 0;
        const meters = Math.max(0, item.alongM - done);
        const seconds = Number.isFinite(route.durationS) && route.totalM > 0 ? route.durationS * meters / route.totalM : null;
        return { meters, seconds };
    }

    /**
     * Paradas del tipo pedido en lo que falta de la ruta (Route-AI: HERE + OpenStreetMap, con el desvío real para el
     * camión). { status: 'no-route' } sin ruta; { status: 'ok', stops } (puede venir vacía); lanza si no hay servicio.
     */
    async function searchStops(category, { maxDetourMeters = STOP_MAX_DETOUR_M, aheadMeters = STOP_AHEAD_M } = {}) {
        const api = window.TruckCarApi && window.TruckCarApi.routes;
        if (!route || !api || !api.stops) return { status: 'no-route' };
        const vehicle = currentVehicle();
        const position = currentPosition();
        if (!vehicle) return { status: 'no-vehicle' };
        const done = project(route.geometry, route.cumulative, position).alongM;
        const ahead = [];
        // Lo que falta de la ruta, hasta aheadMeters (un punto cada ~150 m como mínimo para no enviar miles).
        let last = null;
        for (let i = 0; i < route.geometry.length; i++) {
            const along = route.cumulative[i];
            if (along < done) continue;
            if (along - done > aheadMeters) { ahead.push(route.geometry[i]); break; }
            if (!last || distanceM(last, route.geometry[i]) >= 150 || i === route.geometry.length - 1) {
                ahead.push(route.geometry[i]);
                last = route.geometry[i];
            }
        }
        if (ahead.length < 2) ahead.push(finalDestination());
        const destination = finalDestination();
        const response = await api.stops({
            latitude: position[0], longitude: position[1],
            destinationLatitude: destination[0], destinationLongitude: destination[1],
            ahead: ahead.slice(0, 5000),
            category,
            heightMeters: vehicle.height, grossWeightTons: vehicle.grossWeight,
            ...(TRUCK_CODE.test(vehicle.category || '') ? { truckType: vehicle.category } : {}),
            maxDetourMeters, aheadMeters, limit: 3
        });
        const stops = (response && Array.isArray(response.stops) ? response.stops : [])
            .filter(s => s && Number.isFinite(s.latitude) && Number.isFinite(s.longitude) && s.title);
        return { status: 'ok', stops, sources: response && response.sources ? response.sources : [] };
    }

    /**
     * Agrega (o cambia) la parada del conductor: recalcula para el camión (HERE; respaldo OSRM) pasando por ella y, si
     * falta recoger, por el punto de cargue, en el orden del recorrido. Nunca pierde la carga ni el destino.
     * { ok, title, then, toStopM, toStopS, extraM, extraS, replaced, restricted } o { ok: false, reason }
     * ('no-route', 'no-place', 'offline', 'changed'). then: hacia dónde sigue después de la parada.
     */
    async function addStop(place) {
        if (!route) return { ok: false, reason: 'no-route' };
        if (!place || !Number.isFinite(place.latitude) || !Number.isFinite(place.longitude)) return { ok: false, reason: 'no-place' };
        const key = route.key;
        const position = currentPosition();
        const destination = finalDestination();
        const coords = [place.latitude, place.longitude];
        const replaced = stop && !stop.reached ? stop.title : null;
        const candidate = { coords, alongM: project(route.geometry, route.cumulative, coords).alongM };
        const pendingPickup = pickup && !pickup.reached ? pickup : null;
        const vias = orderStops([candidate, ...(pendingPickup ? [pendingPickup] : [])], position).map(item => item.coords);
        const beforePickup = !!pendingPickup && vias[0] === coords;
        // El «antes» es la ruta actual (sin la parada anterior), para decir cuánto suma esta.
        const left = remaining();
        let candidates;
        try {
            const viaHere = await hereRoutes(position, destination, avoidPoints, vias);
            candidates = viaHere
                ? viaHere.map(option => buildRoute(option, key, 'parada'))
                : (await requestRoutes([position, ...vias, destination])).map(osrm => buildRoute(osrm, key, 'parada'));
        } catch (e) {
            return { ok: false, reason: 'offline' };
        }
        if (!route || route.key !== key) return { ok: false, reason: 'changed' };
        if (!candidates.length) return { ok: false, reason: 'offline' };
        const chosen = await chooseRoute(candidates);
        if (!route || route.key !== key) return { ok: false, reason: 'changed' };
        stop = { kind: 'stop', title: String(place.title).slice(0, 80), address: place.address || null, phone: place.phone || null,
            coords, destination: stop ? stop.destination : (pendingPickup ? pendingPickup.destination : destination),
            alongM: null, addedAt: Date.now(), reached: false, skipped: false, arrivedAt: null };
        announced.clear();
        useRoute(chosen, candidates);
        lastReroute = Date.now();
        persist();
        refreshNearby(chosen);
        update({ coords: position });
        const ahead = toStop(stop);
        const baseline = Number.isFinite(place.detourMeters) ? null : left;
        return { ok: true, title: stop.title, replaced,
            then: beforePickup ? 'el punto de cargue en ' + originLabel(currentLoad) : null,
            toStopM: ahead ? ahead.meters : null, toStopS: ahead ? ahead.seconds : null,
            extraM: Number.isFinite(place.detourMeters) ? place.detourMeters
                : baseline && Number.isFinite(baseline.remainingM) ? Math.max(0, chosen.totalM - baseline.remainingM) : null,
            extraS: Number.isFinite(place.detourSeconds) ? place.detourSeconds
                : baseline && Number.isFinite(baseline.durationS) && Number.isFinite(chosen.durationS) ? Math.max(0, chosen.durationS - baseline.durationS) : null,
            remainingM: chosen.totalM, durationS: chosen.durationS,
            restricted: Boolean(chosen.choice && chosen.choice.restricted), provider: chosen.provider };
    }

    /**
     * Quita la parada del conductor: si aún no llegó, recalcula (pasando por el cargue si falta recoger). { ok, title,
     * rerouted } o { ok: false, reason } ('no-stop', 'pickup' si solo queda el cargue, 'offline', 'changed').
     */
    async function removeStop() {
        if (!stop) {
            return pickup && !pickup.reached ? { ok: false, reason: 'pickup', title: pickup.title } : { ok: false, reason: 'no-stop' };
        }
        const title = stop.title;
        if (stop.reached || !route) {
            clearStop();
            notify();
            return { ok: true, title, rerouted: false };
        }
        const key = route.key;
        const position = currentPosition();
        const saved = stop;
        stop = null;
        let candidates;
        try {
            candidates = await rerouteCandidates(position, avoidPoints, null);
        } catch (e) {
            candidates = [];
        }
        if (!route || route.key !== key) return { ok: false, reason: 'changed' };
        if (!candidates.length) {
            stop = saved;
            return { ok: false, reason: 'offline' };
        }
        const chosen = await chooseRoute(candidates);
        if (!route || route.key !== key) return { ok: false, reason: 'changed' };
        announced.clear();
        useRoute(chosen, candidates);
        showStopMarker();
        lastReroute = Date.now();
        persist();
        update({ coords: position });
        return { ok: true, title, rerouted: true, then: nextTargetLabel(), remainingM: chosen.totalM, durationS: chosen.durationS };
    }

    /** La parada (del conductor o el cargue) más cercana al camión entre las que cumplen el filtro. */
    function closestStop(filter) {
        const position = progress && progress.position ? progress.position.coords : null;
        const items = [stop, pickup].filter(item => item && filter(item));
        if (items.length < 2 || !position) return items[0] || null;
        return items.sort((a, b) => distanceM(position, a.coords) - distanceM(position, b.coords))[0];
    }

    /** «Ya llegué»: da por alcanzada la parada más cercana (en el cargue registra la llegada). */
    function markStopReached() {
        const target = closestStop(item => !item.reached) || closestStop(() => true);
        if (!target) return { ok: false, reason: 'no-stop' };
        if (!target.reached) {
            target.reached = true;
            target.arrivedAt = Date.now();
            if (target === pickup) recordPickup('arrive');
            showStopMarker();
            notify();
        }
        return { ok: true, kind: target.kind || 'stop', title: target.title };
    }

    /** «Seguimos» después de parar: termina la parada donde está (en el cargue, registra la recogida). */
    function resumeAfterStop() {
        const target = stop && stop.reached ? stop : pickup && pickup.reached ? pickup : null;
        if (!target) {
            const next = nextStop();
            if (!next) return { ok: false, reason: 'no-stop' };
            const ahead = toStop(next);
            return { ok: false, reason: 'not-there', title: next.title, toStopM: ahead ? ahead.meters : null };
        }
        const title = target.title;
        if (target === pickup) {
            // «Seguimos» en el punto de cargue: la carga ya está arriba.
            pickup = null;
            markPickupDone(loadId);
            recordPickup('complete');
        } else {
            stop = null;
        }
        showStopMarker();
        notify();
        // Lo que falta hasta lo siguiente: el cargue si sigue pendiente, si no el destino.
        const next = pickup && !pickup.reached ? toStop(pickup) : null;
        const left = remaining();
        return { ok: true, title, kind: target.kind || 'stop', then: nextTargetLabel(),
            remainingM: next ? next.meters : left ? left.remainingM : null,
            durationS: next ? next.seconds : left ? left.durationS : null };
    }

    /** La parada actual para el Copiloto: la del conductor si hay, si no el cargue. null sin paradas. */
    function stopInfo() {
        const item = stop || pickup;
        if (!item) return null;
        const ahead = toStop(item);
        return { kind: item.kind || 'stop', title: item.title, address: item.address, phone: item.phone, reached: item.reached,
            toStopM: ahead ? ahead.meters : null, toStopS: ahead ? ahead.seconds : null,
            pickupPending: !!(pickup && !pickup.reached && item !== pickup), pickupTitle: pickup ? pickup.title : null };
    }

    async function handleBlockage(blockage) {
        if (!route || !blockage || !Number.isFinite(blockage.latitude) || !Number.isFinite(blockage.longitude)) return false;
        const id = blockage.eventId || ('alert-' + blockage.alertId);
        if (handledBlockages.has(id)) return false;
        const point = [blockage.latitude, blockage.longitude];
        const { alongM, offM } = project(route.geometry, route.cumulative, point);
        const done = progress && progress.alongM != null ? progress.alongM : 0;
        if (offM > BLOCKAGE_NEAR_M || alongM < done) return false;
        handledBlockages.add(id);
        avoidPoints.push({ lat: point[0], lng: point[1], alertId: blockage.alertId == null ? null : blockage.alertId });

        const description = (blockage.description || blockage.title || 'bloqueo en la vía').trim().replace(/[.\s]+$/, '');
        const headline = 'Alerta en ruta procesada por IA: ' + description + '.';
        aiAlert = { text: headline, sub: 'Recalculando trayectoria...', warning: true };
        if (window.voiceEngine) {
            if (window.voiceEngine.alert) window.voiceEngine.alert();
            window.voiceEngine.speak(headline + ' Recalculando trayectoria...', true);
        }
        notify();

        const key = route.key;
        try {
            const candidates = await rerouteCandidates(currentPosition(), avoidPoints, point);
            if (!route || route.key !== key) return true;
            if (!candidates.length) {
                aiAlert = { text: headline, sub: 'no hay un desvío que evite el bloqueo: avance con precaución', warning: true };
                if (window.voiceEngine) window.voiceEngine.speak('No se encontró un desvío que evite el bloqueo. Avance con precaución.', true);
                persist();
                notify();
                return true;
            }
            const chosen = await chooseRoute(candidates);
            if (!route || route.key !== key) return true;
            announced.clear();
            useRoute(chosen, candidates);
            lastReroute = Date.now();
            const restricted = chosen.choice && chosen.choice.restricted;
            aiAlert = { text: headline, warning: !!restricted, sub: restricted
                ? 'desvío calculado, pero con restricciones de gálibo o peso para su vehículo'
                : 'desvío calculado sin restricciones de gálibo ni peso' };
            if (!restricted) {
                const shown = aiAlert;
                clearTimeout(aiAlertTimer);
                aiAlertTimer = setTimeout(() => { if (aiAlert === shown) { aiAlert = null; notify(); } }, AI_ALERT_OK_MS);
            }
            if (window.voiceEngine) window.voiceEngine.speak(restricted
                ? 'Desvío calculado. Atención: tiene restricciones no aptas para su vehículo.'
                : 'Desvío calculado sin restricciones para su vehículo.', true);
            persist();
            refreshNearby(chosen);
            update({ coords: currentPosition() });
        } catch (e) {
            aiAlert = { text: headline, sub: 'sin conexión para recalcular: el bloqueo queda marcado en su ruta', warning: true };
            persist();
            notify();
        }
        return true;
    }

    function announceChoice(chosen) {
        const choice = chosen.choice;
        if (!choice || !window.voiceEngine) return;
        if (choice.restricted) {
            window.voiceEngine.speak('Atención: la ruta contiene restricciones no aptas para su vehículo. '
                + 'Se eligió la alternativa con menos restricciones.', true);
        } else if (choice.avoided) {
            window.voiceEngine.speak('Se eligió una ruta alternativa que evita restricciones de gálibo o peso para su vehículo.', false);
        }
    }

    function routeNotice() {
        const choice = route && route.choice;
        if (!choice || !choice.checked) return null;
        if (choice.restricted) {
            return {
                warning: true,
                text: 'Atención: La ruta contiene restricciones no aptas para su vehículo',
                sub: choice.evaluated > 1
                    ? 'se eligió la de menor impacto (' + choice.blocking + ' de ' + choice.evaluated + ' rutas evaluadas)'
                    : 'no hay rutas alternativas para comparar'
            };
        }
        if (choice.avoided) {
            return { warning: false, text: 'Ruta alternativa apta para su vehículo',
                sub: 'evita ' + choice.avoided + (choice.avoided === 1 ? ' restricción' : ' restricciones') + ' de la ruta principal' };
        }
        return null;
    }

    function nextClearance(alongM) {
        if (!route || !clearance || clearance.key !== route.key || !clearance.items.length) return null;
        const from = alongM == null ? 0 : alongM - 50;
        const ahead = clearance.items.filter(item => item.alongM >= from);
        return ahead.find(item => !item.warning) || ahead[0] || null;
    }

    function announce(next, p) {
        if (!window.voiceEngine || p.offRoute) return;
        const far = p.nextIndex + ':far';
        const near = p.nextIndex + ':near';
        if (p.arrived && !announced.has('arrived')) {
            announced.add('arrived');
            window.voiceEngine.speak('Llegó al destino. Registre la entrega con el botón Llegué.', true);
        } else if (p.toNextM <= NEAR_ANNOUNCE_M && !announced.has(near)) {
            announced.add(near);
            announced.add(far);
            window.voiceEngine.speak(spokenDistance(p.toNextM) + next.text.toLowerCase(), true);
        } else if (!announced.has(far)) {
            announced.add(far);
            window.voiceEngine.speak(spokenDistance(p.toNextM) + next.text.toLowerCase(), false);
        }
    }

    function snapshot() {
        const p = progress;
        const next = route && p && p.nextIndex != null ? route.steps[p.nextIndex] : route ? route.steps[Math.min(1, route.steps.length - 1)] : null;
        const current = route && p && p.stepIndex != null ? route.steps[p.stepIndex] : route ? route.steps[0] : null;
        const speed = p && p.position && Number.isFinite(p.position.speed) ? Math.round(p.position.speed) : null;
        return {
            status,
            source: route ? route.source : null,
            hasPosition: !!(p && p.position),
            offRoute: !!(p && p.offRoute),
            arrived: !!(p && p.arrived),
            icon: p && p.arrived ? 'fa-flag-checkered' : next ? next.icon : 'fa-route',
            glyph: p && p.arrived ? 'flag-checkered-fill' : next ? next.glyph : 'path',
            nextLocation: next && next.location ? next.location : null,
            distance: p && p.toNextM != null ? formatDistance(p.toNextM) : next ? formatDistance(next.startM) : '—',
            instruction: p && p.arrived ? 'Llegó al destino de la carga' : next ? next.text : '',
            street: current ? current.street : '',
            stepNumber: p && p.nextIndex != null ? p.nextIndex + 1 : route ? 1 : 0,
            stepCount: route ? route.steps.length : 0,
            remaining: route ? formatDistance(p && p.remainingM != null ? p.remainingM : route.totalM) : '—',
            plannedDuration: plannedDuration(),
            speed,
            clearance: clearanceHud(p),
            routeNotice: aiAlert ? null : routeNotice(),
            aiAlert,
            stop: (() => {
                const next = nextStop();
                if (!next) return null;
                const a = toStop(next);
                return { title: next.title, kind: next.kind || 'stop', distance: a ? formatDistance(a.meters) : '' };
            })(),
            restored: !!(route && route.restored)
        };
    }

    function plannedDuration() {
        const routes = window.TruckCarData && window.TruckCarData.routes;
        const hours = routes && routes.optimal ? routes.optimal.estimatedDurationHours : null;
        return hours == null ? null : window.TruckCarService.formatHours(hours);
    }

    function formatMinutes(minutes) {
        return minutes >= 60 ? Math.floor(minutes / 60) + ' h ' + String(minutes % 60).padStart(2, '0') + ' min' : minutes + ' min';
    }

    function minutesLeft() {
        const left = route ? remaining() : null;
        return left && Number.isFinite(left.durationS) ? Math.max(1, Math.round(left.durationS / 60)) : null;
    }

    /** «22 min» para la barra del viaje. */
    function minutesText() {
        const minutes = minutesLeft();
        return minutes == null ? '—' : formatMinutes(minutes);
    }

    /** «Llegada 10:51 p. m.» */
    function arrivalText() {
        const minutes = minutesLeft();
        if (minutes == null) return '';
        return 'Llegada ' + new Date(Date.now() + minutes * 60000).toLocaleTimeString('es-CO', { hour: 'numeric', minute: '2-digit' });
    }

    function durationText(s) {
        if (freeDestination && route) {
            const left = remaining();
            const minutes = left && Number.isFinite(left.durationS) ? Math.max(1, Math.round(left.durationS / 60)) : null;
            if (minutes != null) return 'Tiempo estimado: ' + formatMinutes(minutes) + (route.provider === 'HERE' ? ', con el tráfico actual' : '');
        }
        return s.plannedDuration ? 'Viaje completo: ' + s.plannedDuration + ' · Route-AI' : 'Duración: ' + window.ui.NOT_AVAILABLE;
    }

    function clearanceHud(p) {
        if (p && p.offRoute && p.position && p.position.coords) {
            const hazard = nearbyHazard(p.position.coords);
            if (hazard) return { text: hazard.item.text + ' a ' + formatDistance(hazard.distanceM), sub: hazard.item.sub + ' (cerca de su posición)', warning: false };
        }
        const along = p && p.alongM != null ? p.alongM : null;
        const item = nextClearance(along);
        if (!item) return null;
        const away = Math.max(0, item.alongM - (along || 0));
        return { text: item.text + ' en ' + formatDistance(away), sub: item.sub, warning: item.warning };
    }

    function currentStreet(s) {
        const street = (s.street || '').trim();
        if (!street) return '';
        const plain = (text) => text.toLocaleLowerCase('es-CO').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
        return plain(s.instruction || '').includes(plain(street)) ? '' : street;
    }

    function hudText(s) {
        if (s.status === 'loading') return { distance: '…', instruction: 'Calculando la ruta paso a paso…', street: '' };
        if (s.status === 'unavailable') return { distance: '—', instruction: 'Guía paso a paso no disponible', street: 'Sin conexión con el servicio de rutas: siga el mapa.' };
        if (s.status === 'idle' && !currentLoad && !freeDestination) {
            return { distance: '—', instruction: 'Sin destino', street: 'Busque un lugar con la lupa o diga «llévame a…»' };
        }
        if (s.status === 'idle') return { distance: '—', instruction: 'Preparando la navegación…', street: '' };
        if (!s.hasPosition || s.offRoute) return { distance: s.distance, instruction: s.instruction, street: '' };
        if (s.restored) return { distance: s.distance, instruction: s.instruction, street: 'Sin señal: guía con la ruta guardada en el teléfono' };
        return { distance: s.distance, instruction: s.instruction, street: currentStreet(s) };
    }

    function renderHud() {
        if (typeof document === 'undefined') return;
        const s = snapshot();
        const text = hudText(s);
        const set = (selector, value) => document.querySelectorAll(selector).forEach(el => { el.textContent = value; });
        set('[data-nav-distance]', text.distance);
        set('[data-nav-instruction]', text.instruction);
        set('[data-nav-street]', text.street);
        set('[data-nav-speed]', s.speed == null ? '—' : String(s.speed));
        set('[data-nav-remaining]', s.remaining);
        set('[data-nav-eta]', durationText(s));
        set('[data-nav-minutes]', minutesText());
        set('[data-nav-arrival]', arrivalText());
        set('[data-nav-step]', s.stepCount ? 'Paso ' + s.stepNumber + ' de ' + s.stepCount : 'Ruta real');
        document.querySelectorAll('[data-nav-icon]').forEach(el => { el.className = 'fas ' + s.icon; });
        document.querySelectorAll('[data-nav-glyph]').forEach(el => { el.setAttribute('href', 'assets/icons.svg#' + s.glyph); });
        document.querySelectorAll('[data-nav-offroute]').forEach(el => { el.hidden = !s.offRoute; });
        document.querySelectorAll('[data-nav-clearance]').forEach(el => { el.hidden = !s.clearance; });
        set('[data-nav-clearance-text]', s.clearance ? s.clearance.text : '');
        set('[data-nav-clearance-sub]', s.clearance ? '· ' + s.clearance.sub : '');
        document.querySelectorAll('[data-nav-route-notice]').forEach(el => {
            el.hidden = !s.routeNotice;
            el.classList.toggle('is-ok', !!(s.routeNotice && !s.routeNotice.warning));
        });
        set('[data-nav-route-notice-text]', s.routeNotice ? s.routeNotice.text : '');
        set('[data-nav-route-notice-sub]', s.routeNotice ? '· ' + s.routeNotice.sub : '');
        document.querySelectorAll('[data-nav-ai-alert]').forEach(el => {
            el.hidden = !s.aiAlert;
            el.classList.toggle('is-ok', !!(s.aiAlert && !s.aiAlert.warning));
        });
        set('[data-nav-ai-alert-text]', s.aiAlert ? s.aiAlert.text : '');
        set('[data-nav-ai-alert-sub]', s.aiAlert ? '· ' + s.aiAlert.sub : '');
        document.querySelectorAll('[data-nav-stop]').forEach(el => { el.hidden = !s.stop; });
        set('[data-nav-stop-text]', s.stop ? 'Parada: ' + s.stop.title : '');
        set('[data-nav-stop-sub]', s.stop && s.stop.distance ? '· a ' + s.stop.distance : '');
        layoutAlerts();
    }

    function alertPriority(el) {
        if (el.hasAttribute('data-nav-route-notice') && el.classList.contains('is-ok')) return 4;
        return Number(el.dataset.hudAlert) || 9;
    }

    function isActive(el) {
        if (el.hidden) return false;
        if (el.classList.contains('hud-gps')) return !!el.textContent.trim() && el.dataset.state !== 'ok';
        return true;
    }

    function layoutAlerts() {
        if (typeof document === 'undefined') return;
        const card = document.querySelector('.nav-screen .hud-card');
        if (!card) return;
        // El texto del Copiloto va debajo de la tarjeta: se mueve con ella cuando cambia de alto.
        const copilot = window.VoiceAssistant && window.VoiceAssistant.copilot;
        if (copilot && copilot.ui && !copilot.ui.banner.hidden) requestAnimationFrame(() => copilot.placeBanner());
        const screen = card.closest('.nav-screen');
        const more = card.querySelector('[data-hud-more]');
        const meta = card.querySelector('.hud-meta');
        const all = Array.from(card.querySelectorAll('[data-hud-alert]'));
        const rows = all.filter(isActive)
            .map((el, i) => ({ el, i, p: alertPriority(el) }))
            .sort((a, b) => a.p - b.p || a.i - b.i)
            .map(item => item.el);
        rows.forEach(el => { if (more) card.insertBefore(el, more); });
        all.forEach(el => el.classList.remove('is-overflow'));
        if (rows.length <= MAX_HUD_ALERTS) collapseAlerts(false);
        if (meta) meta.hidden = false;
        const panel = screen && screen.querySelector('.hud-panel');
        if (panel) panel.classList.remove('is-row');

        let visible = alertsExpanded ? rows.length : Math.min(rows.length, MAX_HUD_ALERTS);
        const apply = () => {
            rows.forEach((el, i) => el.classList.toggle('is-overflow', i >= visible));
            const rest = rows.length - visible;
            if (!more) return;
            more.hidden = !(rest > 0 || alertsExpanded);
            more.setAttribute('aria-expanded', alertsExpanded ? 'true' : 'false');
            const label = more.querySelector('[data-hud-more-text]');
            if (label) label.textContent = alertsExpanded ? 'Ocultar avisos' : '+' + rest + (rest === 1 ? ' aviso' : ' avisos');
        };
        apply();

        const area = screen && screen.querySelector('.nav-map-area');
        const below = (el) => {
            if (!el || !(el.offsetHeight > 0)) return false;
            const c = card.getBoundingClientRect();
            const r = el.getBoundingClientRect();
            return r.left < c.right && r.right > c.left && r.top > c.top;
        };
        const limit = (withPanel = true) => {
            let bound = area && area.offsetHeight > 0 ? area.getBoundingClientRect().bottom : Infinity;
            [withPanel ? panel : null, screen && screen.querySelector('.trip-bar'),
                screen && screen.querySelector('.leaflet-control-attribution')].forEach(el => {
                if (below(el)) bound = Math.min(bound, el.getBoundingClientRect().top);
            });
            return bound;
        };
        const overlaps = () => card.getBoundingClientRect().bottom + 8 > limit();
        card.style.maxHeight = '';
        card.style.overflowY = '';
        if (!alertsExpanded && rows.length && overlaps()) {
            if (meta) meta.hidden = true;
            if (overlaps() && below(panel)) panel.classList.add('is-row');
            while (visible > 1 && overlaps()) {
                visible--;
                apply();
            }
            if (overlaps()) {
                card.style.maxHeight = Math.max(120, limit() - card.getBoundingClientRect().top - 8) + 'px';
                card.style.overflowY = 'auto';
            }
        }
        if (alertsExpanded) {
            card.style.maxHeight = Math.max(120, limit(false) - card.getBoundingClientRect().top - 8) + 'px';
            card.style.overflowY = 'auto';
        }
        if (screen) screen.classList.toggle('alerts-expanded', alertsExpanded);
    }

    function collapseAlerts(relayout = true) {
        clearTimeout(expandedTimer);
        if (!alertsExpanded) return;
        alertsExpanded = false;
        if (relayout) layoutAlerts();
    }

    function toggleAlerts() {
        if (alertsExpanded) {
            collapseAlerts();
            return;
        }
        alertsExpanded = true;
        clearTimeout(expandedTimer);
        expandedTimer = setTimeout(() => collapseAlerts(), EXPANDED_ALERTS_MS);
        layoutAlerts();
    }

    if (typeof window !== 'undefined' && window.addEventListener) window.addEventListener('resize', () => layoutAlerts());

    function reset() {
        pickup = null;
        clearStop();
        freeDestination = null;
        route = null;
        status = 'idle';
        progress = null;
        pendingKey = null;
        clearance = null;
        announced.clear();
        loadId = null;
        currentLoad = null;
        nearby = [];
        avoidPoints = [];
        aiAlert = null;
        clearTimeout(aiAlertTimer);
        clearTimeout(expandedTimer);
        alertsExpanded = false;
        handledBlockages.clear();
        lastNetworkTry = 0;
        releaseWakeLock();
    }

    async function acquireWakeLock() {
        if (typeof navigator !== 'undefined' && 'wakeLock' in navigator && !wakeLock) {
            try {
                if (typeof document === 'undefined' || document.visibilityState === 'visible') {
                    wakeLock = await navigator.wakeLock.request('screen');
                    wakeLock.addEventListener('release', () => { wakeLock = null; });
                }
            } catch (err) { }
        }
    }

    async function releaseWakeLock() {
        if (wakeLock) {
            try { await wakeLock.release(); } catch (e) {}
            wakeLock = null;
        }
    }

    if (typeof document !== 'undefined') {
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'visible' && status === 'ready') {
                acquireWakeLock();
            }
        });
    }

    function forget(id) {
        const target = id === undefined ? loadId : id;
        reset();
        if (window.RouteStore) return window.RouteStore.clear(target);
        return Promise.resolve();
    }

    /**
     * Peajes que faltan en la ruta, en orden: nombre, tarifa de HERE para el camión y metros hasta cada uno.
     * { status: 'no-route' } sin ruta; { status: 'no-data' } si la ruta no es de HERE (sin tarifas);
     * { status: 'ok', tolls, computedAt } con la hora en que HERE calculó la ruta (la tarifa es de ese momento).
     */
    function tollsAhead(position) {
        if (!route) return { status: 'no-route' };
        if (route.provider !== 'HERE') return { status: 'no-data' };
        const here = position || (progress && progress.position && progress.position.coords) || null;
        const done = progress && progress.alongM != null ? progress.alongM
            : here ? project(route.geometry, route.cumulative, here).alongM : 0;
        const tolls = (route.tolls || []).map((t) => {
            const at = project(route.geometry, route.cumulative, [t.latitude, t.longitude]);
            return at.offM > 300 ? null : { name: t.name, cost: t.cost, currency: t.currency, aheadM: at.alongM - done };
        }).filter(t => t && t.aheadM > -50).sort((a, b) => a.aheadM - b.aheadM);
        return { status: 'ok', tolls, computedAt: route.computedAt || null };
    }

    return {
        tollsAhead,
        prepare, prefetch, update, reset, forget, snapshot, hudText, renderHud, durationText, handleBlockage, layoutAlerts, toggleAlerts,
        recalculate, planReroute, applyReroute, remaining, navigateTo, endFreeNavigation, minutesText, arrivalText,
        searchStops, addStop, removeStop, markStopReached, resumeAfterStop, stopInfo, pickupCompleted,
        get stop() { return stop; },
        get freeDestination() { return freeDestination; },
        onUpdate(listener) { listeners.add(listener); return () => listeners.delete(listener); },
        get route() { return route; },
        get clearance() { return clearance; },
        get nearby() { return nearby; },
        get avoidPoints() { return avoidPoints; },
        get hasWakeLock() { return Boolean(wakeLock); }, requestWakeLock: acquireWakeLock, releaseWakeLock,
        instruction, formatDistance, glyph, project, samplePath, validateRoute, chooseRoute, routeNotice, OFF_ROUTE_M
    };
})();

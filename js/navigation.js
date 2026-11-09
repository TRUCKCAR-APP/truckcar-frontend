/**
 * Navegación paso a paso sobre la ruta real de la carga en tránsito.
 *
 *  - Ruta: los puntos del plan de Route-AI (o el origen y destino de la carga si el plan no llegó) se envían a OSRM con
 *    steps=true; cada maniobra (giro, glorieta, incorporación, llegada) se traduce a una instrucción en español.
 *  - Progreso: cada posición de la telemetría se proyecta sobre la geometría de la ruta. Con eso se sabe la maniobra
 *    siguiente, la distancia hasta ella y lo que falta hasta el destino.
 *  - Fuera de ruta (> 250 m de la línea) se recalcula desde la posición actual hasta el destino (máx. 1 cada 30 s).
 *
 *  - Sin señal: la ruta elegida (geometría, maniobras y restricciones) se guarda en IndexedDB (routeStore.js). Si OSRM
 *    no responde al reabrir la app, la guía se restaura desde ahí y siguen los avisos de restricciones a 3 km.
 *  - Restricciones vecinas: además de las de la ruta, se piden las de un corredor ampliado (500 m). Fuera de ruta (y
 *    sin señal para recalcular) la posición se compara con ellas y se avisa de los puentes bajos cercanos.
 *  - Bloqueos de la IA: route-ai-agent detecta en una alerta de la comunidad que la vía está cerrada y fleets-drivers
 *    lo reenvía por /topic/road-blockages. Si el punto cae sobre lo que falta de ruta, el HUD y la voz lo anuncian y se
 *    recalcula de inmediato con alternativas que no pasen por el bloqueo y validadas contra gálibo y peso.
 *
 * La vista no se re-renderiza en cada posición (destruiría el mapa): renderHud() actualiza el HUD en sitio.
 */
window.RouteGuidance = (function () {
    const OSRM_URL = 'https://router.project-osrm.org/route/v1/driving/';
    const OFF_ROUTE_M = 250;
    const REROUTE_COOLDOWN_MS = 30000;
    // Restricciones de la ruta (Routing-Restrictions): se anuncian una vez al quedar a 3 km o menos.
    const CLEARANCE_ANNOUNCE_M = 3000;
    const CLEARANCE_MAX_POINTS = 400;
    // OSRM devuelve hasta 3 rutas con alternatives=true (solo entre dos puntos: con puntos intermedios no hay alternativas).
    const MAX_ALTERNATIVES = 3;
    const ARRIVED_M = 60;
    const NEAR_ANNOUNCE_M = 300;
    // Corredor ampliado de las restricciones vecinas (máximo que admite /validate-route).
    const NEARBY_CORRIDOR_M = 500;
    // Un bloqueo de la IA afecta la ruta si está a esta distancia o menos de lo que falta por recorrer.
    const BLOCKAGE_NEAR_M = 150;
    // Desvío lateral (en grados, ~3 km) de los puntos de paso que se prueban si ninguna alternativa evita el bloqueo.
    const DETOUR_OFFSET_DEG = 0.03;
    // Con la ruta restaurada sin señal, se vuelve a intentar OSRM como mucho una vez por minuto.
    const RETRY_ONLINE_MS = 60000;
    // Desvío limpio: la confirmación verde de la IA se retira sola (el HUD no debe crecer hasta tapar el panel).
    const AI_ALERT_OK_MS = 20000;

    // { key, source, geometry, cumulative, steps, totalM, durationS, choice: { evaluated, index, restricted, blocking } }
    let route = null;
    let status = 'idle';       // idle | loading | ready | unavailable
    let progress = null;       // { stepIndex, toNextM, remainingM, offRoute, arrived, position }
    let pendingKey = null;
    let lastReroute = 0;
    const announced = new Set();
    const listeners = new Set();
    // { key, status: checking | ok | found | unavailable | no-vehicle, items: [{ id, kind, alongM, text, sub, spoken }] }
    let clearance = null;
    let loadId = null;           // carga de la ruta actual (clave del registro guardado)
    let currentLoad = null;
    let nearby = [];             // restricciones del corredor ampliado que incumple el vehículo, con su posición
    let avoidPoints = [];        // bloqueos de la IA que la ruta debe evitar: [{ lat, lng, alertId }]
    let aiAlert = null;          // aviso del HUD: { text, sub, warning }
    const handledBlockages = new Set();
    let lastNetworkTry = 0;
    let aiAlertTimer = null;
    // Avisos del HUD: como máximo MAX_HUD_ALERTS a la vista; el resto en "+N avisos" (se despliega al tocarlo).
    const MAX_HUD_ALERTS = 2;
    const EXPANDED_ALERTS_MS = 15000;
    let alertsExpanded = false;
    let expandedTimer = null;

    // ------------------------------------------------------------------ geometría
    const toRad = (deg) => deg * Math.PI / 180;

    function distanceM(a, b) {
        const dLat = toRad(b[0] - a[0]);
        const dLng = toRad(b[1] - a[1]);
        const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a[0])) * Math.cos(toRad(b[0])) * Math.sin(dLng / 2) ** 2;
        return 6371000 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
    }

    /** Proyección del punto sobre la polilínea: distancia recorrida a lo largo de ella y separación de la línea. */
    function project(geometry, cumulative, point) {
        const cos = Math.cos(toRad(point[0]));
        let best = { alongM: 0, offM: Infinity };
        for (let i = 1; i < geometry.length; i++) {
            const a = geometry[i - 1];
            const b = geometry[i];
            // Plano local equirectangular: suficiente para tramos de pocos km.
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

    // ------------------------------------------------------------------ instrucciones
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
        const mod = MODIFIERS[m.modifier] || '';
        const road = street(step);
        const via = road ? ' por ' + road : '';
        const toward = road ? ' hacia ' + road : '';
        // OSRM marca los retornos como turn, continue o new name con modificador uturn.
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

    /** Ícono de Phosphor (assets/icons.svg) de la maniobra, para el HUD. Distingue giro, giro leve, retorno y glorieta. */
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

    /** Tiempo restante en texto ("2 h 16 min"). */
    function formatDuration(seconds) {
        if (seconds == null || !Number.isFinite(seconds)) return '—';
        const minutes = Math.max(1, Math.round(seconds / 60));
        return minutes >= 60 ? Math.floor(minutes / 60) + ' h ' + (minutes % 60) + ' min' : minutes + ' min';
    }

    function formatDistance(m) {
        if (m == null || !Number.isFinite(m)) return '—';
        if (m < 1000) return Math.max(10, Math.round(m / 10) * 10) + ' m';
        return (m / 1000).toLocaleString('es-CO', { maximumFractionDigits: m < 10000 ? 1 : 0 }) + ' km';
    }

    function spokenDistance(m) {
        return m < 1000 ? 'En ' + Math.max(50, Math.round(m / 50) * 50) + ' metros, ' : 'En ' + formatDistance(m).replace(' km', ' kilómetros') + ', ';
    }

    // ------------------------------------------------------------------ ruta
    function waypointsFor(load) {
        const routes = window.TruckCarData.routes;
        const plan = routes && routes.optimal && routes.optimal.waypoints && routes.optimal.waypoints.length >= 2
            && (!routes.planForLoadId || routes.planForLoadId === load.backendId) ? routes.optimal : null;
        if (plan) return { key: plan.id, source: 'Route-AI', points: plan.waypoints.map(w => w.coords) };
        const points = [load.origin && load.origin.coords, load.destination && load.destination.coords].filter(Boolean);
        return points.length >= 2 ? { key: 'CARGA-' + load.backendId, source: 'carga', points } : null;
    }

    /** Rutas de OSRM entre los puntos: la principal y, entre dos puntos, hasta dos alternativas, en el orden de OSRM. */
    async function requestRoutes(points) {
        const url = OSRM_URL + points.map(c => c[1] + ',' + c[0]).join(';')
            + '?overview=full&geometries=geojson&steps=true' + (points.length === 2 ? '&alternatives=true' : '');
        const response = await fetch(url);
        if (!response.ok) throw new Error('OSRM ' + response.status);
        const json = await response.json();
        const routes = (json.routes || []).filter(r => r && r.geometry && r.legs).slice(0, MAX_ALTERNATIVES);
        if (!routes.length) throw new Error('OSRM sin ruta');
        return routes;
    }

    function buildRoute(osrm, key, source) {
        const geometry = osrm.geometry.coordinates.map(pt => [pt[1], pt[0]]);
        const cumulative = geometry.reduce((acc, point, i) => {
            acc.push(i === 0 ? 0 : acc[i - 1] + distanceM(geometry[i - 1], point));
            return acc;
        }, []);
        const raw = osrm.legs.flatMap(leg => leg.steps || []);
        // Las llegadas intermedias (fin de cada tramo) no son maniobras para el conductor: solo cuenta la final.
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
        return { key, source, geometry, cumulative, steps, totalM: cumulative[cumulative.length - 1], durationS: osrm.duration };
    }

    function notify() {
        listeners.forEach(listener => { try { listener(snapshot()); } catch (e) { /* listener roto */ } });
        renderHud();
    }

    /** Prepara la ruta de la carga activa (una vez por plan). Idempotente mientras la carga y el plan no cambien. */
    async function prepare(load) {
        if (!load) return;
        if (loadId !== load.backendId) {
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

    /** Recalcula desde la posición actual hasta el destino cuando el conductor se sale de la ruta. */
    async function reroute(position) {
        if (!route || Date.now() - lastReroute < REROUTE_COOLDOWN_MS) return;
        lastReroute = Date.now();
        const destination = route.geometry[route.geometry.length - 1];
        const key = route.key;
        try {
            const candidates = avoiding((await requestRoutes([position, destination])).map(osrm => buildRoute(osrm, key, 'recalculada')));
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
            // Sin OSRM se sigue mostrando la ruta anterior con el aviso de fuera de ruta.
        }
    }

    /** Nueva posición (GPS real, o la simulación si se activó en las herramientas de prueba). */
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
        announce(next, progress);
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

    /** Hasta CLEARANCE_MAX_POINTS puntos de la geometría, siempre con el primero y el último. */
    function samplePath(geometry) {
        if (geometry.length <= CLEARANCE_MAX_POINTS) return geometry.slice();
        const step = (geometry.length - 1) / (CLEARANCE_MAX_POINTS - 1);
        return Array.from({ length: CLEARANCE_MAX_POINTS }, (_, i) => geometry[Math.round(i * step)]);
    }

    const metres = (value) => Number(value).toLocaleString('es-CO', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const tons = (value) => Number(value).toLocaleString('es-CO', { maximumFractionDigits: 1 });

    /** Texto de una restricción de la ruta, con lo que mide o pesa este vehículo. */
    function clearanceItem(item, vehicle, warning) {
        const r = item.restriction || {};
        const base = { id: r.id, kind: item.kind, alongM: item.alongRouteMeters, warning,
            lat: Number.isFinite(r.latitude) ? r.latitude : null, lng: Number.isFinite(r.longitude) ? r.longitude : null };
        const title = r.title || 'Restricción vial';
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

    /**
     * Pide a Routing-Restrictions las restricciones activas a lo largo de la geometría real de una ruta (la de OSRM), con
     * la altura y el peso bruto del vehículo registrado. Devuelve el estado y las restricciones que incumple (blocking) o
     * que solo informan (warnings). Sin vehículo o sin respuesta no se inventa nada.
     */
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

    /**
     * Elige la ruta para el camión: valida todas las alternativas contra Routing-Restrictions y toma la primera, en el
     * orden de OSRM, que no incumpla ningún gálibo ni límite de peso. Si todas incumplen, la de menor impacto: menos
     * restricciones incumplidas y, a igualdad, la más corta. Sin vehículo o sin Routing-Restrictions, la principal.
     */
    async function chooseRoute(candidates) {
        const results = await Promise.all(candidates.map(candidate => validateRoute(candidate)));
        const checked = results.every(r => r.status === 'ok' || r.status === 'found');
        let index = 0;
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
            restricted: checked && results[index].blocking > 0,
            blocking: results[index].blocking,
            avoided: checked && index > 0 && results[index].blocking === 0
                ? results.slice(0, index).reduce((sum, r) => sum + r.blocking, 0) : 0
        };
        return chosen;
    }

    /** Deja la ruta elegida como la de la guía y la dibuja; las alternativas descartadas quedan en gris en el mapa. */
    function useRoute(chosen, candidates) {
        route = chosen;
        clearance = chosen.clearance;
        if (window.mapCtrl && window.mapCtrl.drawGuidanceLine) {
            window.mapCtrl.drawGuidanceLine(route.geometry, candidates.filter(c => c !== chosen).map(c => c.geometry));
        }
        if (window.mapCtrl && window.mapCtrl.useGuidedRoute) window.mapCtrl.useGuidedRoute(route);
    }

    // ------------------------------------------------------------------ sin señal y restricciones vecinas
    /** Guarda la ruta actual en el dispositivo (no bloquea la guía; sin IndexedDB no pasa nada). */
    function persist() {
        if (!route || loadId == null || !window.RouteStore) return;
        window.RouteStore.save(loadId, route, {
            nearby, avoidPoints,
            load: currentLoad && currentLoad.raw ? { ...currentLoad.raw, status: currentLoad.status } : null,
            driver: window.TruckCarData && window.TruckCarData.currentDriver
        });
    }

    /** Restaura la ruta guardada de la carga. Devuelve true si había una. */
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
            durationS: saved.durationS, choice: saved.choice, clearance: saved.clearance, restored: true, loadId: id };
        clearance = saved.clearance;
        nearby = saved.nearby || [];
        avoidPoints = saved.avoidPoints || [];
        if (window.mapCtrl && window.mapCtrl.drawGuidanceLine) window.mapCtrl.drawGuidanceLine(route.geometry, []);
        if (window.mapCtrl && window.mapCtrl.useGuidedRoute) window.mapCtrl.useGuidedRoute(route);
        return true;
    }

    /**
     * Restricciones que el vehículo incumple en el corredor ampliado de la ruta (500 m), con su posición, para avisar
     * fuera de ruta. Se piden una vez por ruta, con señal, y se guardan con ella.
     */
    async function refreshNearby(forRoute) {
        const result = await validateRoute(forRoute, NEARBY_CORRIDOR_M);
        if (route !== forRoute || (result.status !== 'ok' && result.status !== 'found')) return;
        nearby = nearbyItems(result);
        persist();
    }

    function nearbyItems(result) {
        return result.items.filter(item => !item.warning && item.lat != null && item.lng != null);
    }

    /**
     * Al aceptar la carga (antes de iniciar el viaje) se calcula y guarda la ruta, para poder guiar aunque el viaje
     * empiece sin señal. No dibuja ni anuncia nada; una vez por carga.
     */
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

    /** La restricción vecina más cercana a la posición, a 3 km o menos. */
    function nearbyHazard(position) {
        let best = null;
        nearby.forEach(item => {
            const d = distanceM(position, [item.lat, item.lng]);
            if (d <= CLEARANCE_ANNOUNCE_M && (!best || d < best.distanceM)) best = { item, distanceM: d };
        });
        return best;
    }

    // ------------------------------------------------------------------ bloqueos detectados por la IA
    function passesNear(candidate, points) {
        return points.some(p => project(candidate.geometry, candidate.cumulative, [p.lat, p.lng]).offM <= BLOCKAGE_NEAR_M);
    }

    /** Quita las alternativas que pasan por un bloqueo marcado; si todas pasan, las deja (no hay otra ruta). */
    function avoiding(candidates) {
        if (!avoidPoints.length) return candidates;
        const clean = candidates.filter(c => !passesNear(c, avoidPoints));
        return clean.length ? clean : candidates;
    }

    /** Puntos de paso a ~3 km a cada lado del bloqueo, perpendiculares a la ruta, para forzar un desvío. */
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

    /** Alternativas de OSRM desde la posición hasta el destino que no pasan por los bloqueos marcados. */
    async function detourCandidates(position, point) {
        const destination = route.geometry[route.geometry.length - 1];
        const key = route.key;
        const direct = (await requestRoutes([position, destination])).map(osrm => buildRoute(osrm, key, 'desvío'));
        let clean = direct.filter(c => !passesNear(c, avoidPoints));
        if (clean.length) return clean;
        const viaRoutes = await Promise.all(detourVias(point).map(via =>
            requestRoutes([position, via, destination]).then(rs => rs.map(osrm => buildRoute(osrm, key, 'desvío')), () => [])));
        clean = viaRoutes.flat().filter(c => !passesNear(c, avoidPoints));
        return clean;
    }

    /**
     * Bloqueo vial que la IA (route-ai-agent) detectó en una alerta. Si cae a 150 m o menos de lo que falta por recorrer:
     * aviso visual y sonoro, y recálculo inmediato con un desvío que no pase por él y que se valida contra gálibo y peso.
     * Devuelve true si el bloqueo afectaba la ruta.
     */
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
            const candidates = await detourCandidates(currentPosition(), point);
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

    /** Se dice una vez por ruta: si se esquivó una restricción o si ninguna alternativa es apta para el vehículo. */
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

    /** Aviso de la ruta elegida para el HUD (null si la ruta principal ya era apta o no se pudo validar). */
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

    /** La próxima restricción de la ruta desde la posición actual (las ya pasadas no cuentan); primero las que bloquean. */
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
            // Ubicación de la próxima maniobra: la navegación encuadra la posición y ese punto.
            nextLocation: next && next.location ? next.location : null,
            distance: p && p.toNextM != null ? formatDistance(p.toNextM) : next ? formatDistance(next.startM) : '—',
            instruction: p && p.arrived ? 'Llegó al destino de la carga' : next ? next.text : '',
            street: current ? current.street : '',
            stepNumber: p && p.nextIndex != null ? p.nextIndex + 1 : route ? 1 : 0,
            stepCount: route ? route.steps.length : 0,
            remaining: route ? formatDistance(p && p.remainingM != null ? p.remainingM : route.totalM) : '—',
            // Tiempo restante proporcional a la distancia que falta (OSRM, perfil de auto).
            remainingTime: route && route.durationS && route.totalM
                ? formatDuration(route.durationS * (p && p.remainingM != null ? p.remainingM : route.totalM) / route.totalM) : '—',
            speed,
            clearance: clearanceHud(p),
            // El aviso de la IA ya dice si el desvío tiene restricciones: no se repite con el de ruta alternativa.
            routeNotice: aiAlert ? null : routeNotice(),
            aiAlert,
            restored: !!(route && route.restored)
        };
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

    /** Textos del HUD según el estado (el mismo marcado sirve para el render inicial y para las actualizaciones). */
    /**
     * Calle por la que va el camión, bajo la instrucción. Si no se conoce o es la misma que ya nombra la instrucción
     * ("…hacia Avenida Calle 59 Sur"), no se muestra nada: repetirla no informa.
     */
    function currentStreet(s) {
        const street = (s.street || '').trim();
        if (!street) return '';
        const plain = (text) => text.toLocaleLowerCase('es-CO').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
        return plain(s.instruction || '').includes(plain(street)) ? '' : street;
    }

    function hudText(s) {
        if (s.status === 'loading') return { distance: '…', instruction: 'Calculando la ruta paso a paso…', street: 'Ruta por carretera de OSRM' };
        if (s.status === 'unavailable') return { distance: '—', instruction: 'Guía paso a paso no disponible', street: 'Sin conexión con el servicio de rutas: siga el mapa.' };
        if (s.status === 'idle') return { distance: '—', instruction: 'Preparando la navegación…', street: '' };
        // Sin GPS o fuera de ruta, el aviso ya está dentro de la tarjeta (triángulo y texto): la línea gris no lo repite.
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
        set('[data-nav-eta]', s.remainingTime === '—' ? 'Tiempo sin información' : s.remainingTime + ' · estimado para auto');
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
        layoutAlerts();
    }

    // ------------------------------------------------------------------ pila de avisos del HUD
    /**
     * Prioridad de cada fila (data-hud-alert, menor = más importante): bloqueo de la IA (1) > restricción de gálibo o
     * peso próxima (2) > ruta con restricciones (2,5) > fuera de ruta (3) > ruta alternativa apta (4) > GPS (5).
     */
    function alertPriority(el) {
        if (el.hasAttribute('data-nav-route-notice') && el.classList.contains('is-ok')) return 4;
        return Number(el.dataset.hudAlert) || 9;
    }

    function isActive(el) {
        if (el.hidden) return false;
        if (el.classList.contains('hud-gps')) return !!el.textContent.trim() && el.dataset.state !== 'ok';
        return true;
    }

    /**
     * Ordena los avisos activos por prioridad, deja a la vista los dos primeros (cada uno en 3 líneas como máximo) y
     * resume el resto en "+N avisos". Si aun así la tarjeta llega al panel de velocidad: 1) se oculta la fila de altura y
     * peso (los avisos de gálibo ya dicen cuánto mide el vehículo), 2) el panel pasa a una fila al pie del mapa y 3) se
     * deja un solo aviso. Desplegado, se ven todos y el panel
     * se oculta mientras se leen (se repliega solo a los 15 s o al tocar de nuevo).
     */
    function layoutAlerts() {
        if (typeof document === 'undefined') return;
        const card = document.querySelector('.nav-screen .hud-card');
        if (!card) return;
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

        // Lo que la tarjeta no puede tapar: lo que está debajo de ella en su columna (panel de velocidad, barra del
        // viaje, atribución del mapa) y el borde inferior del mapa. En vertical el panel queda bajo la tarjeta; en horizontal, al lado.
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
                // Ni con un solo aviso cabe (pantallas muy bajas): la tarjeta llega hasta el límite y se desplaza.
                card.style.maxHeight = Math.max(120, limit() - card.getBoundingClientRect().top - 8) + 'px';
                card.style.overflowY = 'auto';
            }
        }
        if (alertsExpanded) {
            // Desplegada (panel oculto): hasta el borde del mapa o la barra del viaje, con desplazamiento interno.
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

    /** Toque en "+N avisos" / "Ocultar avisos". */
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
    }

    /** Viaje terminado o sesión cerrada: borra también la ruta guardada en el dispositivo. */
    function forget(id) {
        const target = id === undefined ? loadId : id;
        reset();
        if (window.RouteStore) return window.RouteStore.clear(target);
        return Promise.resolve();
    }

    return {
        prepare, prefetch, update, reset, forget, snapshot, hudText, renderHud, handleBlockage, layoutAlerts, toggleAlerts,
        onUpdate(listener) { listeners.add(listener); return () => listeners.delete(listener); },
        get route() { return route; },
        get clearance() { return clearance; },
        get nearby() { return nearby; },
        get avoidPoints() { return avoidPoints; },
        // Expuestos para pruebas.
        instruction, formatDistance, formatDuration, glyph, project, samplePath, validateRoute, chooseRoute, routeNotice
    };
})();

window.RouteGuidance = (function () {
    const OSRM_URL = 'https://router.project-osrm.org/route/v1/driving/';
    const OFF_ROUTE_M = 250;
    const REROUTE_COOLDOWN_MS = 30000;
    const CLEARANCE_ANNOUNCE_M = 3000;
    const CLEARANCE_MAX_POINTS = 400;
    const ARRIVED_M = 60;
    const NEAR_ANNOUNCE_M = 300;

    let route = null;
    let status = 'idle';
    let progress = null;
    let pendingKey = null;
    let lastReroute = 0;
    const announced = new Set();
    const listeners = new Set();
    let clearance = null;
    let wakeLock = null;

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

    async function requestRoute(points) {
        const url = OSRM_URL + points.map(c => c[1] + ',' + c[0]).join(';')
            + '?overview=full&geometries=geojson&steps=true';
        const response = await fetch(url);
        if (!response.ok) throw new Error('OSRM ' + response.status);
        const json = await response.json();
        const best = json.routes && json.routes[0];
        if (!best || !best.geometry || !best.legs) throw new Error('OSRM sin ruta');
        return best;
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
        return { key, source, geometry, cumulative, steps, totalM: cumulative[cumulative.length - 1] };
    }

    function notify() {
        listeners.forEach(listener => { try { listener(snapshot()); } catch (e) { } });
        renderHud();
    }

    async function prepare(load) {
        if (!load) return;
        const target = waypointsFor(load);
        if (!target) {
            route = null;
            status = 'unavailable';
            notify();
            return;
        }
        if ((route && route.key === target.key) || pendingKey === target.key) return;
        pendingKey = target.key;
        status = 'loading';
        progress = null;
        announced.clear();
        notify();
        try {
            const osrm = await requestRoute(target.points);
            if (pendingKey !== target.key) return;
            route = buildRoute(osrm, target.key, target.source);
            status = 'ready';
            acquireWakeLock();
            if (window.mapCtrl && window.mapCtrl.drawGuidanceLine) window.mapCtrl.drawGuidanceLine(route.geometry);
            checkClearance(route);
            const fix = window.DriverTelemetry && window.DriverTelemetry.lastPoint;
            if (fix) update(fix); else notify();
        } catch (e) {
            if (pendingKey !== target.key) return;
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
        const destination = route.geometry[route.geometry.length - 1];
        const key = route.key;
        try {
            const osrm = await requestRoute([position, destination]);
            if (!route || route.key !== key) return;
            route = buildRoute(osrm, key, 'recalculada');
            announced.clear();
            checkClearance(route);
            if (window.mapCtrl && window.mapCtrl.drawGuidanceLine) window.mapCtrl.drawGuidanceLine(route.geometry);
            if (window.voiceEngine) window.voiceEngine.speak('Ruta recalculada.', false);
            update({ coords: position });
        } catch (e) {
        }
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
        announce(next, progress);
        const restriction = nextClearance(alongM);
        if (restriction && window.voiceEngine && restriction.alongM - alongM <= CLEARANCE_ANNOUNCE_M
            && !announced.has('clearance:' + restriction.id)) {
            announced.add('clearance:' + restriction.id);
            window.voiceEngine.speak('Atención: ' + spokenDistance(Math.max(0, restriction.alongM - alongM)).trim() + ' '
                + restriction.spoken + '.', true);
        }
        if (progress.offRoute) reroute(point.coords);
        notify();
    }

    function samplePath(geometry) {
        if (geometry.length <= CLEARANCE_MAX_POINTS) return geometry.slice();
        const step = (geometry.length - 1) / (CLEARANCE_MAX_POINTS - 1);
        return Array.from({ length: CLEARANCE_MAX_POINTS }, (_, i) => geometry[Math.round(i * step)]);
    }

    function clearanceItem(item, warning) {
        const r = item.restriction || {};
        const reason = window.ui.orNotAvailable(item.reason);
        return { id: r.id, kind: item.kind, alongM: item.alongRouteMeters, warning, text: reason, spoken: reason };
    }

    async function checkClearance(target) {
        const driver = window.TruckCarData && window.TruckCarData.currentDriver;
        const vehicle = driver && driver.vehicle;
        const api = window.TruckCarApi && window.TruckCarApi.restrictions;
        if (!vehicle || !Number.isFinite(vehicle.height) || !Number.isFinite(vehicle.grossWeight)) {
            clearance = { key: target.key, status: 'no-vehicle', items: [] };
            return;
        }
        if (!api || !api.validateRoute) return;
        clearance = { key: target.key, status: 'checking', items: [] };
        try {
            const result = await api.validateRoute({
                vehiclePlate: vehicle.plate,
                heightMeters: vehicle.height,
                grossWeightTons: vehicle.grossWeight,
                path: samplePath(target.geometry)
            });
            if (route !== target) return;
            const items = [
                ...(result.blocking || []).map(item => clearanceItem(item, false)),
                ...(result.warnings || []).map(item => clearanceItem(item, true))
            ].sort((a, b) => a.alongM - b.alongM);
            clearance = { key: target.key, status: items.length ? 'found' : 'ok', items };
        } catch (e) {
            if (route !== target) return;
            clearance = { key: target.key, status: 'unavailable', items: [] };
        }
        notify();
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
            clearance: clearanceHud(p)
        };
    }

    function plannedDuration() {
        const routes = window.TruckCarData && window.TruckCarData.routes;
        const hours = routes && routes.optimal ? routes.optimal.estimatedDurationHours : null;
        return hours == null ? null : window.TruckCarService.formatHours(hours);
    }

    function durationText(s) {
        return s.plannedDuration ? 'Viaje completo: ' + s.plannedDuration + ' · Route-AI' : 'Duración: ' + window.ui.NOT_AVAILABLE;
    }

    function clearanceHud(p) {
        const along = p && p.alongM != null ? p.alongM : null;
        const item = nextClearance(along);
        if (!item) return null;
        const away = Math.max(0, item.alongM - (along || 0));
        return { text: item.text, sub: 'en ' + formatDistance(away), warning: item.warning };
    }

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
        if (!s.hasPosition || s.offRoute) return { distance: s.distance, instruction: s.instruction, street: '' };
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
        set('[data-nav-step]', s.stepCount ? 'Paso ' + s.stepNumber + ' de ' + s.stepCount : 'Ruta real');
        document.querySelectorAll('[data-nav-icon]').forEach(el => { el.className = 'fas ' + s.icon; });
        document.querySelectorAll('[data-nav-glyph]').forEach(el => { el.setAttribute('href', 'assets/icons.svg#' + s.glyph); });
        document.querySelectorAll('[data-nav-offroute]').forEach(el => { el.hidden = !s.offRoute; });
        document.querySelectorAll('[data-nav-clearance]').forEach(el => { el.hidden = !s.clearance; });
        set('[data-nav-clearance-text]', s.clearance ? s.clearance.text : '');
        set('[data-nav-clearance-sub]', s.clearance ? '· ' + s.clearance.sub : '');
    }

    function reset() {
        route = null;
        status = 'idle';
        progress = null;
        pendingKey = null;
        clearance = null;
        announced.clear();
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

    return {
        prepare, update, reset, snapshot, hudText, renderHud, durationText,
        onUpdate(listener) { listeners.add(listener); return () => listeners.delete(listener); },
        get route() { return route; },
        get clearance() { return clearance; },
        get hasWakeLock() { return Boolean(wakeLock); }, requestWakeLock: acquireWakeLock, releaseWakeLock,
        instruction, formatDistance, glyph, project, samplePath, checkClearance
    };
})();

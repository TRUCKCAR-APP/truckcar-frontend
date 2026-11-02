/** Color de un token de css/tokens.css (ya resuelto), para las capas SVG de Leaflet. */
function mapToken(name, fallback) {
    const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return value || fallback;
}

/** Marcadores de la ruta, distintos por forma: origen = anillo hueco; destino = pin con bandera. */
const ROUTE_PINS = {
    origin: () => L.divIcon({ html: '<span class="map-pin-origin"></span>', className: 'map-pin', iconSize: [20, 20], iconAnchor: [10, 10] }),
    stop: () => L.divIcon({ html: '<span class="map-pin-stop"></span>', className: 'map-pin', iconSize: [12, 12], iconAnchor: [6, 6] }),
    destination: () => L.divIcon({
        html: '<span class="map-pin-destination"><svg aria-hidden="true"><use href="assets/icons.svg#flag-checkered-fill"></use></svg></span>',
        className: 'map-pin', iconSize: [32, 40], iconAnchor: [16, 40], popupAnchor: [0, -36]
    })
};

class MapController {
    constructor() {
        this.map = null;
        this.truckMarker = null;
        this.optimalRouteLayer = null;
        this.alertMarkersLayer = null;
        this.fleetMarkersLayer = null;
        this.fleetMarkers = new Map();
        this.shipmentLayer = null;
        this.shipmentTruckMarker = null;
        this.mountKey = null;
        this.currentCoords = [4.6752, -74.1450];
        this.heading = 240;

        this.cachedOptimalRoadGeometry = null;
        this.cachedRouteKey = null;
        this.isFetchingRoute = false;
        // Distancia y duración por carretera de la misma línea que se dibuja (OSRM, perfil de auto).
        this.routeSummary = null;
        this.routeSummaryFailed = false;
        this.bottomInset = 0;
    }

    initMap(containerId, center = [4.6097, -74.0817], zoom = 8) {
        if (this.resizeObserver) {
            this.resizeObserver.disconnect();
            this.resizeObserver = null;
        }
        if (this.sheetObserver) {
            this.sheetObserver.disconnect();
            this.sheetObserver = null;
        }
        this.bottomInset = 0;
        if (this.map) {
            try {
                // Detener animaciones pendientes evita el error "_leaflet_pos" al destruir el mapa.
                this.map.stop();
                this.map.off();
                this.map.remove();
            } catch(e) {
                console.warn(e);
            }
            this.map = null;
            this.truckMarker = null;
            this.optimalRouteLayer = null;
            this.shipmentLayer = null;
        }

        const container = document.getElementById(containerId);
        if (!container) return;

        const defaultCenter = Array.isArray(center) ? center : (center.lat ? [center.lat, center.lng] : [4.6097, -74.0817]);

        this.map = L.map(containerId, {
            center: defaultCenter,
            zoom: zoom,
            zoomControl: true,
            attributionControl: false
        });
        // Atribución obligatoria y siempre legible: abajo a la izquierda, por encima de los controles de cada pantalla.
        L.control.attribution({ position: 'bottomleft', prefix: false }).addTo(this.map);

        // Teselas oscuras del proveedor configurado en js/config.js (Stadia Maps; CARTO como plan B). crossOrigin hace
        // legibles sus cabeceras: el Service Worker guarda cada tesela con el vencimiento que estas indican.
        const tiles = window.TruckCarConfig.map;
        L.tileLayer(tiles.tileUrl, {
            maxZoom: tiles.maxZoom,
            attribution: tiles.attribution,
            crossOrigin: true
        }).addTo(this.map);

        this.alertMarkersLayer = L.layerGroup().addTo(this.map);
        this.fleetMarkersLayer = L.layerGroup().addTo(this.map);
        this.fleetMarkers = new Map();
        this.shipmentTruckMarker = null;
        this.mountKey = containerId;

        // Leaflet mide el contenedor una sola vez al crearse. Si después cambia de tamaño (la pestaña termina de
        // aparecer, cargan las fuentes, rota el teléfono, se abre una hoja), las teselas quedan desalineadas y con
        // huecos: se vuelve a medir cada vez que el contenedor cambia, una vez por cuadro.
        if (typeof ResizeObserver === 'function') {
            let frame = null;
            this.resizeObserver = new ResizeObserver(() => {
                cancelAnimationFrame(frame);
                frame = requestAnimationFrame(() => { if (this.map) this.map.invalidateSize({ pan: false }); });
            });
            this.resizeObserver.observe(container);
        } else {
            setTimeout(() => { if (this.map) this.map.invalidateSize(); }, 200);
        }
    }

    /** Invalida la geometría cacheada cuando cambia la carga o el plan de ruta. */
    resetRouteCache() {
        this.cachedOptimalRoadGeometry = null;
        this.cachedRouteKey = null;
        this.routeSummary = null;
        this.routeSummaryFailed = false;
    }

    /**
     * Una hoja inferior tapa la parte baja del mapa: la atribución y los controles de abajo suben por encima de ella y
     * el encuadre de la ruta la descuenta. Se vuelve a medir cuando la hoja cambia de alto.
     */
    observeBottomSheet(sheet) {
        if (!this.map || !sheet) return;
        const container = this.map.getContainer();
        const apply = () => {
            this.bottomInset = sheet.offsetHeight;
            container.style.setProperty('--map-bottom-inset', this.bottomInset + 'px');
        };
        apply();
        if (typeof ResizeObserver === 'function') {
            this.sheetObserver = new ResizeObserver(apply);
            this.sheetObserver.observe(sheet);
        }
    }

    /** Cifras de la hoja de Rutas: kilómetros y tiempo de la línea dibujada, o "Sin información" si no se pudo calcular. */
    routeFiguresHtml() {
        const s = this.routeSummary;
        if (s) {
            const minutes = Math.round(s.durationMin);
            const hours = Math.floor(minutes / 60);
            return '<span class="figure">' + Math.round(s.distanceKm) + '<small>km</small></span>'
                + '<span class="figure">' + (hours ? hours + '<small>h</small> ' : '') + (minutes % 60) + '<small>min</small></span>';
        }
        return this.routeSummaryFailed
            ? '<span class="figure is-none">Sin información</span>'
            : '<span class="figure is-none">Calculando…</span>';
    }

    renderRouteFigures() {
        document.querySelectorAll('[data-route-figures]').forEach(el => { el.innerHTML = this.routeFiguresHtml(); });
    }

    currentRoute() {
        const routes = window.TruckCarData.routes;
        return routes && routes.optimal && routes.optimal.waypoints && routes.optimal.waypoints.length >= 2
            ? routes.optimal
            : null;
    }

    drawOverviewRoutes() {
        if (!this.map) return;
        this.renderRoutes();
        this.renderAlerts();
        this.fitAllRoute();
    }

    /** Navegación: ruta, alertas, la línea de la guía paso a paso y el camión en la posición actual (si la hay). */
    drawLiveNavigation(position) {
        if (!this.map) return;
        this.renderRoutes();
        this.renderAlerts();
        this.guidanceLayer = null;
        const guided = window.RouteGuidance && window.RouteGuidance.route;
        if (guided) this.drawGuidanceLine(guided.geometry);
        if (position) {
            this.createTruckMarker(position);
            this.map.setView(position, 15);
        } else {
            this.truckMarker = null;
            this.fitAllRoute();
        }
    }

    /** Línea de la ruta que sigue la guía (la del plan o la recalculada desde la posición actual). */
    drawGuidanceLine(geometry) {
        if (!this.map || !geometry || geometry.length < 2 || !document.getElementById('live-nav-map-container')) return;
        if (this.guidanceLayer) {
            try { this.map.removeLayer(this.guidanceLayer); } catch (e) { /* capa ya removida */ }
        }
        this.guidanceLines = this.routeLines(geometry);
        this.guidanceLayer = L.layerGroup(this.guidanceLines.layers).addTo(this.map);
    }

    /** Posición del conductor para separar lo recorrido de lo que falta (solo en la app del conductor). */
    driverPosition() {
        const state = window.store && window.store.state;
        const point = window.DriverTelemetry && window.DriverTelemetry.lastPoint;
        return state && state.activeRole === 'driver' && point && point.coords ? point.coords : null;
    }

    /**
     * Divide la ruta en la posición: lo recorrido en grafito, lo que falta en azul con borde del color del fondo. Una
     * posición a más de 250 m de la línea no cuenta (fuera de ruta o sin GPS): toda la ruta queda por recorrer.
     */
    splitRoute(coords, position) {
        if (!position) return { done: [], ahead: coords };
        const cos = Math.cos(position[0] * Math.PI / 180);
        let index = 0;
        let best = Infinity;
        coords.forEach((c, i) => {
            const d = ((c[0] - position[0]) ** 2) + ((c[1] - position[1]) * cos) ** 2;
            if (d < best) { best = d; index = i; }
        });
        if (Math.sqrt(best) * 111320 > 250) return { done: [], ahead: coords };
        return { done: coords.slice(0, index + 1).concat([position]), ahead: [position].concat(coords.slice(index + 1)) };
    }

    routeLines(coords) {
        const style = { lineCap: 'round', lineJoin: 'round', opacity: 1, interactive: false };
        const { done, ahead } = this.splitRoute(coords, this.driverPosition());
        const lines = {
            coords,
            done: L.polyline(done, { ...style, color: mapToken('--color-route-done', '#3A4049'), weight: 6 }),
            casing: L.polyline(ahead, { ...style, color: mapToken('--color-route-casing', '#0C0E12'), weight: 10 }),
            ahead: L.polyline(ahead, { ...style, color: mapToken('--color-route', '#5AA2FF'), weight: 6 })
        };
        lines.layers = [lines.done, lines.casing, lines.ahead];
        return lines;
    }

    /** Con cada posición nueva, lo recorrido crece y lo que falta se acorta. */
    refreshRouteProgress() {
        const position = this.driverPosition();
        [this.routeProgressLines, this.guidanceLines].forEach(lines => {
            if (!lines) return;
            const { done, ahead } = this.splitRoute(lines.coords, position);
            lines.done.setLatLngs(done);
            lines.casing.setLatLngs(ahead);
            lines.ahead.setLatLngs(ahead);
        });
    }

    drawCoordinatorFleet() {
        if (!this.map) return;
        this.renderRoutes();
        this.renderAlerts();
        this.renderCoordinatorFleetMarkers();
        this.fitAllRoute();
    }

    renderRoutes() {
        if (!this.map) return;
        if (this.optimalRouteLayer) {
            try { this.map.removeLayer(this.optimalRouteLayer); } catch (e) { /* capa ya removida */ }
            this.optimalRouteLayer = null;
        }

        const optimal = this.currentRoute();
        if (!optimal) return;

        const waypoints = optimal.waypoints;
        const routeKey = optimal.id;
        if (this.cachedRouteKey !== routeKey) {
            this.cachedOptimalRoadGeometry = null;
            this.cachedRouteKey = routeKey;
            this.routeSummary = null;
            this.routeSummaryFailed = false;
        }
        const polylineCoords = this.cachedOptimalRoadGeometry || waypoints.map(w => w.coords);

        this.routeProgressLines = this.routeLines(polylineCoords);
        const markers = waypoints.map((wp, index) => {
            const kind = index === 0 ? 'origin' : index === waypoints.length - 1 ? 'destination' : 'stop';
            return L.marker(wp.coords, { icon: ROUTE_PINS[kind](), title: wp.name || '' })
                .bindPopup('<b>' + window.ui.escape(wp.name) + '</b><br><span class="map-popup-sub">' + window.ui.escape(wp.instruction) + '</span>');
        });

        this.optimalRouteLayer = L.layerGroup(this.routeProgressLines.layers.concat(markers)).addTo(this.map);

        if (!this.cachedOptimalRoadGeometry && !this.isFetchingRoute) {
            this.fetchRealRoadGeometry(waypoints, routeKey);
        }
    }

    /** Geometría vial real entre los puntos de la ruta (OSRM público); si falla se mantienen tramos rectos. */
    async fetchRealRoadGeometry(waypoints, routeKey) {
        try {
            this.isFetchingRoute = true;
            const coordString = waypoints.map(w => w.coords[1] + ',' + w.coords[0]).join(';');
            const url = 'https://router.project-osrm.org/route/v1/driving/' + coordString + '?overview=full&geometries=geojson';

            const res = await fetch(url);
            if (!res.ok) {
                this.routeSummaryFailed = true;
                this.renderRouteFigures();
                return;
            }
            const data = await res.json();

            if (data.routes && data.routes[0] && data.routes[0].geometry && this.cachedRouteKey === routeKey) {
                const roadCoords = data.routes[0].geometry.coordinates.map(pt => [pt[1], pt[0]]);
                this.cachedOptimalRoadGeometry = roadCoords;
                this.routeSummary = { distanceKm: data.routes[0].distance / 1000, durationMin: data.routes[0].duration / 60 };
                if (this.optimalRouteLayer && this.map) this.renderRoutes();
                this.renderRouteFigures();
            }
        } catch (err) {
            // Sin conexión a OSRM: se conservan los tramos rectos y la hoja dice "Sin información".
            this.routeSummaryFailed = true;
            this.renderRouteFigures();
        } finally {
            this.isFetchingRoute = false;
        }
    }

    renderAlerts() {
        if (!this.map || !this.alertMarkersLayer) return;
        this.alertMarkersLayer.clearLayers();

        const alerts = window.TruckCarData.communityAlerts || [];
        alerts.filter(alert => alert.coords).forEach(alert => {
            let color = 'bg-amber-500';
            let icon = 'fa-triangle-exclamation';

            if (alert.type === 'scale') { color = 'bg-indigo-600'; icon = 'fa-weight-hanging'; }
            else if (alert.type === 'bridge') { color = 'bg-red-600'; icon = 'fa-ruler-vertical'; }
            else if (alert.type === 'police') { color = 'bg-blue-600'; icon = 'fa-shield-alt'; }
            else if (alert.type === 'rest') { color = 'bg-emerald-600'; icon = 'fa-coffee'; }
            else if (alert.type === 'workshop') { color = 'bg-orange-600'; icon = 'fa-wrench'; }
            else if (alert.type === 'danger') { color = 'bg-rose-600'; icon = 'fa-car-burst'; }

            const alertIcon = L.divIcon({
                html: '<div class="w-7 h-7 ' + color + ' text-white rounded-full flex items-center justify-center shadow-lg border-2 border-white text-xs"><i class="fas ' + icon + '"></i></div>',
                className: 'community-alert-pin',
                iconSize: [28, 28],
                iconAnchor: [14, 14]
            });

            L.marker(alert.coords, { icon: alertIcon })
                .bindPopup('<b>' + window.ui.escape(alert.title) + '</b><br>' + window.ui.escape(alert.description)
                    + '<br><span class="text-xs">' + window.ui.escape(alert.upvotes) + ' confirmaciones</span>')
                .addTo(this.alertMarkersLayer);
        });
    }

    /**
     * Marcadores de la flota: se actualizan en sitio (uno por conductor) para que la telemetría en tiempo real
     * pueda moverlos sin recrearlos.
     */
    renderCoordinatorFleetMarkers() {
        if (!this.map || !this.fleetMarkersLayer) return;
        const fleet = (window.TruckCarData.fleetVehicles || []).filter(truck => truck.coords);
        const present = new Set(fleet.map(truck => truck.id));
        this.fleetMarkers.forEach((marker, id) => {
            if (!present.has(id)) {
                this.fleetMarkersLayer.removeLayer(marker);
                this.fleetMarkers.delete(id);
            }
        });
        fleet.forEach(truck => this.placeFleetMarker(truck, false));
    }

    fleetTruckIcon(truck) {
        const statusColor = truck.status === 'EN_TRANSITO' ? 'bg-emerald-600' : truck.status === 'DESCANSO' ? 'bg-amber-500' : 'bg-blue-600';
        const heading = typeof truck.heading === 'number' ? truck.heading : null;
        // fa-location-arrow apunta al noreste (45°): se compensa para que 0° sea el norte.
        const arrow = heading == null ? '' : `
            <i class="fas fa-location-arrow truck-heading absolute -top-1.5 -right-1.5 text-[11px] text-emerald-300 drop-shadow"
               style="transform: rotate(${Math.round(heading - 45)}deg)"></i>`;
        return L.divIcon({
            html: `
                <div class="flex flex-col items-center">
                    <div class="relative w-8 h-8 ${statusColor} text-white rounded-full shadow-lg border-2 border-white flex items-center justify-center text-xs">
                        <i class="fas fa-truck"></i>${arrow}
                    </div>
                    <span class="bg-slate-900 text-white text-[9px] font-mono font-bold px-1.5 py-0.5 rounded shadow mt-0.5 border border-slate-700 whitespace-nowrap">${window.ui.escape(truck.plate)}</span>
                </div>`,
            className: 'fleet-truck-marker',
            iconSize: [60, 45],
            iconAnchor: [30, 20]
        });
    }

    fleetPopup(truck) {
        return '<b>' + window.ui.escape(truck.driverName) + ' (' + window.ui.escape(truck.plate) + ')</b><br>'
            + window.ui.escape(truck.vehicleType || '—') + '<br>Estado: <b>' + window.ui.escape(truck.status) + '</b> | Vel: '
            + truck.speed + ' km/h' + (typeof truck.heading === 'number' ? ' | Rumbo: ' + Math.round(truck.heading) + '°' : '');
    }

    /** Crea o actualiza el marcador de un camión; con animate, se desliza hasta la nueva posición. */
    placeFleetMarker(truck, animate) {
        if (!this.map || !this.fleetMarkersLayer || !truck.coords) return;
        let marker = this.fleetMarkers.get(truck.id);
        if (!marker) {
            marker = L.marker(truck.coords, { icon: this.fleetTruckIcon(truck) }).bindPopup(this.fleetPopup(truck));
            marker.addTo(this.fleetMarkersLayer);
            this.fleetMarkers.set(truck.id, marker);
            return;
        }
        marker.setIcon(this.fleetTruckIcon(truck));
        marker.setPopupContent(this.fleetPopup(truck));
        if (animate) this.animateMarker(marker, truck.coords);
        else marker.setLatLng(truck.coords);
    }

    /** Telemetría en tiempo real (torre de control). */
    moveFleetMarker(truck) {
        this.placeFleetMarker(truck, true);
    }

    /** Interpola la posición del marcador (ease-in-out) durante ~2,5 s, menos que el intervalo de envío (3 s). */
    animateMarker(marker, target, durationMs = 2500) {
        if (marker._truckcarAnimation) cancelAnimationFrame(marker._truckcarAnimation);
        const from = marker.getLatLng();
        const to = L.latLng(target);
        if (from.distanceTo(to) > 50000) {      // salto grande (p. ej. primer dato real): sin animación
            marker.setLatLng(to);
            return;
        }
        const start = performance.now();
        const step = (now) => {
            const t = Math.min(1, (now - start) / durationMs);
            const eased = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
            marker.setLatLng([from.lat + (to.lat - from.lat) * eased, from.lng + (to.lng - from.lng) * eased]);
            marker._truckcarAnimation = t < 1 ? requestAnimationFrame(step) : null;
        };
        marker._truckcarAnimation = requestAnimationFrame(step);
    }

    createTruckMarker(coords = this.currentCoords) {
        if (!this.map) return;
        if (this.truckMarker) {
            try { this.map.removeLayer(this.truckMarker); } catch(e) {}
        }

        const latLng = Array.isArray(coords) ? coords : [coords.lat, coords.lng];
        this.currentCoords = latLng;

        const truckIcon = L.divIcon({
            html: '<div class="w-9 h-9 bg-slate-900 border-2 border-emerald-400 rounded-full shadow-xl flex items-center justify-center text-emerald-400 text-sm animate-pulse"><i class="fas fa-truck-moving"></i></div>',
            className: 'truck-pin',
            iconSize: [36, 36],
            iconAnchor: [18, 18]
        });

        this.truckMarker = L.marker(latLng, { icon: truckIcon, zIndexOffset: 1000 }).addTo(this.map);
    }

    updateTruckPosition(arg1, arg2) {
        let lat, lng;
        if (Array.isArray(arg1)) {
            lat = arg1[0];
            lng = arg1[1];
        } else if (typeof arg1 === 'object' && arg1 !== null) {
            lat = arg1.lat;
            lng = arg1.lng;
        } else {
            lat = arg1;
            lng = arg2;
        }

        if (typeof lat !== 'number' || typeof lng !== 'number') return;
        this.currentCoords = [lat, lng];

        if (this.truckMarker) {
            this.truckMarker.setLatLng([lat, lng]);
        } else if (this.map) {
            this.createTruckMarker([lat, lng]);
        }
        this.refreshRouteProgress();

        if (this.map) {
            this.map.panTo([lat, lng], { animate: true, duration: 0.8 });
        }
    }

    /** Encuadra la ruta activa; sin ruta, encuadra la flota y las alertas visibles. */
    fitAllRoute() {
        if (!this.map) return;
        const optimal = this.currentRoute();
        let points;
        if (optimal) {
            points = this.cachedOptimalRoadGeometry || optimal.waypoints.map(w => w.coords);
        } else {
            const fleet = (window.TruckCarData.fleetVehicles || []).map(t => t.coords);
            const alerts = (window.TruckCarData.communityAlerts || []).map(a => a.coords);
            points = fleet.concat(alerts).filter(Boolean);
        }
        if (points.length === 1) {
            this.map.setView(points[0], 11, { animate: false });
        } else if (points.length > 1) {
            this.map.fitBounds(L.latLngBounds(points), { paddingTopLeft: [40, 40], paddingBottomRight: [40, 40 + this.bottomInset], animate: false });
        }
    }

    /** Panel del generador: origen, destino y, si la carga está asignada o en ruta, la posición del camión. */
    drawShipment(load, truck, { fit = true } = {}) {
        if (!this.map) return;
        if (this.shipmentLayer) {
            try { this.map.removeLayer(this.shipmentLayer); } catch (e) { /* capa ya removida */ }
            this.shipmentLayer = null;
        }
        this.shipmentTruckMarker = null;
        if (!load) return;
        const esc = window.ui.escape;
        const layers = [];
        const points = [];
        const origin = load.origin && load.origin.coords;
        const destination = load.destination && load.destination.coords;
        if (origin) {
            layers.push(L.marker(origin, { icon: ROUTE_PINS.origin(), title: load.origin.city || '' }).bindPopup('<b>Origen</b><br>' + esc(load.origin.city)));
            points.push(origin);
        }
        if (destination) {
            layers.push(L.marker(destination, { icon: ROUTE_PINS.destination(), title: load.destination.city || '' }).bindPopup('<b>Destino</b><br>' + esc(load.destination.city)));
            points.push(destination);
        }
        if (origin && destination) {
            layers.push(L.polyline([origin, destination], { color: mapToken('--color-route', '#5AA2FF'), weight: 3, opacity: 0.9, dashArray: '6 8' }));
        }
        if (truck && truck.coords) {
            this.shipmentTruckMarker = L.marker(truck.coords, { zIndexOffset: 1000, icon: this.shipmentTruckIcon(truck) })
                .bindPopup(this.shipmentTruckPopup(truck));
            layers.push(this.shipmentTruckMarker);
            points.push(truck.coords);
        }
        this.shipmentLayer = L.layerGroup(layers).addTo(this.map);
        if (!fit) return;
        if (points.length === 1) {
            this.map.setView(points[0], 10, { animate: false });
        } else if (points.length > 1) {
            this.map.fitBounds(L.latLngBounds(points), { padding: [36, 36], animate: false });
        }
    }

    shipmentTruckIcon(truck) {
        const heading = typeof truck.heading === 'number' ? truck.heading : null;
        const arrow = heading == null ? '' : `
            <i class="fas fa-location-arrow absolute -top-2 -right-2 text-[12px] text-emerald-300 drop-shadow"
               style="transform: rotate(${Math.round(heading - 45)}deg)"></i>`;
        return L.divIcon({
            html: `<div class="relative w-9 h-9 bg-slate-900 border-2 border-emerald-400 rounded-full shadow-xl flex items-center justify-center text-emerald-400 text-sm"><i class="fas fa-truck-moving"></i>${arrow}</div>`,
            className: 'truck-pin', iconSize: [36, 36], iconAnchor: [18, 18]
        });
    }

    shipmentTruckPopup(truck) {
        const esc = window.ui.escape;
        return '<b>' + esc(truck.driverName) + ' (' + esc(truck.plate) + ')</b><br>' + esc(truck.status) + ' · '
            + truck.speed + ' km/h · ' + esc(truck.lastCheckin);
    }

    /** Telemetría en tiempo real ("Mis envíos"): desliza el camión del envío visible hacia su nueva posición. */
    moveShipmentTruck(truck) {
        if (!this.map || !this.shipmentLayer || !truck || !truck.coords) return;
        if (!this.shipmentTruckMarker) {
            this.shipmentTruckMarker = L.marker(truck.coords, { zIndexOffset: 1000, icon: this.shipmentTruckIcon(truck) })
                .bindPopup(this.shipmentTruckPopup(truck));
            this.shipmentLayer.addLayer(this.shipmentTruckMarker);
            return;
        }
        this.shipmentTruckMarker.setIcon(this.shipmentTruckIcon(truck));
        this.shipmentTruckMarker.setPopupContent(this.shipmentTruckPopup(truck));
        this.animateMarker(this.shipmentTruckMarker, truck.coords);
    }

    /** true si el contenedor del mapa actual sigue en el DOM con ese id (el mapa se puede reutilizar). */
    isMountedOn(containerId) {
        return !!(this.map && document.getElementById(containerId) === this.map.getContainer());
    }

    focusOn(coords, zoom = 13) {
        if (this.map && coords) {
            this.map.flyTo(coords, zoom, { duration: 1.2 });
        }
    }
}

window.mapCtrl = new MapController();

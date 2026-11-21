function mapToken(name, fallback) {
    const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return value || fallback;
}

// Mapas embebidos en una página con scroll (paneles de torre y generador). En pantallas táctiles pequeñas un dedo
// desplaza la página y dos dedos mueven y acercan el mapa: sin arrastre de Leaflet, el contenedor queda con
// touch-action: pan-x pan-y y el pellizco (touchZoom) sigue moviendo el centro. La navegación del conductor no entra.
const SCROLL_FRIENDLY_MAPS = new Set(['coordinator-map-container', 'generator-map-container']);
const COMPACT_TOUCH_QUERY = '(pointer: coarse) and (max-width: 1023.98px)';

const ROUTE_PINS = {
    origin: () => L.divIcon({ html: '<span class="map-pin-origin"></span>', className: 'map-pin', iconSize: [20, 20], iconAnchor: [10, 10] }),
    stop: () => L.divIcon({ html: '<span class="map-pin-stop"></span>', className: 'map-pin', iconSize: [12, 12], iconAnchor: [6, 6] }),
    destination: () => L.divIcon({
        html: '<span class="map-pin-destination"><svg aria-hidden="true"><use href="assets/icons.svg#flag-checkered-fill"></use></svg></span>',
        className: 'map-pin', iconSize: [32, 40], iconAnchor: [16, 40], popupAnchor: [0, -36]
    })
};

/**
 * Capa del mapa para el tema: la de TruckCarConfig.map.layer (base y nombres de calles) o, si la configuración no la trae,
 * una sola capa con tileUrl / lightTileUrl.
 */
function tileLayerFor(tiles, theme) {
    if (typeof tiles.layer === 'function') return tiles.layer(theme);
    return L.tileLayer(theme === 'light' ? tiles.lightTileUrl : tiles.tileUrl,
        { maxZoom: tiles.maxZoom, attribution: tiles.attribution, crossOrigin: true });
}

class MapController {
    constructor() {
        this.map = null;
        this.baseTileLayer = null;
        this.truckMarker = null;
        this.optimalRouteLayer = null;
        this.alertMarkersLayer = null;
        this.fleetMarkersLayer = null;
        this.fleetMarkers = new Map();
        this.shipmentLayer = null;
        this.shipmentTruckMarker = null;
        this.mountKey = null;
        this.currentCoords = null;
        this.defaultCenter = [4.6097, -74.0817];

        this.cachedOptimalRoadGeometry = null;
        this.cachedRouteKey = null;
        this.isFetchingRoute = false;
        this.bottomInset = 0;
    }

    initMap(containerId, center = null, zoom = 8) {
        if (this.resizeObserver) {
            this.resizeObserver.disconnect();
            this.resizeObserver = null;
        }
        if (this.gestureCleanup) {
            this.gestureCleanup();
            this.gestureCleanup = null;
        }
        if (this.sheetObserver) {
            this.sheetObserver.disconnect();
            this.sheetObserver = null;
        }
        this.bottomInset = 0;
        this.navFramed = false;
        this.navGuidanceFramed = false;
        this.navFollow = true;
        this.navOversized = false;
        this.navLayoutKey = null;
        this.navRotation = 0;
        this.navHidden = null;
        if (this.navAreaObserver) {
            this.navAreaObserver.disconnect();
            this.navAreaObserver = null;
            this.navAreaObserved = null;
        }
        if (this.map) {
            try {
                this.map.stop();
                this.map.off();
                this.map.remove();
            } catch(e) {
                console.warn(e);
            }
            this.map = null;
            this.baseTileLayer = null;
            this.truckMarker = null;
            this.deviceFramed = false;
            this.optimalRouteLayer = null;
            this.shipmentLayer = null;
        }

        const container = document.getElementById(containerId);
        if (!container) return;

        const defaultCenter = Array.isArray(center) ? center : (center && center.lat ? [center.lat, center.lng] : this.defaultCenter);

        this.map = L.map(containerId, {
            center: defaultCenter,
            zoom: zoom,
            zoomControl: true,
            attributionControl: false
        });
        L.control.attribution({ position: 'bottomleft', prefix: false }).addTo(this.map);

        const tiles = window.TruckCarConfig.map;
        const theme = window.TruckCarTheme ? window.TruckCarTheme.getTheme() : 'dark';
        this.baseTileLayer = tileLayerFor(tiles, theme).addTo(this.map);

        this.alertMarkersLayer = L.layerGroup().addTo(this.map);
        this.fleetMarkersLayer = L.layerGroup().addTo(this.map);
        this.fleetMarkers = new Map();
        this.shipmentTruckMarker = null;
        this.mountKey = containerId;
        if (SCROLL_FRIENDLY_MAPS.has(containerId)) this.gestureCleanup = this.applyScrollFriendlyGestures(container);

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

    applyScrollFriendlyGestures(container) {
        if (typeof window.matchMedia !== 'function') return null;
        const query = window.matchMedia(COMPACT_TOUCH_QUERY);
        const map = this.map;
        const apply = () => {
            const compact = query.matches;
            if (compact) map.dragging.disable();
            else map.dragging.enable();
            container.classList.toggle('map-two-finger', compact);
        };
        apply();
        if (typeof query.addEventListener === 'function') query.addEventListener('change', apply);
        return () => {
            if (typeof query.removeEventListener === 'function') query.removeEventListener('change', apply);
            container.classList.remove('map-two-finger');
        };
    }

    resetRouteCache() {
        this.cachedOptimalRoadGeometry = null;
        this.cachedRouteKey = null;
    }

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

    /**
     * Seguimiento como en las apps de navegación: mientras navFollow, el mapa sigue al camión con zoom de calle y el
     * camión un poco abajo del centro (se ve más vía por delante). Al mover o pellizcar el mapa con el dedo deja de
     * seguirlo hasta que el conductor toque «Recentrar».
     */
    bindNavGestures() {
        if (!this.map || this.navGesturesBound === this.map) return;
        this.navGesturesBound = this.map;
        const stop = () => this.pauseFollow();
        this.map.on('dragstart', stop);
        const container = this.map.getContainer();
        container.addEventListener('wheel', stop, { passive: true });
        container.addEventListener('touchstart', (event) => { if (event.touches && event.touches.length > 1) stop(); }, { passive: true });
    }

    pauseFollow() {
        if (!this.navFollow) return;
        this.navFollow = false;
        // Mapa libre: norte arriba al instante, para que el arrastre siga al dedo.
        this.applyNavRotation(null, { instant: true });
        this.syncRecenter();
    }

    /**
     * Vista de conducción (como Waze o Google Maps): el mapa gira para que la dirección de viaje quede siempre hacia
     * arriba. Leaflet no gira el mapa, así que se gira su contenedor; para que al girar no queden esquinas vacías, el
     * contenedor es un cuadrado más grande que la pantalla, centrado en el punto donde va el camión (~65 % de la altura
     * visible, debajo de la tarjeta de la maniobra).
     */
    layoutNavMap() {
        const container = this.map && this.map.getContainer();
        const area = container && container.id === 'live-nav-map-container' ? container.closest('.nav-map-area') : null;
        if (!area) { this.navOversized = false; return; }
        const width = area.clientWidth;
        const height = area.clientHeight;
        if (!width || !height) return;
        const inset = this.navInsets();
        const anchorX = inset.left + (width - inset.left - inset.right) / 2;
        const anchorY = inset.top + (height - inset.top) * 0.65;
        const key = [width, height, anchorX, anchorY].map(Math.round).join('x');
        // Con keepAliveMaps el mismo mapa pasa a un área nueva en cada actualización: se vuelve a preparar.
        if (key === this.navLayoutKey && this.navOversized && this.navAreaObserved === area && area.classList.contains('is-heading-view')) return;
        this.navLayoutKey = key;
        const reach = Math.max(...[[0, 0], [width, 0], [0, height], [width, height]]
            .map(([x, y]) => Math.hypot(x - anchorX, y - anchorY)));
        const side = Math.ceil(2 * reach + 16);
        Object.assign(container.style, {
            width: side + 'px', height: side + 'px', right: 'auto', bottom: 'auto',
            left: Math.round(anchorX - side / 2) + 'px', top: Math.round(anchorY - side / 2) + 'px'
        });
        area.classList.add('is-heading-view');
        this.navOversized = true;
        this.navHidden = {
            left: Math.round(side / 2 - anchorX), top: Math.round(side / 2 - anchorY),
            right: Math.round(anchorX + side / 2 - width), bottom: Math.round(anchorY + side / 2 - height)
        };
        if (!area.querySelector('.nav-attribution')) {
            // Las esquinas del mapa quedan fuera de la pantalla: los créditos de las teselas van fijos en la vista.
            const credit = document.createElement('div');
            credit.className = 'nav-attribution';
            credit.innerHTML = window.TruckCarConfig.map.attribution || '';
            area.appendChild(credit);
        }
        if (typeof ResizeObserver === 'function' && this.navAreaObserved !== area) {
            if (this.navAreaObserver) this.navAreaObserver.disconnect();
            this.navAreaObserved = area;
            this.navAreaObserver = new ResizeObserver(() => {
                if (!this.map || !this.navOversized) return;
                this.layoutNavMap();
                if (this.navFollow && this.truckMarker) this.followTruck(this.truckMarker.getLatLng(), { animate: false });
            });
            this.navAreaObserver.observe(area);
        }
        this.map.invalidateSize({ pan: false });
    }

    /** Gira el mapa para que el rumbo quede hacia arriba (null: norte arriba). Toma el giro más corto. */
    applyNavRotation(heading, { instant = false } = {}) {
        if (!this.navOversized || !this.map) return;
        const container = this.map.getContainer();
        const target = heading == null ? 0 : -heading;
        const current = this.navRotation || 0;
        const delta = ((((target - current) % 360) + 540) % 360) - 180;
        this.navRotation = instant && heading == null ? 0 : current + delta;
        if (instant) {
            container.style.transition = 'none';
            container.style.transform = 'rotate(' + this.navRotation + 'deg)';
            void container.offsetWidth;
            container.style.transition = '';
        } else {
            container.style.transform = 'rotate(' + this.navRotation + 'deg)';
        }
    }

    /**
     * Rumbo del camión para la vista de conducción: el del GPS si va andando; si no (detenido o sin brújula), la
     * dirección de la ruta por delante; si tampoco, el último conocido.
     */
    navHeading(position) {
        const point = window.DriverTelemetry && window.DriverTelemetry.lastPoint;
        const fix = window.DeviceLocation && window.DeviceLocation.last && window.DeviceLocation.last(60000);
        const speed = point && Number.isFinite(point.speed) ? point.speed : fix && Number.isFinite(fix.speedKmH) ? fix.speedKmH : 0;
        const gps = point && Number.isFinite(point.heading) ? point.heading : null;
        let heading = gps != null && speed >= 5 ? gps : this.routeBearing(position);
        if (heading == null) heading = gps;
        if (heading != null) this.lastNavHeading = heading;
        return this.lastNavHeading != null ? this.lastNavHeading : null;
    }

    /** Dirección de la ruta unos 30 m por delante del punto de la ruta más cercano al camión (null si va fuera de ella). */
    routeBearing(position) {
        const geometry = this.guidanceGeometry || (this.routeProgressLines && this.routeProgressLines.coords);
        if (!position || !geometry || geometry.length < 2) return null;
        const here = L.latLng(position);
        let nearest = 0;
        let best = Infinity;
        geometry.forEach((p, i) => {
            const d = here.distanceTo(p);
            if (d < best) { best = d; nearest = i; }
        });
        if (best > 80) return null;
        let ahead = nearest;
        let walked = 0;
        while (ahead < geometry.length - 1 && walked < 30) {
            walked += L.latLng(geometry[ahead]).distanceTo(geometry[ahead + 1]);
            ahead++;
        }
        const from = ahead === nearest ? geometry[Math.max(0, nearest - 1)] : geometry[nearest];
        const to = geometry[ahead];
        if (!to || (from[0] === to[0] && from[1] === to[1])) return null;
        const rad = Math.PI / 180;
        const y = Math.sin((to[1] - from[1]) * rad) * Math.cos(to[0] * rad);
        const x = Math.cos(from[0] * rad) * Math.sin(to[0] * rad) - Math.sin(from[0] * rad) * Math.cos(to[0] * rad) * Math.cos((to[1] - from[1]) * rad);
        return (Math.atan2(y, x) / rad + 360) % 360;
    }

    syncRecenter() {
        document.querySelectorAll('[data-recenter]').forEach(el => { el.hidden = this.navFollow; });
    }

    /** Zoom de calle según la velocidad: más cerca en ciudad, un poco más lejos en carretera. */
    navZoom() {
        const point = window.DriverTelemetry && window.DriverTelemetry.lastPoint;
        const fix = window.DeviceLocation && window.DeviceLocation.last(60000);
        const speed = point && Number.isFinite(point.speed) ? point.speed : fix && Number.isFinite(fix.speedKmH) ? fix.speedKmH : 0;
        return speed >= 80 ? 15 : speed >= 40 ? 16 : 17;
    }

    followTruck(position, { animate = true } = {}) {
        if (!this.map || !position) return;
        const zoom = this.navZoom();
        this.layoutNavMap();
        if (this.navOversized) {
            // El centro del contenedor ya es el punto del camión en pantalla: se centra ahí y se gira según el rumbo.
            this.map.setView(position, zoom, { animate, duration: 0.6 });
            this.applyNavRotation(this.navHeading(position));
            this.updateTruckHeading();
            this.navFramed = true;
            return;
        }
        const size = this.map.getSize();
        const inset = this.navInsets();
        // El camión queda a ~65 % de la altura visible (debajo de la tarjeta de la maniobra), con la vía por delante.
        const visibleTop = inset.top;
        const targetY = visibleTop + (size.y - visibleTop) * 0.65;
        const offsetY = targetY - size.y / 2;
        const point = this.map.project(L.latLng(position), zoom).subtract([0, offsetY]);
        this.map.setView(this.map.unproject(point, zoom), zoom, { animate, duration: 0.6 });
        this.navFramed = true;
    }

    /** Actualización sin recrear el mapa: alertas, línea de la guía y marcador; respeta si el conductor lo movió. */
    refreshLiveNavigation() {
        if (!this.map) return;
        this.layoutNavMap();
        this.renderAlerts();
        const guided = window.RouteGuidance && window.RouteGuidance.route;
        if (guided && guided.geometry !== this.guidanceGeometry) this.drawGuidanceLine(guided.geometry);
        if (!guided && this.guidanceLayer) {
            try { this.map.removeLayer(this.guidanceLayer); } catch (e) { }
            this.guidanceLayer = null;
            this.guidanceGeometry = null;
        }
        this.syncRecenter();
    }

    drawLiveNavigation(position) {
        if (!this.map) return;
        if (this.map.zoomControl) this.map.removeControl(this.map.zoomControl);
        this.layoutNavMap();
        this.bindNavGestures();
        this.renderRoutes();
        this.renderAlerts();
        this.guidanceLayer = null;
        const guided = window.RouteGuidance && window.RouteGuidance.route;
        if (guided) this.drawGuidanceLine(guided.geometry);
        if (position) {
            this.createTruckMarker(position);
            this.followTruck(position, { animate: false });
        } else {
            this.truckMarker = null;
            this.deviceFramed = false;
            this.fitAllRoute();
        }
    }

    navInsets() {
        const card = document.querySelector('.nav-screen .hud-card');
        const panel = document.querySelector('.nav-screen .hud-panel');
        const landscape = !!document.querySelector('.nav-screen.is-landscape');
        return {
            top: card && !landscape ? card.offsetHeight + 16 : 16,
            left: card && landscape ? card.offsetWidth + 16 : 0,
            right: panel ? panel.offsetWidth + 16 : 0
        };
    }

    frameNextLeg(position) {
        if (!this.map || !position) return;
        const snapshot = window.RouteGuidance ? window.RouteGuidance.snapshot() : {};
        const next = snapshot.nextLocation;
        const inset = this.navInsets();
        const near = next && L.latLng(position).distanceTo(L.latLng(next)) < 40000;
        const bounds = L.latLngBounds(near ? [position, next] : [position]);
        this.map.fitBounds(bounds.pad(near ? 0.15 : 0), {
            paddingTopLeft: [24 + inset.left, inset.top + 24],
            paddingBottomRight: [24 + inset.right, 40 + (this.bottomInset || 0)],
            maxZoom: 14,
            animate: false
        });
        if (!near) this.map.setZoom(Math.min(this.map.getZoom(), 14), { animate: false });
        this.navFramed = true;
    }

    /** Marcador del camión con la ubicación del teléfono cuando no hay viaje; la primera vez centra el mapa ahí. */
    showDevicePosition(position) {
        if (!this.map || !position || !document.getElementById('live-nav-map-container')) return;
        if (this.truckMarker) this.truckMarker.setLatLng(position);
        else this.createTruckMarker(position);
        if (!this.deviceFramed && this.navFollow) {
            this.deviceFramed = true;
            this.followTruck(position, { animate: false });
        }
    }

    centerOnPosition() {
        if (!this.map) return;
        const point = window.DriverTelemetry && window.DriverTelemetry.lastPoint;
        const fix = window.DeviceLocation && window.DeviceLocation.last();
        const position = point ? point.coords : fix ? fix.coords : null;
        if (!position) {
            window.ui.toast('Sin posición GPS', 'warning', { description: 'Active la ubicación del teléfono o espere la señal.' });
            return;
        }
        if (this.truckMarker) this.truckMarker.setLatLng(position);
        else this.createTruckMarker(position);
        if (document.getElementById('live-nav-map-container')) {
            // «Recentrar»: vuelve a seguir al camión con zoom de calle.
            this.navFollow = true;
            this.syncRecenter();
            this.followTruck(position);
        } else {
            this.map.setView(position, Math.max(this.map.getZoom(), 12), { animate: true });
        }
    }

    drawGuidanceLine(geometry, discarded = []) {
        if (!this.map || !geometry || geometry.length < 2 || !document.getElementById('live-nav-map-container')) return;
        if (this.guidanceLayer) {
            try { this.map.removeLayer(this.guidanceLayer); } catch (e) { }
        }
        this.guidanceLines = this.routeLines(geometry);
        const alternatives = (discarded || []).filter(g => g && g.length > 1).map(g => L.polyline(g, {
            color: mapToken('--color-route-done', '#3A4049'), weight: 4, opacity: 0.9, dashArray: '6 8',
            lineCap: 'round', lineJoin: 'round', interactive: false
        }));
        this.guidanceLayer = L.layerGroup(alternatives.concat(this.guidanceLines.layers)).addTo(this.map);
        this.guidanceGeometry = geometry;
        if (this.truckMarker && !this.navGuidanceFramed) {
            this.navGuidanceFramed = true;
            if (this.navFollow) this.followTruck(this.truckMarker.getLatLng());
        }
    }

    driverPosition() {
        const state = window.store && window.store.state;
        const point = window.DriverTelemetry && window.DriverTelemetry.lastPoint;
        return state && state.activeRole === 'driver' && point && point.coords ? point.coords : null;
    }

    splitRoute(coords, position) {
        if (!position || !window.RouteGuidance) return { done: [], ahead: coords };
        const cos = Math.cos(position[0] * Math.PI / 180);
        let index = 0;
        let best = Infinity;
        coords.forEach((c, i) => {
            const d = ((c[0] - position[0]) ** 2) + ((c[1] - position[1]) * cos) ** 2;
            if (d < best) { best = d; index = i; }
        });
        if (Math.sqrt(best) * 111320 > window.RouteGuidance.OFF_ROUTE_M) return { done: [], ahead: coords };
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
            try { this.map.removeLayer(this.optimalRouteLayer); } catch (e) { }
            this.optimalRouteLayer = null;
        }

        const optimal = this.currentRoute();
        if (!optimal) return;

        const waypoints = optimal.waypoints;
        const routeKey = optimal.id;
        if (this.cachedRouteKey !== routeKey) {
            this.cachedOptimalRoadGeometry = null;
            this.cachedRouteKey = routeKey;
        }
        // La línea va por las vías: mientras llega la geometría (o si el servicio de rutas no responde) solo se ven las
        // paradas, nunca rectas entre ellas.
        const road = this.cachedOptimalRoadGeometry;
        this.routeProgressLines = road && road.length > 1 ? this.routeLines(road) : null;
        const lineLayers = this.routeProgressLines ? this.routeProgressLines.layers : [];
        const markers = waypoints.map((wp, index) => {
            const kind = index === 0 ? 'origin' : index === waypoints.length - 1 ? 'destination' : 'stop';
            return L.marker(wp.coords, { icon: ROUTE_PINS[kind](), title: wp.name || '' })
                .bindPopup('<b>' + window.ui.escape(wp.name) + '</b><br><span class="map-popup-sub">' + window.ui.escape(wp.instruction) + '</span>');
        });

        this.optimalRouteLayer = L.layerGroup(lineLayers.concat(markers)).addTo(this.map);

        if (!this.cachedOptimalRoadGeometry && !this.isFetchingRoute) {
            this.fetchRealRoadGeometry(waypoints, routeKey);
        }
    }

    useGuidedRoute(guided) {
        if (!guided || !guided.geometry || guided.geometry.length < 2) return;
        this.cachedOptimalRoadGeometry = guided.geometry;
        if (this.optimalRouteLayer && this.map) this.renderRoutes();
    }

    async fetchRealRoadGeometry(waypoints, routeKey) {
        const guided = window.RouteGuidance && window.RouteGuidance.route;
        if (guided && guided.choice) {
            this.useGuidedRoute(guided);
            return;
        }
        try {
            this.isFetchingRoute = true;
            const route = await window.TruckCarApi.routing.drivingRoute(waypoints.map(w => w.coords));
            if (this.cachedRouteKey === routeKey) {
                this.cachedOptimalRoadGeometry = route.geometry.coordinates.map(pt => [pt[1], pt[0]]);
                if (this.optimalRouteLayer && this.map) this.renderRoutes();
            }
        } catch (err) {
        } finally {
            this.isFetchingRoute = false;
        }
    }

    renderAlerts() {
        if (!this.map || !this.alertMarkersLayer) return;
        this.alertMarkersLayer.clearLayers();

        const alerts = window.TruckCarData.communityAlerts || [];
        alerts.filter(alert => alert.coords).forEach(alert => {
            const icon = { scale: 'fa-weight-hanging', bridge: 'fa-ruler-vertical', police: 'fa-shield-alt', rest: 'fa-mug-hot',
                workshop: 'fa-wrench', danger: 'fa-car-burst', traffic: 'fa-traffic-light' }[alert.type] || 'fa-triangle-exclamation';
            const tone = alert.type === 'rest' ? '' : ' is-warn';

            const alertIcon = L.divIcon({
                html: '<div class="alert-pin' + tone + '"><i class="fas ' + icon + '"></i></div>',
                className: 'community-alert-pin',
                iconSize: [28, 28],
                iconAnchor: [14, 14]
            });

            L.marker(alert.coords, { icon: alertIcon })
                .bindPopup('<b>' + window.ui.escape(alert.title) + '</b>' + (alert.description ? '<br>' + window.ui.escape(alert.description) : '')
                    + '<br><span class="text-xs">' + window.ui.escape(typeof alert.upvotes === 'number'
                        ? alert.upvotes + ' confirmaciones' : 'Confirmaciones: ' + window.ui.NOT_AVAILABLE) + '</span>')
                .addTo(this.alertMarkersLayer);
        });
    }

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
        const statusClass = truck.status === 'EN_TRANSITO' ? ' is-transit' : truck.status === 'DESCANSO' ? ' is-rest' : '';
        const heading = typeof truck.heading === 'number' ? truck.heading : null;
        const arrow = heading == null ? '' : `
            <i class="fas fa-location-arrow truck-heading fleet-heading"
               style="transform: rotate(${Math.round(heading - 45)}deg)"></i>`;
        return L.divIcon({
            html: `
                <div class="flex flex-col items-center">
                    <div class="fleet-pin${statusClass}">
                        <i class="fas fa-truck"></i>${arrow}
                    </div>
                    <span class="fleet-plate">${window.ui.escape(truck.plate)}</span>
                </div>`,
            className: 'fleet-truck-marker',
            iconSize: [60, 45],
            iconAnchor: [30, 20]
        });
    }

    fleetPopup(truck) {
        return '<b>' + window.ui.escape(truck.driverName) + ' (' + window.ui.escape(truck.plate) + ')</b><br>'
            + window.ui.escape(truck.vehicleType || '—') + '<br>Estado: <b>' + window.ui.escape(window.ui.statusLabel(truck.status)) + '</b> | '
            + window.ui.escape(window.ui.speedText(truck.speed)) + (typeof truck.heading === 'number' ? ' | Rumbo: ' + Math.round(truck.heading) + '°' : '');
    }

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

    moveFleetMarker(truck) {
        this.placeFleetMarker(truck, true);
    }

    animateMarker(marker, target, durationMs = 2500) {
        if (marker._truckcarAnimation) cancelAnimationFrame(marker._truckcarAnimation);
        const from = marker.getLatLng();
        const to = L.latLng(target);
        if (from.distanceTo(to) > 50000) {
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

    truckHeading() {
        // En la vista de conducción la flecha usa el mismo rumbo que gira el mapa (apunta siempre hacia arriba).
        if (this.navOversized && this.currentCoords) return this.navHeading(this.currentCoords);
        const point = window.DriverTelemetry && window.DriverTelemetry.lastPoint;
        return point && typeof point.heading === 'number' ? point.heading : null;
    }

    truckIcon(heading) {
        const html = heading == null
            ? '<span class="truck-dot" role="img" aria-label="Su posición"></span>'
            : '<span class="truck-arrow" role="img" aria-label="Su posición y rumbo" style="--heading:' + Math.round(heading)
                + 'deg"><svg aria-hidden="true"><use href="assets/icons.svg#heading"></use></svg></span>';
        return L.divIcon({ html, className: 'truck-pin', iconSize: [44, 44], iconAnchor: [22, 22] });
    }

    createTruckMarker(coords = this.currentCoords) {
        if (!this.map) return;
        if (this.truckMarker) {
            try { this.map.removeLayer(this.truckMarker); } catch(e) { }
        }

        const latLng = Array.isArray(coords) ? coords : [coords.lat, coords.lng];
        this.currentCoords = latLng;
        this.truckMarkerHeading = this.truckHeading();
        this.truckMarker = L.marker(latLng, { icon: this.truckIcon(this.truckMarkerHeading), zIndexOffset: 1000, keyboard: false }).addTo(this.map);
    }

    updateTruckHeading() {
        if (!this.truckMarker) return;
        const heading = this.truckHeading();
        const el = this.truckMarker.getElement && this.truckMarker.getElement();
        const arrow = el && el.querySelector('.truck-arrow');
        if (heading != null && arrow) arrow.style.setProperty('--heading', Math.round(heading) + 'deg');
        else if ((heading == null) !== (this.truckMarkerHeading == null)) this.truckMarker.setIcon(this.truckIcon(heading));
        this.truckMarkerHeading = heading;
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
        this.updateTruckHeading();
        this.refreshRouteProgress();

        if (this.map) {
            if (document.getElementById('live-nav-map-container')) {
                // Navegar: sigue al camión solo si el conductor no movió el mapa.
                if (this.navFollow) this.followTruck([lat, lng]);
                return;
            }
            const target = this.map.project([lat, lng]);
            this.map.panTo(this.map.unproject(target), { animate: true, duration: 0.8 });
        }
    }

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
            // En la vista de conducción parte del contenedor queda fuera de la pantalla: se encuadra en lo visible.
            const hidden = this.navOversized && this.navHidden ? this.navHidden : { left: 0, top: 0, right: 0, bottom: 0 };
            if (this.navOversized) this.applyNavRotation(null, { instant: true });
            this.map.fitBounds(L.latLngBounds(points), {
                paddingTopLeft: [40 + hidden.left, 40 + hidden.top],
                paddingBottomRight: [40 + hidden.right, 40 + hidden.bottom + this.bottomInset], animate: false });
        }
    }

    drawShipment(load, truck, { fit = true } = {}) {
        if (!this.map) return;
        if (this.shipmentLayer) {
            try { this.map.removeLayer(this.shipmentLayer); } catch (e) { }
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
        // La ruta va por las vías, nunca una recta entre origen y destino: si el servicio de rutas no responde, solo
        // se ven los pines.
        const roadKey = origin && destination ? origin.join(',') + '|' + destination.join(',') : null;
        const road = roadKey && this.shipmentRoads ? this.shipmentRoads[roadKey] : null;
        if (road) layers.unshift(this.shipmentRoadLine(road));
        else if (roadKey) this.fetchShipmentRoad(roadKey, origin, destination);
        if (truck && truck.coords) {
            this.shipmentTruckMarker = L.marker(truck.coords, { zIndexOffset: 1000, icon: this.shipmentTruckIcon(truck) })
                .bindPopup(this.shipmentTruckPopup(truck));
            layers.push(this.shipmentTruckMarker);
            points.push(truck.coords);
        }
        this.shipmentLayer = L.layerGroup(layers).addTo(this.map);
        this.shipmentLayer.roadKey = roadKey;
        if (!fit) return;
        if (points.length === 1) {
            this.map.setView(points[0], 10, { animate: false });
        } else if (points.length > 1) {
            this.map.fitBounds(L.latLngBounds(points), { padding: [36, 36], animate: false });
        }
    }

    shipmentRoadLine(geometry) {
        return L.polyline(geometry, { color: mapToken('--color-route', '#5AA2FF'), weight: 4, opacity: 0.9,
            lineCap: 'round', lineJoin: 'round', interactive: false });
    }

    /** Pide una vez la ruta por vías de un envío y la agrega al mapa si ese envío sigue en pantalla. */
    async fetchShipmentRoad(key, origin, destination) {
        this.shipmentRoads = this.shipmentRoads || {};
        this.shipmentRoadRequests = this.shipmentRoadRequests || {};
        const routing = window.TruckCarApi && window.TruckCarApi.routing;
        if (this.shipmentRoadRequests[key] || !routing || !routing.drivingRoute) return;
        this.shipmentRoadRequests[key] = true;
        try {
            const route = await routing.drivingRoute([origin, destination]);
            const geometry = route.geometry.coordinates.map(pt => [pt[1], pt[0]]);
            if (geometry.length < 2) return;
            this.shipmentRoads[key] = geometry;
            const layer = this.shipmentLayer;
            if (layer && this.map && this.map.hasLayer(layer) && layer.roadKey === key) {
                const line = this.shipmentRoadLine(geometry);
                layer.addLayer(line);
                line.bringToBack();
            }
        } catch (e) {
            // Sin ruta por vías no se dibuja nada: una recta engañaría sobre el recorrido.
        } finally {
            delete this.shipmentRoadRequests[key];
        }
    }

    shipmentTruckIcon(truck) {
        const heading = typeof truck.heading === 'number' ? truck.heading : null;
        const arrow = heading == null ? '' : `
            <i class="fas fa-location-arrow fleet-heading"
               style="transform: rotate(${Math.round(heading - 45)}deg)"></i>`;
        return L.divIcon({
            html: `<div class="fleet-pin is-transit"><i class="fas fa-truck-moving"></i>${arrow}</div>`,
            className: 'truck-pin', iconSize: [36, 36], iconAnchor: [18, 18]
        });
    }

    shipmentTruckPopup(truck) {
        const esc = window.ui.escape;
        return '<b>' + esc(truck.driverName) + ' (' + esc(truck.plate) + ')</b><br>' + esc(window.ui.statusLabel(truck.status)) + ' · '
            + esc(window.ui.speedText(truck.speed)) + ' · ' + esc(truck.lastCheckin);
    }

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
window.addEventListener('truckcar:themechange', (event) => {
    const layer = window.mapCtrl.baseTileLayer;
    if (!layer) return;
    if (layer.setTheme) layer.setTheme(event.detail.theme);
    else layer.setUrl(event.detail.theme === 'light' ? window.TruckCarConfig.map.lightTileUrl : window.TruckCarConfig.map.tileUrl);
});

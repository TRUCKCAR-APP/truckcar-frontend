function mapToken(name, fallback) {
    const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return value || fallback;
}

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
        if (this.sheetObserver) {
            this.sheetObserver.disconnect();
            this.sheetObserver = null;
        }
        this.bottomInset = 0;
        this.navFramed = false;
        this.navGuidanceFramed = false;
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
        this.baseTileLayer = L.tileLayer(theme === 'light' ? tiles.lightTileUrl : tiles.tileUrl, {
            maxZoom: tiles.maxZoom,
            attribution: tiles.attribution,
            crossOrigin: true
        }).addTo(this.map);

        this.alertMarkersLayer = L.layerGroup().addTo(this.map);
        this.fleetMarkersLayer = L.layerGroup().addTo(this.map);
        this.fleetMarkers = new Map();
        this.shipmentTruckMarker = null;
        this.mountKey = containerId;

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

    drawLiveNavigation(position) {
        if (!this.map) return;
        if (this.map.zoomControl) this.map.removeControl(this.map.zoomControl);
        this.renderRoutes();
        this.renderAlerts();
        this.guidanceLayer = null;
        const guided = window.RouteGuidance && window.RouteGuidance.route;
        if (guided) this.drawGuidanceLine(guided.geometry);
        if (position) {
            this.createTruckMarker(position);
            this.frameNextLeg(position);
        } else {
            this.truckMarker = null;
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
        if (document.getElementById('live-nav-map-container')) this.frameNextLeg(position);
        else this.map.setView(position, Math.max(this.map.getZoom(), 12), { animate: true });
    }

    drawGuidanceLine(geometry) {
        if (!this.map || !geometry || geometry.length < 2 || !document.getElementById('live-nav-map-container')) return;
        if (this.guidanceLayer) {
            try { this.map.removeLayer(this.guidanceLayer); } catch (e) { }
        }
        this.guidanceLines = this.routeLines(geometry);
        this.guidanceLayer = L.layerGroup(this.guidanceLines.layers).addTo(this.map);
        if (this.truckMarker && !this.navGuidanceFramed) {
            this.navGuidanceFramed = true;
            this.frameNextLeg(this.truckMarker.getLatLng());
        }
    }

    driverPosition() {
        const state = window.store && window.store.state;
        const point = window.DriverTelemetry && window.DriverTelemetry.lastPoint;
        return state && state.activeRole === 'driver' && point && point.coords ? point.coords : null;
    }

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

    async fetchRealRoadGeometry(waypoints, routeKey) {
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
                workshop: 'fa-wrench', danger: 'fa-car-burst' }[alert.type] || 'fa-triangle-exclamation';
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
            const inset = document.getElementById('live-nav-map-container') ? this.navInsets() : { top: 0, left: 0 };
            const target = this.map.project([lat, lng]).subtract([inset.left / 2, inset.top / 2]);
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
            this.map.fitBounds(L.latLngBounds(points), { paddingTopLeft: [40, 40], paddingBottomRight: [40, 40 + this.bottomInset], animate: false });
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
    const tiles = window.TruckCarConfig.map;
    if (window.mapCtrl.baseTileLayer) {
        window.mapCtrl.baseTileLayer.setUrl(event.detail.theme === 'light' ? tiles.lightTileUrl : tiles.tileUrl);
    }
});

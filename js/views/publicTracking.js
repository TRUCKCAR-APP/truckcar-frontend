/**
 * Seguimiento público de un envío (?track=<token>): lo abre el destinatario sin cuenta ni sesión.
 * GET /api/v1/loads/public-tracking/{token} cada 15 s; el backend responde 410 cuando el enlace venció, la carga se
 * canceló o pasaron 6 h desde la entrega. La vista no tiene datos personales: placa enmascarada y sin conductor.
 *
 * Mismo sistema que la app del conductor: mapa oscuro del proveedor de js/config.js (el Service Worker guarda sus
 * teselas), íconos Phosphor neutros, estado como texto con punto y textos de 14 px o más.
 */
window.PublicTracking = (function () {
    const esc = (value) => window.ui.escape(value);
    const icon = (name, cls = '') => `<svg class="ui-icon ${cls}" aria-hidden="true"><use href="assets/icons.svg#${name}"></use></svg>`;
    const spinner = '<span class="spinner" aria-hidden="true"></span>';
    const POLL_MS = 15000;
    const ZOOM = 13;

    let token = null;
    let timer = null;
    let map = null;
    let tileLayer = null;
    let marker = null;
    let last = null;
    let offline = false;

    function tokenFromUrl(search = window.location.search) {
        const value = new URLSearchParams(search).get('track');
        return value && /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(value) ? value : null;
    }

    function time(iso) {
        return iso ? new Date(iso).toLocaleString('es-CO', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : '';
    }

    function place(p) {
        return p ? [p.city, p.department].filter(Boolean).join(', ') : '';
    }

    function row(label, value) {
        return value ? `<div class="list-row"><span class="list-label">${esc(label)}</span><span class="list-value">${value}</span></div>` : '';
    }

    function step(done, name, label, at) {
        return `<li class="track-step${done ? ' is-done' : ''}">
            <span class="track-step-mark">${icon(name)}</span>
            <span class="track-step-text"><b>${esc(label)}</b>${at ? `<span>${esc(time(at))}</span>` : done ? '' : '<span>Todavía no</span>'}</span>
        </li>`;
    }

    function shell(inner) {
        return `<div class="public-track" data-screen><div class="public-track-col">${inner}</div></div>`;
    }

    function unavailableHtml(message) {
        return shell(`<section class="empty-state">
            <div class="empty-mark">${icon('x-circle')}</div>
            <h1 class="public-track-empty-title">Seguimiento no disponible</h1>
            <p>${esc(message)}</p>
            <p>Pida un enlace nuevo a quien le envió la carga.</p>
        </section>`);
    }

    function loadingHtml(message) {
        return shell(`<section class="empty-state" role="status"><div class="empty-mark">${spinner}</div><p>${esc(message)}</p></section>`);
    }

    function positionLine(v) {
        const transit = v.status === 'IN_TRANSIT';
        const delivered = v.status === 'DELIVERED';
        const lost = offline ? '<span class="status-sub"> · sin conexión, reintentando</span>' : '';
        if (v.position) {
            // La hora y la velocidad van en su propia línea: en el teléfono no se parten detrás de un "·" suelto.
            const when = [
                v.position.updatedAt ? 'Actualizada el ' + esc(time(v.position.updatedAt)) : '',
                v.position.speedKmH != null ? Math.round(v.position.speedKmH) + ' km/h' : ''
            ].filter(Boolean).join(' · ');
            return `<span class="dot ok" aria-hidden="true"></span><span>Posición en vivo</span>${lost}`
                + (when ? `<span class="public-track-when">${when}</span>` : '');
        }
        const text = transit ? 'Esperando la próxima posición del vehículo…'
            : delivered ? 'El envío llegó a su destino.'
                : 'La posición aparece cuando el vehículo inicie el viaje.';
        return `<span class="dot" aria-hidden="true"></span><span class="status-sub">${text}</span>${lost}`;
    }

    function viewHtml(v) {
        const live = v.status === 'IN_TRANSIT' || v.status === 'DELIVERED';
        const cargo = [v.cargoDescription, v.weightTons ? v.weightTons + ' t' : ''].filter(Boolean).join(' · ');
        return shell(`
            <header class="public-track-head">
                <p class="secondary">Seguimiento de envío</p>
                <h1 class="public-track-title">${esc(v.reference)}</h1>
                <p class="status-line" data-track-status><span class="dot${live ? ' ok' : ''}" aria-hidden="true"></span><span>${esc(v.statusLabel)}</span></p>
            </header>

            <div class="list">
                ${row('Origen', esc(place(v.origin)))}
                ${row('Destino', esc(place(v.destination)))}
                ${row('Carga', esc(cargo))}
                ${row('Vehículo', v.vehiclePlate ? `<span class="tnum">${esc(v.vehiclePlate)}</span>` : '')}
            </div>

            <section class="public-track-map-card" aria-label="Mapa del envío">
                <div id="public-track-map" class="public-track-map"></div>
                <p class="status-line public-track-position" data-track-position>${positionLine(v)}</p>
            </section>

            <h2 class="list-title">Avance del envío</h2>
            <ol class="list track-steps">
                ${step(true, 'package', 'Envío publicado', v.publishedAt)}
                ${step(!!v.assignedAt, 'user', 'Conductor asignado', v.assignedAt)}
                ${step(!!v.tripStartedAt, 'truck', 'En ruta', v.tripStartedAt)}
                ${step(v.status === 'DELIVERED', 'flag-checkered', 'Entregado', v.deliveredAt)}
            </ol>

            <p class="secondary public-track-foot">Enlace válido hasta el ${esc(time(v.expiresAt))} · TruckCar</p>`);
    }

    /** Centra el camión con el mapa ya medido: así no queda cortado por un borde. */
    function frameTruck() {
        if (!map) return;
        map.invalidateSize({ pan: false });
        if (marker) map.setView(marker.getLatLng(), map.getZoom() || ZOOM, { animate: false });
    }

    function createMap(el) {
        const tiles = window.TruckCarConfig.map;
        map = window.L.map(el, { zoomControl: false, attributionControl: false }).setView([4.6, -74.08], 6);
        // Atribución obligatoria y legible, como en la app del conductor.
        window.L.control.attribution({ position: 'bottomleft', prefix: false }).addTo(map);
        const theme = window.TruckCarTheme ? window.TruckCarTheme.getTheme() : 'dark';
        tileLayer = window.L.tileLayer(theme === 'light' ? tiles.lightTileUrl : tiles.tileUrl,
            { maxZoom: tiles.maxZoom, attribution: tiles.attribution, crossOrigin: true }).addTo(map);
        // El contenedor puede cambiar de tamaño después de crearse (fuentes, estilos, giro): se vuelve a medir y a
        // encuadrar el camión, una vez por cuadro.
        if (typeof ResizeObserver === 'function') {
            let frame = null;
            new ResizeObserver(() => {
                if (frame) return;
                frame = requestAnimationFrame(() => { frame = null; frameTruck(); });
            }).observe(el);
        }
    }

    function paintMap(v) {
        const el = document.getElementById('public-track-map');
        if (!el || !window.L) return;
        // El mapa se crea una vez y se reinserta en cada re-render: así no parpadea cada 15 s.
        if (map) el.replaceWith(map.getContainer());
        else createMap(el);
        if (v.position) {
            const at = [v.position.latitude, v.position.longitude];
            if (!marker) {
                marker = window.L.marker(at, {
                    keyboard: false,
                    icon: window.L.divIcon({ className: 'map-pin', html: `<div class="public-truck-pin">${icon('truck-fill')}</div>`, iconSize: [40, 40], iconAnchor: [20, 20] })
                }).addTo(map);
                map.setView(at, ZOOM, { animate: false });
            } else {
                marker.setLatLng(at);
            }
        } else if (marker) {
            marker.remove();
            marker = null;
        }
        frameTruck();
    }

    function paint(html) {
        const mount = document.getElementById('app-mount');
        if (!mount) return;
        mount.innerHTML = html;
        if (last) paintMap(last);
    }

    async function refresh() {
        try {
            last = await window.TruckCarApi.loads.publicTracking(token);
            offline = false;
            paint(viewHtml(last));
            if (last.status === 'DELIVERED') stopPolling();
        } catch (error) {
            if (error && (error.status === 410 || error.status === 404 || error.status === 400)) {
                stopPolling();
                last = null;
                paint(unavailableHtml(error.status === 410 && error.message ? error.message : 'El enlace no es válido o ya venció.'));
                return;
            }
            offline = true;
            paint(last ? viewHtml(last) : loadingHtml('No hay conexión con TruckCar. Reintentando…'));
        }
    }

    function stopPolling() {
        clearInterval(timer);
        timer = null;
    }

    /** Si la URL trae ?track=, monta la vista pública (sin login ni barra de roles) y devuelve true. */
    function maybeStart() {
        const hasParam = new URLSearchParams(window.location.search).has('track');
        if (!hasParam) return false;
        document.body.dataset.mode = 'public-tracking';
        document.title = 'Seguimiento de envío · TruckCar';
        token = tokenFromUrl();
        if (!token) {
            paint(unavailableHtml('El enlace está incompleto. Ábralo tal como lo recibió.'));
            return true;
        }
        paint(loadingHtml('Cargando el envío…'));
        refresh();
        timer = setInterval(refresh, POLL_MS);
        document.addEventListener('visibilitychange', () => { if (!document.hidden && timer) refresh(); });
        return true;
    }

    window.addEventListener('truckcar:themechange', (event) => {
        if (tileLayer) tileLayer.setUrl(event.detail.theme === 'light'
            ? window.TruckCarConfig.map.lightTileUrl : window.TruckCarConfig.map.tileUrl);
    });

    return { maybeStart, tokenFromUrl, refresh, stopPolling };
})();

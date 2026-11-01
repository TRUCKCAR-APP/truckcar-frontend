/**
 * Seguimiento público de un envío (?track=<token>): lo abre el destinatario sin cuenta ni sesión.
 * GET /api/v1/loads/public-tracking/{token} cada 15 s; el backend responde 410 cuando el enlace venció, la carga se
 * canceló o pasaron 6 h desde la entrega. La vista no tiene datos personales: placa enmascarada y sin conductor.
 */
window.PublicTracking = (function () {
    const esc = (value) => window.ui.escape(value);
    const POLL_MS = 15000;

    let token = null;
    let timer = null;
    let map = null;
    let marker = null;
    let last = null;
    let offline = false;

    function tokenFromUrl(search = window.location.search) {
        const value = new URLSearchParams(search).get('track');
        return value && /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(value) ? value : null;
    }

    function time(iso) {
        return iso ? new Date(iso).toLocaleString('es-CO', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '';
    }

    function place(p) {
        return p ? [p.city, p.department].filter(Boolean).join(', ') : '';
    }

    function step(done, icon, label, at) {
        return `<li class="flex items-center gap-3 ${done ? '' : 'opacity-45'}">
            <span class="w-8 h-8 shrink-0 rounded-full grid place-items-center ${done ? 'bg-brand-600/25 text-brand-300' : 'bg-slate-800 text-slate-500'}"><i class="fas ${icon} text-[12px]"></i></span>
            <div class="min-w-0"><b class="block text-[13px] text-slate-100">${esc(label)}</b>
                ${at ? `<span class="text-[11.5px] text-slate-400">${esc(time(at))}</span>` : ''}</div>
        </li>`;
    }

    function shell(inner) {
        return `<div class="h-full w-full overflow-y-auto bg-slate-950 text-slate-100" data-screen>
            <div class="max-w-xl mx-auto p-4 flex flex-col gap-3" style="padding-bottom: calc(1rem + var(--safe-bottom))">${inner}</div>
        </div>`;
    }

    function unavailableHtml(message) {
        return shell(`<div class="card p-6 text-center mt-8">
            <div class="w-14 h-14 mx-auto rounded-2xl bg-slate-800 grid place-items-center text-2xl text-slate-400"><i class="fas fa-link-slash"></i></div>
            <h1 class="text-lg font-extrabold mt-4">Seguimiento no disponible</h1>
            <p class="text-[13px] text-slate-400 mt-1.5 leading-snug">${esc(message)}</p>
            <p class="text-[12px] text-slate-500 mt-3">Pida un enlace nuevo a quien le envió la carga.</p>
        </div>`);
    }

    function viewHtml(v) {
        const transit = v.status === 'IN_TRANSIT';
        const delivered = v.status === 'DELIVERED';
        const updated = v.position && v.position.updatedAt ? time(v.position.updatedAt) : null;
        return shell(`
            <div class="card p-4">
                <div class="flex items-start justify-between gap-3">
                    <div class="min-w-0">
                        <span class="text-[11px] uppercase tracking-wide font-bold text-slate-400">Seguimiento de envío</span>
                        <h1 class="text-xl font-black font-mono tracking-tight">${esc(v.reference)}</h1>
                    </div>
                    <span data-track-status class="shrink-0 px-2.5 py-1 rounded-full text-[12px] font-bold border
                        ${delivered ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
                            : transit ? 'bg-brand-600/20 text-brand-300 border-brand-500/30'
                                : 'bg-slate-800 text-slate-300 border-slate-700'}">${esc(v.statusLabel)}</span>
                </div>
                <div class="mt-3 grid grid-cols-[auto,1fr] gap-x-3 gap-y-1 text-[13px]">
                    <i class="fas fa-circle-dot text-brand-400 mt-1"></i><span>${esc(place(v.origin))}</span>
                    <i class="fas fa-location-dot text-rose-400 mt-1"></i><span>${esc(place(v.destination))}</span>
                </div>
                <p class="mt-2 text-[12.5px] text-slate-400">${esc(v.cargoDescription || '')}${v.weightTons ? ' · ' + esc(v.weightTons) + ' t' : ''}${v.vehiclePlate ? ' · Vehículo <span class="font-mono">' + esc(v.vehiclePlate) + '</span>' : ''}</p>
            </div>

            <div class="card p-0 overflow-hidden">
                <div id="public-track-map" class="h-64 w-full bg-slate-900"></div>
                <p class="px-4 py-2.5 text-[12px] text-slate-400" data-track-position>
                    ${v.position
                        ? `<i class="fas fa-satellite-dish text-emerald-400"></i> Posición en vivo${updated ? ' · ' + esc(updated) : ''}${v.position.speedKmH != null ? ' · ' + Math.round(v.position.speedKmH) + ' km/h' : ''}`
                        : transit ? '<i class="fas fa-satellite-dish"></i> Esperando la próxima posición del vehículo…'
                            : delivered ? '<i class="fas fa-flag-checkered text-emerald-400"></i> El envío llegó a su destino.'
                                : '<i class="fas fa-clock"></i> La posición aparece cuando el vehículo inicie el viaje.'}
                    ${offline ? ' · <span class="text-amber-300">sin conexión, reintentando</span>' : ''}
                </p>
            </div>

            <ol class="card p-4 flex flex-col gap-3" aria-label="Avance del envío">
                ${step(true, 'fa-box', 'Envío publicado', v.publishedAt)}
                ${step(!!v.assignedAt, 'fa-handshake', 'Conductor asignado', v.assignedAt)}
                ${step(!!v.tripStartedAt, 'fa-truck-moving', 'En ruta', v.tripStartedAt)}
                ${step(delivered, 'fa-flag-checkered', 'Entregado', v.deliveredAt)}
            </ol>

            <p class="text-[11.5px] text-slate-500 text-center">Enlace válido hasta el ${esc(time(v.expiresAt))} · TruckCar</p>`);
    }

    function paintMap(v) {
        const el = document.getElementById('public-track-map');
        if (!el || !window.L) return;
        // El mapa se crea una vez y se reinserta en cada re-render: así no parpadea cada 15 s.
        if (map) {
            el.replaceWith(map.getContainer());
            map.invalidateSize();
        } else {
            map = window.L.map(el, { zoomControl: false, attributionControl: true }).setView([4.6, -74.08], 6);
            map.attributionControl.setPrefix(false);
            window.L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; OpenStreetMap' }).addTo(map);
        }
        if (v.position) {
            const at = [v.position.latitude, v.position.longitude];
            if (!marker) {
                marker = window.L.marker(at, {
                    icon: window.L.divIcon({ className: '', html: '<div class="public-truck-pin"><i class="fas fa-truck"></i></div>', iconSize: [36, 36], iconAnchor: [18, 18] })
                }).addTo(map);
                map.setView(at, 13);
            } else {
                marker.setLatLng(at);
                map.panTo(at);
            }
        } else if (marker) {
            marker.remove();
            marker = null;
        }
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
            paint(last ? viewHtml(last) : shell(`<div class="card p-6 text-center mt-8 text-[13px] text-slate-400">
                <i class="fas fa-circle-notch fa-spin text-brand-400 text-xl"></i>
                <p class="mt-3">No hay conexión con TruckCar. Reintentando…</p></div>`));
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
        paint(shell(`<div class="card p-6 text-center mt-8 text-[13px] text-slate-400">
            <i class="fas fa-circle-notch fa-spin text-brand-400 text-xl"></i><p class="mt-3">Cargando el envío…</p></div>`));
        refresh();
        timer = setInterval(refresh, POLL_MS);
        document.addEventListener('visibilitychange', () => { if (!document.hidden && timer) refresh(); });
        return true;
    }

    return { maybeStart, tokenFromUrl, refresh, stopPolling };
})();

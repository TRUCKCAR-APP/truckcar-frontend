// «Mi flota» de la empresa transportadora: dónde está cada uno de SUS conductores, si va en ruta, con carga o en
// descanso obligatorio, sus horas de manejo y su última señal. El servidor (fleets-drivers /company/fleet) solo entrega
// los conductores con la afiliación ACTIVA a la empresa de la cuenta: nunca los de otra empresa.
// El mapa vive en un contenedor propio que se conserva entre redibujos (la pantalla se repinta entera) y la flota se
// actualiza cada 15 s mientras la pestaña está abierta.
window.CompanyFleet = (function () {
    const esc = (value) => window.ui.escape(value);
    const POLL_MS = 15000;

    // Color de cada estado: el mismo significado que en la torre de control.
    const TONE = {
        EN_TRANSITO: { color: '#2f9e44', label: 'En ruta' },
        CON_CARGA: { color: '#1c7ed6', label: 'Con carga aceptada' },
        DESCANSO: { color: '#e8590c', label: 'Descanso obligatorio' },
        ACTIVO: { color: '#868e96', label: 'Disponible' },
        INACTIVO: { color: '#495057', label: 'Inactivo' }
    };

    let host = null;
    let map = null;
    let layer = null;
    let fitted = false;
    let timer = null;

    function tone(vehicle) {
        return TONE[vehicle.status] || { color: '#868e96', label: window.ui.statusLabel(vehicle.status) };
    }

    /** Conductores afiliados (ACTIVA) que todavía no han registrado su camión: no tienen posición ni estado. */
    function withoutVehicle() {
        const inFleet = new Set((window.TruckCarData.companyFleet || []).map(v => v.driverId));
        return (window.TruckCarData.companyDrivers || [])
            .filter(d => d.affiliationStatus === 'ACTIVA' && !inFleet.has(d.id));
    }

    function summary(fleet) {
        const count = (status) => fleet.filter(v => v.status === status).length;
        const card = (label, value, color) => `
            <div class="bg-slate-900 border border-slate-800 rounded-2xl px-4 py-3 min-w-0">
                <span class="text-xs text-slate-400 flex items-center gap-1.5"><span class="dot" style="background:${color}"></span>${label}</span>
                <span class="text-xl font-bold text-white font-mono block mt-0.5">${value}</span>
            </div>`;
        return `<div class="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4" data-company-fleet-summary>
            ${card('En ruta', count('EN_TRANSITO'), TONE.EN_TRANSITO.color)}
            ${card('Con carga aceptada', count('CON_CARGA'), TONE.CON_CARGA.color)}
            ${card('Descanso obligatorio', count('DESCANSO'), TONE.DESCANSO.color)}
            ${card('Disponibles', count('ACTIVO'), TONE.ACTIVO.color)}
        </div>`;
    }

    function hours(v) {
        if (!Number.isFinite(Number(v.remainingDrivingHours))) return v.hoursActive;
        return v.hoursActive + ' hoy · le quedan ' + Number(v.remainingDrivingHours).toLocaleString('es-CO', { maximumFractionDigits: 1 }) + ' h';
    }

    function row(v) {
        const t = tone(v);
        return `
            <li class="bg-slate-900 border border-slate-800 rounded-2xl p-3 min-w-0" data-company-fleet-driver="${esc(v.driverId)}">
                <button type="button" onclick="window.CompanyFleet.focus('${esc(v.driverId)}')" class="w-full text-left" ${v.coords ? '' : 'disabled'}>
                    <div class="flex items-start justify-between gap-3">
                        <div class="min-w-0">
                            <h3 class="font-bold text-sm text-white truncate">${esc(v.driverName)}</h3>
                            <p class="text-xs text-slate-400 truncate">${esc(v.plate || 'Sin placa')} · ${esc(v.vehicleType)}</p>
                        </div>
                        <span class="text-xs text-slate-200 whitespace-nowrap flex items-center gap-1.5"><span class="dot" style="background:${t.color}"></span>${esc(t.label)}</span>
                    </div>
                    <p class="text-xs text-slate-400 mt-2">${v.currentLoadId ? 'Carga #' + esc(v.currentLoadId) + ' · ' : ''}${esc(hours(v))}</p>
                    <p class="text-xs text-slate-500 mt-0.5">${v.coords ? 'Última señal ' + esc(String(v.lastCheckin).toLowerCase()) + (Number.isFinite(v.speed) ? ' · ' + v.speed + ' km/h' : '') : 'Sin posición reportada'}</p>
                </button>
            </li>`;
    }

    function render(state) {
        const fleet = window.TruckCarData.companyFleet;
        const errors = (state.dataStatus && state.dataStatus.errors) || {};
        if (!fleet && errors.companyFleet) {
            return `<div class="text-center py-16 px-4"><i class="fas fa-triangle-exclamation text-2xl text-slate-400"></i>
                <h2 class="font-bold text-white mt-3">No se pudo cargar su flota</h2>
                <p class="text-sm text-slate-400 mt-1">${esc(errors.companyFleet)}</p>
                <button onclick="window.CompanyFleet.refresh()" class="mt-4 px-4 py-2 bg-slate-800 rounded-xl text-xs font-bold">Reintentar</button></div>`;
        }
        if (!fleet) {
            return '<div class="text-center py-16 text-sm text-slate-400"><i class="fas fa-spinner fa-spin"></i> Cargando su flota…</div>';
        }
        const pending = withoutVehicle();
        const sorted = [...fleet].sort((a, b) => a.driverName.localeCompare(b.driverName, 'es'));
        return `
            ${summary(fleet)}
            <div class="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
                <div class="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden h-[52vh] min-h-[320px]" data-company-fleet-map-slot></div>
                <div class="min-w-0">
                    <h2 class="font-bold text-white mb-1">Sus conductores</h2>
                    <p class="text-xs text-slate-400 mb-3">Solo los afiliados a su empresa. Se actualiza cada 15 segundos.</p>
                    ${sorted.length ? `<ul class="grid gap-2" aria-label="Conductores de la empresa">${sorted.map(row).join('')}</ul>`
                        : '<p class="text-sm text-slate-400 bg-slate-900 border border-slate-800 rounded-2xl p-4">Ninguno de sus conductores ha registrado su camión todavía. Cuando lo hagan desde la app, aparecerán aquí con su posición.</p>'}
                    ${pending.length ? `<p class="text-xs text-slate-400 mt-3">Sin camión registrado: ${pending.map(d => esc([d.firstName, d.lastName].filter(Boolean).join(' ') || d.email)).join(', ')}.</p>` : ''}
                </div>
            </div>`;
    }

    function ensureMap() {
        if (map) return;
        host = document.createElement('div');
        host.className = 'w-full h-full';
        host.setAttribute('aria-label', 'Mapa de la flota de la empresa');
        map = window.L.map(host, { center: [4.6097, -74.0817], zoom: 6, zoomControl: true });
        window.TruckCarConfig.map.layer(document.documentElement.dataset.theme === 'light' ? 'light' : 'dark').addTo(map);
        layer = window.L.layerGroup().addTo(map);
    }

    function drawMarkers() {
        if (!map) return;
        layer.clearLayers();
        const points = [];
        for (const v of window.TruckCarData.companyFleet || []) {
            if (!v.coords) continue;
            const t = tone(v);
            window.L.circleMarker(v.coords, { radius: 9, color: '#ffffff', weight: 2, fillColor: t.color, fillOpacity: 1 })
                .bindTooltip(v.driverName + ' · ' + (v.plate || '') + ' · ' + t.label, { direction: 'top' })
                .addTo(layer);
            points.push(v.coords);
        }
        if (points.length && !fitted) {
            map.fitBounds(points, { padding: [40, 40], maxZoom: 12 });
            fitted = true;
        }
    }

    /** Después de cada redibujo: el mapa vuelve a su lugar y se actualizan los marcadores. */
    function mount() {
        const slot = document.querySelector('[data-company-fleet-map-slot]');
        if (!slot) return;
        ensureMap();
        if (host.parentElement !== slot) slot.appendChild(host);
        map.invalidateSize();
        drawMarkers();
    }

    function focus(driverId) {
        const v = (window.TruckCarData.companyFleet || []).find(x => x.driverId === driverId);
        if (v && v.coords && map) map.setView(v.coords, 13);
    }

    async function refresh() {
        await window.TruckCarService.loadCompanyFleet();
        window.store.setState({});
    }

    function startPolling() {
        if (timer) return;
        timer = setInterval(() => {
            const s = window.store.state;
            if (!s.isAuthenticated || s.activeRole !== 'company' || (s.companyTab || 'fleet') !== 'fleet') {
                stopPolling();
                return;
            }
            refresh();
        }, POLL_MS);
    }

    function stopPolling() {
        clearInterval(timer);
        timer = null;
    }

    return { render, mount, focus, refresh, startPolling, stopPolling, TONE };
})();

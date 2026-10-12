/**
 * Panel del generador de carga (rol COORDINADOR): publicar cargas y seguir sus envíos.
 * La empresa generadora es el usuario autenticado: el backend fija generatorCompanyId = X-Auth-User.
 */
window.GeneratorPanel = (function () {
    /** Ciudades con su departamento y coordenadas: el backend exige latitud y longitud de origen y destino. */
    const CITIES = [
        ['Bogotá', 'Cundinamarca', 4.6097, -74.0817], ['Medellín', 'Antioquia', 6.2442, -75.5812],
        ['Cali', 'Valle del Cauca', 3.4516, -76.5320], ['Barranquilla', 'Atlántico', 10.9685, -74.7813],
        ['Cartagena', 'Bolívar', 10.3910, -75.4794], ['Bucaramanga', 'Santander', 7.1193, -73.1227],
        ['Cúcuta', 'Norte de Santander', 7.8939, -72.5078], ['Pereira', 'Risaralda', 4.8133, -75.6961],
        ['Manizales', 'Caldas', 5.0703, -75.5138], ['Armenia', 'Quindío', 4.5339, -75.6811],
        ['Ibagué', 'Tolima', 4.4389, -75.2322], ['Villavicencio', 'Meta', 4.1420, -73.6266],
        ['Tunja', 'Boyacá', 5.5353, -73.3678], ['Sogamoso', 'Boyacá', 5.7146, -72.9339],
        ['Neiva', 'Huila', 2.9273, -75.2819], ['Santa Marta', 'Magdalena', 11.2408, -74.1990],
        ['Buenaventura', 'Valle del Cauca', 3.8801, -77.0312], ['Pasto', 'Nariño', 1.2136, -77.2811],
        ['Montería', 'Córdoba', 8.7479, -75.8814], ['Valledupar', 'Cesar', 10.4631, -73.2532]
    ].map(([city, department, latitude, longitude]) => ({ city, department, latitude, longitude }));

    const TRUCK_TYPES = [
        ['TRACTOMULA_3S3', 'Tractomula 3S3'], ['MINIMULA', 'Minimula'], ['DOBLETROQUE', 'Doble troque'],
        ['CUATRO_MANOS', 'Cuatro manos'], ['SENCILLO', 'Sencillo'], ['TURBO', 'Turbo'], ['REFRIGERADO', 'Refrigerado']
    ];

    /** Status visible para el generador: mientras la carga está AVAILABLE manda el estado de la asignación. */
    const STATUS = {
        AVAILABLE: { label: 'AVAILABLE', text: 'Buscando conductor', style: 'bg-sky-500/15 text-sky-300 border-sky-500/40' },
        PROPOSED: { label: 'PROPOSED', text: 'Propuesta a conductor', style: 'bg-amber-500/15 text-amber-300 border-amber-500/40' },
        NOTIFIED: { label: 'NOTIFIED', text: 'Conductor notificado', style: 'bg-orange-500/15 text-orange-300 border-orange-500/40' },
        NO_DRIVERS: { label: 'SIN CONDUCTOR', text: 'Sin conductores elegibles', style: 'bg-rose-500/15 text-rose-300 border-rose-500/40' },
        ASSIGNED: { label: 'ASSIGNED', text: 'Aceptada por el conductor', style: 'bg-indigo-500/15 text-indigo-300 border-indigo-500/40' },
        IN_TRANSIT: { label: 'IN_TRANSIT', text: 'En ruta', style: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40' },
        DELIVERED: { label: 'DELIVERED', text: 'Entregada', style: 'bg-teal-500/20 text-teal-200 border-teal-400/50' },
        CANCELLED: { label: 'CANCELLED', text: 'Cancelada', style: 'bg-slate-600/30 text-slate-300 border-slate-500/50' }
    };
    const FILTERS = ['ALL', 'AVAILABLE', 'PROPOSED', 'NOTIFIED', 'ASSIGNED', 'IN_TRANSIT', 'DELIVERED', 'CANCELLED'];

    function statusKey(load) {
        if (load.status !== 'AVAILABLE') return STATUS[load.status] ? load.status : 'AVAILABLE';
        if (load.assignmentStatus === 'PROPOSED' || load.assignmentStatus === 'NOTIFIED') return load.assignmentStatus;
        if (load.assignmentStatus === 'UNASSIGNED_NO_DRIVERS') return 'NO_DRIVERS';
        return 'AVAILABLE';
    }

    /** Los filtros agrupan "sin conductor" con AVAILABLE: ambos siguen esperando asignación. */
    function filterKey(load) {
        const key = statusKey(load);
        return key === 'NO_DRIVERS' ? 'AVAILABLE' : key;
    }

    /**
     * Conductor vigente: el de una propuesta activa o el que aceptó la carga. Tras un rechazo o vencimiento
     * la carga conserva el último conductor propuesto, que ya no corresponde mostrar.
     */
    function currentDriver(load) {
        const key = statusKey(load);
        const relevant = ['PROPOSED', 'NOTIFIED', 'ASSIGNED', 'IN_TRANSIT', 'DELIVERED'].includes(key)
            || (key === 'CANCELLED' && load.assignmentStatus === 'ACCEPTED');
        return relevant && load.assignedDriverName
            ? { name: load.assignedDriverName, plate: load.assignedVehiclePlate }
            : null;
    }

    function badge(load) {
        const status = STATUS[statusKey(load)];
        return `<span class="px-2 py-0.5 border rounded-md text-[10px] font-mono font-bold whitespace-nowrap ${status.style}" title="${status.text}">${status.label}</span>`;
    }

    function formatDate(value) {
        return window.PodUI.formatDate(value);
    }

    function cityOptions(selected) {
        return CITIES.map(c => `<option value="${c.city}" ${c.city === selected ? 'selected' : ''}>${c.city} · ${c.department}</option>`).join('');
    }

    function renderForm(state) {
        const esc = window.ui.escape;
        const d = window.generatorCtrl.draft();
        const busy = state.busyAction === 'publish';
        return `
            <form onsubmit="event.preventDefault(); window.generatorCtrl.publish()" oninput="window.generatorCtrl.updateDraft(event)" onchange="window.generatorCtrl.updateDraft(event)"
                  class="bg-slate-900 border border-slate-800 rounded-2xl p-4 flex flex-col gap-3 shadow-xl overflow-y-auto" novalidate>
                <div class="flex items-center gap-2 border-b border-slate-800 pb-2.5">
                    <i class="fas fa-square-plus text-emerald-400"></i>
                    <h2 class="font-extrabold text-sm text-white">Publicar nueva carga</h2>
                </div>
                <label class="text-[11px] space-y-1">
                    <span class="font-bold text-slate-300">Empresa generadora</span>
                    <input name="generatorCompanyName" value="${esc(d.generatorCompanyName)}" maxlength="120" class="login-input w-full text-xs" placeholder="Nombre de la empresa">
                </label>
                <label class="text-[11px] space-y-1">
                    <span class="font-bold text-slate-300">Descripción de la carga <span class="text-rose-400">*</span></span>
                    <input name="cargoDescription" value="${esc(d.cargoDescription)}" maxlength="255" class="login-input w-full text-xs" placeholder="Ej. Cemento ensacado, 600 bultos">
                </label>
                <div class="grid grid-cols-2 gap-2">
                    <label class="text-[11px] space-y-1">
                        <span class="font-bold text-slate-300">Peso (t) <span class="text-rose-400">*</span></span>
                        <input name="weightTons" type="number" min="0.1" step="0.1" value="${esc(d.weightTons)}" class="login-input w-full text-xs" placeholder="30">
                    </label>
                    <label class="text-[11px] space-y-1">
                        <span class="font-bold text-slate-300">Volumen (m³)</span>
                        <input name="volumeM3" type="number" min="0" step="0.1" value="${esc(d.volumeM3)}" class="login-input w-full text-xs" placeholder="Opcional">
                    </label>
                </div>
                <label class="text-[11px] space-y-1">
                    <span class="font-bold text-slate-300">Tipo de camión requerido <span class="text-rose-400">*</span></span>
                    <select name="requiredTruckType" class="login-input w-full text-xs">
                        ${TRUCK_TYPES.map(([value, text]) => `<option value="${value}" ${value === d.requiredTruckType ? 'selected' : ''}>${text}</option>`).join('')}
                    </select>
                </label>
                <div class="grid grid-cols-2 gap-2">
                    <label class="text-[11px] space-y-1">
                        <span class="font-bold text-slate-300">Origen <span class="text-rose-400">*</span></span>
                        <select name="originCity" class="login-input w-full text-xs">${cityOptions(d.originCity)}</select>
                    </label>
                    <label class="text-[11px] space-y-1">
                        <span class="font-bold text-slate-300">Destino <span class="text-rose-400">*</span></span>
                        <select name="destinationCity" class="login-input w-full text-xs">${cityOptions(d.destinationCity)}</select>
                    </label>
                </div>
                <label class="text-[11px] space-y-1">
                    <span class="font-bold text-slate-300">Presupuesto ofrecido (COP) <span class="text-rose-400">*</span></span>
                    <input name="offeredBudget" type="number" min="1000" step="1000" value="${esc(d.offeredBudget)}" class="login-input w-full text-xs" placeholder="5000000">
                </label>
                ${state.generatorFormError ? `<p class="text-[11px] text-rose-300 bg-rose-500/10 border border-rose-500/30 rounded-xl p-2">${esc(state.generatorFormError)}</p>` : ''}
                <button type="submit" ${busy ? 'disabled' : ''} class="w-full py-2.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-60 text-white rounded-xl text-xs font-bold transition">
                    <i class="fas ${busy ? 'fa-spinner fa-spin' : 'fa-paper-plane'}"></i> Publicar carga
                </button>
                <p class="text-[10px] text-slate-500 leading-snug">Al publicarla, el motor de asignación busca automáticamente un conductor disponible.</p>
            </form>
        `;
    }

    function renderBoard(state, loads) {
        const esc = window.ui.escape;
        const filter = state.shipmentFilter || 'ALL';
        const counts = FILTERS.reduce((acc, key) => {
            acc[key] = key === 'ALL' ? loads.length : loads.filter(l => filterKey(l) === key).length;
            return acc;
        }, {});
        const visible = filter === 'ALL' ? loads : loads.filter(l => filterKey(l) === filter);
        const selectedId = state.selectedShipmentId;
        return `
            <div class="bg-slate-900 border border-slate-800 rounded-2xl p-4 flex flex-col gap-3 shadow-xl overflow-hidden">
                <div class="flex items-center justify-between">
                    <div class="flex items-center gap-2">
                        <i class="fas fa-boxes-stacked text-indigo-400"></i>
                        <h2 class="font-extrabold text-sm text-white">Mis envíos</h2>
                    </div>
                    <button onclick="window.generatorCtrl.refresh()" class="text-slate-400 hover:text-emerald-400 text-xs" title="Actualizar ahora">
                        <i class="fas fa-rotate ${state.dataStatus.loading ? 'fa-spin' : ''}"></i>
                    </button>
                </div>
                <div class="flex flex-wrap gap-1.5" role="group" aria-label="Filtrar por estado">
                    ${FILTERS.map(key => `
                        <button onclick="window.generatorCtrl.setFilter('${key}')" aria-pressed="${filter === key}"
                                class="px-2 py-1 rounded-lg text-[10px] font-bold border transition ${filter === key ? 'bg-emerald-600 border-emerald-500 text-white' : 'bg-slate-800/60 border-slate-700 text-slate-300 hover:bg-slate-800'}">
                            ${key === 'ALL' ? 'Todos' : key} <span class="font-mono opacity-80">${counts[key]}</span>
                        </button>
                    `).join('')}
                </div>
                <div class="flex-1 overflow-y-auto space-y-2 pr-1">
                    ${visible.length ? visible.map(l => `
                        <button onclick="window.generatorCtrl.select(${l.backendId})"
                                class="w-full text-left p-3 rounded-xl border transition ${l.backendId === selectedId ? 'bg-indigo-950/40 border-indigo-500/60' : 'bg-slate-800/40 border-slate-700/50 hover:bg-slate-800'}">
                            <div class="flex items-center justify-between gap-2">
                                <span class="font-mono text-[11px] font-bold text-slate-300">${esc(l.id)}</span>
                                ${badge(l)}
                            </div>
                            <div class="text-xs font-bold text-white mt-1 truncate">${esc(l.cargoType)}</div>
                            <div class="flex items-center justify-between gap-2 text-[10px] text-slate-400 mt-0.5">
                                <span class="truncate">${esc(l.origin.city)} → ${esc(l.destination.city)} · ${esc(l.netWeight)} t</span>
                                <span class="shrink-0">${esc(currentDriver(l) ? currentDriver(l).name : l.scheduledDeparture)}</span>
                            </div>
                        </button>
                    `).join('') : `
                        <div class="p-6 rounded-xl border border-dashed border-slate-700 text-xs text-slate-400 text-center">
                            <i class="fas fa-inbox text-lg mb-1 block"></i>
                            ${loads.length ? 'No hay envíos con este estado.' : 'Aún no ha publicado cargas. Use el formulario para publicar la primera.'}
                        </div>
                    `}
                </div>
            </div>
        `;
    }

    function timelineItem(done, icon, title, when, extra) {
        const esc = window.ui.escape;
        return `
            <li class="flex gap-2.5">
                <span class="w-6 h-6 shrink-0 rounded-full flex items-center justify-center text-[10px] ${done ? 'bg-emerald-500 text-slate-950' : 'bg-slate-800 text-slate-500 border border-slate-700'}"><i class="fas ${icon}"></i></span>
                <div class="text-[11px] leading-tight pt-0.5">
                    <div class="font-bold ${done ? 'text-white' : 'text-slate-500'}">${title}</div>
                    <div class="text-slate-400">${done && when ? esc(formatDate(when)) : done ? '' : 'Pendiente'}${extra ? ' · ' + esc(extra) : ''}</div>
                </div>
            </li>
        `;
    }

    function renderDetail(state, load, truck) {
        const esc = window.ui.escape;
        if (!load) {
            return `
                <div class="bg-slate-900 border border-slate-800 rounded-2xl p-6 flex flex-col items-center justify-center text-center text-xs text-slate-400 shadow-xl">
                    <i class="fas fa-hand-pointer text-lg mb-2"></i>
                    Seleccione un envío para ver su detalle, su seguimiento en el mapa y la prueba de entrega.
                </div>
            `;
        }
        const status = STATUS[statusKey(load)];
        const cancelled = load.status === 'CANCELLED';
        const assigned = ['ASSIGNED', 'IN_TRANSIT', 'DELIVERED'].includes(load.status);
        return `
            <div class="bg-slate-900 border border-slate-800 rounded-2xl p-4 flex flex-col gap-3 shadow-xl overflow-y-auto">
                <div class="flex items-start justify-between gap-2">
                    <div class="min-w-0">
                        <div class="font-mono text-[11px] text-slate-400">${esc(load.id)}</div>
                        <h3 class="font-extrabold text-sm text-white truncate">${esc(load.cargoType)}</h3>
                        <p class="text-[11px] text-slate-400">${status.text}</p>
                    </div>
                    ${badge(load)}
                </div>
                <div id="generator-map-container" class="h-44 rounded-xl overflow-hidden border border-slate-800 shrink-0" aria-label="Mapa del envío"></div>
                ${truck && truck.coords && (load.status === 'ASSIGNED' || load.status === 'IN_TRANSIT')
                    ? `<p class="text-[10px] text-emerald-300"><i class="fas fa-location-crosshairs"></i> ${esc(truck.plate)} · ${truck.speed} km/h · posición ${esc(truck.lastCheckin)}</p>` : ''}
                <div class="grid grid-cols-2 gap-x-3 gap-y-1.5 text-[11px]">
                    <div><span class="text-slate-500 block">Trayecto</span><b class="text-white">${esc(load.origin.city)} → ${esc(load.destination.city)}</b></div>
                    <div><span class="text-slate-500 block">Peso / camión</span><b class="text-white">${esc(load.netWeight)} t · ${esc(load.requiredTruckType)}</b></div>
                    <div><span class="text-slate-500 block">Presupuesto</span><b class="text-white">${esc(load.freightPayment)}</b></div>
                    <div><span class="text-slate-500 block">Conductor</span><b class="text-white">${esc(currentDriver(load) ? currentDriver(load).name : '—')}</b>${currentDriver(load) && currentDriver(load).plate ? ` <span class="font-mono text-slate-400">${esc(currentDriver(load).plate)}</span>` : ''}</div>
                </div>
                <ol class="space-y-2 border-t border-slate-800 pt-3" aria-label="Seguimiento del envío">
                    ${timelineItem(true, 'fa-upload', 'Publicada', load.publishedAt)}
                    ${cancelled
                        ? timelineItem(true, 'fa-ban', 'Cancelada', load.cancelledAt, load.cancellationReason)
                        : timelineItem(assigned, 'fa-handshake', 'Aceptada por el conductor', load.assignedAt)
                            + timelineItem(!!load.tripStartedAt, 'fa-truck-moving', 'En ruta', load.tripStartedAt)
                            + timelineItem(load.status === 'DELIVERED', 'fa-flag-checkered', 'Entregada', load.deliveredAt,
                                load.podReceiverName ? 'recibió ' + load.podReceiverName : '')}
                </ol>
                <div class="flex flex-col gap-2 pt-1">
                    ${load.status === 'DELIVERED' ? `
                        <button onclick="window.generatorCtrl.showProofOfDelivery(${load.backendId})" class="w-full py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-bold">
                            <i class="fas fa-file-signature"></i> Ver prueba de entrega (POD)
                        </button>` : ''}
                    ${load.status === 'AVAILABLE' || load.status === 'ASSIGNED' ? `
                        <button onclick="window.generatorCtrl.cancel(${load.backendId})" ${state.busyAction === 'cancel' ? 'disabled' : ''} class="w-full py-2 bg-rose-600/20 hover:bg-rose-600/30 disabled:opacity-60 text-rose-300 border border-rose-500/40 rounded-xl text-xs font-bold">
                            <i class="fas ${state.busyAction === 'cancel' ? 'fa-spinner fa-spin' : 'fa-ban'}"></i> Cancelar envío
                        </button>` : ''}
                </div>
            </div>
        `;
    }

    function selectedLoad(state) {
        const loads = window.TruckDarData.publishedLoads || [];
        return loads.find(l => l.backendId === state.selectedShipmentId) || null;
    }

    /** Camión a seguir en el mapa: solo mientras la carga está aceptada o en ruta. */
    function truckFor(load) {
        if (!load || !load.assignedDriverId || !['ASSIGNED', 'IN_TRANSIT'].includes(load.status)) return null;
        const tracked = (window.TruckDarData.shipmentTrucks || {})[load.assignedDriverId];
        return tracked || (window.TruckDarData.fleetVehicles || []).find(t => t.driverId === load.assignedDriverId) || null;
    }

    function render(state) {
        const esc = window.ui.escape;
        const loads = window.TruckDarData.publishedLoads || [];
        const load = selectedLoad(state);
        const user = state.currentUser;
        const active = loads.filter(l => ['ASSIGNED', 'IN_TRANSIT'].includes(l.status)).length;
        const delivered = loads.filter(l => l.status === 'DELIVERED').length;
        return `
            <div class="h-full w-full flex flex-col bg-slate-950 text-slate-100 overflow-hidden font-sans">
                <header class="h-16 px-6 bg-slate-900 border-b border-slate-800 flex items-center justify-between z-30 shrink-0 gap-4">
                    <div class="flex items-center gap-3 min-w-0">
                        <div class="w-10 h-10 rounded-xl bg-gradient-to-tr from-indigo-600 to-sky-500 flex items-center justify-center text-white shadow-lg">
                            <i class="fas fa-industry text-lg"></i>
                        </div>
                        <div class="min-w-0">
                            <h1 class="text-base font-extrabold text-white tracking-tight">PANEL DEL GENERADOR DE CARGA</h1>
                            <p class="text-xs text-slate-400 truncate">Actualización automática · última ${state.dataStatus.lastSync ? new Date(state.dataStatus.lastSync).toLocaleTimeString('es-CO') : '—'}</p>
                        </div>
                    </div>
                    ${state.sessionRole === 'GENERADOR' ? '' : window.CoordinatorPanel.renderTabs(state)}
                    <div class="flex items-center gap-3">
                        <div class="px-3 py-1.5 bg-slate-800/80 border border-slate-700/60 rounded-xl text-center">
                            <span class="text-[10px] uppercase text-slate-400 font-bold block">En curso</span>
                            <span class="text-sm font-black text-emerald-400 font-mono">${active}</span>
                        </div>
                        <div class="px-3 py-1.5 bg-slate-800/80 border border-slate-700/60 rounded-xl text-center">
                            <span class="text-[10px] uppercase text-slate-400 font-bold block">Entregadas</span>
                            <span class="text-sm font-black text-teal-300 font-mono">${delivered}</span>
                        </div>
                        <div class="text-xs font-bold text-slate-200 pl-3 border-l border-slate-800">${esc(user ? user.firstName + ' ' + user.lastName : 'Generador')}</div>
                        <button onclick="window.app.logout()" class="text-slate-400 hover:text-rose-400 text-xs" title="Cerrar sesión"><i class="fas fa-right-from-bracket"></i></button>
                    </div>
                </header>
                ${window.ui.syncBanner(state)}
                <div class="flex-1 grid grid-cols-12 gap-4 p-4 overflow-hidden">
                    <div class="col-span-3 flex flex-col overflow-hidden">${renderForm(state)}</div>
                    <div class="col-span-5 flex flex-col overflow-hidden">${renderBoard(state, loads)}</div>
                    <div class="col-span-4 flex flex-col overflow-hidden">${renderDetail(state, load, truckFor(load))}</div>
                </div>
            </div>
        `;
    }

    return { render, selectedLoad, truckFor, CITIES };
})();

window.generatorCtrl = (function () {
    let draft = null;
    let companyEdited = false;

    function defaultDraft() {
        const user = window.store.state.currentUser;
        let company = '';
        try { company = localStorage.getItem('truckdar.generatorCompanyName') || ''; } catch (e) { /* sin almacenamiento */ }
        return {
            generatorCompanyName: company || (user ? (user.firstName + ' ' + user.lastName).trim() : ''),
            cargoDescription: '', weightTons: '', volumeM3: '', requiredTruckType: 'TRACTOMULA_3S3',
            originCity: 'Bogotá', destinationCity: 'Cali', offeredBudget: ''
        };
    }

    const city = (name) => window.GeneratorPanel.CITIES.find(c => c.city === name);

    return {
        /** Borrador del formulario: sobrevive a los re-render del refresco automático. */
        draft() {
            if (!draft) draft = defaultDraft();
            // El perfil puede llegar después del primer render (p. ej. justo tras registrarse).
            if (!draft.generatorCompanyName && !companyEdited) {
                draft.generatorCompanyName = defaultDraft().generatorCompanyName;
            }
            return draft;
        },

        updateDraft(event) {
            const target = event.target;
            if (target && target.name && this.draft().hasOwnProperty(target.name)) {
                draft[target.name] = target.value;
                if (target.name === 'generatorCompanyName') companyEdited = true;
            }
        },

        async publish() {
            const d = this.draft();
            const origin = city(d.originCity);
            const destination = city(d.destinationCity);
            const weight = Number(d.weightTons);
            const budget = Number(d.offeredBudget);
            const error =
                !d.cargoDescription.trim() ? 'Describa la carga.' :
                !(weight > 0) ? 'El peso debe ser mayor a 0 toneladas.' :
                !origin || !destination ? 'Seleccione el origen y el destino.' :
                origin === destination ? 'El origen y el destino deben ser distintos.' :
                !(budget >= 1000) ? 'El presupuesto mínimo es 1.000 COP.' : null;
            if (error) {
                window.store.setState({ generatorFormError: error });
                return;
            }
            const user = window.store.state.currentUser;
            const companyName = d.generatorCompanyName.trim() || (user ? user.firstName + ' ' + user.lastName : 'Generador');
            window.store.setState({ busyAction: 'publish', generatorFormError: null });
            try {
                const created = await window.TruckDarService.publishLoad({
                    // El backend reemplaza este valor por el id del usuario autenticado (X-Auth-User).
                    generatorCompanyId: user ? user.id : undefined,
                    generatorCompanyName: companyName,
                    cargoDescription: d.cargoDescription.trim(),
                    weightTons: weight,
                    volumeM3: d.volumeM3 === '' ? null : Number(d.volumeM3),
                    requiredTruckType: d.requiredTruckType,
                    originCity: origin.city, originDepartment: origin.department,
                    originLatitude: origin.latitude, originLongitude: origin.longitude,
                    destinationCity: destination.city, destinationDepartment: destination.department,
                    destinationLatitude: destination.latitude, destinationLongitude: destination.longitude,
                    offeredBudget: budget
                });
                try { localStorage.setItem('truckdar.generatorCompanyName', companyName); } catch (e) { /* sin almacenamiento */ }
                draft = { ...defaultDraft(), requiredTruckType: d.requiredTruckType, originCity: d.originCity, destinationCity: d.destinationCity };
                window.store.setState({ busyAction: null, selectedShipmentId: created.backendId, shipmentFilter: 'ALL' });
                window.ui.toast(created.id + ' publicada. El motor de asignación ya busca conductor.', 'success');
                // El matching es asíncrono: a los pocos segundos la carga suele pasar a PROPOSED/NOTIFIED.
                setTimeout(() => this.refresh(true), 4000);
            } catch (err) {
                window.store.setState({ busyAction: null, generatorFormError: 'No se pudo publicar: ' + window.ui.errorMessage(err) });
            }
        },

        setFilter(filter) {
            window.store.setState({ shipmentFilter: filter });
        },

        select(loadId) {
            window.store.setState({ selectedShipmentId: loadId });
        },

        async refresh(silent) {
            // Un refresco programado (p. ej. tras publicar) puede dispararse después de cerrar la sesión.
            if (!window.store.state.isAuthenticated) return;
            await window.TruckDarService.refreshShipments();
            window.store.setState({ dataStatus: { ...window.store.state.dataStatus, lastSync: new Date().toISOString() } });
            if (!silent) window.ui.toast('Envíos actualizados.', 'info');
        },

        showProofOfDelivery(loadId) {
            const load = (window.TruckDarData.publishedLoads || []).find(l => l.backendId === loadId);
            window.PodUI.showProofOfDelivery(loadId, load);
        },

        async cancel(loadId) {
            const reason = prompt('Motivo de la cancelación del envío CARGA-' + loadId + ' (obligatorio):');
            if (reason === null) return;
            if (!reason.trim()) {
                window.ui.toast('Indique el motivo de la cancelación.', 'warning');
                return;
            }
            window.store.setState({ busyAction: 'cancel' });
            try {
                await window.TruckDarService.cancelLoad(loadId, reason.trim());
                await window.TruckDarService.loadPublishedLoads();
                window.ui.toast('Envío CARGA-' + loadId + ' cancelado.', 'success');
            } catch (err) {
                window.ui.toast('No se pudo cancelar: ' + window.ui.errorMessage(err), 'error');
            } finally {
                window.store.setState({ busyAction: null });
            }
        },

        reset() {
            draft = null;
            companyEdited = false;
        }
    };
})();

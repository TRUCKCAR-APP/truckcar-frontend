window.GeneratorPanel = (function () {
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

    const STATUS = {
        AVAILABLE: { label: 'Disponible', text: 'Buscando conductor', tone: '' },
        PROPOSED: { label: 'Propuesta', text: 'Propuesta a conductor', tone: '' },
        NOTIFIED: { label: 'Notificada', text: 'Conductor notificado', tone: '' },
        NO_DRIVERS: { label: 'Sin conductor', text: 'Sin conductores elegibles', tone: 'warn' },
        ASSIGNED: { label: 'Aceptada', text: 'Aceptada por el conductor', tone: '' },
        IN_TRANSIT: { label: 'En tránsito', text: 'En ruta', tone: 'ok' },
        DELIVERED: { label: 'Entregada', text: 'Entregada', tone: 'ok' },
        CANCELLED: { label: 'Cancelada', text: 'Cancelada', tone: '' }
    };
    const truckTypeLabel = (code) => (TRUCK_TYPES.find(([key]) => key === code) || [code, code || '—'])[1];
    const FILTERS = ['ALL', 'AVAILABLE', 'PROPOSED', 'NOTIFIED', 'ASSIGNED', 'IN_TRANSIT', 'DELIVERED', 'CANCELLED'];

    function statusKey(load) {
        if (load.status !== 'AVAILABLE') return STATUS[load.status] ? load.status : 'AVAILABLE';
        if (load.assignmentStatus === 'PROPOSED' || load.assignmentStatus === 'NOTIFIED') return load.assignmentStatus;
        if (load.assignmentStatus === 'UNASSIGNED_NO_DRIVERS') return 'NO_DRIVERS';
        return 'AVAILABLE';
    }

    function filterKey(load) {
        const key = statusKey(load);
        return key === 'NO_DRIVERS' ? 'AVAILABLE' : key;
    }

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
        const mark = status.tone === 'warn'
            ? '<i class="fas fa-triangle-exclamation text-warn-500"></i>'
            : `<span class="dot${status.tone ? ' ' + status.tone : ''}" aria-hidden="true"></span>`;
        return `<span class="status-badge${status.tone === 'warn' ? ' is-warn' : ''}" title="${status.text}">${mark}${status.label}</span>`;
    }

    function formatDate(value) {
        return window.PodUI.formatDate(value);
    }

    const FORM_STEPS = [
        { title: 'Carga', icon: 'fa-box', fields: ['generatorCompanyName', 'cargoDescription', 'weightTons', 'volumeM3', 'requiredTruckType'] },
        { title: 'Ruta', icon: 'fa-route', fields: ['originCity', 'destinationCity'] },
        { title: 'Precio', icon: 'fa-coins', fields: ['offeredBudget'] }
    ];

    function findCity(name) {
        const norm = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();
        return CITIES.find(c => norm(c.city) === norm(name)) || null;
    }

    function validate(d) {
        const errors = {};
        if (!String(d.cargoDescription || '').trim()) errors.cargoDescription = 'Describa la carga.';
        const weight = Number(d.weightTons);
        if (!(weight > 0)) errors.weightTons = 'Debe ser mayor a 0 t.';
        else if (weight > 60) errors.weightTons = 'Máximo 60 t por vehículo.';
        if (d.volumeM3 !== '' && d.volumeM3 != null && !(Number(d.volumeM3) >= 0)) errors.volumeM3 = 'Volumen inválido.';
        if (!findCity(d.originCity)) errors.originCity = 'Elija una ciudad de la lista.';
        if (!findCity(d.destinationCity)) errors.destinationCity = 'Elija una ciudad de la lista.';
        else if (findCity(d.originCity) === findCity(d.destinationCity)) errors.destinationCity = 'Debe ser distinto del origen.';
        if (!(Number(d.offeredBudget) >= 1000)) errors.offeredBudget = 'Mínimo 1.000 COP.';
        return errors;
    }

    function field(name, label, control, { required = false, touched, errors }) {
        const error = touched.has(name) ? errors[name] : '';
        return `<label class="text-[11px] space-y-1 block">
            <span class="font-bold text-slate-300">${label}${required ? ' <span class="text-slate-400 font-medium">· obligatorio</span>' : ''}</span>
            ${control.replace('<input ', `<input aria-invalid="${Boolean(error)}" `).replace('<select ', `<select aria-invalid="${Boolean(error)}" `)}
            <span class="field-hint block" data-hint="${name}" aria-live="polite">${error ? window.ui.escape(error) : ''}</span>
        </label>`;
    }

    function renderForm(state) {
        const esc = window.ui.escape;
        const ctrl = window.generatorCtrl;
        const d = ctrl.draft();
        const step = ctrl.step();
        const touched = ctrl.touched();
        const errors = validate(d);
        const busy = state.busyAction === 'publish';
        const opts = { touched, errors };
        const money = Number(d.offeredBudget) > 0 ? Number(d.offeredBudget).toLocaleString('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }) : '—';
        const origin = findCity(d.originCity);
        const destination = findCity(d.destinationCity);
        const stepper = FORM_STEPS.map((s, i) => `
            <button type="button" onclick="window.generatorCtrl.goToStep(${i})" class="flex items-center gap-1.5 ${i === step ? 'text-white' : 'text-slate-400'}" ${i === step ? 'aria-current="step"' : ''}>
                <span class="stepper-dot ${i < step ? 'is-done' : i === step ? 'is-current' : ''}">${i < step ? '<i class="fas fa-check text-[10px]"></i>' : i + 1}</span>
                <span class="text-[11px] font-bold hidden xl:inline">${s.title}</span>
            </button>${i < FORM_STEPS.length - 1 ? `<div class="stepper-line"><span style="transform: scaleX(${i < step ? 1 : 0})"></span></div>` : ''}`).join('');

        const steps = [
            `${field('generatorCompanyName', 'Empresa generadora', `<input name="generatorCompanyName" value="${esc(d.generatorCompanyName)}" maxlength="120" autocomplete="organization" class="login-input w-full text-xs" placeholder="Nombre de la empresa">`, opts)}
             ${field('cargoDescription', 'Descripción de la carga', `<input name="cargoDescription" value="${esc(d.cargoDescription)}" maxlength="255" class="login-input w-full text-xs" placeholder="Ej. Cemento ensacado, 600 bultos" enterkeyhint="next">`, { ...opts, required: true })}
             <div class="grid grid-cols-2 gap-2">
                ${field('weightTons', 'Peso (t)', `<input name="weightTons" type="number" inputmode="decimal" min="0.1" step="0.1" value="${esc(d.weightTons)}" class="login-input w-full text-xs" placeholder="30">`, { ...opts, required: true })}
                ${field('volumeM3', 'Volumen (m³)', `<input name="volumeM3" type="number" inputmode="decimal" min="0" step="0.1" value="${esc(d.volumeM3)}" class="login-input w-full text-xs" placeholder="Opcional">`, opts)}
             </div>
             ${field('requiredTruckType', 'Tipo de camión requerido', `<select name="requiredTruckType" class="login-input w-full text-xs">${TRUCK_TYPES.map(([value, text]) => `<option value="${value}" ${value === d.requiredTruckType ? 'selected' : ''}>${text}</option>`).join('')}</select>`, { ...opts, required: true })}`,
            `<datalist id="truckcar-cities">${CITIES.map(c => `<option value="${c.city}">${c.department}</option>`).join('')}</datalist>
             ${field('originCity', 'Origen', `<input name="originCity" list="truckcar-cities" value="${esc(d.originCity)}" autocomplete="off" class="login-input w-full text-xs" placeholder="Escriba una ciudad">`, { ...opts, required: true })}
             ${field('destinationCity', 'Destino', `<input name="destinationCity" list="truckcar-cities" value="${esc(d.destinationCity)}" autocomplete="off" class="login-input w-full text-xs" placeholder="Escriba una ciudad">`, { ...opts, required: true })}
             <p class="text-[11px] text-slate-400 leading-snug"><i class="fas fa-location-dot"></i> ${origin && destination && origin !== destination
                ? esc(origin.city + ', ' + origin.department + ' → ' + destination.city + ', ' + destination.department)
                : 'Las coordenadas del trayecto salen del catálogo de ciudades.'}</p>`,
            `${field('offeredBudget', 'Presupuesto ofrecido (COP)', `<input name="offeredBudget" type="number" inputmode="numeric" min="1000" step="1000" value="${esc(d.offeredBudget)}" class="login-input w-full text-xs" placeholder="5000000" enterkeyhint="done">`, { ...opts, required: true })}
             <div class="card p-3 space-y-1.5 text-[11px]">
                <div class="font-bold text-slate-200 mb-1">Resumen</div>
                <div class="flex justify-between gap-2"><span class="text-slate-400">Carga</span><b class="text-right truncate">${esc(d.cargoDescription || '—')}</b></div>
                <div class="flex justify-between gap-2"><span class="text-slate-400">Peso</span><b>${esc(d.weightTons || '—')} t</b></div>
                <div class="flex justify-between gap-2"><span class="text-slate-400">Trayecto</span><b class="text-right">${esc((origin ? origin.city : '—') + ' → ' + (destination ? destination.city : '—'))}</b></div>
                <div class="flex justify-between gap-2"><span class="text-slate-400">Presupuesto</span><b class="text-white font-mono">${esc(money)}</b></div>
             </div>`
        ];
        const last = step === FORM_STEPS.length - 1;
        return `
            <form onsubmit="event.preventDefault(); window.generatorCtrl.${last ? 'publish()' : 'nextStep()'}" oninput="window.generatorCtrl.updateDraft(event)" onchange="window.generatorCtrl.updateDraft(event)" onfocusout="window.generatorCtrl.touch(event)"
                  class="card p-4 flex flex-col gap-3 overflow-y-auto" novalidate>
                <div class="flex items-center gap-2 border-b border-slate-800 pb-2.5">
                    <i class="fas fa-square-plus text-slate-400"></i>
                    <h2 class="font-bold text-sm text-white">Publicar nueva carga</h2>
                    <span class="ml-auto text-[10px] text-slate-400 font-mono">Paso ${step + 1}/${FORM_STEPS.length}</span>
                </div>
                <div class="stepper" aria-label="Pasos del formulario">${stepper}</div>
                <div class="space-y-2" data-form-step="${step}">${steps[step]}</div>
                ${state.generatorFormError ? `<p class="text-xs font-semibold text-warn-500 flex items-start gap-2" role="alert"><i class="fas fa-triangle-exclamation mt-0.5"></i><span>${esc(state.generatorFormError)}</span></p>` : ''}
                <div class="flex gap-2 mt-auto pt-1">
                    ${step > 0 ? '<button type="button" onclick="window.generatorCtrl.prevStep()" class="btn-secondary px-4"><i class="fas fa-arrow-left"></i></button>' : ''}
                    <button type="submit" ${busy ? 'disabled' : ''} class="btn-cta !min-h-[46px] !text-[13px] flex-1">
                        ${last
                            ? `<i class="fas ${busy ? 'fa-circle-notch fa-spin' : 'fa-paper-plane'}"></i> Publicar carga`
                            : 'Siguiente <i class="fas fa-arrow-right"></i>'}
                    </button>
                </div>
                ${last ? '<p class="text-[10px] text-slate-500 leading-snug">Al publicarla, el motor de asignación busca automáticamente un conductor disponible.</p>' : ''}
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
            <div class="card p-4 flex flex-col gap-3 overflow-hidden">
                <div class="flex items-center justify-between">
                    <div class="flex items-center gap-2">
                        <i class="fas fa-boxes-stacked text-slate-400"></i>
                        <h2 class="font-bold text-sm text-white">Mis envíos</h2>
                    </div>
                    <button onclick="window.generatorCtrl.refresh()" class="w-9 h-9 grid place-items-center rounded-xl text-slate-400 hover:text-white text-xs" title="Actualizar ahora" aria-label="Actualizar los envíos">
                        <i class="fas fa-rotate ${state.dataStatus.loading ? 'fa-spin' : ''}"></i>
                    </button>
                </div>
                <div class="flex flex-wrap gap-1.5" role="group" aria-label="Filtrar por estado">
                    ${FILTERS.map(key => `
                        <button onclick="window.generatorCtrl.setFilter('${key}')" aria-pressed="${filter === key}"
                                class="px-3 py-1.5 rounded-full text-xs font-semibold border transition ${filter === key ? 'bg-slate-800 border-transparent text-white' : 'border-slate-700 text-slate-400 hover:text-white'}">
                            ${key === 'ALL' ? 'Todos' : STATUS[key].label} <span class="font-mono opacity-80">${counts[key]}</span>
                        </button>
                    `).join('')}
                </div>
                <div class="flex-1 overflow-y-auto space-y-2 pr-1">
                    ${visible.length ? visible.map(l => `
                        <button onclick="window.generatorCtrl.select(${l.backendId})"
                                class="w-full text-left p-3 rounded-xl border transition ${l.backendId === selectedId ? 'bg-slate-800 border-slate-400' : 'bg-slate-800/40 border-slate-700/50 hover:bg-slate-800'}">
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
                <span class="w-6 h-6 shrink-0 rounded-full flex items-center justify-center text-[10px] ${done ? 'bg-ok-500 text-graphite-950' : 'bg-slate-800 text-slate-500 border border-slate-700'}"><i class="fas ${icon}"></i></span>
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
            <div class="card p-4 flex flex-col gap-3 overflow-y-auto">
                <div class="flex items-start justify-between gap-2">
                    <div class="min-w-0">
                        <div class="font-mono text-[11px] text-slate-400">${esc(load.id)}</div>
                        <h3 class="font-extrabold text-sm text-white truncate">${esc(load.cargoType)}</h3>
                        <p class="text-[11px] text-slate-400">${status.text}</p>
                    </div>
                    ${badge(load)}
                </div>
                <div id="generator-map-container" class="h-44 rounded-xl overflow-hidden border border-slate-800 shrink-0" aria-label="Mapa del envío"></div>
                ${load.status === 'ASSIGNED' || load.status === 'IN_TRANSIT' ? `
                    <div class="flex items-center justify-between gap-2 text-[10px]">
                        <p id="shipment-truck-line" class="text-slate-200 truncate">${truckLine(truck)}</p>
                        <span data-telemetry-status class="shrink-0 flex items-center gap-1 text-slate-400"></span>
                    </div>` : ''}
                <div class="grid grid-cols-2 gap-x-3 gap-y-1.5 text-[11px]">
                    <div><span class="text-slate-500 block">Trayecto</span><b class="text-white">${esc(load.origin.city)} → ${esc(load.destination.city)}</b></div>
                    <div><span class="text-slate-500 block">Peso / camión</span><b class="text-white">${esc(load.netWeight)} t · ${esc(truckTypeLabel(load.requiredTruckType))}</b></div>
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
                        <button onclick="window.generatorCtrl.showProofOfDelivery(${load.backendId})" class="w-full py-2.5 bg-accent-500 hover:bg-accent-600 text-graphite-950 rounded-xl text-xs font-bold">
                            <i class="fas fa-file-signature"></i> Ver prueba de entrega (POD)
                        </button>` : ''}
                    ${load.status !== 'CANCELLED' ? `
                        <button onclick="window.generatorCtrl.shareTracking(${load.backendId})" class="w-full py-2 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 rounded-xl text-xs font-bold">
                            <i class="fas fa-link"></i> Generar enlace de seguimiento público
                        </button>` : ''}
                    ${load.status === 'AVAILABLE' || load.status === 'ASSIGNED' ? `
                        <button onclick="window.generatorCtrl.cancel(${load.backendId})" ${state.busyAction === 'cancel' ? 'disabled' : ''} class="w-full py-2 bg-slate-800 hover:bg-slate-700 disabled:opacity-60 text-white border border-slate-700 rounded-xl text-xs font-bold">
                            <i class="fas ${state.busyAction === 'cancel' ? 'fa-spinner fa-spin' : 'fa-ban'}"></i> Cancelar envío
                        </button>` : ''}
                </div>
            </div>
        `;
    }

    function truckLine(truck) {
        const esc = window.ui.escape;
        if (!truck || !truck.coords) return '<i class="fas fa-satellite-dish"></i> Esperando la posición del camión…';
        const heading = typeof truck.heading === 'number' ? ' · rumbo ' + Math.round(truck.heading) + '°' : '';
        return `<i class="fas fa-location-crosshairs"></i> ${esc(truck.plate)} · ${truck.speed} km/h${heading} · posición ${esc(truck.lastCheckin)}`;
    }

    function updateTruckLine(truck) {
        const el = document.getElementById('shipment-truck-line');
        if (el) el.innerHTML = truckLine(truck);
    }

    function selectedLoad(state) {
        const loads = window.TruckCarData.publishedLoads || [];
        return loads.find(l => l.backendId === state.selectedShipmentId) || null;
    }

    function truckFor(load) {
        if (!load || !load.assignedDriverId || !['ASSIGNED', 'IN_TRANSIT'].includes(load.status)) return null;
        const tracked = (window.TruckCarData.shipmentTrucks || {})[load.assignedDriverId];
        return tracked || (window.TruckCarData.fleetVehicles || []).find(t => t.driverId === load.assignedDriverId) || null;
    }

    function render(state) {
        const esc = window.ui.escape;
        const loads = window.TruckCarData.publishedLoads || [];
        const load = selectedLoad(state);
        const user = state.currentUser;
        const active = loads.filter(l => ['ASSIGNED', 'IN_TRANSIT'].includes(l.status)).length;
        const delivered = loads.filter(l => l.status === 'DELIVERED').length;
        return `
            <div class="h-full w-full flex flex-col bg-slate-950 text-slate-100 overflow-hidden font-sans">
                <header class="min-h-16 px-4 lg:px-6 py-2 bg-slate-900 border-b border-slate-800 flex flex-wrap items-center justify-between z-30 shrink-0 gap-x-4 gap-y-2">
                    <div class="flex items-center gap-3 min-w-0">
                        <div class="w-10 h-10 rounded-xl bg-slate-800 flex items-center justify-center text-slate-100">
                            <i class="fas fa-industry text-lg"></i>
                        </div>
                        <div class="min-w-0">
                            <h1 class="text-[15px] lg:text-base font-bold text-white tracking-tight">Mis envíos</h1>
                            <p class="text-xs text-slate-400 truncate flex items-center gap-2"><span data-network-status class="lg:hidden"></span> Última ${state.dataStatus.lastSync ? new Date(state.dataStatus.lastSync).toLocaleTimeString('es-CO') : '—'}</p>
                        </div>
                    </div>
                    ${state.sessionRole === 'GENERADOR' ? '' : window.CoordinatorPanel.renderTabs(state)}
                    <div class="flex items-center gap-3">
                        <div class="px-3 py-1.5 bg-slate-800/80 border border-slate-700/60 rounded-xl text-center">
                            <span class="text-xs text-slate-400 font-medium block">En curso</span>
                            <span class="text-sm font-bold text-white font-mono" data-count="${active}" data-count-key="gen-active">${active}</span>
                        </div>
                        <div class="px-3 py-1.5 bg-slate-800/80 border border-slate-700/60 rounded-xl text-center">
                            <span class="text-xs text-slate-400 font-medium block">Entregadas</span>
                            <span class="text-sm font-bold text-white font-mono" data-count="${delivered}" data-count-key="gen-delivered">${delivered}</span>
                        </div>
                        <div class="hidden md:block text-xs font-bold text-slate-200 pl-3 border-l border-slate-800">${esc(user ? user.firstName + ' ' + user.lastName : 'Generador')}</div>
                        <button onclick="window.app.logout()" class="w-9 h-9 rounded-xl grid place-items-center text-slate-400 hover:text-white text-xs" title="Cerrar sesión" aria-label="Cerrar sesión"><i class="fas fa-right-from-bracket"></i></button>
                    </div>
                </header>
                ${window.ui.syncBanner(state)}
                <div data-screen class="flex-1 grid grid-cols-1 lg:grid-cols-12 gap-4 p-3 lg:p-4 overflow-y-auto lg:overflow-hidden" style="padding-bottom: calc(1rem + var(--safe-bottom))">
                    <div class="lg:col-span-3 flex flex-col lg:overflow-hidden">${renderForm(state)}</div>
                    <div class="lg:col-span-5 flex flex-col lg:overflow-hidden min-h-[320px]">${renderBoard(state, loads)}</div>
                    <div class="lg:col-span-4 flex flex-col lg:overflow-hidden">${renderDetail(state, load, truckFor(load))}</div>
                </div>
            </div>
        `;
    }

    return { render, selectedLoad, truckFor, updateTruckLine, CITIES, FORM_STEPS, findCity, validate };
})();

window.generatorCtrl = (function () {
    let draft = null;
    let companyEdited = false;
    let step = 0;
    let touched = new Set();
    let sharing = false;

    function defaultDraft() {
        const user = window.store.state.currentUser;
        let company = '';
        try { company = localStorage.getItem('truckcar.generatorCompanyName') || ''; } catch (e) { }
        return {
            generatorCompanyName: company || (user ? (user.firstName + ' ' + user.lastName).trim() : ''),
            cargoDescription: '', weightTons: '', volumeM3: '', requiredTruckType: 'TRACTOMULA_3S3',
            originCity: 'Bogotá', destinationCity: 'Cali', offeredBudget: ''
        };
    }

    const city = (name) => window.GeneratorPanel.findCity(name);

    return {
        draft() {
            if (!draft) draft = defaultDraft();
            if (!draft.generatorCompanyName && !companyEdited) {
                draft.generatorCompanyName = defaultDraft().generatorCompanyName;
            }
            return draft;
        },

        step() { return step; },
        touched() { return touched; },

        updateDraft(event) {
            const target = event.target;
            if (target && target.name && Object.hasOwn(this.draft(), target.name)) {
                draft[target.name] = target.value;
                if (target.name === 'generatorCompanyName') companyEdited = true;
                if (event.type === 'change') touched.add(target.name);
                this.showFieldErrors(target.form);
            }
        },

        touch(event) {
            const target = event.target;
            if (!target || !target.name) return;
            touched.add(target.name);
            const city = (target.name === 'originCity' || target.name === 'destinationCity') && window.GeneratorPanel.findCity(target.value);
            if (city && city.city !== target.value) {
                target.value = city.city;
                draft[target.name] = city.city;
            }
            this.showFieldErrors(target.form);
        },

        showFieldErrors(form) {
            if (!form) return;
            const errors = window.GeneratorPanel.validate(this.draft());
            form.querySelectorAll('[data-hint]').forEach((hint) => {
                const name = hint.dataset.hint;
                const message = touched.has(name) ? (errors[name] || '') : '';
                hint.textContent = message;
                const input = form.elements[name];
                if (input) input.setAttribute('aria-invalid', String(Boolean(message)));
            });
        },

        goToStep(index) {
            if (index > step && !this.validateStep()) return;
            step = Math.max(0, Math.min(2, index));
            window.store.setState({ generatorFormError: null });
            const panel = document.querySelector('[data-form-step]');
            if (panel) panel.classList.add('screen-enter');
        },
        nextStep() { this.goToStep(step + 1); },
        prevStep() { this.goToStep(step - 1); },

        validateStep() {
            const errors = window.GeneratorPanel.validate(this.draft());
            const fields = window.GeneratorPanel.FORM_STEPS[step].fields;
            fields.forEach(name => touched.add(name));
            const invalid = fields.find(name => errors[name]);
            if (!invalid) return true;
            const form = document.querySelector('[data-form-step]') && document.querySelector('[data-form-step]').closest('form');
            this.showFieldErrors(form);
            if (form && form.elements[invalid]) form.elements[invalid].focus();
            window.Native.haptic('warning');
            return false;
        },

        async shareTracking(loadId) {
            if (sharing) return;
            sharing = true;
            let link;
            try {
                link = await window.TruckCarService.createTrackingLink(loadId);
            } catch (error) {
                window.ui.failure('No se pudo generar el enlace', error, 'compartir el seguimiento');
                return;
            } finally {
                sharing = false;
            }
            const expires = new Date(link.expiresAt).toLocaleString('es-CO',
                { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
            const canShare = !!navigator.share && window.matchMedia('(pointer: coarse)').matches;
            window.Sheet.open({
                title: 'Enlace de seguimiento',
                subtitle: 'Quien lo abra ve el estado y la posición del envío, sin iniciar sesión.',
                icon: 'fa-link',
                body: `
                    <input readonly data-tracking-url class="login-input w-full text-sm font-mono" value="${window.ui.escape(link.url)}" aria-label="Enlace de seguimiento">
                    <p class="text-[12px] text-slate-400 mt-2 leading-snug"><i class="fas fa-clock"></i> Vence el ${window.ui.escape(expires)}
                        o 6 h después de la entrega. No muestra la placa completa ni datos del conductor.</p>`,
                actions: [
                    {
                        label: canShare ? 'Compartir' : 'Copiar enlace', tone: 'primary', icon: canShare ? 'fa-share-nodes' : 'fa-copy',
                        onClick: async (sheet) => {
                            try {
                                if (canShare) {
                                    await navigator.share({ title: 'Seguimiento CARGA-' + loadId, url: link.url });
                                } else {
                                    await navigator.clipboard.writeText(link.url);
                                    window.ui.toast('Enlace copiado', 'success', { description: 'Vence el ' + expires + '.' });
                                }
                            } catch (error) {
                                if (error && error.name === 'AbortError') return false;
                                const input = sheet.querySelector('[data-tracking-url]');
                                input.focus();
                                input.select();
                                window.ui.toast('Cópielo manualmente', 'info', { description: 'El enlace quedó seleccionado.' });
                                return false;
                            }
                        }
                    },
                    { label: 'Listo', tone: 'secondary' }
                ]
            });
        },

        async publish() {
            const d = this.draft();
            const origin = city(d.originCity);
            const destination = city(d.destinationCity);
            const weight = Number(d.weightTons);
            const budget = Number(d.offeredBudget);
            const errors = window.GeneratorPanel.validate(d);
            const firstInvalid = window.GeneratorPanel.FORM_STEPS.findIndex(s => s.fields.some(name => errors[name]));
            if (firstInvalid >= 0) {
                Object.keys(errors).forEach(name => touched.add(name));
                step = firstInvalid;
                window.store.setState({ generatorFormError: 'Revise los campos marcados.' });
                return;
            }
            const user = window.store.state.currentUser;
            const companyName = d.generatorCompanyName.trim() || (user ? user.firstName + ' ' + user.lastName : 'Generador');
            window.store.setState({ busyAction: 'publish', generatorFormError: null });
            try {
                const created = await window.TruckCarService.publishLoad({
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
                try { localStorage.setItem('truckcar.generatorCompanyName', companyName); } catch (e) { }
                draft = { ...defaultDraft(), requiredTruckType: d.requiredTruckType, originCity: d.originCity, destinationCity: d.destinationCity };
                step = 0;
                touched = new Set();
                window.Native.haptic('success');
                window.store.setState({ busyAction: null, selectedShipmentId: created.backendId, shipmentFilter: 'ALL' });
                window.ui.toast(created.id + ' publicada. El motor de asignación ya busca conductor.', 'success');
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
            if (!window.store.state.isAuthenticated) return;
            await window.TruckCarService.refreshShipments();
            window.store.setState({ dataStatus: { ...window.store.state.dataStatus, lastSync: new Date().toISOString() } });
            if (!silent) window.ui.toast('Envíos actualizados.', 'info');
        },

        showProofOfDelivery(loadId) {
            const load = (window.TruckCarData.publishedLoads || []).find(l => l.backendId === loadId);
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
                await window.TruckCarService.cancelLoad(loadId, reason.trim());
                await window.TruckCarService.loadPublishedLoads();
                window.ui.toast('Envío CARGA-' + loadId + ' cancelado.', 'success');
            } catch (err) {
                window.ui.failure('No se pudo cancelar', err, 'cancelar');
            } finally {
                window.store.setState({ busyAction: null });
            }
        },

        reset() {
            draft = null;
            companyEdited = false;
            step = 0;
            touched = new Set();
        }
    };
})();

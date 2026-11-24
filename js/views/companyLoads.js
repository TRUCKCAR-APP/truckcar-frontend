// «Cargas» de la transportadora: las que llevan sus conductores (de cualquier generador) y sus cargas propias, con la
// línea de tiempo del viaje y la prueba de entrega. Una carga propia solo se ofrece a los conductores de la empresa.
// El servidor (Load-Allocation /loads/fleet) confirma la empresa con el token: nunca muestra cargas de otra empresa.
window.CompanyLoads = (function () {
    const esc = (value) => window.ui.escape(value);
    const POLL_MS = 20000;
    let timer = null;
    let formOpen = false;
    let draft = emptyDraft();
    let touched = new Set();

    function emptyDraft() {
        return { cargoDescription: '', weightTons: '', requiredTruckType: '', originCity: '', destinationCity: '', offeredBudget: '' };
    }

    const city = (name) => window.GeneratorPanel && window.GeneratorPanel.findCity ? window.GeneratorPanel.findCity(name) : null;

    function clock(iso) {
        if (!iso) return '';
        const date = new Date(iso);
        return Number.isNaN(date.getTime()) ? '' : date.toLocaleString('es-CO', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
    }

    /** Etapa legible: distingue el tramo al cargue, el cargue y el viaje con la mercancía. */
    function stage(load) {
        if (load.status === 'IN_TRANSIT' && !load.pickedUpAt) return load.arrivedAtPickupAt ? 'En el punto de cargue' : 'Camino al punto de cargue';
        if (load.status === 'IN_TRANSIT') return 'En ruta al destino';
        if (load.status === 'AVAILABLE') {
            return load.assignmentStatus === 'NOTIFIED' || load.assignmentStatus === 'PROPOSED' ? 'Propuesta a ' + (load.assignedDriverName || 'un conductor')
                : load.assignmentStatus === 'UNASSIGNED_NO_DRIVERS' ? 'Sin conductores disponibles' : 'Buscando conductor';
        }
        return window.ui.statusLabel(load.status);
    }

    const TONE = { IN_TRANSIT: '#2f9e44', ASSIGNED: '#1c7ed6', AVAILABLE: '#868e96', DELIVERED: '#495057', CANCELLED: '#c92a2a' };

    function step(done, label, when) {
        return `<li class="flex items-center gap-2 ${done ? 'text-slate-200' : 'text-slate-500'}">
            <span class="dot" style="background:${done ? '#2f9e44' : '#5c6370'}"></span>${esc(label)}${done && when ? ' <span class="text-slate-400">· ' + esc(clock(when)) + '</span>' : ''}</li>`;
    }

    function card(load, state) {
        const raw = load.raw || {};
        const own = !!raw.ownerCompanyId;
        const allowed = window.TruckCarService.loadActions(load);
        return `
            <li class="bg-slate-900 border border-slate-800 rounded-2xl p-3 min-w-0" data-company-load="${esc(load.backendId)}">
                <div class="flex items-start justify-between gap-3">
                    <div class="min-w-0">
                        <h3 class="font-bold text-sm text-white truncate">${esc(load.id)} · ${esc(load.origin.city || '—')} → ${esc(load.destination.city || '—')}</h3>
                        <p class="text-xs text-slate-400 truncate">${esc(load.cargoType || raw.cargoDescription || '')} · ${esc(load.netWeight)} t${own ? ' · <b class="text-slate-200">Carga propia</b>' : raw.generatorCompanyName ? ' · ' + esc(raw.generatorCompanyName) : ''}</p>
                    </div>
                    <span class="text-xs text-slate-200 whitespace-nowrap flex items-center gap-1.5"><span class="dot" style="background:${TONE[load.status] || '#868e96'}"></span>${esc(stage(load))}</span>
                </div>
                ${load.assignedDriverName && load.status !== 'AVAILABLE' ? `<p class="text-xs text-slate-300 mt-2">Conductor: ${esc(load.assignedDriverName)}${raw.assignedVehiclePlate ? ' · <span class="font-mono">' + esc(raw.assignedVehiclePlate) + '</span>' : ''}</p>` : ''}
                ${load.status === 'CANCELLED' ? '' : `
                <ol class="grid gap-1 text-xs mt-2" aria-label="Avance de ${esc(load.id)}">
                    ${step(!!load.assignedAt && load.status !== 'AVAILABLE', 'Aceptada', load.assignedAt)}
                    ${step(!!load.tripStartedAt, 'Camino al punto de cargue', load.tripStartedAt)}
                    ${step(!!load.arrivedAtPickupAt, 'Llegó al punto de cargue', load.arrivedAtPickupAt)}
                    ${step(!!load.pickedUpAt, 'Carga recogida', load.pickedUpAt)}
                    ${step(load.status === 'DELIVERED', 'Entregada' + (raw.podReceiverName ? ' · recibió ' + raw.podReceiverName : ''), load.deliveredAt)}
                </ol>`}
                <div class="flex flex-wrap gap-2 mt-3">
                    ${allowed.viewProofOfDelivery ? `<button type="button" onclick="window.CompanyLoads.showProof(${Number(load.backendId)})" class="btn-quiet company-load-btn"><i class="fas fa-file-signature" aria-hidden="true"></i>Prueba de entrega</button>` : ''}
                    ${own && allowed.cancel ? `<button type="button" onclick="window.CompanyLoads.cancel(${Number(load.backendId)})" ${state.busyAction === 'cancel' ? 'disabled' : ''} class="btn-quiet company-load-btn"><i class="fas fa-ban" aria-hidden="true"></i>Cancelar</button>` : ''}
                </div>
            </li>`;
    }

    function validate(d) {
        const errors = {};
        if (!String(d.cargoDescription).trim()) errors.cargoDescription = 'Describa la carga.';
        if (!(Number(d.weightTons) > 0)) errors.weightTons = 'Debe ser mayor a 0 t.';
        if (!d.requiredTruckType) errors.requiredTruckType = 'Elija el tipo de camión.';
        const from = city(d.originCity);
        const to = city(d.destinationCity);
        if (!from) errors.originCity = 'Elija una ciudad de la lista.';
        if (!to) errors.destinationCity = 'Elija una ciudad de la lista.';
        else if (from && from.city === to.city) errors.destinationCity = 'Debe ser distinto del origen.';
        if (!(Number(d.offeredBudget) >= 1000)) errors.offeredBudget = 'Mínimo 1.000 COP.';
        return errors;
    }

    function field(name, label, control, errors) {
        const error = touched.has(name) ? errors[name] : '';
        return `<label class="text-[11px] space-y-1 block">
            <span class="font-bold text-slate-300">${label}</span>
            ${control.replace(/<(input|select) /, `<$1 aria-invalid="${Boolean(error)}" `)}
            <span class="field-hint block" aria-live="polite">${error ? esc(error) : ''}</span>
        </label>`;
    }

    function formHtml(state) {
        const errors = validate(draft);
        const types = window.TruckCarService.truckTypes ? window.TruckCarService.truckTypes() : [];
        const cities = window.TruckCarService.cityCatalog ? window.TruckCarService.cityCatalog() : [];
        const busy = state.busyAction === 'publish-own';
        return `
            <form class="bg-slate-900 border border-slate-800 rounded-2xl p-4 mb-4 space-y-2" data-own-load-form novalidate
                  oninput="window.CompanyLoads.input(event)" onsubmit="event.preventDefault(); window.CompanyLoads.publish()">
                <h2 class="font-bold text-white">Publicar carga propia</h2>
                <p class="text-xs text-slate-400">Solo se les ofrece a sus conductores afiliados: el motor elige al más cercano al punto de cargue.</p>
                <datalist id="company-cities">${cities.map(c => `<option value="${esc(c.city)}">${esc(c.department)}</option>`).join('')}</datalist>
                ${field('cargoDescription', 'Descripción de la carga', `<input name="cargoDescription" value="${esc(draft.cargoDescription)}" maxlength="255" class="login-input w-full text-xs" placeholder="Ej. Cemento ensacado, 600 bultos">`, errors)}
                <div class="grid grid-cols-2 gap-2">
                    ${field('weightTons', 'Peso (t)', `<input name="weightTons" type="number" inputmode="decimal" min="0.1" step="0.1" value="${esc(draft.weightTons)}" class="login-input w-full text-xs" placeholder="30">`, errors)}
                    ${field('requiredTruckType', 'Tipo de camión', `<select name="requiredTruckType" class="login-input w-full text-xs"><option value="">Elija…</option>${types.map(t => `<option value="${esc(t.code)}" ${draft.requiredTruckType === t.code ? 'selected' : ''}>${esc(t.label)}</option>`).join('')}</select>`, errors)}
                </div>
                <div class="grid grid-cols-2 gap-2">
                    ${field('originCity', 'Punto de cargue', `<input name="originCity" list="company-cities" value="${esc(draft.originCity)}" autocomplete="off" class="login-input w-full text-xs" placeholder="Ciudad">`, errors)}
                    ${field('destinationCity', 'Destino', `<input name="destinationCity" list="company-cities" value="${esc(draft.destinationCity)}" autocomplete="off" class="login-input w-full text-xs" placeholder="Ciudad">`, errors)}
                </div>
                ${field('offeredBudget', 'Valor del flete (COP)', `<input name="offeredBudget" type="number" inputmode="numeric" min="1000" step="1000" value="${esc(draft.offeredBudget)}" class="login-input w-full text-xs" placeholder="Ej. 2500000">`, errors)}
                <div class="flex gap-2 pt-1">
                    <button type="submit" ${busy ? 'disabled' : ''} class="btn-accent company-load-btn">${busy ? '<i class="fas fa-spinner fa-spin"></i>' : '<i class="fas fa-paper-plane" aria-hidden="true"></i>'}Publicar para mi flota</button>
                    <button type="button" onclick="window.CompanyLoads.toggleForm(false)" class="btn-quiet company-load-btn">Cancelar</button>
                </div>
            </form>`;
    }

    function render(state) {
        const loads = window.TruckCarData.companyLoads;
        const errors = (state.dataStatus && state.dataStatus.errors) || {};
        const header = `
            <div class="flex flex-wrap items-end justify-between gap-3 mb-3">
                <div>
                    <h2 class="font-bold text-white">Cargas de su flota</h2>
                    <p class="text-xs text-slate-400 mt-0.5">Las que llevan sus conductores y sus cargas propias. Se actualiza cada 20 segundos.</p>
                </div>
                ${formOpen ? '' : `<button type="button" onclick="window.CompanyLoads.toggleForm(true)" class="px-4 py-2.5 bg-accent-500 hover:bg-accent-600 text-graphite-950 rounded-xl text-xs font-bold flex items-center gap-2" data-own-load-open><i class="fas fa-plus"></i> Publicar carga propia</button>`}
            </div>`;
        let list;
        if (!loads && errors.companyLoads) {
            list = `<p class="text-sm text-slate-400 bg-slate-900 border border-slate-800 rounded-2xl p-4">No se pudieron cargar las cargas: ${esc(errors.companyLoads)}
                <button onclick="window.CompanyLoads.refresh()" class="ml-2 underline font-bold">Reintentar</button></p>`;
        } else if (!loads) {
            list = '<div class="text-center py-12 text-sm text-slate-400"><i class="fas fa-spinner fa-spin"></i> Cargando las cargas…</div>';
        } else if (!loads.length) {
            list = '<p class="text-sm text-slate-400 bg-slate-900 border border-slate-800 rounded-2xl p-4">Aún no hay cargas de su flota. Cuando un conductor suyo acepte una, o publique una carga propia, aparecerá aquí.</p>';
        } else {
            const active = loads.filter(l => l.status !== 'DELIVERED' && l.status !== 'CANCELLED');
            const done = loads.filter(l => l.status === 'DELIVERED' || l.status === 'CANCELLED');
            list = `
                ${active.length ? `<h3 class="text-xs font-bold text-slate-300 mb-2">En curso (${active.length})</h3><ul class="grid gap-2 lg:grid-cols-2 items-start mb-4">${active.map(l => card(l, state)).join('')}</ul>` : ''}
                ${done.length ? `<h3 class="text-xs font-bold text-slate-300 mb-2">Terminadas (${done.length})</h3><ul class="grid gap-2 lg:grid-cols-2 items-start">${done.map(l => card(l, state)).join('')}</ul>` : ''}`;
        }
        return header + (formOpen ? formHtml(state) : '') + list;
    }

    function input(event) {
        const target = event.target;
        if (!target || !target.name) return;
        draft[target.name] = target.value;
        touched.add(target.name);
        const hint = target.closest('label') && target.closest('label').querySelector('.field-hint');
        const error = validate(draft)[target.name] || '';
        if (hint) hint.textContent = error;
        target.setAttribute('aria-invalid', String(Boolean(error)));
    }

    function toggleForm(open) {
        formOpen = open;
        if (!open) { draft = emptyDraft(); touched = new Set(); }
        window.store.setState({});
    }

    async function publish() {
        Object.keys(draft).forEach(name => touched.add(name));
        const errors = validate(draft);
        if (Object.keys(errors).length) {
            window.store.setState({});
            return;
        }
        const origin = city(draft.originCity);
        const destination = city(draft.destinationCity);
        const company = window.TruckCarData.company;
        window.store.setState({ busyAction: 'publish-own' });
        try {
            const created = await window.TruckCarService.publishOwnLoad({
                generatorCompanyName: (company && company.name) || 'Transportadora',
                cargoDescription: draft.cargoDescription.trim(),
                weightTons: Number(draft.weightTons),
                requiredTruckType: draft.requiredTruckType,
                originCity: origin.city, originDepartment: origin.department,
                originLatitude: origin.latitude, originLongitude: origin.longitude,
                destinationCity: destination.city, destinationDepartment: destination.department,
                destinationLatitude: destination.latitude, destinationLongitude: destination.longitude,
                offeredBudget: Number(draft.offeredBudget)
            });
            formOpen = false;
            draft = emptyDraft();
            touched = new Set();
            window.ui.toast('Carga ' + created.id + ' publicada para su flota', 'success',
                { description: 'El motor se la ofrece a su conductor disponible más cercano al punto de cargue.' });
        } catch (error) {
            window.ui.failure('No se pudo publicar la carga', error, 'publicar la carga');
        } finally {
            window.store.setState({ busyAction: null });
        }
    }

    function showProof(loadId) {
        const load = (window.TruckCarData.companyLoads || []).find(l => l.backendId === loadId);
        window.PodUI.showProofOfDelivery(loadId, load, (id) => window.TruckCarService.getCompanyProofOfDelivery(id));
    }

    async function cancel(loadId) {
        const reason = await window.Sheet.prompt({
            title: 'Cancelar la carga #' + loadId, message: 'Esta acción no se puede deshacer. Indique el motivo.',
            label: 'Motivo de la cancelación', placeholder: 'Motivo de la cancelación', confirmLabel: 'Cancelar carga',
            cancelLabel: 'Volver', requiredMessage: 'Indique el motivo de la cancelación.', tone: 'danger', icon: 'fa-ban'
        });
        if (reason === null) return;
        window.store.setState({ busyAction: 'cancel' });
        try {
            await window.TruckCarService.cancelLoad(loadId, reason);
            await window.TruckCarService.loadCompanyLoads();
            window.ui.toast('Carga #' + loadId + ' cancelada.', 'success');
        } catch (error) {
            window.ui.failure('No se pudo cancelar la carga', error, 'cancelar la carga');
        } finally {
            window.store.setState({ busyAction: null });
        }
    }

    async function refresh() {
        await window.TruckCarService.loadCompanyLoads();
        window.store.setState({});
    }

    function startPolling() {
        if (timer) return;
        timer = setInterval(() => {
            const s = window.store.state;
            if (!s.isAuthenticated || s.activeRole !== 'company' || s.companyTab !== 'loads') {
                stopPolling();
                return;
            }
            // Con el formulario abierto no se repinta: perdería lo que el usuario está escribiendo.
            if (formOpen) return;
            refresh();
        }, POLL_MS);
    }

    function stopPolling() {
        clearInterval(timer);
        timer = null;
    }

    return { render, input, toggleForm, publish, showProof, cancel, refresh, startPolling, stopPolling, stage };
})();

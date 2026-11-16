window.TowerLoads = (function () {
    const esc = (value) => window.ui.escape(value);
    const FILTERS = [
        ['ALL', 'Todas'], ['AVAILABLE', 'Disponibles'], ['ASSIGNED', 'Aceptadas'],
        ['IN_TRANSIT', 'En tránsito'], ['DELIVERED', 'Entregadas'], ['CANCELLED', 'Canceladas']
    ];
    let requestId = 0;

    function activeFilter(state) {
        return FILTERS.some(([key]) => key === state.towerLoadFilter) ? state.towerLoadFilter : 'ALL';
    }

    function statusText(load) {
        const status = window.ui.statusLabel(load.status);
        return load.status === 'AVAILABLE' && load.assignmentStatus
            ? status + ' · ' + window.ui.statusLabel(load.assignmentStatus)
            : status;
    }

    function driverText(load) {
        if (!load.assignedDriverName && !load.assignedDriverId) return 'Sin conductor';
        const name = load.assignedDriverName || load.assignedDriverId;
        return load.assignedVehiclePlate ? name + ' (' + load.assignedVehiclePlate + ')' : name;
    }

    function rowHtml(load) {
        const na = window.ui.NOT_AVAILABLE;
        const route = (load.origin.city || na) + ' → ' + (load.destination.city || na);
        const dispatchable = load.status === 'AVAILABLE';
        return `
            <article class="bg-slate-900 border border-slate-800 rounded-2xl p-4" data-tower-load="${Number(load.backendId)}">
                <div class="flex items-start justify-between gap-3">
                    <div class="min-w-0">
                        <p class="text-[11px] font-semibold text-slate-400">${esc(load.id)} · ${esc(load.scheduledDeparture || na)}</p>
                        <h3 class="font-bold text-sm text-white mt-0.5">${esc(route)}</h3>
                    </div>
                    <span class="text-xs font-bold text-slate-200 text-right">${esc(statusText(load))}</span>
                </div>
                <dl class="grid grid-cols-2 gap-x-3 gap-y-1 text-xs mt-3">
                    <dt class="text-slate-400">Generador</dt><dd class="text-slate-200 text-right">${esc(load.customer || na)}</dd>
                    <dt class="text-slate-400">Conductor</dt><dd class="text-slate-200 text-right">${esc(driverText(load))}</dd>
                    <dt class="text-slate-400">Carga</dt><dd class="text-slate-200 text-right">${esc(load.cargoType || na)}${load.netWeight != null ? ' · ' + esc(load.netWeight) + ' t' : ''}</dd>
                </dl>
                ${dispatchable ? `
                    <button onclick="window.TowerLoads.openInDispatch(${Number(load.backendId)})" class="mt-3 w-full py-2 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-white rounded-xl text-xs font-bold transition">
                        <i class="fas fa-cubes-stacked"></i> Abrir en evaluación de despacho
                    </button>` : ''}
            </article>`;
    }

    function block(icon, title, text, actionHtml = '') {
        return `
            <div class="bg-slate-900 border border-slate-800 rounded-2xl p-8 text-center">
                <i class="fas ${icon} text-slate-400 text-2xl mb-3 block"></i>
                <p class="font-bold text-sm text-white">${esc(title)}</p>
                <p class="text-xs text-slate-400 mt-1">${esc(text)}</p>
                ${actionHtml}
            </div>`;
    }

    function bodyHtml(state) {
        const status = state.towerLoadsStatus;
        const loads = window.TruckCarData.towerLoads || [];
        const retry = '<button onclick="window.TowerLoads.refresh()" class="mt-3 px-4 py-2 bg-slate-800 rounded-xl text-xs font-bold">Reintentar</button>';
        if (status === 'error') {
            return block('fa-triangle-exclamation', 'No se pudieron cargar las cargas', 'Revise la conexión e intente de nuevo.', retry);
        }
        if (status !== 'ready' && !loads.length) {
            return block('fa-spinner fa-spin', 'Cargando cargas', 'Consultando las cargas de todos los generadores.');
        }
        if (!loads.length) {
            return block('fa-inbox', 'Sin cargas', activeFilter(state) === 'ALL'
                ? 'Ningún generador ha publicado cargas.'
                : 'No hay cargas en este estado.');
        }
        return `<div class="grid gap-3 md:grid-cols-2">${loads.map(rowHtml).join('')}</div>`;
    }

    function render(state) {
        const filter = activeFilter(state);
        const count = (window.TruckCarData.towerLoads || []).length;
        return `
            <div class="h-full w-full flex flex-col bg-slate-950 text-slate-100 overflow-hidden font-sans">
                ${window.CoordinatorPanel.renderHeader(state)}
                <div data-screen class="flex-1 overflow-y-auto p-3 lg:p-6" style="padding-bottom: calc(1rem + var(--safe-bottom))">
                    <div class="max-w-5xl mx-auto">
                        <div class="flex flex-wrap items-end justify-between gap-3 mb-4">
                            <div class="min-w-0">
                                <h2 class="text-lg font-bold text-white">Cargas</h2>
                                <p class="text-xs text-slate-400 mt-0.5">Cargas de todos los generadores, las 200 más recientes${state.towerLoadsStatus === 'ready' ? ' · ' + count + ' en esta vista' : ''}.</p>
                            </div>
                            <button onclick="window.TowerLoads.refresh()" class="px-4 py-2.5 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-xl text-xs font-bold transition flex items-center gap-2">
                                <i class="fas fa-rotate ${state.towerLoadsStatus === 'loading' ? 'fa-spin' : ''}"></i> Actualizar
                            </button>
                        </div>
                        <div class="flex flex-wrap gap-2 mb-4" role="group" aria-label="Filtrar por estado">
                            ${FILTERS.map(([key, label]) => `
                                <button onclick="window.TowerLoads.setFilter('${key}')" aria-pressed="${filter === key}"
                                        class="px-3 py-1.5 min-h-[36px] rounded-lg text-xs font-bold transition ${filter === key ? 'bg-accent-500/15 text-accent-500' : 'bg-slate-900 border border-slate-800 text-slate-300 hover:bg-slate-800'}">${esc(label)}</button>`).join('')}
                        </div>
                        ${bodyHtml(state)}
                    </div>
                </div>
            </div>`;
    }

    async function refresh({ silent = false } = {}) {
        const id = ++requestId;
        const filter = activeFilter(window.store.state);
        if (!silent) window.store.setState({ towerLoadsStatus: 'loading' });
        try {
            await window.TruckCarService.loadTowerLoads(filter === 'ALL' ? null : filter);
            if (id === requestId) window.store.setState({ towerLoadsStatus: 'ready' });
        } catch (error) {
            if (id !== requestId || silent) return;
            window.TruckCarData.towerLoads = [];
            window.store.setState({ towerLoadsStatus: 'error' });
            if (error && error.status !== 401) window.ui.toast('No se pudieron cargar las cargas', 'error', { description: window.ui.errorMessage(error) });
        }
    }

    function setFilter(key) {
        window.TruckCarData.towerLoads = [];
        window.store.setState({ towerLoadFilter: key });
        return refresh();
    }

    async function openInDispatch(loadId) {
        window.store.setState({ selectedLoadId: Number(loadId), coordinatorTab: 'fleet' });
        await window.TruckCarService.loadCoordinatorLoad();
        window.store.setState({});
    }

    return { FILTERS, render, refresh, setFilter, openInDispatch, statusText, driverText, rowHtml };
})();

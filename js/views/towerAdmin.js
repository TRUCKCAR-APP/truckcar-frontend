/**
 * Pestañas de administración de la torre de control:
 *  - Restricciones (COORDINADOR y ADMIN): registrar y desactivar gálibos, límites de peso y cierres. La PWA del
 *    conductor las cruza con su ruta real (POST /restrictions/validate-route) y avisa en la navegación.
 *  - Usuarios (solo ADMIN): cambiar el rol y activar o suspender cuentas. El registro público solo crea conductores y
 *    generadores; los coordinadores salen de aquí.
 *
 * La vista se vuelve a dibujar con cada actualización de la torre; el formulario de restricción va en una hoja montada
 * en <body> (window.Sheet) para que el mapa y lo escrito no se pierdan.
 */
window.TowerAdmin = (function () {
    const esc = (value) => window.ui.escape(value);

    const RESTRICTION_TYPES = {
        GALIBO_ALTURA: { label: 'Gálibo de altura', field: 'maxClearanceMeters', unit: 'm', min: 2, max: 6, placeholder: '3,80' },
        PESO_BRUTO: { label: 'Peso bruto máximo', field: 'maxGrossWeightTons', unit: 't', min: 1, max: 80, placeholder: '32' },
        PESO_POR_EJE: { label: 'Peso máximo por eje', field: 'maxAxleWeightTons', unit: 't', min: 1, max: 20, placeholder: '10' },
        CIERRE_PROGRAMADO: { label: 'Cierre programado', field: null },
        HORARIO_FESTIVO: { label: 'Restricción por horario o festivo', field: null }
    };
    const SEVERITIES = { INFORMATIVA: 'Informativa', PRECAUCION: 'Precaución', BLOQUEO_TOTAL: 'Bloqueo total' };
    const ROLES = { CONDUCTOR: 'Conductor', GENERADOR: 'Generador de carga', COORDINADOR: 'Coordinador', ADMIN: 'Administrador' };
    const STATUSES = { ACTIVE: 'Activa', PENDING_VERIFICATION: 'Pendiente de verificación', SUSPENDED: 'Suspendida' };
    const USER_FILTERS = [
        ['all', 'Todas'], ['PENDING_VERIFICATION', 'Pendientes'], ['CONDUCTOR', 'Conductores'],
        ['GENERADOR', 'Generadores'], ['tower', 'Torre de control']
    ];

    function number(value) {
        const text = String(value ?? '').trim().replace(',', '.');
        const n = Number(text);
        return text === '' || !Number.isFinite(n) ? null : n;
    }

    /** Validación del formulario de restricción; devuelve { errors, restriction }. */
    function validateRestriction(values) {
        const errors = {};
        const type = RESTRICTION_TYPES[values.restrictionType] ? values.restrictionType : null;
        if (!type) errors.restrictionType = 'Elija el tipo de restricción.';
        const title = String(values.title || '').trim();
        if (!title) errors.title = 'Escriba un título (ej. Puente peatonal de la calle 80).';
        const corridor = String(values.roadCorridor || '').trim();
        if (!corridor) errors.roadCorridor = 'Escriba el corredor vial (ej. Bogotá - Tunja).';
        const severity = SEVERITIES[values.severity] ? values.severity : null;
        if (!severity) errors.severity = 'Elija la severidad.';
        const spec = type && RESTRICTION_TYPES[type];
        const limit = number(values.limit);
        if (spec && spec.field && (limit == null || limit < spec.min || limit > spec.max)) {
            errors.limit = `El valor va entre ${spec.min} y ${spec.max} ${spec.unit}.`;
        }
        const lat = number(values.latitude);
        const lon = number(values.longitude);
        if (lat == null || lon == null || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
            errors.location = 'Toque el mapa en el punto de la restricción.';
        }
        if (Object.keys(errors).length) return { errors, restriction: null };
        const restriction = {
            title, roadCorridor: corridor, restrictionType: type, severity,
            description: String(values.description || '').trim() || null,
            department: String(values.department || '').trim() || null,
            latitude: lat, longitude: lon
        };
        if (spec.field) restriction[spec.field] = limit;
        return { errors, restriction };
    }

    function limitText(r) {
        if (r.maxClearanceMeters != null) return window.DriverApp.number(r.maxClearanceMeters, 2, 'm') + ' de altura';
        if (r.maxGrossWeightTons != null) return window.DriverApp.number(r.maxGrossWeightTons, 1, 't') + ' de peso bruto';
        if (r.maxAxleWeightTons != null) return window.DriverApp.number(r.maxAxleWeightTons, 1, 't') + ' por eje';
        return '';
    }

    function shell(state, title, subtitle, actionHtml, bodyHtml) {
        return `
            <div class="h-full w-full flex flex-col bg-slate-950 text-slate-100 overflow-hidden font-sans">
                ${window.CoordinatorPanel.renderHeader(state)}
                <div data-screen class="flex-1 overflow-y-auto p-3 lg:p-6" style="padding-bottom: calc(1rem + var(--safe-bottom))">
                    <div class="max-w-5xl mx-auto">
                        <div class="flex flex-wrap items-end justify-between gap-3 mb-4">
                            <div class="min-w-0">
                                <h2 class="text-lg font-bold text-white">${esc(title)}</h2>
                                <p class="text-xs text-slate-400 mt-0.5">${esc(subtitle)}</p>
                            </div>
                            ${actionHtml}
                        </div>
                        ${bodyHtml}
                    </div>
                </div>
            </div>`;
    }

    function stateBlock(icon, title, text, actionHtml = '') {
        return `
            <div class="bg-slate-900 border border-slate-800 rounded-2xl p-8 text-center">
                <i class="fas ${icon} text-slate-400 text-2xl mb-3 block"></i>
                <p class="font-bold text-sm text-white">${esc(title)}</p>
                <p class="text-xs text-slate-400 mt-1">${esc(text)}</p>
                ${actionHtml}
            </div>`;
    }

    // ------------------------------------------------------------------ restricciones
    function renderRestrictions(state) {
        const status = state.adminStatus || {};
        const list = window.TruckCarData.restrictions || [];
        const action = `
            <button onclick="window.TowerAdmin.openRestrictionForm()" class="px-4 py-2.5 bg-accent-500 hover:bg-accent-600 text-graphite-950 rounded-xl text-xs font-bold transition flex items-center gap-2">
                <i class="fas fa-plus"></i> Nueva restricción
            </button>`;
        let body;
        if (status.restrictions === 'loading' && !list.length) {
            body = stateBlock('fa-spinner fa-spin', 'Cargando restricciones', 'Consultando las restricciones activas.');
        } else if (status.restrictions === 'error') {
            body = stateBlock('fa-triangle-exclamation', 'No se pudieron cargar las restricciones', 'Revise la conexión e intente de nuevo.',
                '<button onclick="window.TowerAdmin.load(\'restrictions\')" class="mt-3 px-4 py-2 bg-slate-800 rounded-xl text-xs font-bold">Reintentar</button>');
        } else if (!list.length) {
            body = stateBlock('fa-road-barrier', 'Sin restricciones activas',
                'Registre un gálibo, un límite de peso o un cierre: los conductores lo verán en su ruta.');
        } else {
            body = `<div class="grid gap-3 md:grid-cols-2">${list.map(r => `
                <article class="bg-slate-900 border border-slate-800 rounded-2xl p-4">
                    <div class="flex items-start justify-between gap-3">
                        <div class="min-w-0">
                            <p class="text-[11px] font-semibold text-slate-400">${esc((RESTRICTION_TYPES[r.restrictionType] || {}).label || r.restrictionType)} · ${esc(SEVERITIES[r.severity] || r.severity)}</p>
                            <h3 class="font-bold text-sm text-white mt-0.5">${esc(r.title)}</h3>
                        </div>
                        <span class="text-sm font-bold text-white whitespace-nowrap">${esc(limitText(r))}</span>
                    </div>
                    <dl class="grid grid-cols-2 gap-x-3 gap-y-1 text-xs mt-3">
                        <dt class="text-slate-400">Corredor</dt><dd class="text-slate-200 text-right">${esc(r.roadCorridor || '—')}</dd>
                        <dt class="text-slate-400">Ubicación</dt><dd class="text-slate-200 text-right font-mono">${r.latitude != null ? esc(Number(r.latitude).toFixed(4) + ', ' + Number(r.longitude).toFixed(4)) : '—'}</dd>
                        <dt class="text-slate-400">Código</dt><dd class="text-slate-200 text-right font-mono">${esc(r.restrictionCode || '—')}</dd>
                    </dl>
                    <button onclick="window.TowerAdmin.deactivateRestriction(${Number(r.id)})" ${state.busyAction === 'restriction-' + r.id ? 'disabled' : ''}
                            class="mt-3 w-full py-2 bg-slate-800 hover:bg-slate-700 disabled:opacity-60 border border-slate-700 rounded-xl text-xs font-bold transition">
                        <i class="fas ${state.busyAction === 'restriction-' + r.id ? 'fa-spinner fa-spin' : 'fa-ban'}"></i> Desactivar
                    </button>
                </article>`).join('')}</div>`;
        }
        return shell(state, 'Restricciones viales', 'Gálibos, límites de peso y cierres que la app del conductor cruza con su ruta.', action, body);
    }

    function openRestrictionForm() {
        const body = document.createElement('form');
        body.noValidate = true;
        body.className = 'space-y-3 text-left';
        const input = 'login-input w-full text-sm';
        const label = (text, html, name) => `
            <label class="block">
                <span class="block text-xs font-semibold text-slate-400 mb-1">${text}</span>
                ${html}
                <span class="field-error hidden" data-error-for="${name}" role="alert"></span>
            </label>`;
        body.innerHTML = `
            <div class="hidden text-xs text-warn-500" data-form-error role="alert"></div>
            ${label('Tipo', `<select name="restrictionType" class="${input}">${Object.entries(RESTRICTION_TYPES).map(([k, v]) => `<option value="${k}">${v.label}</option>`).join('')}</select>`, 'restrictionType')}
            <div data-limit>${label('<span data-limit-label></span>', `<input name="limit" type="number" inputmode="decimal" step="0.01" min="0" class="${input}">`, 'limit')}</div>
            ${label('Título', `<input name="title" maxlength="120" class="${input}" placeholder="Puente peatonal de la Autopista Norte">`, 'title')}
            <div class="grid grid-cols-2 gap-2">
                ${label('Corredor vial', `<input name="roadCorridor" maxlength="120" class="${input}" placeholder="Bogotá - Tunja">`, 'roadCorridor')}
                ${label('Departamento', `<input name="department" maxlength="60" class="${input}" placeholder="Cundinamarca">`, 'department')}
            </div>
            ${label('Severidad', `<select name="severity" class="${input}">${Object.entries(SEVERITIES).map(([k, v]) => `<option value="${k}" ${k === 'PRECAUCION' ? 'selected' : ''}>${v}</option>`).join('')}</select>`, 'severity')}
            ${label('Descripción', `<input name="description" maxlength="250" class="${input}" placeholder="Opcional">`, 'description')}
            <div>
                <span class="block text-xs font-semibold text-slate-400 mb-1">Ubicación · toque el mapa en el punto exacto</span>
                <div id="restriction-map" class="w-full rounded-xl overflow-hidden border border-slate-700" style="height: 220px"></div>
                <p class="text-xs text-slate-400 mt-1 font-mono" data-location>Sin punto elegido</p>
                <span class="field-error hidden" data-error-for="location" role="alert"></span>
                <input type="hidden" name="latitude"><input type="hidden" name="longitude">
            </div>`;

        const typeSelect = body.elements.restrictionType;
        const syncLimit = () => {
            const spec = RESTRICTION_TYPES[typeSelect.value];
            body.querySelector('[data-limit]').classList.toggle('hidden', !spec.field);
            if (spec.field) {
                body.querySelector('[data-limit-label]').textContent = spec.label + ' (' + spec.unit + ')';
                body.elements.limit.placeholder = spec.placeholder;
            }
        };
        typeSelect.addEventListener('change', syncLimit);
        syncLimit();

        const showErrors = (errors) => {
            body.querySelectorAll('[data-error-for]').forEach(el => {
                const message = errors[el.dataset.errorFor];
                el.textContent = message || '';
                el.classList.toggle('hidden', !message);
            });
        };

        let map = null;
        window.Sheet.open({
            title: 'Nueva restricción vial',
            // Routing-Restrictions cruza la ruta con un corredor de 60 m (DEFAULT_CORRIDOR_METERS): el punto va sobre la vía.
            subtitle: 'Toque el punto sobre la vía: la verán los conductores cuya ruta pase a menos de 60 m.',
            icon: 'fa-road-barrier',
            body,
            draggable: false,
            onMount: () => {
                if (!window.L) return;
                const tiles = window.TruckCarConfig.map;
                map = window.L.map(body.querySelector('#restriction-map'), { center: [4.6097, -74.0817], zoom: 11, attributionControl: false });
                window.L.control.attribution({ position: 'bottomleft', prefix: false }).addTo(map);
                window.L.tileLayer(tiles.tileUrl, { maxZoom: tiles.maxZoom, attribution: tiles.attribution, crossOrigin: true }).addTo(map);
                let marker = null;
                map.on('click', (event) => {
                    const { lat, lng } = event.latlng;
                    body.elements.latitude.value = lat.toFixed(6);
                    body.elements.longitude.value = lng.toFixed(6);
                    body.querySelector('[data-location]').textContent = lat.toFixed(5) + ', ' + lng.toFixed(5);
                    if (marker) marker.setLatLng(event.latlng);
                    else marker = window.L.marker(event.latlng).addTo(map);
                });
                // La hoja termina de subir después de montarse: Leaflet necesita medir el contenedor ya visible.
                setTimeout(() => map && map.invalidateSize(), 450);
            },
            actions: [
                {
                    label: 'Registrar restricción', tone: 'primary', icon: 'fa-check',
                    onClick: async () => {
                        const { errors, restriction } = validateRestriction(Object.fromEntries(new FormData(body).entries()));
                        showErrors(errors);
                        if (!restriction) return false;
                        const box = body.querySelector('[data-form-error]');
                        try {
                            await window.TruckCarService.createRestriction(restriction);
                        } catch (error) {
                            box.textContent = 'No se pudo registrar: ' + window.ui.errorMessage(error);
                            box.classList.remove('hidden');
                            return false;
                        }
                        window.ui.toast('Restricción registrada: los conductores la verán en su ruta.', 'success');
                        window.store.setState({});
                        return true;
                    }
                },
                { label: 'Cancelar', tone: 'secondary', value: null }
            ]
        }).then(() => { if (map) map.remove(); });
    }

    async function deactivateRestriction(id) {
        const r = (window.TruckCarData.restrictions || []).find(x => x.id === id);
        const ok = await window.Sheet.confirm({
            title: 'Desactivar la restricción',
            message: (r ? r.title + '. ' : '') + 'Los conductores dejarán de recibir el aviso en su ruta.',
            confirmLabel: 'Desactivar', tone: 'danger'
        });
        if (!ok) return;
        window.store.setState({ busyAction: 'restriction-' + id });
        try {
            await window.TruckCarService.deactivateRestriction(id);
            window.ui.toast('Restricción desactivada.', 'success');
        } catch (error) {
            window.ui.failure('No se pudo desactivar la restricción', error, 'desactivar la restricción');
        } finally {
            window.store.setState({ busyAction: null });
        }
    }

    // ------------------------------------------------------------------ usuarios
    function filterUsers(users, filter) {
        if (!filter || filter === 'all') return users;
        if (filter === 'PENDING_VERIFICATION') return users.filter(u => u.status === 'PENDING_VERIFICATION');
        if (filter === 'tower') return users.filter(u => u.role === 'COORDINADOR' || u.role === 'ADMIN');
        return users.filter(u => u.role === filter);
    }

    function renderUsers(state) {
        const status = state.adminStatus || {};
        const all = window.TruckCarData.users || [];
        const filter = state.adminUserFilter || 'all';
        const users = filterUsers(all, filter);
        const me = state.currentUser && state.currentUser.id;
        const chips = `
            <div class="flex flex-wrap gap-2 mb-3" role="group" aria-label="Filtrar cuentas">
                ${USER_FILTERS.map(([key, text]) => `
                    <button onclick="window.TowerAdmin.setUserFilter('${key}')" aria-pressed="${filter === key}"
                            class="px-3 py-1.5 rounded-lg text-xs font-bold border transition ${filter === key ? 'border-accent-500 text-accent-500 bg-accent-500/10' : 'border-slate-700 text-slate-300 hover:bg-slate-800'}">
                        ${text} <span class="text-slate-400">${filterUsers(all, key).length}</span>
                    </button>`).join('')}
            </div>`;
        let body;
        if (status.users === 'loading' && !all.length) {
            body = stateBlock('fa-spinner fa-spin', 'Cargando cuentas', 'Consultando los usuarios de la plataforma.');
        } else if (status.users === 'error') {
            body = stateBlock('fa-triangle-exclamation', 'No se pudieron cargar las cuentas', 'Revise la conexión e intente de nuevo.',
                '<button onclick="window.TowerAdmin.load(\'users\')" class="mt-3 px-4 py-2 bg-slate-800 rounded-xl text-xs font-bold">Reintentar</button>');
        } else if (!users.length) {
            body = chips + stateBlock('fa-users', 'Sin cuentas en este filtro', 'Elija otro filtro para ver más cuentas.');
        } else {
            body = chips + `<div class="grid gap-3 md:grid-cols-2">${users.map(u => {
                const own = u.id === me;
                const busy = state.busyAction === 'user-' + u.id;
                const name = [u.firstName, u.lastName].filter(Boolean).join(' ') || u.email;
                const statusTone = u.status === 'ACTIVE' ? 'ok' : '';
                return `
                    <article class="bg-slate-900 border border-slate-800 rounded-2xl p-4 min-w-0">
                        <div class="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
                            <div class="min-w-0">
                                <h3 class="font-bold text-sm text-white truncate">${esc(name)}${own ? ' <span class="text-slate-400 font-medium">· su cuenta</span>' : ''}</h3>
                                <p class="text-xs text-slate-400 truncate">${esc(u.email)}</p>
                            </div>
                            <span class="text-xs text-slate-300 whitespace-nowrap flex items-center gap-1.5"><span class="dot ${statusTone}"></span>${esc(STATUSES[u.status] || u.status)}</span>
                        </div>
                        <div class="grid grid-cols-[minmax(0,1fr)_auto] gap-2 mt-3 items-end">
                            <label class="block min-w-0">
                                <span class="block text-[11px] font-semibold text-slate-400 mb-1">Rol</span>
                                <select onchange="window.TowerAdmin.changeRole('${esc(u.id)}', this)" class="login-input w-full text-xs" ${own || busy ? 'disabled' : ''} data-current="${esc(u.role)}">
                                    ${Object.entries(ROLES).map(([k, v]) => `<option value="${k}" ${k === u.role ? 'selected' : ''}>${v}</option>`).join('')}
                                </select>
                            </label>
                            ${own ? '' : u.status === 'ACTIVE'
                                ? `<button onclick="window.TowerAdmin.changeStatus('${esc(u.id)}', 'SUSPENDED')" ${busy ? 'disabled' : ''} class="px-3 py-2.5 bg-slate-800 hover:bg-slate-700 disabled:opacity-60 border border-slate-700 rounded-xl text-xs font-bold">Suspender</button>`
                                : `<button onclick="window.TowerAdmin.changeStatus('${esc(u.id)}', 'ACTIVE')" ${busy ? 'disabled' : ''} class="px-3 py-2.5 bg-accent-500 hover:bg-accent-600 disabled:opacity-60 text-graphite-950 rounded-xl text-xs font-bold">${u.status === 'PENDING_VERIFICATION' ? 'Verificar' : 'Reactivar'}</button>`}
                        </div>
                    </article>`;
            }).join('')}</div>`;
        }
        const action = `<button onclick="window.TowerAdmin.load('users')" class="px-4 py-2.5 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-xl text-xs font-bold flex items-center gap-2"><i class="fas fa-rotate"></i> Actualizar</button>`;
        return shell(state, 'Usuarios', 'Roles y estado de las cuentas. Los coordinadores se crean aquí: el registro público solo crea conductores y generadores.', action, body);
    }

    async function changeRole(userId, select) {
        const user = (window.TruckCarData.users || []).find(u => u.id === userId);
        const role = select.value;
        if (!user || role === user.role) return;
        const ok = await window.Sheet.confirm({
            title: 'Cambiar el rol',
            message: `${[user.firstName, user.lastName].filter(Boolean).join(' ') || user.email} pasará de ${ROLES[user.role]} a ${ROLES[role]}. El cambio aplica en su próximo inicio de sesión.`,
            confirmLabel: 'Cambiar rol'
        });
        if (!ok) {
            select.value = user.role;
            return;
        }
        window.store.setState({ busyAction: 'user-' + userId });
        try {
            await window.TruckCarService.changeUserRole(userId, role);
            window.ui.toast('Rol actualizado: ' + ROLES[role] + '.', 'success');
        } catch (error) {
            window.ui.failure('No se pudo cambiar el rol', error, 'cambiar el rol');
        } finally {
            window.store.setState({ busyAction: null });
        }
    }

    async function changeStatus(userId, status) {
        const user = (window.TruckCarData.users || []).find(u => u.id === userId);
        if (!user) return;
        if (status === 'SUSPENDED') {
            const ok = await window.Sheet.confirm({
                title: 'Suspender la cuenta',
                message: (user.email || '') + ' no podrá iniciar sesión hasta que la reactive.',
                confirmLabel: 'Suspender', tone: 'danger'
            });
            if (!ok) return;
        }
        window.store.setState({ busyAction: 'user-' + userId });
        try {
            await window.TruckCarService.changeUserStatus(userId, status);
            window.ui.toast(status === 'ACTIVE' ? 'Cuenta activa.' : 'Cuenta suspendida.', 'success');
        } catch (error) {
            window.ui.failure('No se pudo cambiar el estado', error, 'cambiar el estado de la cuenta');
        } finally {
            window.store.setState({ busyAction: null });
        }
    }

    function setUserFilter(filter) {
        window.store.setState({ adminUserFilter: filter });
    }

    /** Carga los datos de la pestaña; el estado de carga va en adminStatus para los vacíos y errores. */
    async function load(tab) {
        const setStatus = (value) => window.store.setState({ adminStatus: { ...(window.store.state.adminStatus || {}), [tab]: value } });
        setStatus('loading');
        try {
            if (tab === 'users') await window.TruckCarService.loadUsers();
            else await window.TruckCarService.loadRestrictions();
            setStatus('ready');
        } catch (error) {
            console.error('[TruckCar] Error cargando ' + tab, error);
            setStatus('error');
        }
    }

    function render(state, tab) {
        return tab === 'users' ? renderUsers(state) : renderRestrictions(state);
    }

    return {
        render, load, openRestrictionForm, deactivateRestriction, changeRole, changeStatus, setUserFilter,
        validateRestriction, filterUsers, RESTRICTION_TYPES
    };
})();

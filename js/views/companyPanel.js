// Empresas transportadoras y afiliación de conductores.
//  - CompanyPanel: «Mis conductores» de la cuenta TRANSPORTADORA (solicitudes, afiliados, registrar, desvincular).
//  - DriverAffiliation: qué ve el conductor según su tipo (independiente o de empresa) y el selector para cambiarlo.
window.DriverAffiliation = (function () {
    const esc = (value) => window.ui.escape(value);

    /** Por qué la afiliación no le deja recibir cargas, o null si sí puede. */
    function loadsBlockedReason(user) {
        if (!user || user.role !== 'CONDUCTOR') return null;
        if (!user.driverType) {
            return 'Aún no ha indicado si es independiente o de una transportadora: no recibirá cargas hasta que lo elija.';
        }
        if (user.driverType === 'INDEPENDIENTE') {
            return 'Es conductor independiente: tiene la navegación para camión y las alertas, pero no recibe cargas.';
        }
        const company = user.companyName || 'su transportadora';
        if (user.affiliationStatus === 'PENDIENTE') return company + ' aún no aprueba su afiliación: recibirá cargas cuando la apruebe.';
        if (user.affiliationStatus === 'RECHAZADA') return company + ' rechazó su afiliación. Puede pedirla a otra transportadora o seguir como independiente.';
        return null;
    }

    /** Solo el conductor de una transportadora con la afiliación aprobada recibe cargas (y aparece en la torre). */
    function receivesLoads(user) {
        return !!(user && user.role === 'CONDUCTOR' && user.driverType === 'EMPRESA' && user.affiliationStatus === 'ACTIVA');
    }

    function summary(user) {
        if (!user || !user.driverType) return 'Sin definir';
        if (user.driverType === 'INDEPENDIENTE') return 'Independiente';
        const states = { PENDIENTE: 'pendiente', ACTIVA: 'activa', RECHAZADA: 'rechazada' };
        return (user.companyName || 'Transportadora') + ' · afiliación ' + (states[user.affiliationStatus] || '—');
    }

    /** Aviso para la pantalla del conductor (vehículo y carga). */
    function noticeHtml(user) {
        if (!user || user.role !== 'CONDUCTOR') return '';
        if (!user.driverType) {
            // Cuentas anteriores a la afiliación (o creadas con una versión vieja de la app): no reciben cargas hasta
            // elegir su tipo, y lo pueden hacer desde aquí.
            return `
            <div class="notice" data-affiliation-notice>
                <div class="warn-line"><svg class="ui-icon" aria-hidden="true"><use href="assets/icons.svg#truck"></use></svg><span>Tipo de conductor sin definir</span></div>
                <p>Indique si es independiente o si trabaja para una transportadora. No recibirá cargas hasta que lo elija.</p>
                <button type="button" onclick="window.DriverAffiliation.openChooser()" class="btn-quiet mt-2">Elegir tipo de conductor</button>
            </div>`;
        }
        const reason = loadsBlockedReason(user);
        const title = user.driverType === 'INDEPENDIENTE' ? 'Conductor independiente'
            : user.affiliationStatus === 'ACTIVA' ? 'Conductor de ' + (user.companyName || 'su transportadora')
                : 'Afiliación ' + (user.affiliationStatus === 'RECHAZADA' ? 'rechazada' : 'pendiente');
        const icon = reason && user.driverType === 'EMPRESA' ? 'warning-fill' : 'truck';
        return `
            <div class="notice" data-affiliation-notice>
                <div class="warn-line"><svg class="ui-icon" aria-hidden="true"><use href="assets/icons.svg#${icon}"></use></svg><span>${esc(title)}</span></div>
                <p>${esc(reason || 'Recibe las cargas que la plataforma asigna a los conductores de su transportadora.')}</p>
                <button type="button" onclick="window.DriverAffiliation.openChooser()" class="btn-quiet mt-2">Cambiar tipo de conductor</button>
            </div>`;
    }

    async function openChooser() {
        const user = window.store.state.currentUser;
        const body = document.createElement('form');
        body.noValidate = true;
        body.className = 'space-y-3 text-left';
        body.innerHTML = `
            <div class="hidden text-xs text-warn-500" data-form-error role="alert"></div>
            <label class="flex items-start gap-3 p-3 rounded-xl border border-slate-700 cursor-pointer">
                <input type="radio" name="driverType" value="INDEPENDIENTE" ${!user || user.driverType !== 'EMPRESA' ? 'checked' : ''} class="mt-1">
                <span><b class="block text-sm">Independiente</b><span class="text-xs text-slate-400">Navegación, rutas y alertas. Sin cargas de la plataforma.</span></span>
            </label>
            <label class="flex items-start gap-3 p-3 rounded-xl border border-slate-700 cursor-pointer">
                <input type="radio" name="driverType" value="EMPRESA" ${user && user.driverType === 'EMPRESA' ? 'checked' : ''} class="mt-1">
                <span><b class="block text-sm">De una transportadora</b><span class="text-xs text-slate-400">Recibe cargas cuando su empresa aprueba la afiliación.</span></span>
            </label>
            <label class="block" data-company-field>
                <span class="block text-xs font-semibold text-slate-400 mb-1">Transportadora</span>
                <select name="companyId" class="login-input w-full text-sm"><option value="">Cargando transportadoras…</option></select>
            </label>`;
        const select = body.elements.companyId;
        const sync = () => {
            const company = body.querySelector('input[name="driverType"]:checked').value === 'EMPRESA';
            body.querySelector('[data-company-field]').hidden = !company;
        };
        body.querySelectorAll('input[name="driverType"]').forEach(r => r.addEventListener('change', sync));
        sync();
        window.TruckCarService.loadCompanyCatalog().then(companies => {
            select.replaceChildren(...[{ id: '', name: companies.length ? 'Elija su transportadora' : 'Aún no hay transportadoras registradas' }, ...companies]
                .map(c => Object.assign(document.createElement('option'), { value: c.id, textContent: c.name })));
            if (user && user.companyId) select.value = user.companyId;
        }).catch(() => {
            select.replaceChildren(Object.assign(document.createElement('option'), { value: '', textContent: 'No se pudieron cargar las transportadoras' }));
        });

        await window.Sheet.open({
            title: 'Tipo de conductor',
            subtitle: 'Un conductor independiente usa la navegación; uno de transportadora además recibe cargas.',
            icon: 'fa-id-card',
            body,
            actions: [
                {
                    label: 'Guardar', tone: 'primary', icon: 'fa-check',
                    onClick: async () => {
                        const driverType = body.querySelector('input[name="driverType"]:checked').value;
                        const box = body.querySelector('[data-form-error]');
                        const choice = driverType === 'EMPRESA' ? { driverType, companyId: select.value } : { driverType };
                        if (driverType === 'EMPRESA' && !choice.companyId) {
                            box.textContent = 'Elija la transportadora a la que pertenece.';
                            box.classList.remove('hidden');
                            return false;
                        }
                        try {
                            const updated = await window.TruckCarService.changeMyAffiliation(choice);
                            window.ui.toast(updated.driverType === 'EMPRESA'
                                ? 'Solicitud enviada a ' + (updated.companyName || 'la transportadora') + '.'
                                : 'Ahora es conductor independiente.', 'success');
                        } catch (error) {
                            box.textContent = 'No se pudo guardar: ' + window.ui.errorMessage(error);
                            box.classList.remove('hidden');
                            return false;
                        }
                        return true;
                    }
                },
                { label: 'Cancelar', tone: 'secondary', value: null }
            ]
        });
    }

    return { loadsBlockedReason, receivesLoads, summary, noticeHtml, openChooser };
})();

window.CompanyPanel = (function () {
    const esc = (value) => window.ui.escape(value);
    const STATES = {
        PENDIENTE: ['Pendiente', 'warn'],
        ACTIVA: ['Activa', 'ok'],
        RECHAZADA: ['Rechazada', '']
    };
    const ACCOUNT = { ACTIVE: 'Cuenta verificada', PENDING_VERIFICATION: 'Cuenta sin verificar', SUSPENDED: 'Cuenta suspendida' };

    function driverName(d) {
        return [d.firstName, d.lastName].filter(Boolean).join(' ') || d.email;
    }

    /** Solicitudes pendientes primero, luego activas, luego rechazadas; dentro de cada grupo, por nombre. */
    function sortDrivers(drivers) {
        const rank = { PENDIENTE: 0, ACTIVA: 1, RECHAZADA: 2 };
        return [...drivers].sort((a, b) => (rank[a.affiliationStatus] ?? 3) - (rank[b.affiliationStatus] ?? 3)
            || driverName(a).localeCompare(driverName(b), 'es'));
    }

    function driverCard(d, state) {
        const [label, tone] = STATES[d.affiliationStatus] || ['—', ''];
        const busy = state.busyAction === 'company-' + d.id;
        const actions = d.affiliationStatus === 'PENDIENTE'
            ? `<button onclick="window.companyCtrl.decide('${esc(d.id)}', 'ACTIVA')" ${busy ? 'disabled' : ''} class="px-3 py-2 bg-accent-500 hover:bg-accent-600 disabled:opacity-60 text-graphite-950 rounded-xl text-xs font-bold">Aprobar</button>
               <button onclick="window.companyCtrl.decide('${esc(d.id)}', 'RECHAZADA')" ${busy ? 'disabled' : ''} class="px-3 py-2 bg-slate-800 hover:bg-slate-700 disabled:opacity-60 border border-slate-700 rounded-xl text-xs font-bold">Rechazar</button>`
            : d.affiliationStatus === 'ACTIVA'
                ? `<button onclick="window.companyCtrl.unlink('${esc(d.id)}')" ${busy ? 'disabled' : ''} class="px-3 py-2 bg-slate-800 hover:bg-slate-700 disabled:opacity-60 border border-slate-700 rounded-xl text-xs font-bold">Desvincular</button>`
                : `<button onclick="window.companyCtrl.decide('${esc(d.id)}', 'ACTIVA')" ${busy ? 'disabled' : ''} class="px-3 py-2 bg-slate-800 hover:bg-slate-700 disabled:opacity-60 border border-slate-700 rounded-xl text-xs font-bold">Aprobar de nuevo</button>`;
        return `
            <article class="bg-slate-900 border border-slate-800 rounded-2xl p-4 min-w-0" data-company-driver="${esc(d.id)}">
                <div class="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
                    <div class="min-w-0">
                        <h3 class="font-bold text-sm text-white truncate">${esc(driverName(d))}</h3>
                        <p class="text-xs text-slate-400 truncate">${esc(d.email)}${d.phoneNumber ? ' · ' + esc(d.phoneNumber) : ''}</p>
                    </div>
                    <span class="text-xs text-slate-300 whitespace-nowrap flex items-center gap-1.5"><span class="dot ${tone}"></span>Afiliación ${esc(label.toLowerCase())}</span>
                </div>
                <p class="text-xs text-slate-400 mt-2">${esc(ACCOUNT[d.status] || d.status || '')}${d.status !== 'ACTIVE' ? ' · la plataforma la verifica antes de asignarle cargas' : ''}</p>
                <div class="flex flex-wrap gap-2 mt-3">${actions}</div>
            </article>`;
    }

    function tab(key, icon, label, state) {
        const active = (state.companyTab || 'fleet') === key;
        return `<button type="button" onclick="window.store.setState({ companyTab: '${key}' })" ${active ? 'aria-current="page"' : ''}
            class="px-4 py-2 rounded-xl text-xs font-bold flex items-center gap-2 ${active ? 'bg-accent-500 text-graphite-950' : 'bg-slate-900 border border-slate-800 text-slate-300 hover:text-white'}"><i class="fas ${icon}"></i>${label}</button>`;
    }

    function stat(label, value, key) {
        return `
            <div class="px-3 py-1.5 bg-slate-800/80 border border-slate-700/60 rounded-xl text-center">
                <span class="text-xs text-slate-400 font-medium block">${label}</span>
                <span class="text-sm font-bold text-white font-mono" data-count="${value}" data-count-key="${key}">${value}</span>
            </div>`;
    }

    function render(state) {
        const company = window.TruckCarData.company;
        const drivers = sortDrivers(window.TruckCarData.companyDrivers || []);
        const errors = state.dataStatus.errors || {};
        const user = state.currentUser;
        const pending = drivers.filter(d => d.affiliationStatus === 'PENDIENTE');
        const others = drivers.filter(d => d.affiliationStatus !== 'PENDIENTE');
        let body;
        if (errors.company && !company) {
            body = `<div class="text-center py-16 px-4"><i class="fas fa-triangle-exclamation text-2xl text-slate-400"></i>
                <h2 class="font-bold text-white mt-3">No se pudo cargar su empresa</h2>
                <p class="text-sm text-slate-400 mt-1">Revise la conexión e intente de nuevo.</p>
                <button onclick="window.companyCtrl.refresh()" class="mt-4 px-4 py-2 bg-slate-800 rounded-xl text-xs font-bold">Reintentar</button></div>`;
        } else if (!company) {
            body = `<div class="text-center py-16 text-sm text-slate-400"><i class="fas fa-spinner fa-spin"></i> Cargando su empresa…</div>`;
        } else if ((state.companyTab || 'fleet') === 'fleet') {
            body = window.CompanyFleet.render(state);
        } else {
            body = `
                <section class="mb-6">
                    <div class="flex flex-wrap items-end justify-between gap-3 mb-3">
                        <div>
                            <h2 class="font-bold text-white">Solicitudes de afiliación</h2>
                            <p class="text-xs text-slate-400 mt-0.5">Conductores que eligieron su empresa al registrarse. Al aprobarlos empiezan a recibir cargas.</p>
                        </div>
                    </div>
                    ${pending.length ? `<div class="grid gap-3 md:grid-cols-2">${pending.map(d => driverCard(d, state)).join('')}</div>`
                        : '<p class="text-sm text-slate-400 bg-slate-900 border border-slate-800 rounded-2xl p-4">No hay solicitudes pendientes.</p>'}
                </section>
                <section>
                    <div class="flex flex-wrap items-end justify-between gap-3 mb-3">
                        <div>
                            <h2 class="font-bold text-white">Conductores</h2>
                            <p class="text-xs text-slate-400 mt-0.5">Los afiliados reciben las cargas que la plataforma asigna; al desvincular uno queda como independiente.</p>
                        </div>
                        <button onclick="window.companyCtrl.openRegisterDriver()" class="px-4 py-2.5 bg-accent-500 hover:bg-accent-600 text-graphite-950 rounded-xl text-xs font-bold flex items-center gap-2"><i class="fas fa-user-plus"></i> Registrar conductor</button>
                    </div>
                    ${others.length ? `<div class="grid gap-3 md:grid-cols-2">${others.map(d => driverCard(d, state)).join('')}</div>`
                        : '<p class="text-sm text-slate-400 bg-slate-900 border border-slate-800 rounded-2xl p-4">Aún no tiene conductores. Regístrelos aquí o pídales que elijan su empresa al crear su cuenta.</p>'}
                </section>`;
        }
        return `
            <div class="h-full w-full flex flex-col bg-slate-950 text-slate-100 overflow-hidden font-sans">
                <header class="min-h-16 px-4 lg:px-6 py-2 bg-slate-900 border-b border-slate-800 flex flex-wrap items-center justify-between z-30 shrink-0 gap-x-4 gap-y-2">
                    <div class="flex items-center gap-3 min-w-0">
                        <div class="w-10 h-10 rounded-xl bg-slate-800 flex items-center justify-center text-slate-100"><i class="fas fa-truck-moving text-lg"></i></div>
                        <div class="min-w-0">
                            <h1 class="text-[15px] lg:text-base font-bold text-white tracking-tight">${(state.companyTab || 'fleet') === 'fleet' ? 'Mi flota' : 'Mis conductores'}</h1>
                            <p class="text-xs text-slate-400 truncate">${company ? esc(company.name) + ' · NIT ' + esc(company.nit) : 'Empresa transportadora'}</p>
                        </div>
                    </div>
                    <div class="flex items-center gap-3">
                        ${stat('Afiliados', company ? company.activeDrivers : 0, 'company-active')}
                        ${stat('Solicitudes', company ? company.pendingRequests : 0, 'company-pending')}
                        <div class="hidden md:block text-xs font-bold text-slate-200 pl-3 border-l border-slate-800">${esc(user ? user.firstName + ' ' + user.lastName : 'Transportadora')}</div>
                        <button onclick="window.TwoFactorUI.open()" class="w-9 h-9 rounded-xl grid place-items-center text-slate-400 hover:text-white text-xs" title="Seguridad de la cuenta" aria-label="Seguridad de la cuenta" data-security-button><i class="fas fa-shield-halved"></i></button>
                        <button onclick="window.app.logout()" class="w-9 h-9 rounded-xl grid place-items-center text-slate-400 hover:text-white text-xs" title="Cerrar sesión" aria-label="Cerrar sesión"><i class="fas fa-right-from-bracket"></i></button>
                    </div>
                </header>
                ${window.ui.syncBanner(state)}
                <nav class="px-3 lg:px-6 pt-3 flex gap-2 shrink-0" aria-label="Secciones de la empresa">
                    ${tab('fleet', 'fa-map-location-dot', 'Mi flota', state)}
                    ${tab('drivers', 'fa-users', 'Conductores', state)}
                </nav>
                <div data-screen class="flex-1 overflow-y-auto p-3 lg:p-6" style="padding-bottom: calc(1rem + var(--safe-bottom))">
                    ${user && user.status === 'PENDING_VERIFICATION' ? `<div class="notice mb-4"><div class="warn-line"><span>Cuenta pendiente de verificación</span></div><p>Puede gestionar a sus conductores; un administrador de la plataforma verificará su empresa.</p></div>` : ''}
                    ${body}
                </div>
            </div>`;
    }

    return { render, sortDrivers };
})();

window.companyCtrl = {
    async refresh() {
        await window.TruckCarService.loadCompany();
        window.store.setState({});
    },

    async decide(driverId, status) {
        const driver = (window.TruckCarData.companyDrivers || []).find(d => d.id === driverId);
        const name = driver ? [driver.firstName, driver.lastName].filter(Boolean).join(' ') : 'El conductor';
        if (status === 'RECHAZADA') {
            const ok = await window.Sheet.confirm({
                title: 'Rechazar la afiliación',
                message: name + ' no recibirá cargas como conductor de su empresa. Podrá pedir la afiliación de nuevo.',
                confirmLabel: 'Rechazar', tone: 'danger'
            });
            if (!ok) return;
        }
        window.store.setState({ busyAction: 'company-' + driverId });
        try {
            await window.TruckCarService.decideAffiliation(driverId, status);
            window.ui.toast(status === 'ACTIVA' ? name + ' ya es conductor de su empresa.' : 'Afiliación rechazada.', 'success');
        } catch (error) {
            window.ui.failure('No se pudo responder la solicitud', error, 'responder la solicitud');
        } finally {
            window.store.setState({ busyAction: null });
        }
    },

    async unlink(driverId) {
        const driver = (window.TruckCarData.companyDrivers || []).find(d => d.id === driverId);
        const name = driver ? [driver.firstName, driver.lastName].filter(Boolean).join(' ') : 'El conductor';
        const ok = await window.Sheet.confirm({
            title: 'Desvincular al conductor',
            message: name + ' quedará como conductor independiente y dejará de recibir las cargas de su empresa.',
            confirmLabel: 'Desvincular', tone: 'danger'
        });
        if (!ok) return;
        window.store.setState({ busyAction: 'company-' + driverId });
        try {
            await window.TruckCarService.unlinkCompanyDriver(driverId);
            window.ui.toast(name + ' fue desvinculado.', 'success');
        } catch (error) {
            window.ui.failure('No se pudo desvincular', error, 'desvincular al conductor');
        } finally {
            window.store.setState({ busyAction: null });
        }
    },

    async openRegisterDriver() {
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
            <div class="grid grid-cols-2 gap-2">
                ${label('Nombre', `<input name="firstName" maxlength="100" autocomplete="off" class="${input}">`, 'firstName')}
                ${label('Apellido', `<input name="lastName" maxlength="100" autocomplete="off" class="${input}">`, 'lastName')}
            </div>
            ${label('Correo', `<input name="email" type="email" inputmode="email" autocapitalize="none" autocomplete="off" class="${input}">`, 'email')}
            ${label('Teléfono · opcional', `<input name="phoneNumber" type="tel" inputmode="tel" maxlength="20" class="${input}">`, 'phoneNumber')}
            ${label('Contraseña inicial · mínimo 8 caracteres', `<input name="password" type="text" autocomplete="new-password" class="${input}">`, 'password')}
            <p class="text-xs text-slate-400">Entréguele el correo y la contraseña al conductor. Queda afiliado a su empresa; la plataforma verifica su cuenta antes de asignarle cargas.</p>`;
        const showErrors = (errors) => body.querySelectorAll('[data-error-for]').forEach(el => {
            el.textContent = errors[el.dataset.errorFor] || '';
            el.classList.toggle('hidden', !errors[el.dataset.errorFor]);
        });
        await window.Sheet.open({
            title: 'Registrar conductor',
            subtitle: 'El conductor entra a la app con estos datos y recibe las cargas de su empresa.',
            icon: 'fa-user-plus',
            body,
            actions: [
                {
                    label: 'Registrar', tone: 'primary', icon: 'fa-check',
                    onClick: async () => {
                        const values = Object.fromEntries(new FormData(body).entries());
                        const { errors, driver } = window.companyCtrl.validateDriver(values);
                        showErrors(errors);
                        if (!driver) return false;
                        const box = body.querySelector('[data-form-error]');
                        try {
                            await window.TruckCarService.registerCompanyDriver(driver);
                        } catch (error) {
                            box.textContent = 'No se pudo registrar: ' + window.ui.errorMessage(error);
                            box.classList.remove('hidden');
                            return false;
                        }
                        window.ui.toast(driver.firstName + ' quedó registrado en su empresa.', 'success');
                        window.store.setState({});
                        return true;
                    }
                },
                { label: 'Cancelar', tone: 'secondary', value: null }
            ]
        });
    },

    /** Valida el formulario de registro de un conductor propio; devuelve los errores por campo o el cuerpo a enviar. */
    validateDriver(values) {
        const text = (name) => String(values[name] || '').trim();
        const errors = {};
        if (!text('firstName')) errors.firstName = 'Escriba el nombre.';
        if (!text('lastName')) errors.lastName = 'Escriba el apellido.';
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text('email'))) errors.email = 'Escriba un correo válido.';
        if (String(values.password || '').length < 8) errors.password = 'La contraseña debe tener al menos 8 caracteres.';
        if (Object.keys(errors).length) return { errors, driver: null };
        return {
            errors,
            driver: {
                firstName: text('firstName'), lastName: text('lastName'), email: text('email'),
                phoneNumber: text('phoneNumber') || null, password: String(values.password)
            }
        };
    }
};

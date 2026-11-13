window.DriverApp = {
    statusLabel(code) {
        return window.ui.statusLabel(code);
    },

    render(state) {
        const currentScreen = state.driverScreen;
        const isLandscape = state.isLandscape;

        let screenContent = '';
        if (currentScreen === 'profile') {
            screenContent = this.renderProfileScreen(state);
        } else if (currentScreen === 'assigned_load') {
            screenContent = this.renderAssignedLoadScreen(state);
        } else if (currentScreen === 'route_overview') {
            screenContent = this.renderRouteOverviewScreen(state);
        } else if (currentScreen === 'navigation') {
            screenContent = this.renderNavigationScreen(state, isLandscape);
        } else if (currentScreen === 'alerts') {
            screenContent = this.renderAlertsScreen(state);
        } else if (currentScreen === 'offline') {
            screenContent = this.renderOfflineScreen(state);
        }

        return `
            <div class="h-full w-full flex flex-col bg-slate-950 text-slate-100 overflow-hidden relative select-none">
                <header class="app-header">
                    <span class="wordmark">TruckCar</span>
                    <span data-network-status aria-live="polite" class="min-w-0"></span>
                    <span class="app-header-spacer"></span>
                    <button type="button" onclick="window.DriverActions.confirmLogout(this)" class="header-icon-btn" title="Cerrar sesión" aria-label="Cerrar sesión">
                        ${this.icon('sign-out')}
                    </button>
                </header>

                ${window.ui.syncBanner(state)}

                <div data-screen class="flex-1 relative overflow-hidden flex flex-col">
                    ${screenContent}
                </div>

                ${(isLandscape && currentScreen === 'navigation') ? '' : `
                    <nav class="driver-tabbar z-40" aria-label="Secciones del conductor">
                        ${this.TABS.map(([screen, label, icon]) => this.tabButton(currentScreen, screen, label, icon)).join('')}
                    </nav>
                `}
            </div>
        `;
    },

    TABS: [
        ['profile', 'Vehículo', 'truck'],
        ['assigned_load', 'Carga', 'package'],
        ['route_overview', 'Rutas', 'path'],
        ['navigation', 'Navegar', 'navigation-arrow'],
        ['alerts', 'Alertas', 'bell'],
        ['offline', 'Offline', 'cloud-arrow-down']
    ],

    tabButton(currentScreen, screen, label, icon) {
        const active = currentScreen === screen;
        const badge = screen === 'assigned_load' && this.hasPendingLoad() ? '<span class="driver-tab-badge" aria-label="Carga pendiente"></span>'
            : screen === 'offline' ? this.offlineBadgeHtml() : '';
        return `
            <button onclick="window.store.setState({ driverScreen: '${screen}' })" ${active ? 'aria-current="page"' : ''} class="driver-tab ${active ? 'is-active' : ''}">
                <svg aria-hidden="true"><use href="assets/icons.svg#${icon}${active ? '-fill' : ''}"></use></svg>
                <span>${label}</span>${badge}
            </button>`;
    },

    offlineBadgeHtml() {
        const pending = window.OfflineQueue ? window.OfflineQueue.status().pending || 0 : 0;
        if (!pending) return '<span data-offline-badge hidden></span>';
        const text = pending + (pending === 1 ? ' acción guardada sin enviar' : ' acciones guardadas sin enviar');
        return `<span data-offline-badge><span class="driver-tab-count" aria-hidden="true">${pending > 99 ? '99+' : pending}</span><span class="sr-only">, ${text}</span></span>`;
    },

    renderOfflineBadge() {
        document.querySelectorAll('[data-offline-badge]').forEach(el => { el.outerHTML = this.offlineBadgeHtml(); });
    },

    hasPendingLoad() {
        const load = window.TruckCarData.activeLoadOrder;
        const actions = load ? window.TruckCarService.loadActions(load) : {};
        return Boolean(actions.awaitNotification || actions.respond);
    },

    destinationLabel() {
        const load = window.TruckCarData.activeLoadOrder;
        return load ? load.destination.city || load.destination.name : 'Sin destino';
    },

    TRUCK_TYPES: {
        TRACTOMULA_3S3: 'Tractocamión 3S3', TRACTOMULA_3S2: 'Tractocamión 3S2', MINIMULA: 'Minimula',
        DOBLETROQUE: 'Doble troque', CUATRO_MANOS: 'Cuatro manos', SENCILLO: 'Sencillo', TURBO: 'Turbo',
        REFRIGERADO: 'Refrigerado'
    },

    truckTypeLabel(code) {
        if (!code || code === '—') return 'Sin información';
        return this.TRUCK_TYPES[code] || this.statusLabel(code);
    },

    icon(name, cls = '') {
        return `<svg class="ui-icon ${cls}" aria-hidden="true"><use href="assets/icons.svg#${name}"></use></svg>`;
    },

    number(value, digits, unit) {
        if (typeof value !== 'number' || Number.isNaN(value)) return window.ui.NOT_AVAILABLE;
        return value.toLocaleString('es-CO', { minimumFractionDigits: digits, maximumFractionDigits: digits }) + (unit ? ' ' + unit : '');
    },

    plateText(plate) {
        return String(plate || '').replace(/[-\s]+/g, ' ').trim();
    },

    listRow(label, valueHtml, strong = false) {
        return `<div class="list-row"><span class="list-label">${window.ui.escape(label)}</span><span class="list-value${strong ? ' is-strong' : ''}">${valueHtml}</span></div>`;
    },

    dotText(text, tone = '') {
        return `<span class="dot${tone ? ' ' + tone : ''}" aria-hidden="true"></span>${window.ui.escape(text)}`;
    },

    warnLine(text, sub = '') {
        return `<div class="warn-line">${this.icon('warning-fill')}<span>${window.ui.escape(text)}${sub ? ` <span class="warn-sub">${window.ui.escape(sub)}</span>` : ''}</span></div>`;
    },

    spinner() {
        return '<span class="spinner" aria-hidden="true"></span>';
    },

    renderEmptyState(icon, title, text, actionHtml = '') {
        return `
            <div class="screen-scroll">
                <div class="empty-state">
                    <div class="empty-mark">${icon === 'loading' ? this.spinner() : this.icon(icon)}</div>
                    <h2>${title}</h2>
                    <p>${text}</p>
                    ${actionHtml}
                </div>
            </div>
        `;
    },

    renderProfileScreen(state) {
        const esc = window.ui.escape;
        const driver = window.TruckCarData.currentDriver;
        const themeSetting = window.TruckCarTheme
            ? `<div class="theme-setting list-row"><span class="list-label">Apariencia</span>${window.TruckCarTheme.selector()}</div>`
            : '';
        if (!driver) {
            const empty = state.dataStatus.loading
                ? this.renderEmptyState('loading', 'Cargando el perfil', 'Consultando sus datos y los del vehículo.')
                : this.renderEmptyState('warning', 'No se pudo cargar el perfil', 'Revise la señal e intente de nuevo.',
                    `<button onclick="window.app.reloadData()" class="btn-quiet">${this.icon('arrows-clockwise')}Reintentar</button>`);
            return `<div class="screen-scroll"><h1 class="large-title">Perfil</h1>${themeSetting}${empty}</div>`;
        }
        const v = driver.vehicle;
        const load = window.TruckCarData.activeLoadOrder;
        const status = this.statusLabel(driver.status) + (load && window.TruckCarService.loadActions(load).deliver ? ' · ' + load.id : '');
        const na = window.ui.NOT_AVAILABLE;
        const rating = typeof driver.rating === 'number' ? this.number(driver.rating, 1) + ' de 5' : na;
        const yes = (on, onText, offText) => on === null || on === undefined ? esc(na) : this.dotText(on ? onText : offText, on ? 'ok' : '');
        const hours = typeof driver.hoursDrivenToday === 'number' && typeof driver.maxDailyHours === 'number'
            ? this.number(driver.hoursDrivenToday, 1, 'h') + ' de ' + this.number(driver.maxDailyHours, 0, 'h')
            : typeof driver.hoursDrivenToday === 'number' ? this.number(driver.hoursDrivenToday, 1, 'h') : na;
        const rest = driver.restRequired === null || driver.restRequired === undefined ? esc(na)
            : driver.restRequired
                ? this.warnLine('Descanso requerido', driver.mandatoryRestLocation ? '· ' + driver.mandatoryRestLocation : '')
                : this.dotText('No requerido', 'ok');

        return `
            <div class="screen-scroll">
                <h1 class="large-title">Vehículo</h1>
                ${themeSetting}
                ${v ? `
                    <div class="vehicle-id">
                        <span class="plate" aria-label="Placa ${esc(v.plate)}">${esc(this.plateText(v.plate))}</span>
                        <div class="min-w-0">
                            <div class="vehicle-model">${esc(v.brand && v.brand !== '—' ? v.brand : 'Modelo sin información')}</div>
                            <div class="secondary">${esc(this.truckTypeLabel(v.category))}</div>
                        </div>
                    </div>` : `
                    <div class="notice">
                        ${this.warnLine('Sin vehículo registrado')}
                        <p>La torre de control debe registrar su vehículo para planear rutas compatibles con su altura y peso.</p>
                    </div>`}

                <h2 class="list-title">Conductor</h2>
                <div class="list">
                    ${this.listRow('Nombre', esc(driver.name), true)}
                    ${this.listRow('Categoría de licencia', esc(window.ui.orNotAvailable(driver.licenseCategory)))}
                    ${this.listRow('Cuenta', yes(driver.accountVerified, 'Verificada', 'Sin verificar'))}
                    ${this.listRow('Calificación', esc(rating))}
                    ${this.listRow('Viajes completados', esc(window.ui.orNotAvailable(driver.tripsCompleted)))}
                    ${this.listRow('Horas de conducción hoy', esc(hours))}
                    ${this.listRow('Horas de conducción restantes', esc(this.number(driver.remainingDrivingHours, 1, 'h')))}
                    ${this.listRow('Descanso', rest)}
                    ${this.listRow('Parada de descanso obligatoria', esc(window.ui.orNotAvailable(driver.mandatoryRestLocation)))}
                    ${this.listRow('En viaje', yes(driver.onTrip, 'Sí', 'No'))}
                    ${this.listRow('Estado', this.dotText(status, driver.onTrip ? 'ok' : ''))}
                </div>

                ${v ? `
                    <h2 class="list-title">Dimensiones y peso</h2>
                    <div class="list">
                        ${this.listRow('Gálibo (altura)', esc(this.number(v.height, 2, 'm')), true)}
                        ${this.listRow('Capacidad de carga', esc(this.number(v.maxPayload, 1, 't')))}
                        ${this.listRow('Tara', esc(this.number(v.tareWeight, 1, 't')))}
                        ${this.listRow('Carga a bordo', esc(this.number(v.netCargoWeight, 1, 't')))}
                        ${this.listRow('Peso bruto actual (tara + carga)', esc(this.number(v.grossWeight, 1, 't')), true)}
                    </div>

                    <h2 class="list-title">Documentos y permisos</h2>
                    <div class="list">
                        ${this.listRow('RUNT', yes(v.runtValid, 'Vigente', 'No vigente'))}
                        ${this.listRow('TAG de telepeaje', yes(v.electronicTollTagActive, 'Activo', 'Inactivo'))}
                        ${this.listRow('Cadena de frío', yes(v.coldChainCertified, 'Certificado', 'No certificado'))}
                        ${this.listRow('Mercancías peligrosas', yes(v.hazmatAuthorized, 'Autorizado', 'No autorizado'))}
                        ${(v.badges || []).map(b => this.listRow(b, this.dotText('Activo', 'ok'))).join('')}
                    </div>` : ''}
            </div>
        `;
    },

    plannedRoute() {
        const routes = window.TruckCarData.routes;
        const load = window.TruckCarData.activeLoadOrder;
        if (!routes || !routes.optimal) return null;
        return !routes.planForLoadId || (load && routes.planForLoadId === load.backendId) ? routes.optimal : null;
    },

    roadDistanceKm() {
        const plan = this.plannedRoute();
        return plan && typeof plan.totalDistanceKm === 'number' ? Math.round(plan.totalDistanceKm) : null;
    },

    planFiguresHtml(plan) {
        const km = plan && typeof plan.totalDistanceKm === 'number' ? Math.round(plan.totalDistanceKm) : null;
        const hours = plan && typeof plan.estimatedDurationHours === 'number' ? plan.estimatedDurationHours : null;
        const none = '<span class="figure is-none">' + window.ui.NOT_AVAILABLE + '</span>';
        const h = hours == null ? 0 : Math.floor(hours);
        const min = hours == null ? 0 : Math.round((hours - h) * 60);
        return (km == null ? none : '<span class="figure">' + km + '<small>km</small></span>')
            + (hours == null ? none : '<span class="figure">' + (h ? h + '<small>h</small> ' : '') + min + '<small>min</small></span>');
    },

    renderAssignedLoadScreen(state) {
        const esc = window.ui.escape;
        const load = window.TruckCarData.activeLoadOrder;
        const lastDelivery = window.TruckCarData.lastDelivery;
        if (!load && lastDelivery) {
            const pod = { ...lastDelivery.pod, loadId: lastDelivery.load.backendId,
                          driverName: lastDelivery.load.assignedDriverName, vehiclePlate: lastDelivery.load.assignedVehiclePlate,
                          tripStartedAt: lastDelivery.load.tripStartedAt };
            return `
                <div class="screen-scroll">
                    <h1 class="large-title">Viaje finalizado</h1>
                    <p class="secondary">La carga quedó entregada. Cuando el sistema le proponga otra aparecerá aquí.</p>
                    ${lastDelivery.pendingSync ? `<div class="notice">${this.warnLine('Entrega guardada sin señal', '· la firma, la foto y el registro se enviarán al reconectar.')}</div>` : ''}
                    <div class="mt-6">${window.PodUI.receiptHtml(pod, lastDelivery.load)}</div>
                    <div class="screen-actions">
                        <button onclick="window.app.refreshAssignment()" class="btn-accent">${this.icon('arrows-clockwise')}Buscar nueva carga</button>
                    </div>
                </div>
            `;
        }
        if (!load) {
            return this.renderEmptyState('package', 'Sin carga asignada',
                'Cuando el sistema le proponga una carga aparecerá aquí para aceptarla o rechazarla.',
                `<button onclick="window.app.refreshAssignment()" class="btn-quiet">${this.icon('arrows-clockwise')}Consultar de nuevo</button>`);
        }
        const raw = load.raw || {};
        const allowed = window.TruckCarService.loadActions(load);
        const pending = allowed.awaitNotification || allowed.respond;
        const inTransit = allowed.deliver;
        const busy = state.busyAction;
        const statusCode = pending ? load.assignmentStatus : load.status;
        const clock = (iso) => new Date(iso).toLocaleTimeString('es-CO', { hour: 'numeric', minute: '2-digit' });
        const startedAt = inTransit && load.tripStartedAt ? ' · salió ' + clock(load.tripStartedAt)
            : !inTransit && load.assignmentStatusChangedAt ? ' · desde ' + clock(load.assignmentStatusChangedAt) : '';
        const km = this.roadDistanceKm();
        const budget = Number(raw.offeredBudget);
        const busyIcon = (action, icon) => (busy === action ? this.spinner() : this.icon(icon));

        const actions = allowed.awaitNotification ? `
                <div class="notice">${this.warnLine('Propuesta en proceso de notificación', '· podrá aceptarla o rechazarla cuando llegue la notificación.')}</div>
                <div class="screen-actions">
                    <button onclick="window.app.refreshAssignment()" class="btn-accent">${this.icon('arrows-clockwise')}Consultar estado</button>
                </div>`
            : allowed.respond ? `
                <div class="screen-actions">
                    <button onclick="window.app.handleAcceptTrip()" ${busy ? 'disabled' : ''} class="btn-accent">${busyIcon('accept', 'check-circle')}Aceptar carga y ver ruta</button>
                    <button onclick="window.app.handleRejectTrip()" ${busy ? 'disabled' : ''} class="btn-quiet">${busyIcon('reject', 'x-circle')}Rechazar</button>
                </div>`
            : inTransit ? `
                <div class="screen-actions">
                    <button onclick="window.app.startNavigation()" ${busy ? 'disabled' : ''} class="btn-accent">${this.icon('navigation-arrow-fill')}Continuar navegación</button>
                    <button onclick="window.app.finishTrip()" ${busy ? 'disabled' : ''} class="btn-quiet">${busyIcon('deliver', 'flag-checkered')}Llegué: registrar entrega</button>
                </div>`
            : `
                <div class="screen-actions">
                    <button onclick="window.app.startNavigation()" ${busy ? 'disabled' : ''} class="btn-accent">${busyIcon('start-trip', 'navigation-arrow-fill')}Iniciar viaje</button>
                    <button onclick="window.store.setState({ driverScreen: 'route_overview' })" class="btn-quiet">${this.icon('path')}Ver ruta planeada</button>
                </div>`;

        return `
            <div class="screen-scroll">
                <p class="status-line">${this.dotText(this.statusLabel(statusCode), inTransit ? 'ok' : '')}<span class="status-sub"> · ${esc(load.id)}${esc(startedAt)}</span></p>

                <div class="trip">
                    <div class="trip-rail"><span class="trip-stop"></span><span class="trip-line"></span></div>
                    <div class="trip-leg">
                        <div class="place-label">Origen</div>
                        <div class="place">${esc(load.origin.city || load.origin.name || 'Sin información')}</div>
                        <div class="place-sub">${esc(raw.originDepartment || '')}</div>
                    </div>
                    <div class="trip-rail"><span class="trip-stop is-end"></span></div>
                    <div class="trip-leg">
                        <div class="place-label">Destino</div>
                        <div class="place">${esc(load.destination.city || load.destination.name || 'Sin información')}</div>
                        <div class="place-sub">${esc([raw.destinationDepartment, km != null ? km + ' km por carretera' : ''].filter(Boolean).join(' · '))}</div>
                    </div>
                </div>

                <div class="fare">
                    <div class="place-label">Flete</div>
                    <div class="fare-amount">${Number.isFinite(budget) ? '$ ' + esc(budget.toLocaleString('es-CO', { maximumFractionDigits: 0 })) + '<small>COP</small>' : 'Sin información'}</div>
                    <div class="place-sub">${esc(load.customer || '')}</div>
                </div>

                <h2 class="list-title">Detalle de la carga</h2>
                <div class="list">
                    ${this.listRow('Mercancía', esc(load.cargoType || 'Sin información'))}
                    ${this.listRow('Peso', esc(this.number(Number(load.netWeight), 1, 't')), true)}
                    ${load.volumeM3 != null ? this.listRow('Volumen', esc(this.number(Number(load.volumeM3), 1, 'm³'))) : ''}
                    ${this.listRow('Vehículo requerido', esc(this.truckTypeLabel(load.requiredTruckType)))}
                    ${inTransit ? this.listRow('Posición', '<span id="driver-telemetry-badge" class="telemetry-inline" aria-live="polite">Preparando la telemetría…</span>') : ''}
                </div>
                ${actions}
            </div>
        `;
    },

    routeFactsHtml(opt) {
        const esc = window.ui.escape;
        const na = window.ui.NOT_AVAILABLE;
        const warnings = opt.warnings;
        const checkpoints = opt.checkpoints || [];
        return [
            this.listRow('Riesgo', esc(opt.riskLevel ? this.statusLabel(opt.riskLevel) : na), true),
            this.listRow('Alertas activas en la ruta', esc(typeof opt.activeAlertsCount === 'number' ? String(opt.activeAlertsCount) : na)),
            this.listRow('Restricciones', esc(!Array.isArray(warnings) ? na : warnings.length ? warnings.join(' · ') : 'Ninguna')),
            this.listRow('Peajes y puestos de control', esc(checkpoints.length ? checkpoints.join(' · ') : na)),
            this.listRow('Recomendación', esc(window.ui.orNotAvailable(opt.aiRecommendation)))
        ].join('');
    },

    renderRouteOverviewScreen(state) {
        const esc = window.ui.escape;
        const routes = window.TruckCarData.routes;
        const errors = state.dataStatus.errors || {};
        const load = window.TruckCarData.activeLoadOrder;
        if (!routes || !routes.optimal) {
            const reason = !load
                ? 'Necesita una carga asignada para planear la ruta.'
                : !(window.TruckCarData.currentDriver && window.TruckCarData.currentDriver.vehicle)
                    ? 'Su vehículo no está registrado: sin altura ni peso no se puede planear una ruta segura.'
                    : (errors.routes ? 'El servicio de rutas respondió con un error: ' + esc(errors.routes) : 'Calculando la ruta…');
            return this.renderEmptyState('path', 'Ruta no disponible', reason,
                load ? `<button onclick="window.TruckCarService.loadRoutePlan({ force: true }).then(() => window.store.setState({}))" class="btn-quiet">${this.icon('arrows-clockwise')}Planear ruta</button>` : '');
        }
        const opt = routes.optimal;
        const rej = routes.rejectedAlternate;
        const title = load ? (load.origin.city || load.origin.name) + ' → ' + (load.destination.city || load.destination.name) : opt.title;
        const inTransit = load && window.TruckCarService.loadActions(load).deliver;

        return `
            <div class="route-screen">
                <div id="overview-map-container" class="route-map" aria-label="Mapa de la ruta ${esc(title)}"></div>
                <div class="map-tools">
                    <button type="button" onclick="window.mapCtrl.centerOnPosition()" class="map-tool" aria-label="Centrar en mi posición">${this.icon('crosshair')}</button>
                    <button type="button" onclick="window.mapCtrl.fitAllRoute()" class="map-tool" aria-label="Ver la ruta completa">${this.icon('corners-out')}</button>
                </div>

                <section class="route-sheet" data-route-sheet aria-label="Ruta de la carga">
                    <h1 class="route-title">${esc(title)}</h1>
                    <div class="route-figures">${this.planFiguresHtml(opt)}</div>
                    <p class="secondary">Distancia y duración calculadas por Route-AI</p>
                    <div class="list">${this.routeFactsHtml(opt)}</div>
                    ${rej ? `<div class="notice">${this.warnLine('Corredor descartado: ' + rej.title, '· ' + rej.rejectionReasons.join(' · '))}</div>` : ''}
                    <div class="sheet-actions-row">
                        <button onclick="window.app.startNavigation()" class="btn-accent">${this.icon('navigation-arrow-fill')}${inTransit ? 'Continuar navegación' : 'Iniciar viaje y navegación'}</button>
                    </div>
                </section>
            </div>
        `;
    },

    renderNavigationScreen(state, isLandscape) {
        const esc = window.ui.escape;
        const s = window.RouteGuidance.snapshot();
        const hud = window.RouteGuidance.hudText(s);
        const vehicle = window.TruckCarData.currentDriver && window.TruckCarData.currentDriver.vehicle;
        const load = window.TruckCarData.activeLoadOrder;
        const km = this.roadDistanceKm();
        const routeLine = load
            ? (load.origin.city || load.origin.name) + ' → ' + (load.destination.city || load.destination.name) + (km != null ? ' · ' + km + ' km' : '')
            : 'Sin carga en tránsito';
        const voice = state.voiceEnabled;

        return `
            <div class="nav-screen${isLandscape ? ' is-landscape' : ''}">
                <div class="nav-map-area">
                    <div id="live-nav-map-container" class="route-map" aria-label="Mapa de navegación"></div>

                    <section class="hud-card" aria-label="Próxima maniobra">
                        <button type="button" class="hud-turn" onclick="window.app.repeatInstruction()" aria-label="Repetir la instrucción en voz alta">
                            <span class="hud-arrow"><svg class="ui-icon" aria-hidden="true"><use data-nav-glyph href="assets/icons.svg#${esc(s.glyph)}"></use></svg></span>
                            <span class="hud-text" aria-live="polite">
                                <span data-nav-distance class="hud-distance">${esc(hud.distance)}</span>
                                <span data-nav-instruction class="hud-instruction">${esc(hud.instruction)}</span>
                                <span data-nav-street class="hud-street">${esc(hud.street)}</span>
                            </span>
                        </button>
                        <div class="hud-meta">
                            <div><div class="k">Altura del vehículo</div><div class="v">${esc(vehicle ? this.number(vehicle.height, 2, 'm') : 'Sin información')}</div></div>
                            <div><div class="k">Peso bruto</div><div class="v">${esc(vehicle ? this.number(vehicle.grossWeight, 1, 't') : 'Sin información')}</div></div>
                        </div>
                        <div class="hud-row" data-nav-offroute ${s.offRoute ? '' : 'hidden'}>${this.warnLine('Fuera de la ruta', '· recalculando desde su posición')}</div>
                        <div class="hud-row" data-nav-clearance role="status" ${s.clearance ? '' : 'hidden'}><div class="warn-line">${this.icon('warning-fill')}<span><span data-nav-clearance-text>${esc(s.clearance ? s.clearance.text : '')}</span> <span class="warn-sub" data-nav-clearance-sub>${esc(s.clearance ? '· ' + s.clearance.sub : '')}</span></span></div></div>
                        <div class="hud-row hud-gps" id="driver-telemetry-badge" aria-live="polite"></div>
                    </section>

                    <div class="hud-panel">
                        <div class="hud-speed" aria-label="Velocidad actual"><b data-nav-speed>${s.speed == null ? '—' : s.speed}</b><span>km/h</span></div>
                        <button type="button" class="hud-btn" onclick="window.mapCtrl.centerOnPosition()" aria-label="Centrar en mi posición">${this.icon('crosshair')}</button>
                        <button type="button" class="hud-btn${voice ? '' : ' is-off'}" onclick="window.app.toggleVoice()" aria-pressed="${voice ? 'true' : 'false'}" aria-label="${voice ? 'Silenciar la voz de navegación' : 'Activar la voz de navegación'}">${this.icon(voice ? 'speaker-high' : 'speaker-slash')}</button>
                        <button type="button" class="hud-btn" onclick="window.app.openReportModal()" aria-label="Reportar novedad en la vía">${this.icon('megaphone')}</button>
                    </div>
                </div>

                <div class="trip-bar">
                    <div class="trip-remaining">
                        <b>Faltan <span data-nav-remaining>${esc(s.remaining)}</span></b>
                        <span data-nav-eta>${esc(window.RouteGuidance.durationText(s))}</span>
                        <span>${esc(routeLine)}</span>
                    </div>
                    <button type="button" onclick="window.app.finishTrip()" class="btn-trip">${this.icon('flag-checkered')}Llegué</button>
                </div>
            </div>
        `;
    },

    ALERT_FILTERS: [
        ['all', 'Todas'], ['scale', 'Básculas'], ['bridge', 'Gálibos bajos'],
        ['police', 'Retenes'], ['rest', 'Paradores'], ['danger', 'Incidentes']
    ],

    updatedAgo(iso) {
        if (!iso) return '';
        const s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
        return 'Actualizado ' + (s < 60 ? 'hace un momento' : s < 3600 ? 'hace ' + Math.round(s / 60) + ' min' : 'hace ' + Math.round(s / 3600) + ' h');
    },

    renderAlertsScreen(state) {
        const esc = window.ui.escape;
        const allAlerts = window.TruckCarData.communityAlerts || [];
        const filter = state.alertFilter || 'all';
        const alerts = filter === 'all' ? allAlerts : allAlerts.filter(a => a.type === filter);
        const errors = state.dataStatus.errors || {};
        const loading = state.dataStatus.loading && !allAlerts.length && !errors.alerts;
        const retry = `<button onclick="window.TruckCarService.loadAlerts().then(() => window.store.setState({}))" class="btn-accent">${this.icon('arrows-clockwise')}Reintentar</button>`;
        const report = `<button onclick="window.app.openReportModal()" class="btn-accent">${this.icon('megaphone')}Reportar novedad</button>`;

        let body;
        if (loading) {
            body = `
                <section aria-busy="true" aria-label="Cargando alertas" class="alerts-loading">
                    <p class="status-line">${this.spinner()}<span class="status-sub">Buscando reportes cerca de usted…</span></p>
                    <div class="skeleton-row"></div><div class="skeleton-row"></div><div class="skeleton-row"></div>
                </section>`;
        } else if (errors.alerts && !allAlerts.length) {
            body = `
                <section class="empty-state" aria-labelledby="alerts-error-title">
                    <div class="empty-mark">${this.icon('wifi-slash')}</div>
                    <h2 id="alerts-error-title">No se pudieron cargar las alertas</h2>
                    <p>El servidor no respondió. Puede que no haya señal; los reportes de otros conductores aparecerán al reconectar.</p>
                    ${retry}
                </section>`;
        } else if (!alerts.length) {
            body = `
                <section class="empty-state" aria-labelledby="alerts-empty-title">
                    <div class="empty-mark">${this.icon('megaphone')}</div>
                    <h2 id="alerts-empty-title">${filter === 'all' ? 'Sin reportes recientes' : 'Sin reportes de este tipo'}</h2>
                    <p>No hay reportes activos de otros conductores${filter === 'all' ? '' : ' de este tipo'}. Si ve algo en la vía, avise a los demás.</p>
                    ${report}
                    ${state.dataStatus.lastSync ? `<p class="empty-meta">${esc(this.updatedAgo(state.dataStatus.lastSync))}</p>` : ''}
                </section>`;
        } else {
            body = `
                ${errors.alerts ? `<div class="notice">${this.warnLine('No se pudieron actualizar', '· se muestran los últimos reportes recibidos.')}</div>` : ''}
                <div class="alert-list">
                    ${alerts.map(a => `
                        <article class="alert-item">
                            <h2>${esc(a.title)}</h2>
                            <p class="alert-meta">${esc([a.badge, a.timeAgo, this.confirmationsText(a.upvotes)].filter(Boolean).join(' · '))} <span class="alert-verified">${this.validationHtml(a.validated)}</span></p>
                            ${a.description ? `<p class="alert-text">${esc(a.description)}</p>` : ''}
                            <div class="alert-foot">
                                <span class="secondary">${esc(a.author || '')}</span>
                                <button onclick="window.app.upvoteAlert(${Number(a.id)})" class="btn-quiet alert-confirm">${this.icon('check-circle')}Confirmar</button>
                            </div>
                        </article>`).join('')}
                </div>
                <div class="screen-actions">${report}</div>`;
        }

        return `
            <div class="screen-scroll">
                <h1 class="large-title">Alertas</h1>
                <p class="secondary">Reportes de otros conductores en la vía.</p>
                <div class="filters" role="group" aria-label="Filtrar alertas">
                    ${this.ALERT_FILTERS.map(([key, label]) => `
                        <button type="button" onclick="window.store.setState({ alertFilter: '${key}' })" aria-pressed="${filter === key}" class="filter">${label}</button>`).join('')}
                </div>
                ${body}
            </div>
        `;
    },

    confirmationsText(count) {
        if (typeof count !== 'number') return 'Confirmaciones: ' + window.ui.NOT_AVAILABLE;
        return count + (count === 1 ? ' confirmación' : ' confirmaciones');
    },

    validationHtml(validated) {
        if (validated === true) return this.dotText('Validada', 'ok');
        if (validated === false) return window.ui.escape('Sin validar');
        return window.ui.escape('Validación: ' + window.ui.NOT_AVAILABLE);
    },

    QUEUE_GROUPS: [
        ['alert.sos', 'SOS', 'Ninguno'],
        ['position', 'Posiciones del viaje', 'Ninguna'],
        ['alert.reported alert.confirmed', 'Reportes de la vía', 'Ninguno'],
        ['trip.started', 'Inicios de viaje', 'Ninguno'],
        ['trip.delivered', 'Entregas', 'Ninguna']
    ],
    QUEUE_LABELS: {
        'position': 'Posición del viaje', 'trip.started': 'Inicio de viaje', 'trip.delivered': 'Entrega',
        'alert.reported': 'Reporte de la vía', 'alert.confirmed': 'Confirmación de reporte', 'alert.sos': 'SOS'
    },

    shortDateTime(ms) {
        const d = new Date(ms);
        const time = d.toLocaleTimeString('es-CO', { hour: 'numeric', minute: '2-digit' });
        const day = (offset) => { const x = new Date(); x.setDate(x.getDate() + offset); return x.toDateString(); };
        if (d.toDateString() === day(0)) return 'hoy ' + time;
        if (d.toDateString() === day(1)) return 'mañana ' + time;
        if (d.toDateString() === day(-1)) return 'ayer ' + time;
        const month = d.toLocaleDateString('es-CO', { month: 'short' }).replace('.', '');
        return d.getDate() + ' ' + month + ', ' + time;
    },

    renderOfflineScreen(state) {
        const esc = window.ui.escape;
        const off = window.TruckCarData.offlineSyncData || {};
        const queue = window.OfflineQueue ? window.OfflineQueue.status()
            : { pending: 0, byKind: {}, rejected: [], lastSyncAt: null, lastError: null, nextRetryAt: null };
        const offline = !navigator.onLine || Boolean(state.isOffline);
        const known = new Set(this.QUEUE_GROUPS.flatMap(([kinds]) => kinds.split(' ')));
        const other = Object.entries(queue.byKind).filter(([kind]) => !known.has(kind)).reduce((sum, [, n]) => sum + n, 0);
        const rows = this.QUEUE_GROUPS
            .map(([kinds, label, none]) => [label, kinds.split(' ').reduce((sum, k) => sum + (queue.byKind[k] || 0), 0), none])
            .filter(([label, count]) => count > 0 || label !== 'SOS' && label !== 'Inicios de viaje');
        if (other) rows.push(['Otros', other, '']);
        const mapUntil = off.cachedTiles > 0 && off.cachedTilesExpiry
            ? 'Guardado hasta ' + this.shortDateTime(off.cachedTilesExpiry)
            : off.cachedTiles === 0 ? 'Sin mapa guardado todavía' : 'Consultando…';
        const app = navigator.serviceWorker && navigator.serviceWorker.controller
            ? this.dotText('Disponible sin señal', 'ok') : this.dotText('Se guarda al abrirla con señal');
        const demo = Boolean(window.TruckCarConfig && window.TruckCarConfig.demoTools);

        return `
            <div class="screen-scroll">
                <h1 class="large-title">Conexión</h1>
                ${offline
                    ? this.warnLine('Sin señal', '· lo que haga se guarda en el teléfono y se envía al recuperar la señal.')
                    : `<p class="status-line">${this.dotText('En línea', 'ok')}<span class="status-sub"> · ${queue.pending ? 'enviando lo guardado' : 'lo que haga se envía al momento'}</span></p>`}

                <h2 class="list-title">${offline ? 'Por enviar al recuperar la señal' : 'Por enviar'}</h2>
                <div class="list">
                    ${rows.map(([label, count, none]) => this.listRow(label, count ? String(count) : esc(none), count > 0)).join('')}
                </div>
                ${queue.lastError ? `<div class="notice">${this.warnLine('El último envío falló', '· ' + queue.lastError + (queue.nextRetryAt ? '. Reintento a las ' + new Date(queue.nextRetryAt).toLocaleTimeString('es-CO', { hour: 'numeric', minute: '2-digit' }) : ''))}</div>` : ''}
                ${queue.rejected.length ? `<div class="notice">${this.warnLine('El servidor rechazó ' + queue.rejected.length + (queue.rejected.length === 1 ? ' evento' : ' eventos'))}
                    <p>${queue.rejected.map(r => esc((this.QUEUE_LABELS[r.kind] || r.kind) + ': ' + r.reason)).join('<br>')}</p></div>` : ''}

                <h2 class="list-title">Guardado en el teléfono</h2>
                <div class="list">
                    ${this.listRow('Aplicación', app)}
                    ${this.listRow('Mapa de la zona del viaje', esc(mapUntil))}
                    ${this.listRow('Última sincronización', esc(queue.lastSyncAt ? this.shortDateTime(new Date(queue.lastSyncAt).getTime()) : 'Sin sincronizar todavía'))}
                </div>
                <p class="list-foot">El mapa se guarda solo en las zonas que ya vio y vence cuando lo indica el proveedor del mapa.</p>

                ${demo ? `
                    <h2 class="list-title">Herramientas de prueba</h2>
                    <div class="list">
                        <button type="button" onclick="window.app.toggleOfflineSimulation()" class="list-row list-button">
                            <span class="list-label">${state.isOffline ? 'Terminar la simulación sin señal' : 'Simular pérdida de señal'}</span>${this.icon('caret-right')}
                        </button>
                    </div>` : ''}

                ${queue.pending ? `
                    <div class="screen-actions">
                        <button onclick="window.OfflineQueue.flush()" class="btn-accent">${this.icon('arrows-clockwise')}${offline ? 'Reintentar ahora' : 'Enviar ahora'}</button>
                    </div>` : ''}
            </div>
        `;
    },

    openDispatchModal() {
        let modal = document.getElementById('driver-dispatch-modal');
        if (!modal) {
            modal = document.createElement('div');
            modal.id = 'driver-dispatch-modal';
            modal.className = 'fixed inset-0 z-[1100] bg-slate-950/85 backdrop-blur-md flex items-center justify-center p-3';
            document.body.appendChild(modal);
        }
        this.renderDispatchModalContent(modal);
        modal.classList.remove('hidden');
    },

    closeDispatchModal() {
        const modal = document.getElementById('driver-dispatch-modal');
        if (modal) modal.classList.add('hidden');
    },

    renderDispatchModalContent(modal) {
        const esc = window.ui.escape;
        const messages = window.store.state.chatMessages || [];
        const replies = (window.TruckCarMessaging && window.TruckCarMessaging.QUICK_REPLIES) || [];
        modal.innerHTML = `
            <div class="bg-slate-900 border border-slate-700 rounded-3xl p-4 sm:p-5 max-w-md w-full shadow-2xl flex flex-col max-h-[85vh]">
                <div class="flex items-center justify-between border-b border-slate-800 pb-2.5 shrink-0">
                    <div class="flex items-center gap-2">
                        <div class="w-8 h-8 rounded-xl bg-accent-500/15 text-accent-500 grid place-items-center">
                            <i class="fas fa-headset text-sm"></i>
                        </div>
                        <div>
                            <h3 class="font-bold text-sm text-white leading-tight">Central de Despacho</h3>
                            <p class="text-[10px] text-slate-400">Canal bidireccional en tiempo real</p>
                        </div>
                    </div>
                    <button type="button" onclick="window.DriverApp.closeDispatchModal()" class="w-8 h-8 rounded-lg text-slate-400 hover:text-white grid place-items-center text-lg">
                        <i class="fas fa-times"></i>
                    </button>
                </div>

                <div id="driver-chat-messages" class="flex-1 overflow-y-auto my-3 space-y-2 pr-1 text-xs">
                    ${messages.length === 0 ? '<p class="text-center text-slate-500 py-6">Mensajería no disponible: falta habilitar el servicio del backend.</p>' : ''}
                    ${messages.map(m => `
                        <div class="p-2.5 rounded-2xl max-w-[85%] ${m.sender === 'driver' ? 'bg-accent-500/20 border border-accent-500/40 text-slate-100 ml-auto' : 'bg-slate-800 border border-slate-700 text-slate-200'}">
                            <div class="flex justify-between items-center gap-2 mb-1">
                                <span class="font-bold text-[10px] ${m.sender === 'driver' ? 'text-accent-400' : 'text-slate-400'}">${esc(m.senderName || (m.sender === 'driver' ? 'Usted' : 'Torre'))}</span>
                                <span class="text-[9px] text-slate-500 font-mono">${esc(m.time)}</span>
                            </div>
                            <p class="leading-relaxed">${esc(m.text)}</p>
                        </div>
                    `).join('')}
                </div>

                <div class="border-t border-slate-800 pt-2 shrink-0 space-y-2">
                    <div class="text-[10px] font-semibold text-slate-400">Respuestas rápidas para cabina:</div>
                    <div class="grid grid-cols-2 gap-1.5">
                        ${replies.map(r => `
                            <button type="button" onclick="window.DriverApp.sendQuickReply('${esc(r)}')" class="px-2.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 rounded-xl text-[11px] font-semibold text-left truncate transition">
                                ${esc(r)}
                            </button>
                        `).join('')}
                    </div>

                    <form onsubmit="window.DriverApp.sendDriverMessage(event)" class="flex gap-2 pt-1">
                        <input id="driver-chat-input" type="text" placeholder="Escribir mensaje a la torre..." class="login-input flex-1 text-xs" enterkeyhint="send">
                        <button type="submit" class="w-10 h-9 bg-accent-500 hover:bg-accent-600 text-graphite-950 font-bold rounded-xl grid place-items-center text-xs transition">
                            <i class="fas fa-paper-plane"></i>
                        </button>
                    </form>
                </div>
            </div>
        `;
        const container = document.getElementById('driver-chat-messages');
        if (container) container.scrollTop = container.scrollHeight;
    },

    async sendQuickReply(text) {
        if (window.TruckCarMessaging) {
            try {
                await window.TruckCarMessaging.sendMessage(text);
            } catch (error) {
                window.ui.failure('No se pudo enviar el mensaje', error, 'contactar a la torre');
            }
        }
    },

    async sendDriverMessage(event) {
        event.preventDefault();
        const input = document.getElementById('driver-chat-input');
        if (!input || !input.value.trim()) return;
        const text = input.value.trim();
        input.value = '';
        await this.sendQuickReply(text);
    }
};

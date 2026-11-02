window.DriverApp = {
    /** Estados del backend en el español de la interfaz: el conductor nunca ve códigos como IN_TRANSIT. */
    STATUS_LABELS: {
        PROPOSED: 'Propuesta', NOTIFIED: 'Propuesta', AVAILABLE: 'Disponible', ASSIGNED: 'Aceptada',
        IN_TRANSIT: 'En tránsito', DELIVERED: 'Entregada', CANCELLED: 'Cancelada',
        DISPONIBLE: 'Disponible', EN_TRANSITO: 'En tránsito', DESCANSO: 'En descanso', SIN_VEHICULO: 'Sin vehículo'
    },

    statusLabel(code) {
        if (!code) return 'Sin estado';
        return this.STATUS_LABELS[code] || String(code).charAt(0) + String(code).slice(1).toLowerCase().replace(/_/g, ' ');
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
                    <button onclick="window.app.logout()" class="header-icon-btn" title="Cerrar sesión" aria-label="Cerrar sesión">
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

    /** Pestañas: [pantalla, etiqueta, ícono de Phosphor (assets/icons.svg; la activa usa su variante -fill)]. */
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

    /**
     * Acciones guardadas sin señal: número sobre el ícono de Offline (en el teléfono no hay tooltip). El número es
     * visual; los lectores de pantalla oyen el texto completo junto al nombre de la pestaña.
     */
    offlineBadgeHtml() {
        const pending = window.OfflineQueue ? window.OfflineQueue.status().pending || 0 : 0;
        if (!pending) return '<span data-offline-badge hidden></span>';
        const text = pending + (pending === 1 ? ' acción guardada sin enviar' : ' acciones guardadas sin enviar');
        return `<span data-offline-badge><span class="driver-tab-count" aria-hidden="true">${pending > 99 ? '99+' : pending}</span><span class="sr-only">, ${text}</span></span>`;
    },

    /** Actualiza el contador de la pestaña Offline en sitio (la cola cambia sin que se repinte la pantalla). */
    renderOfflineBadge() {
        document.querySelectorAll('[data-offline-badge]').forEach(el => { el.outerHTML = this.offlineBadgeHtml(); });
    },

    hasPendingLoad() {
        const load = window.TruckCarData.activeLoadOrder;
        return Boolean(load && (load.assignmentStatus === 'PROPOSED' || load.assignmentStatus === 'NOTIFIED'));
    },

    destinationLabel() {
        const load = window.TruckCarData.activeLoadOrder;
        return load ? load.destination.city || load.destination.name : 'Sin destino';
    },

    routeEta() {
        const routes = window.TruckCarData.routes;
        return routes && routes.optimal ? routes.optimal.eta : '—';
    },

    routeDistance() {
        const routes = window.TruckCarData.routes;
        return routes && routes.optimal ? routes.optimal.distance : '—';
    },

    /** Tipos de camión del backend con su nombre corriente en Colombia. */
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

    /** Número con coma decimal (es-CO) y unidad; sin dato, "Sin información". */
    number(value, digits, unit) {
        if (typeof value !== 'number' || Number.isNaN(value)) return 'Sin información';
        return value.toLocaleString('es-CO', { minimumFractionDigits: digits, maximumFractionDigits: digits }) + (unit ? ' ' + unit : '');
    },

    /** Placa colombiana como se lee en el camión: "TDK 410". */
    plateText(plate) {
        return String(plate || '').replace(/[-\s]+/g, ' ').trim();
    },

    /** Fila de una lista agrupada: rótulo a la izquierda, valor a la derecha. valueHtml ya viene escapado. */
    listRow(label, valueHtml, strong = false) {
        return `<div class="list-row"><span class="list-label">${window.ui.escape(label)}</span><span class="list-value${strong ? ' is-strong' : ''}">${valueHtml}</span></div>`;
    },

    /** Estado como texto con un punto: verde solo para lo que está en curso y bien; gris para lo demás. */
    dotText(text, tone = '') {
        return `<span class="dot${tone ? ' ' + tone : ''}" aria-hidden="true"></span>${window.ui.escape(text)}`;
    },

    /** Advertencia: siempre triángulo y texto, nunca solo color. */
    warnLine(text, sub = '') {
        return `<div class="warn-line">${this.icon('warning-fill')}<span>${window.ui.escape(text)}${sub ? ` <span class="warn-sub">${window.ui.escape(sub)}</span>` : ''}</span></div>`;
    },

    spinner() {
        return '<span class="spinner" aria-hidden="true"></span>';
    },

    /** Estado vacío anclado arriba, con un ícono neutro, qué pasa y qué hacer. */
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
        if (!driver) {
            return state.dataStatus.loading
                ? this.renderEmptyState('loading', 'Cargando el perfil', 'Consultando sus datos y los del vehículo.')
                : this.renderEmptyState('warning', 'No se pudo cargar el perfil', 'Revise la señal e intente de nuevo.',
                    `<button onclick="window.app.reloadData()" class="btn-quiet">${this.icon('arrows-clockwise')}Reintentar</button>`);
        }
        const v = driver.vehicle;
        const load = window.TruckCarData.activeLoadOrder;
        const status = this.statusLabel(driver.status) + (load && load.status === 'IN_TRANSIT' ? ' · ' + load.id : '');
        const rating = typeof driver.rating === 'number' ? this.number(driver.rating, 1) + ' de 5' : 'Sin información';
        const yes = (on, onText, offText) => this.dotText(on ? onText : offText, on ? 'ok' : '');

        return `
            <div class="screen-scroll">
                <h1 class="large-title">Vehículo</h1>
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
                    ${this.listRow('Licencia', esc(driver.licenseNumber && driver.licenseNumber !== '—' ? driver.licenseNumber : 'Sin información'))}
                    ${this.listRow('Calificación', esc(rating))}
                    ${this.listRow('Viajes completados', esc(driver.tripsCompleted))}
                    ${this.listRow('Horas de conducción hoy', esc(this.number(driver.hoursDrivenToday, 1, 'h') + ' de ' + this.number(driver.maxDailyHours, 0, 'h')))}
                    ${driver.restRequired ? this.listRow('Descanso', this.warnLine('Descanso requerido')) : ''}
                    ${this.listRow('Estado', this.dotText(status, driver.status === 'EN_TRANSITO' ? 'ok' : ''))}
                </div>

                ${v ? `
                    <h2 class="list-title">Dimensiones y peso</h2>
                    <div class="list">
                        ${this.listRow('Gálibo (altura)', esc(this.number(v.height, 2, 'm')), true)}
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

    /** Distancia por carretera de la ruta (OSRM, la misma línea del mapa), si ya se calculó. */
    roadDistanceKm() {
        const guided = window.RouteGuidance && window.RouteGuidance.route;
        if (guided && guided.totalM) return Math.round(guided.totalM / 1000);
        const summary = window.mapCtrl && window.mapCtrl.routeSummary;
        return summary ? Math.round(summary.distanceKm) : null;
    },

    renderAssignedLoadScreen(state) {
        const esc = window.ui.escape;
        const load = window.TruckCarData.activeLoadOrder;
        const lastDelivery = window.TruckCarData.lastDelivery;
        if (!load && lastDelivery) {
            // Recibo de la entrega recién registrada (firma y foto ya en memoria; no se vuelven a descargar).
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
        const pending = load.status === 'AVAILABLE'
            && (load.assignmentStatus === 'PROPOSED' || load.assignmentStatus === 'NOTIFIED');
        const inTransit = load.status === 'IN_TRANSIT';
        const busy = state.busyAction;
        const statusCode = pending ? load.assignmentStatus : load.status;
        const startedAt = inTransit && load.tripStartedAt
            ? ' · salió ' + new Date(load.tripStartedAt).toLocaleTimeString('es-CO', { hour: 'numeric', minute: '2-digit' }) : '';
        const km = this.roadDistanceKm();
        const budget = Number(raw.offeredBudget);
        const busyIcon = (action, icon) => (busy === action ? this.spinner() : this.icon(icon));

        const actions = load.assignmentStatus === 'PROPOSED' && pending ? `
                <div class="notice">${this.warnLine('Propuesta en proceso de notificación', '· podrá aceptarla o rechazarla cuando llegue la notificación.')}</div>
                <div class="screen-actions">
                    <button onclick="window.app.refreshAssignment()" class="btn-accent">${this.icon('arrows-clockwise')}Consultar estado</button>
                </div>`
            : pending ? `
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
        const vehicle = window.TruckCarData.currentDriver && window.TruckCarData.currentDriver.vehicle;
        const title = load ? (load.origin.city || load.origin.name) + ' → ' + (load.destination.city || load.destination.name) : opt.title;
        const inTransit = load && load.status === 'IN_TRANSIT';

        return `
            <div class="route-screen">
                <div id="overview-map-container" class="route-map" aria-label="Mapa de la ruta ${esc(title)}"></div>
                <div class="map-tools">
                    <button type="button" onclick="window.mapCtrl.centerOnPosition()" class="map-tool" aria-label="Centrar en mi posición">${this.icon('crosshair')}</button>
                    <button type="button" onclick="window.mapCtrl.fitAllRoute()" class="map-tool" aria-label="Ver la ruta completa">${this.icon('corners-out')}</button>
                </div>

                <section class="route-sheet" data-route-sheet aria-label="Ruta de la carga">
                    <h1 class="route-title">${esc(title)}</h1>
                    <div class="route-figures" data-route-figures>${window.mapCtrl.routeFiguresHtml()}</div>
                    <p class="secondary">Tiempo estimado para auto</p>
                    <p class="status-line">${this.dotText('Aptitud para ' + (vehicle ? this.plateText(vehicle.plate) : 'su vehículo'))}<span class="status-sub"> · sin información</span></p>
                    <div class="list">
                        ${this.listRow('Riesgo de la ruta', 'Sin información')}
                        ${this.listRow('Restricciones', (opt.warnings || []).length ? esc(opt.warnings.join(' · ')) : 'Sin información')}
                        ${this.listRow('Alertas en la ruta', 'Sin información')}
                    </div>
                    ${rej ? `<div class="notice">${this.warnLine('Corredor descartado: ' + rej.title, '· ' + rej.rejectionReasons.join(' · '))}</div>` : ''}
                    <div class="sheet-actions-row">
                        <button onclick="window.app.startNavigation()" class="btn-accent">${this.icon('navigation-arrow-fill')}${inTransit ? 'Continuar navegación' : 'Iniciar viaje y navegación'}</button>
                    </div>
                </section>
            </div>
        `;
    },

    /**
     * Navegación paso a paso de la carga en tránsito. Las instrucciones salen de la ruta real (js/navigation.js:
     * plan de Route-AI + maniobras de OSRM) y avanzan con la posición GPS; RouteGuidance.renderHud() actualiza los
     * elementos data-nav-* en sitio para no recrear el mapa en cada posición.
     */
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

        // Un solo HUD para vertical y horizontal: tarjeta superior de vidrio (maniobra, altura y peso bruto, avisos),
        // panel vertical derecho y barra del viaje. Sin límite de velocidad: no hay fuente para ese dato.
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
                        <span data-nav-eta>${esc(s.remainingTime === '—' ? 'Tiempo sin información' : s.remainingTime + ' · estimado para auto')}</span>
                        <span>${esc(routeLine)}</span>
                    </div>
                    <button type="button" onclick="window.app.finishTrip()" class="btn-trip">${this.icon('flag-checkered')}Llegué</button>
                </div>
            </div>
        `;
    },

    renderAlertsScreen(state) {
        const esc = window.ui.escape;
        const allAlerts = window.TruckCarData.communityAlerts || [];
        const filter = state.alertFilter || 'all';
        const alerts = filter === 'all' ? allAlerts : allAlerts.filter(a => a.type === filter);
        const filters = [
            ['all', 'Todos'], ['scale', 'Básculas'], ['bridge', 'Gálibos Bajos'],
            ['police', 'Retenes'], ['rest', 'Paradores 24h'], ['danger', 'Incidentes']
        ];
        return `
            <div class="h-full overflow-y-auto p-4 space-y-4">
                <div class="flex items-center justify-between">
                    <div>
                        <h2 class="text-lg font-extrabold text-white flex items-center gap-2">
                            <i class="fas fa-bullhorn text-amber-400"></i> Alertas de Carretera
                        </h2>
                        <p class="text-xs text-slate-400">Reportes de Community-Alerts (validadas con 3 confirmaciones)</p>
                    </div>
                    <button onclick="window.app.openReportModal()" class="px-3 py-1.5 bg-amber-500 hover:bg-amber-400 text-slate-950 font-extrabold rounded-xl text-xs flex items-center gap-1.5 shadow transition">
                        <i class="fas fa-plus"></i> Reportar
                    </button>
                </div>

                <div class="flex gap-1.5 overflow-x-auto pb-1 text-xs">
                    ${filters.map(([key, label]) => `
                        <button onclick="window.store.setState({ alertFilter: '${key}' })" class="px-3 py-1 rounded-lg shrink-0 ${filter === key ? 'bg-emerald-600 text-white font-bold' : 'bg-slate-800 text-slate-300 hover:bg-slate-700'}">
                            ${label}${key === 'all' ? ' (' + allAlerts.length + ')' : ''}
                        </button>
                    `).join('')}
                </div>

                <div class="space-y-3">
                    ${alerts.length ? alerts.map(a => `
                        <div class="bg-slate-900 border border-slate-800 rounded-2xl p-3.5 space-y-2">
                            <div class="flex items-start justify-between">
                                <div class="flex items-center gap-2">
                                    <span class="px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                                        a.type === 'scale' ? 'bg-indigo-500/20 text-indigo-400 border border-indigo-500/30' :
                                        a.type === 'bridge' ? 'bg-rose-500/20 text-rose-400 border border-rose-500/30' :
                                        a.type === 'police' ? 'bg-blue-500/20 text-blue-400 border border-blue-500/30' :
                                        a.type === 'danger' ? 'bg-rose-500/20 text-rose-300 border border-rose-500/30' :
                                        'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                                    }">${esc(a.badge)}</span>
                                    <span class="text-[11px] text-slate-400">${esc(a.timeAgo)}</span>
                                    ${a.verified ? '<span class="text-[10px] text-emerald-400 font-bold"><i class="fas fa-circle-check"></i> Validada</span>' : ''}
                                </div>
                                <span class="text-xs text-emerald-400 font-bold flex items-center gap-1">
                                    <i class="fas fa-thumbs-up"></i> ${esc(a.upvotes)}
                                </span>
                            </div>

                            <h3 class="font-bold text-white text-sm">${esc(a.title)}</h3>
                            <p class="text-xs text-slate-300 leading-relaxed">${esc(a.description)}</p>

                            <div class="flex items-center justify-between pt-2 border-t border-slate-800/80 text-[11px] text-slate-400">
                                <span><i class="fas fa-user-circle"></i> ${esc(a.author)}</span>
                                <button onclick="window.app.upvoteAlert(${Number(a.id)})" class="text-emerald-400 hover:underline font-medium">
                                    Confirmar Alerta
                                </button>
                            </div>
                        </div>
                    `).join('') : `
                        <div class="p-6 text-center text-xs text-slate-400 bg-slate-900 border border-dashed border-slate-800 rounded-2xl">
                            No hay alertas activas${filter === 'all' ? '' : ' de este tipo'}.
                        </div>
                    `}
                </div>
            </div>
        `;
    },

    renderOfflineScreen(state) {
        const esc = window.ui.escape;
        const off = window.TruckCarData.offlineSyncData;
        // Estado real de la cola durable (IndexedDB); se vuelve a pintar en cada cambio (app.js).
        const queue = window.OfflineQueue ? window.OfflineQueue.status()
            : { pending: 0, byKind: {}, rejected: [], lastSyncAt: null, lastError: null, nextRetryAt: null };
        return `
            <div class="h-full overflow-y-auto p-4 space-y-4">
                <div class="flex items-center justify-between">
                    <div>
                        <h2 class="text-lg font-extrabold text-white flex items-center gap-2">
                            <i class="fas fa-download text-emerald-400"></i> Modo Offline & Sincronización
                        </h2>
                        <p class="text-xs text-slate-400">Navegación continua en zonas sin cobertura celular</p>
                    </div>
                </div>

                <div class="p-3.5 bg-slate-900 border ${state.isOffline ? 'border-amber-500/60 bg-amber-500/5' : 'border-slate-800'} rounded-2xl flex items-center justify-between">
                    <div>
                        <div class="font-bold text-sm text-white flex items-center gap-2">
                            <i class="fas ${state.isOffline ? 'fa-plane-slash text-amber-400' : 'fa-signal text-emerald-400'}"></i>
                            Estado de Conectividad
                        </div>
                        <p class="text-xs text-slate-400 mt-0.5">${state.isOffline ? 'Sin señal en carretera (Operando en Offline)' : 'Conectado a Red 4G LTE'}</p>
                    </div>
                    <button onclick="window.app.toggleOfflineSimulation()" class="px-3.5 py-2 rounded-xl text-xs font-bold transition ${state.isOffline ? 'bg-emerald-600 hover:bg-emerald-500 text-white' : 'bg-slate-800 hover:bg-slate-700 text-amber-400 border border-amber-500/40'}">
                        ${state.isOffline ? 'Reconectar Red' : 'Simular Pérdida de Señal'}
                    </button>
                </div>

                <div class="bg-slate-900 border border-slate-800 rounded-2xl p-4 space-y-2">
                    <h3 class="text-xs font-bold text-slate-300 uppercase tracking-wider flex items-center justify-between">
                        <span>Mapas y aplicación disponibles sin señal</span>
                        <span class="text-emerald-400 font-mono text-[11px]">${off.cachedTiles == null ? '…' : off.cachedTiles + ' teselas'}</span>
                    </h3>
                    <p class="text-[11px] text-slate-400">El Service Worker guarda la aplicación y las zonas del mapa que ya recorrió; se pueden consultar sin cobertura.</p>
                </div>

                <div class="bg-slate-900 border border-slate-800 rounded-2xl p-4 space-y-3">
                    <div class="flex items-center justify-between">
                        <h3 class="text-xs font-bold text-slate-300 uppercase tracking-wider">Cola de sincronización (${queue.pending})</h3>
                        <span class="text-[10px] ${queue.pending ? 'text-amber-400 animate-pulse' : 'text-emerald-400'} font-mono">
                            ${queue.pending ? 'Se envía al reconectar' : 'Todo sincronizado'}
                        </span>
                    </div>
                    <div class="space-y-2">
                        ${Object.keys(queue.byKind).length ? Object.entries(queue.byKind).map(([kind, count]) => `
                            <div class="p-2 bg-slate-800/40 border border-slate-700/30 rounded-xl flex items-center justify-between text-xs">
                                <span class="text-slate-300"><i class="fas ${KIND_ICONS[kind] || 'fa-circle'} text-slate-500 mr-1"></i> ${esc(KIND_LABELS[kind] || kind)}</span>
                                <span class="text-[10px] text-slate-400 font-mono">${count}</span>
                            </div>
                        `).join('') : '<p class="text-[11px] text-slate-500">No hay eventos pendientes.</p>'}
                    </div>
                    <div class="text-[10px] text-slate-500 font-mono space-y-0.5">
                        <div>Última sincronización: ${queue.lastSyncAt ? esc(new Date(queue.lastSyncAt).toLocaleString('es-CO')) : '—'}</div>
                        ${queue.nextRetryAt ? `<div>Próximo intento: ${esc(new Date(queue.nextRetryAt).toLocaleTimeString('es-CO'))}</div>` : ''}
                        ${queue.lastError ? `<div class="text-amber-300">Último error: ${esc(queue.lastError)}</div>` : ''}
                    </div>
                    ${queue.rejected.length ? `
                        <div class="p-2 bg-rose-500/10 border border-rose-500/30 rounded-xl text-[11px] text-rose-200 space-y-1">
                            <div class="font-bold">Eventos rechazados por el servidor</div>
                            ${queue.rejected.map(r => `<div>${esc(KIND_LABELS[r.kind] || r.kind)}: ${esc(r.reason)}</div>`).join('')}
                        </div>` : ''}
                    <button onclick="window.OfflineQueue.flush()" ${state.isOffline || !queue.pending ? 'disabled' : ''} class="w-full py-2.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white rounded-xl text-xs font-bold transition">
                        <i class="fas fa-rotate"></i> Sincronizar ahora
                    </button>
                </div>
            </div>
        `;
    }
};

const KIND_LABELS = {
    'position': 'Posiciones GPS',
    'trip.started': 'Inicio de viaje',
    'trip.delivered': 'Entrega con firma y foto',
    'alert.reported': 'Alertas reportadas',
    'alert.confirmed': 'Confirmaciones de alertas'
};
const KIND_ICONS = {
    'position': 'fa-location-dot',
    'trip.started': 'fa-truck-moving',
    'trip.delivered': 'fa-file-signature',
    'alert.reported': 'fa-triangle-exclamation',
    'alert.confirmed': 'fa-thumbs-up'
};

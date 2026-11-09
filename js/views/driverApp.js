window.DriverApp = {
    /** Estados del backend en el español de la interfaz: el conductor nunca ve códigos como IN_TRANSIT. */
    STATUS_LABELS: {
        PROPOSED: 'Propuesta', NOTIFIED: 'Propuesta', AVAILABLE: 'Disponible', ASSIGNED: 'Aceptada',
        IN_TRANSIT: 'En tránsito', DELIVERED: 'Entregada', CANCELLED: 'Cancelada',
        DISPONIBLE: 'Disponible', EN_TRANSITO: 'En tránsito', DESCANSO: 'En descanso', SIN_VEHICULO: 'Sin vehículo',
        // Asignación y flota (Torre de control y "Mis envíos").
        ACCEPTED: 'Aceptada', REJECTED: 'Rechazada', TIMEOUT: 'Sin respuesta a tiempo',
        UNASSIGNED_NO_DRIVERS: 'Sin conductores disponibles', ACTIVO: 'Activo', INACTIVO: 'Inactivo', DESCONOCIDO: 'Sin estado',
        // Decisiones del motor de asignación (AI-powered-fleet-allocation, AllocationStatus).
        SUCCESSFUL: 'Conductor seleccionado', NO_DRIVERS_AVAILABLE: 'Sin conductores disponibles',
        DEGRADED_USING_CACHE: 'Con datos guardados', RECOMMENDATION_PENDING: 'Recomendación pendiente',
        ASSIGNMENT_CONFLICT: 'Rechazada por conflicto', ASSIGNMENT_FAILED: 'Asignación sin respuesta'
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
            : screen === 'offline' ? this.offlineBadgeHtml()
            : screen === 'alerts' ? this.inboxBadgeHtml() : '';
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

    /** Notificaciones nuevas sobre la pestaña Alertas (la bandeja "Para usted" vive en esa pantalla). */
    inboxBadgeHtml() {
        const service = window.TruckCarService;
        const unread = service && service.unreadNotifications ? service.unreadNotifications() : 0;
        if (!unread) return '';
        const text = unread + (unread === 1 ? ' notificación nueva' : ' notificaciones nuevas');
        return `<span class="driver-tab-count" aria-hidden="true">${unread > 99 ? '99+' : unread}</span><span class="sr-only">, ${text}</span>`;
    },

    INBOX_CATEGORIES: {
        REASIGNACION_CARGA: 'Carga', CAMBIO_ESTADO_VIAJE: 'Viaje', ALERTA_RUTA: 'Alerta en la ruta',
        CIERRE_VIAL: 'Cierre vial', MENSAJE_DESPACHADOR: 'Mensaje de la torre', EMERGENCIA_SOS: 'SOS'
    },

    /** Bandeja "Para usted": lo que la plataforma le notificó, con el audio si la voz se generó. */
    renderInbox(state) {
        const esc = window.ui.escape;
        const items = window.TruckCarData.notifications || [];
        const status = state.inboxStatus;
        if (status === 'loading' && !items.length) {
            return `<p class="status-line">${this.spinner()}<span class="status-sub">Consultando sus notificaciones…</span></p>`;
        }
        if (status === 'error' && !items.length) {
            return `
                <section class="empty-state">
                    <div class="empty-mark">${this.icon('wifi-slash')}</div>
                    <h2>No se pudieron cargar las notificaciones</h2>
                    <p>Puede que no haya señal. Intente de nuevo en un momento.</p>
                    <button onclick="window.app.openInbox()" class="btn-accent">${this.icon('arrows-clockwise')}Reintentar</button>
                </section>`;
        }
        if (!items.length) {
            return `
                <section class="empty-state">
                    <div class="empty-mark">${this.icon('bell')}</div>
                    <h2>Sin notificaciones</h2>
                    <p>Aquí verá las cargas que le propongan, los cambios de sus viajes y los mensajes de la torre.</p>
                </section>`;
        }
        return `
            <div class="alert-list">
                ${items.map(n => `
                    <article class="alert-item">
                        <p class="alert-meta">${esc([this.INBOX_CATEGORIES[n.category] || 'Aviso', n.timeAgo].filter(Boolean).join(' · '))}</p>
                        <p class="inbox-text">${esc(n.text)}</p>
                        ${n.status === 'FAILED' ? this.warnLine('No se pudo enviar al teléfono', '· queda aquí para consulta') : ''}
                        ${n.audioUrl ? `<audio controls preload="none" src="${esc(n.audioUrl)}" class="inbox-audio"></audio>` : ''}
                    </article>`).join('')}
            </div>`;
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
                ${this.accountPending(state) ? `
                    <div class="notice">
                        ${this.warnLine('Cuenta pendiente de verificación')}
                        <p>Un administrador debe verificarla en la torre de control. Mientras tanto puede registrar su vehículo, pero no recibirá cargas.</p>
                    </div>` : ''}
                ${v ? `
                    <div class="vehicle-id">
                        <span class="plate" aria-label="Placa ${esc(v.plate)}">${esc(this.plateText(v.plate))}</span>
                        <div class="min-w-0">
                            <div class="vehicle-model">${esc(v.brand && v.brand !== '—' ? v.brand : 'Modelo sin información')}</div>
                            <div class="secondary">${esc(this.truckTypeLabel(v.category))}</div>
                        </div>
                    </div>
                    ${this.renderAvailability(driver, load, state)}
                    <div class="vehicle-actions">
                        <button onclick="window.app.openVehicleForm()" class="btn-quiet">${this.icon('pencil-simple')}Editar vehículo</button>
                    </div>` : `
                    <div class="notice">
                        ${this.warnLine('Sin vehículo registrado')}
                        <p>Registre su camión para recibir cargas: el motor de asignación necesita el tipo, la capacidad y la altura.</p>
                    </div>
                    <div class="vehicle-actions">
                        <button onclick="window.app.openVehicleForm()" class="btn-accent">${this.icon('truck')}Registrar mi vehículo</button>
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

    /** Cuenta del conductor aún sin verificar por un administrador: el motor de asignación no le propone cargas. */
    accountPending(state) {
        return Boolean(state && state.currentUser && state.currentUser.status === 'PENDING_VERIFICATION');
    },

    /** Propuesta que el conductor ya puede aceptar o rechazar (Load-Allocation la dejó NOTIFIED). */
    isOpenProposal(load) {
        return Boolean(load && load.status === 'AVAILABLE' && load.assignmentStatus === 'NOTIFIED');
    },

    /**
     * Qué cambió entre dos consultas de /loads/mine: 'new' si llegó una propuesta que no estaba, 'gone' si la que
     * estaba ya no está (venció, la rechazó o se asignó a otro), null si nada que avisar.
     */
    proposalChange(before, after) {
        const open = (l) => this.isOpenProposal(l);
        if (open(after) && !(open(before) && before.backendId === after.backendId)) return 'new';
        if (open(before) && !(after && after.backendId === before.backendId)) return 'gone';
        return null;
    },

    /**
     * Hora límite (ms) para responder: el servidor vence la propuesta cuando lleva assignmentResponseMinutes en
     * NOTIFIED. assignmentStatusChangedAt es hora local del servidor (TZ America/Bogota), como la del teléfono.
     */
    proposalDeadline(load, minutes) {
        const changed = load && load.raw && load.raw.assignmentStatusChangedAt;
        const start = changed ? new Date(changed).getTime() : NaN;
        return Number.isFinite(start) ? start + minutes * 60 * 1000 : null;
    },

    /** Plazo para responder la propuesta; window.app.tickCountdowns actualiza el texto cada segundo sin re-render. */
    renderCountdown(load) {
        const config = window.TruckCarConfig || {};
        const deadline = this.proposalDeadline(load, config.assignmentResponseMinutes || 5);
        if (!deadline) return '';
        const left = this.countdownText(deadline);
        return `
            <div class="countdown" data-deadline="${deadline}" role="timer" aria-live="off">
                ${this.icon('warning')}
                <span data-countdown-text>${left ? `Responda en <b>${left}</b> · después el motor la ofrece a otro conductor` : 'El plazo venció · el motor la ofrecerá a otro conductor'}</span>
            </div>`;
    },

    /** "4:05" para lo que falta, o null si ya venció. */
    countdownText(deadline, now = Date.now()) {
        const left = Math.ceil((deadline - now) / 1000);
        if (left <= 0) return null;
        return Math.floor(left / 60) + ':' + String(left % 60).padStart(2, '0');
    },

    /**
     * Disponible para cargas (ACTIVO) o no (INACTIVO). Con un viaje en curso no se puede apagar: la carga ya va a
     * bordo y la torre lo sigue viendo en ruta.
     */
    renderAvailability(driver, load, state) {
        const available = String(driver.status).toUpperCase() !== 'INACTIVO';
        const inTrip = Boolean(load && (load.status === 'IN_TRANSIT' || load.status === 'ASSIGNED'));
        const busy = state.busyAction === 'availability';
        const detail = inTrip ? 'Tiene un viaje en curso'
            : available ? 'El motor de asignación le puede proponer cargas' : 'No recibirá propuestas de carga';
        return `
            <div class="availability">
                <div class="availability-text">
                    <b id="availability-label">${available ? 'Disponible para cargas' : 'No disponible'}</b>
                    <span>${window.ui.escape(detail)}</span>
                </div>
                <button type="button" role="switch" aria-checked="${available}" aria-labelledby="availability-label"
                        onclick="window.app.toggleAvailability()" class="switch" ${inTrip || busy ? 'disabled' : ''}></button>
            </div>`;
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
                this.accountPending(state)
                    ? 'Su cuenta está pendiente de verificación: recibirá cargas cuando un administrador la verifique.'
                    : 'Cuando el sistema le proponga una carga aparecerá aquí para aceptarla o rechazarla.',
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
                ${pending && load.assignmentStatus === 'NOTIFIED' ? this.renderCountdown(load) : ''}

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

    /**
     * Restricciones, alertas en la ruta y riesgo (que decide la aptitud para el vehículo). Hoy ninguno tiene una fuente
     * fiable: una sola fila lo dice, sin repetir "Sin información". Un dato real sale en su propia fila; lo que siga sin
     * fuente queda agrupado.
     */
    routeFactsHtml(opt) {
        const esc = window.ui.escape;
        const facts = [];
        const missing = [];
        const warnings = opt.warnings || [];
        if (warnings.length) facts.push(this.listRow('Restricciones', esc(warnings.join(' · '))));
        else missing.push('restricciones');
        missing.push('alertas', 'riesgo');   // la API de alertas no filtra por ruta y el riesgo de Route-AI es un valor por defecto
        if (missing.length) {
            const label = missing.join(', ').replace(/, ([^,]*)$/, ' y $1');
            facts.push(`<div class="list-row"><span class="list-label">${esc(label.charAt(0).toUpperCase() + label.slice(1))}<span class="list-note"> · sin fuente de datos todavía</span></span></div>`);
        }
        return facts.join('');
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
                    <div class="list">${this.routeFactsHtml(opt)}</div>
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
                        <div class="hud-row" data-hud-alert="3" data-nav-offroute ${s.offRoute ? '' : 'hidden'}>${this.warnLine('Fuera de la ruta', '· recalculando desde su posición')}</div>
                        <div class="hud-row hud-route-notice${s.routeNotice && !s.routeNotice.warning ? ' is-ok' : ''}" data-hud-alert="2.5" data-nav-route-notice role="status" ${s.routeNotice ? '' : 'hidden'}><div class="warn-line">${this.icon(s.routeNotice && !s.routeNotice.warning ? 'check-circle-fill' : 'warning-fill')}<span><span data-nav-route-notice-text>${esc(s.routeNotice ? s.routeNotice.text : '')}</span> <span class="warn-sub" data-nav-route-notice-sub>${esc(s.routeNotice ? '· ' + s.routeNotice.sub : '')}</span></span></div></div>
                        <div class="hud-row hud-ai-alert${s.aiAlert && !s.aiAlert.warning ? ' is-ok' : ''}" data-hud-alert="1" data-nav-ai-alert role="alert" ${s.aiAlert ? '' : 'hidden'}><div class="warn-line">${this.icon('siren')}<span><span data-nav-ai-alert-text>${esc(s.aiAlert ? s.aiAlert.text : '')}</span> <span class="warn-sub" data-nav-ai-alert-sub>${esc(s.aiAlert ? '· ' + s.aiAlert.sub : '')}</span></span></div></div>
                        <div class="hud-row" data-hud-alert="2" data-nav-clearance role="status" ${s.clearance ? '' : 'hidden'}><div class="warn-line">${this.icon('warning-fill')}<span><span data-nav-clearance-text>${esc(s.clearance ? s.clearance.text : '')}</span> <span class="warn-sub" data-nav-clearance-sub>${esc(s.clearance ? '· ' + s.clearance.sub : '')}</span></span></div></div>
                        <div class="hud-row hud-gps" data-hud-alert="5" id="driver-telemetry-badge" aria-live="polite"></div>
                        <button type="button" class="hud-row hud-more" data-hud-more hidden aria-expanded="false" onclick="window.RouteGuidance.toggleAlerts()"><span data-hud-more-text></span></button>
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

    /** Filtros de Alertas: [tipo, etiqueta]. */
    ALERT_FILTERS: [
        ['all', 'Todas'], ['scale', 'Básculas'], ['bridge', 'Gálibos bajos'],
        ['police', 'Retenes'], ['rest', 'Paradores'], ['danger', 'Incidentes']
    ],

    /** "Actualizado hace 1 min" a partir de la última sincronización. */
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
            // Cargando: esqueleto de la lista, no el vacío (no se afirma que no haya reportes).
            body = `
                <section aria-busy="true" aria-label="Cargando alertas" class="alerts-loading">
                    <p class="status-line">${this.spinner()}<span class="status-sub">Buscando reportes cerca de usted…</span></p>
                    <div class="skeleton-row"></div><div class="skeleton-row"></div><div class="skeleton-row"></div>
                </section>`;
        } else if (errors.alerts && !allAlerts.length) {
            // Error: distinto del vacío, con la causa y cómo seguir.
            body = `
                <section class="empty-state" aria-labelledby="alerts-error-title">
                    <div class="empty-mark">${this.icon('wifi-slash')}</div>
                    <h2 id="alerts-error-title">No se pudieron cargar las alertas</h2>
                    <p>El servidor no respondió. Puede que no haya señal; los reportes de otros conductores aparecerán al reconectar.</p>
                    ${retry}
                </section>`;
        } else if (!alerts.length) {
            // Vacío: no afirma que la vía sea segura, solo que no hay reportes.
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
                            <p class="alert-meta">${esc([a.badge, a.timeAgo, a.upvotes + (Number(a.upvotes) === 1 ? ' confirmación' : ' confirmaciones')].filter(Boolean).join(' · '))}${a.verified ? ` <span class="alert-verified">${this.dotText('Validada', 'ok')}</span>` : ''}</p>
                            ${a.description ? `<p class="alert-text">${esc(a.description)}</p>` : ''}
                            <div class="alert-foot">
                                <span class="secondary">${esc(a.author || '')}</span>
                                <button onclick="window.app.upvoteAlert(${Number(a.id)})" class="btn-quiet alert-confirm">${this.icon('check-circle')}Confirmar</button>
                            </div>
                        </article>`).join('')}
                </div>
                <div class="screen-actions">${report}</div>`;
        }

        const inbox = state.alertsView === 'inbox';
        const unread = window.TruckCarService && window.TruckCarService.unreadNotifications
            ? window.TruckCarService.unreadNotifications() : 0;
        return `
            <div class="screen-scroll">
                <h1 class="large-title">Alertas</h1>
                <div class="segmented" role="tablist" aria-label="Alertas de la vía o notificaciones para usted">
                    <button type="button" role="tab" aria-selected="${!inbox}" onclick="window.store.setState({ alertsView: 'road' })">En la vía</button>
                    <button type="button" role="tab" aria-selected="${inbox}" onclick="window.app.openInbox()">Para usted${unread && !inbox ? ` <span class="segmented-count">${unread}</span>` : ''}</button>
                </div>
                ${inbox ? this.renderInbox(state) : `
                    <p class="secondary">Reportes de otros conductores en la vía.</p>
                    <div class="filters" role="group" aria-label="Filtrar alertas">
                        ${this.ALERT_FILTERS.map(([key, label]) => `
                            <button type="button" onclick="window.store.setState({ alertFilter: '${key}' })" aria-pressed="${filter === key}" class="filter">${label}</button>`).join('')}
                    </div>
                    ${body}`}
            </div>
        `;
    },

    /** Lo que espera en la cola, agrupado como lo entiende el conductor. */
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

    /** "hoy 3:40 a. m.", "mañana 4:30 a. m." o "8 nov, 3:40 a. m.": hasta cuándo dura el mapa guardado. */
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
        // Estado real de la cola durable (IndexedDB); se vuelve a pintar en cada cambio (app.js).
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
    }
};

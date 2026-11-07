window.ui = {
    escape(value) {
        return String(value === null || value === undefined ? '' : value)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    },

    /**
     * Notificación flotante (js/ui/toaster.js). options.description añade una segunda línea y options.action un botón
     * ({ label, onClick }).
     */
    toast(message, type = 'info', options = {}) {
        if (!window.Toaster) return;
        window.Toaster.show({ title: message, type, ...options });
    },

    /**
     * Error de una acción del usuario: 401/403/409 se explican en un diálogo (qué pasó y qué hacer); el resto, en un
     * toast con el detalle técnico como segunda línea.
     */
    failure(title, error, context) {
        // 401: el listener global de truckcar:unauthorized ya cerró la sesión y lo explicó.
        if (error && error.status === 401) return;
        if (window.Sheet && window.Sheet.explainError(error, context)) return;
        this.toast(title, 'error', { description: this.errorMessage(error) });
    },

    errorMessage(error) {
        if (!error) return 'Error desconocido';
        const suffix = error.correlationId ? ' [trace ' + String(error.correlationId).slice(0, 8) + ']' : '';
        return (error.message || String(error)) + suffix;
    },

    /** Banner con el estado de sincronización con el backend, reutilizado por ambas vistas. */
    /** Qué no se pudo actualizar, en palabras del conductor (el detalle técnico queda en el título). */
    SYNC_SECTIONS: {
        alerts: 'las alertas', routes: 'la ruta', fleet: 'la flota', user: 'su perfil', profile: 'el perfil',
        driver: 'el perfil', assignment: 'la carga', load: 'la carga', loads: 'las cargas', shipments: 'los envíos',
        deliveries: 'las entregas', evaluation: 'la evaluación de despacho'
    },

    /**
     * Franja bajo la cabecera mientras se actualizan los datos o si algo falló. Sin colores de fondo: actualizando es
     * texto gris; un fallo es una advertencia (triángulo y texto, nunca rojo, que es solo del SOS). Una pantalla que ya
     * explica su propio error (Alertas, Rutas) no lo repite aquí.
     */
    syncBanner(state) {
        const status = state.dataStatus || {};
        const own = state.activeRole === 'driver'
            ? { alerts: 'alerts', route_overview: 'routes' }[state.driverScreen] : null;
        const errors = Object.entries(status.errors || {}).filter(([key]) => key !== own);
        const icon = (name) => '<svg aria-hidden="true"><use href="assets/icons.svg#' + name + '"></use></svg>';
        if (status.loading) {
            return '<div class="sync-banner" role="status"><span class="spinner" aria-hidden="true"></span>Actualizando…</div>';
        }
        if (errors.length) {
            const what = [...new Set(errors.map(([key]) => this.SYNC_SECTIONS[key] || key))];
            const list = what.length > 1 ? what.slice(0, -1).join(', ') + ' y ' + what[what.length - 1] : what[0];
            const detail = errors.map(([k, v]) => k + ': ' + v).join(' · ');
            return `<div class="sync-banner is-warn" role="status" title="${this.escape(detail)}">
                <span class="sync-text">${icon('warning-fill')}No se pudo actualizar ${this.escape(list)}</span>
                <button onclick="window.app.reloadData()" class="sync-retry">Reintentar</button></div>`;
        }
        return '';
    }
};

window.app = {
    pollTimer: null,

    init() {
        // Enlace público de seguimiento (?track=): sin sesión, sin cola offline ni barra de roles.
        if (window.PublicTracking.maybeStart()) return;
        // Sin ?demo=1 no hay herramientas de simulación a la vista: una simulación de GPS que quedó activa de una sesión
        // anterior se apaga, para que no siga corriendo sin un interruptor visible.
        if (!window.TruckCarConfig.demoTools) {
            try { localStorage.removeItem('truckcar.telemetryMode'); } catch (e) { /* sin almacenamiento */ }
        }
        window.store.subscribe((state) => this.renderCurrentView(state));
        window.Native.init();
        this.initOffline();
        this.watchPhoneLayout();

        window.addEventListener('truckcar:unauthorized', () => {
            if (window.store.state.isAuthenticated) {
                this.endSession();
                window.Sheet.explainError({ status: 401 });
            }
        });

        // 403: la cuenta no tiene permiso para esa vista. Se vuelve a la vista propia del rol, sin franja de error.
        window.addEventListener('truckcar:forbidden', () => {
            const state = window.store.state;
            if (!state.isAuthenticated) return;
            const home = this.roleToView(state.sessionRole);
            if (state.activeRole !== home) {
                window.store.setState({ activeRole: home });
                window.ui.toast(home === 'generator'
                    ? 'Su cuenta de generador de carga solo tiene acceso a "Mis envíos".'
                    : 'Su cuenta no tiene acceso a esa vista.', 'info');
                window.TruckCarService.loadAll();
            }
        });

        const session = window.TruckCarApi.session;
        if (session.isActive()) {
            this.startSession(session.get());
        } else if (session.isRenewable()) {
            // Access token vencido (dura 15 min) pero con refresh token: se renueva sin pedir login.
            window.TruckCarApi.ensureFreshSession()
                .then(renewed => this.startSession(renewed))
                .catch(() => {
                    session.clear();
                    this.renderCurrentView(window.store.state);
                });
        } else {
            session.clear();
            this.renderCurrentView(window.store.state);
        }
    },

    // ------------------------------------------------------------------ vista por dispositivo
    /** Teléfono: por debajo del breakpoint md (768 px) de Tailwind, el mismo que oculta los textos del selector. */
    isPhone() {
        return typeof window.matchMedia === 'function' && !window.matchMedia('(min-width: 768px)').matches;
    },

    /**
     * En el teléfono la app del conductor es solo de cuentas CONDUCTOR: su GPS, SOS y telemetría no funcionan con
     * ADMIN ni COORDINADOR (el backend rechaza el SOS de otros roles). En escritorio la torre conserva la vista previa.
     */
    canUseDriverView(sessionRole) {
        return sessionRole === 'CONDUCTOR' || !this.isPhone();
    },

    /** Si la ventana pasa a tamaño teléfono con la vista previa del conductor abierta, se vuelve a la torre. */
    watchPhoneLayout() {
        if (typeof window.matchMedia !== 'function') return;
        const query = window.matchMedia('(min-width: 768px)');
        const onChange = () => {
            const state = window.store.state;
            if (state.isAuthenticated && state.activeRole === 'driver' && !this.canUseDriverView(state.sessionRole)) {
                this.setRole('coordinator');
            } else {
                this.updateHeader(state);
            }
        };
        if (query.addEventListener) query.addEventListener('change', onChange);
        else if (query.addListener) query.addListener(onChange);
    },

    // ------------------------------------------------------------------ sesión
    /** CONDUCTOR -> app del conductor; GENERADOR -> solo "Mis envíos"; COORDINADOR/ADMIN -> torre de control. */
    roleToView(role) {
        if (role === 'CONDUCTOR') return 'driver';
        if (role === 'GENERADOR') return 'generator';
        return 'coordinator';
    },

    async startSession(session) {
        window.store.setState({
            isAuthenticated: true,
            sessionRole: session.role,
            authError: null,
            busyAction: null,
            activeRole: this.roleToView(session.role)
        });
        this.scheduleSessionRefresh();
        await window.TruckCarService.loadAll();
        this.schedulePolling();
        window.Native.applyShortcut();
        window.Native.Install.maybeOffer();
    },

    /**
     * Renueva el access token (15 min) un minuto antes de que venza, aunque no haya peticiones: la reconexión del
     * WebSocket y la cola offline siempre encuentran un token válido y la sesión no se interrumpe. Si la renovación
     * falla por red se reintenta en 30 s; si el refresh token ya no sirve, api.js emite truckcar:unauthorized.
     */
    scheduleSessionRefresh() {
        clearTimeout(this.sessionRefreshTimer);
        const session = window.TruckCarApi.session.get();
        if (!session || !session.expiresAt) return;
        const delay = Math.max(5000, session.expiresAt - Date.now() - 60 * 1000);
        this.sessionRefreshTimer = setTimeout(async () => {
            if (!window.store.state.isAuthenticated) return;
            try {
                await window.TruckCarApi.ensureFreshSession();
                this.scheduleSessionRefresh();
            } catch (error) {
                if (error && error.status === 401) return;
                this.sessionRefreshTimer = setTimeout(() => this.scheduleSessionRefresh(), 30 * 1000);
            }
        }, delay);
    },

    endSession() {
        clearTimeout(this.sessionRefreshTimer);
        clearInterval(this.pollTimer);
        clearInterval(this.shipmentsTimer);
        clearInterval(this.driverTimer);
        clearInterval(this.countdownTimer);
        clearInterval(this.inboxTimer);
        window.SosMonitor.stop();
        window.DriverTelemetry.stop();
        window.RouteGuidance.reset();
        window.DeviceLocation.forget();
        window.LiveTracking.stopAll();
        window.TruckCarTelemetry.disconnect();
        window.TruckCarService.reset();
        window.TruckCarApi.session.clear();
        window.generatorCtrl.reset();
        window.store.setState({
            isAuthenticated: false,
            currentUser: null,
            sessionRole: null,
            busyAction: null,
            dataStatus: { loading: false, errors: {}, lastSync: null },
            driverScreen: 'assigned_load',
            coordinatorTab: 'fleet',
            selectedShipmentId: null,
            shipmentFilter: 'ALL',
            generatorFormError: null
        });
    },

    async submitLogin(event) {
        event.preventDefault();
        const form = new FormData(event.target);
        window.store.setState({ busyAction: 'auth', authError: null });
        try {
            const session = await window.TruckCarApi.auth.login(form.get('email').trim(), form.get('password'));
            await this.startSession(session);
        } catch (error) {
            window.store.setState({ busyAction: null, authError: window.ui.errorMessage(error) });
        }
    },

    async submitRegister(event) {
        event.preventDefault();
        const form = new FormData(event.target);
        window.store.setState({ busyAction: 'auth', authError: null });
        try {
            const session = await window.TruckCarApi.auth.register({
                email: form.get('email').trim(),
                password: form.get('password'),
                firstName: form.get('firstName').trim(),
                lastName: form.get('lastName').trim(),
                phoneNumber: (form.get('phoneNumber') || '').trim() || null,
                role: form.get('role')
            });
            await this.startSession(session);
        } catch (error) {
            window.store.setState({ busyAction: null, authError: window.ui.errorMessage(error) });
        }
    },

    async logout() {
        try {
            await window.TruckCarApi.auth.logout();
        } catch (error) {
            // El token puede haber expirado; la sesión local se cierra igual.
        }
        this.endSession();
    },

    schedulePolling() {
        clearInterval(this.pollTimer);
        this.pollTimer = setInterval(async () => {
            const state = window.store.state;
            const typing = document.activeElement && ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName);
            if (!state.isAuthenticated || state.activeRole !== 'coordinator' || typing) return;
            await window.TruckCarService.refreshCoordinator();
        }, window.TruckCarConfig.pollingIntervalMs);
        // "Mis envíos" se refresca más seguido (solo cargas propias y flota) para seguir los cambios de estado.
        clearInterval(this.shipmentsTimer);
        this.shipmentsTimer = setInterval(async () => {
            const state = window.store.state;
            const typing = document.activeElement && ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName);
            const podOpen = document.getElementById('pod-viewer-modal');
            const onShipments = state.activeRole === 'generator'
                || (state.activeRole === 'coordinator' && state.coordinatorTab === 'shipments');
            if (!state.isAuthenticated || !onShipments || typing || podOpen) return;
            await window.generatorCtrl.refresh(true);
        }, 10000);
        // El conductor sin viaje en curso se entera de una propuesta sin tocar nada: tiene minutos para responder.
        clearInterval(this.driverTimer);
        this.driverTimer = setInterval(() => this.pollDriverProposals(), window.TruckCarConfig.driverPollingMs);
        clearInterval(this.countdownTimer);
        this.countdownTimer = setInterval(() => this.tickCountdowns(), 1000);
        clearInterval(this.inboxTimer);
        this.inboxTimer = setInterval(() => this.pollInbox(), 30000);
        this.pollInbox();
    },

    /**
     * Cada 30 s para el conductor: el número de nuevas en la pestaña Alertas y, mientras la cuenta esté pendiente,
     * si un administrador ya la verificó (sin cerrar sesión).
     */
    async pollInbox() {
        const state = window.store.state;
        if (!state.isAuthenticated || state.sessionRole !== 'CONDUCTOR' || !state.currentUser) return;
        const service = window.TruckCarService;
        if (state.currentUser.status === 'PENDING_VERIFICATION') {
            try {
                const user = await service.loadCurrentUser();
                if (user && user.status === 'ACTIVE') {
                    window.ui.toast('Su cuenta fue verificada', 'success', { description: 'Ya puede recibir cargas.' });
                }
            } catch (error) {
                // sin señal: se vuelve a consultar en la siguiente vuelta
            }
        }
        const before = (window.TruckCarData.notifications || []).map(n => n.id).join();
        try {
            await service.loadNotifications();
        } catch (error) {
            return; // sin señal: se reintenta en la siguiente vuelta
        }
        const changed = before !== (window.TruckCarData.notifications || []).map(n => n.id).join();
        const viewing = state.activeRole === 'driver' && state.driverScreen === 'alerts' && state.alertsView === 'inbox';
        if (viewing) service.markNotificationsSeen();
        const typing = document.activeElement && ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName);
        if (changed && !typing && !document.querySelector('.sheet-backdrop')) window.store.setState({});
    },

    async openInbox() {
        window.store.setState({ alertsView: 'inbox', inboxStatus: 'loading' });
        try {
            await window.TruckCarService.loadNotifications();
            window.TruckCarService.markNotificationsSeen();
            window.store.setState({ inboxStatus: 'ready' });
        } catch (error) {
            window.store.setState({ inboxStatus: 'error' });
        }
    },

    async pollDriverProposals() {
        const state = window.store.state;
        const current = window.TruckCarData.activeLoadOrder;
        const typing = document.activeElement && ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName);
        const overlayOpen = document.querySelector('.sheet-backdrop');
        const onTrip = current && (current.status === 'ASSIGNED' || current.status === 'IN_TRANSIT');
        if (!state.isAuthenticated || state.activeRole !== 'driver' || state.sessionRole !== 'CONDUCTOR'
            || state.busyAction || typing || overlayOpen || onTrip || this.pollingProposals) return;
        this.pollingProposals = true;
        try {
            const key = (l) => (l ? [l.backendId, l.status, l.assignmentStatus].join(':') : '');
            await window.TruckCarService.loadDriverAssignment();
            const after = window.TruckCarData.activeLoadOrder;
            const change = window.DriverApp.proposalChange(current, after);
            if (change === 'new') this.announceProposal(after);
            if (change === 'gone') {
                window.ui.toast('La propuesta ya no está disponible', 'info',
                    { description: 'Venció o se asignó a otro conductor. Le avisaremos cuando llegue otra.' });
            }
            if (key(current) !== key(after)) window.store.setState(change === 'new' && window.store.state.driverScreen !== 'navigation'
                ? { driverScreen: 'assigned_load' } : {});
        } finally {
            this.pollingProposals = false;
        }
    },

    /** Nueva propuesta: aviso visible, vibración y voz (el conductor puede no estar mirando el teléfono). */
    announceProposal(load) {
        const route = (load.origin.city || 'Origen') + ' → ' + (load.destination.city || 'destino');
        const minutes = window.TruckCarConfig.assignmentResponseMinutes;
        window.ui.toast('Nueva carga propuesta', 'success',
            { description: route + ' · ' + load.netWeight + ' t. Tiene ' + minutes + ' minutos para responder.' });
        if (navigator.vibrate) navigator.vibrate([200, 100, 200]);
        window.voiceEngine.speak('Nueva carga propuesta: ' + route.replace('→', 'a') + ', ' + load.netWeight
            + ' toneladas. Tiene ' + minutes + ' minutos para responder.');
    },

    /** Actualiza la cuenta regresiva de la propuesta sin redibujar la pantalla; al vencer, consulta de nuevo. */
    tickCountdowns() {
        document.querySelectorAll('[data-deadline]').forEach((el) => {
            const text = el.querySelector('[data-countdown-text]');
            const left = window.DriverApp.countdownText(Number(el.dataset.deadline));
            if (left) {
                const b = text.querySelector('b');
                if (b) b.textContent = left;
                return;
            }
            if (el.dataset.expired) return;
            el.dataset.expired = '1';
            text.textContent = 'El plazo venció · el motor la ofrecerá a otro conductor';
            this.pollDriverProposals();
        });
    },

    async reloadData() {
        window.store.setState({ dataStatus: { ...window.store.state.dataStatus, errors: {} } });
        await window.TruckCarService.loadAll();
    },

    // ------------------------------------------------------------------ render
    renderCurrentView(state) {
        const mount = document.getElementById('app-mount');
        if (!mount) return;

        this.updateHeader(state);
        if (!state.isAuthenticated) {
            this.syncLiveTracking(state);
            mount.innerHTML = window.LoginView.render(state);
            window.Native.markScreen(mount, 'login');
            window.DriverActions.syncSos(state);
            window.SosMonitor.sync(state);
            window.DeviceLocation.sync(state);
            window.Native.NetworkStatus.render();
            return;
        }

        // El mapa de la torre y el de "Mis envíos" sobreviven al re-render: su contenedor se vuelve a insertar en
        // lugar del nuevo, así la telemetría mueve los marcadores sin que el mapa se destruya en cada actualización.
        const liveMap = window.mapCtrl.map ? window.mapCtrl.map.getContainer() : null;
        const keepMap = liveMap && this.KEEP_ALIVE_MAPS.includes(liveMap.id) ? liveMap : null;

        if (state.activeRole === 'generator') {
            mount.innerHTML = window.GeneratorPanel.render(state);
        } else if (state.activeRole === 'driver') {
            mount.innerHTML = window.DriverApp.render(state);
        } else if (state.activeRole === 'coordinator' && state.coordinatorTab === 'shipments') {
            mount.innerHTML = window.GeneratorPanel.render(state);
        } else if (state.activeRole === 'coordinator' && ['restrictions', 'users', 'templates'].includes(window.CoordinatorPanel.activeTab(state))) {
            mount.innerHTML = window.TowerAdmin.render(state, window.CoordinatorPanel.activeTab(state));
        } else if (state.activeRole === 'coordinator') {
            mount.innerHTML = window.CoordinatorPanel.render(state);
        }

        const placeholder = keepMap && document.getElementById(keepMap.id);
        if (placeholder && placeholder !== keepMap) {
            placeholder.replaceWith(keepMap);
            window.mapCtrl.map.invalidateSize();
        }

        if (state.activeRole === 'driver') this.handleDriverMapMount(state);
        else if (document.getElementById('generator-map-container')) this.handleGeneratorMapMount(state);
        else if (document.getElementById('coordinator-map-container')) this.handleCoordinatorMapMount(state);

        this.syncLiveTracking(state);
        window.TruckCarTelemetry.renderStatusBadges();
        window.DriverTelemetry.renderBadge();

        const screenKey = state.activeRole + ':' + (state.activeRole === 'driver' ? state.driverScreen : state.coordinatorTab);
        window.Native.markScreen(mount, screenKey);
        window.Native.NetworkStatus.render();
        window.Native.animateCounters(mount);
        window.DriverActions.syncSos(state);
        window.SosMonitor.sync(state);
        window.DeviceLocation.sync(state);
        window.DriverTelemetry.renderSimulationToggle();
    },

    KEEP_ALIVE_MAPS: ['coordinator-map-container', 'generator-map-container'],

    /**
     * Suscripciones de telemetría según la vista: la torre sigue toda la flota y "Mis envíos" cada carga aceptada o
     * en ruta. Las posiciones mueven los marcadores directamente, sin setState ni peticiones HTTP.
     */
    syncLiveTracking(state) {
        const live = window.LiveTracking;
        if (!state.isAuthenticated) {
            live.stopAll();
            return;
        }
        const onTower = state.activeRole === 'coordinator' && state.coordinatorTab !== 'shipments';
        const onShipments = state.activeRole === 'generator'
            || (state.activeRole === 'coordinator' && state.coordinatorTab === 'shipments');

        if (onTower) {
            live.followFleet((truck) => {
                if (window.mapCtrl.isMountedOn('coordinator-map-container')) window.mapCtrl.moveFleetMarker(truck);
            });
        } else {
            live.unfollowFleet();
        }

        if (onShipments) {
            const followed = (window.TruckCarData.publishedLoads || [])
                .filter(l => l.status === 'ASSIGNED' || l.status === 'IN_TRANSIT')
                .map(l => l.backendId);
            live.followTrips(followed, (truck, msg) => {
                const selected = window.GeneratorPanel.selectedLoad(window.store.state);
                if (!selected || selected.backendId !== msg.loadId) return;
                if (window.mapCtrl.isMountedOn('generator-map-container')) window.mapCtrl.moveShipmentTruck(truck);
                window.GeneratorPanel.updateTruckLine(truck);
            });
        } else {
            live.unfollowTrips();
        }
    },

    /**
     * Barra superior según el rol de la sesión: el selector conductor/torre solo para COORDINADOR y ADMIN; las
     * herramientas de prueba del conductor (rotar, simular GPS) no aplican a un generador.
     */
    updateHeader(state) {
        const role = state.isAuthenticated ? state.sessionRole : null;
        const show = (id, visible) => {
            const el = document.getElementById(id);
            if (el) el.classList.toggle('hidden', !visible);
        };
        const controlTower = role === 'COORDINADOR' || role === 'ADMIN';
        // En el teléfono la torre no puede abrir la app del conductor: el selector no tiene a dónde llevar.
        show('role-switcher', controlTower && this.canUseDriverView(role));
        show('rotate-device-btn', role !== 'GENERADOR');
        show('sim-toggle-btn', role !== 'GENERADOR');
        // La vista activa decide el layout móvil (css/main.css): el conductor usa su propia barra superior.
        document.body.dataset.view = state.isAuthenticated ? state.activeRole : 'login';
        const frame = document.getElementById('phone-mockup-frame');
        if (frame) {
            const driverLike = !state.isAuthenticated || state.activeRole === 'driver';
            frame.classList.toggle('phone-frame', driverLike);
            frame.classList.toggle('landscape-mode', driverLike && state.isLandscape);
            frame.classList.toggle('coordinator-frame', !driverLike);
            frame.style.position = 'relative'; // ancla del botón SOS
        }
        const active = 'bg-accent-500/15 text-accent-500';
        const idle = 'text-slate-400 hover:text-slate-200';
        [['role-btn-driver', 'driver'], ['role-btn-coordinator', 'coordinator']].forEach(([id, view]) => {
            const el = document.getElementById(id);
            if (!el) return;
            const selected = state.activeRole === view;
            active.split(' ').forEach(c => el.classList.toggle(c, selected));
            idle.split(' ').forEach(c => el.classList.toggle(c, !selected));
        });
    },

    setCoordinatorTab(tab) {
        window.store.setState({ coordinatorTab: tab });
        if (tab === 'shipments') window.generatorCtrl.refresh(true);
        if (['restrictions', 'users', 'templates'].includes(tab)) window.TowerAdmin.load(tab);
    },

    handleGeneratorMapMount(state) {
        this.scheduleMapMount(() => {
            if (!document.getElementById('generator-map-container')) return;
            const load = window.GeneratorPanel.selectedLoad(window.store.state);
            const key = load ? load.backendId : null;
            if (window.mapCtrl.isMountedOn('generator-map-container')) {
                // Mismo mapa: se redibuja el envío y solo se reencuadra si cambió la carga seleccionada.
                window.mapCtrl.drawShipment(load, window.GeneratorPanel.truckFor(load), { fit: window.mapCtrl.shipmentKey !== key });
            } else {
                window.mapCtrl.initMap('generator-map-container', [4.6097, -74.0817], 6);
                window.mapCtrl.drawShipment(load, window.GeneratorPanel.truckFor(load));
            }
            window.mapCtrl.shipmentKey = key;
        });
    },

    /** Agrupa montajes de mapa: varios renders seguidos (sincronización) crean el mapa una sola vez. */
    scheduleMapMount(fn) {
        clearTimeout(this.mapMountTimer);
        this.mapMountTimer = setTimeout(fn, 150);
    },

    handleDriverMapMount(state) {
        this.scheduleMapMount(() => {
            if (state.driverScreen === 'route_overview') {
                if (!document.getElementById('overview-map-container')) return;
                window.mapCtrl.initMap('overview-map-container', [4.6097, -74.0817], 7);
                // La hoja inferior de Rutas tapa la parte baja del mapa: atribución y encuadre van por encima de ella.
                window.mapCtrl.observeBottomSheet(document.querySelector('[data-route-sheet]'));
                window.mapCtrl.drawOverviewRoutes();
            } else if (state.driverScreen === 'navigation') {
                if (!document.getElementById('live-nav-map-container')) return;
                // Centro: la posición de la telemetría (GPS real o simulación de prueba explícita); sin ella, la ruta.
                const point = window.DriverTelemetry.lastPoint;
                const fix = point ? point.coords : (window.DeviceLocation.last() || {}).coords;
                window.mapCtrl.initMap('live-nav-map-container', fix || [4.6097, -74.0817], fix ? 15 : 7);
                window.mapCtrl.drawLiveNavigation(fix || null);
                window.RouteGuidance.prepare(window.TruckCarData.activeLoadOrder);
                window.RouteGuidance.renderHud();
            }
        });
    },

    handleCoordinatorMapMount(state) {
        this.scheduleMapMount(() => {
            if (!document.getElementById('coordinator-map-container')) return;
            if (window.mapCtrl.isMountedOn('coordinator-map-container')) {
                // Mapa reutilizado: se actualizan capas sin reencuadrar (el usuario conserva su zoom).
                window.mapCtrl.renderAlerts();
                window.mapCtrl.renderCoordinatorFleetMarkers();
                return;
            }
            window.mapCtrl.initMap('coordinator-map-container', [4.4389, -75.2322], 7);
            window.mapCtrl.drawCoordinatorFleet();
        });
    },

    async setRole(role) {
        const sessionRole = window.store.state.sessionRole;
        if (!window.store.state.isAuthenticated) return;
        if (sessionRole === 'GENERADOR') {
            // Un generador solo tiene "Mis envíos": no entra a la torre ni a la app del conductor.
            if (window.store.state.activeRole !== 'generator') window.store.setState({ activeRole: 'generator' });
            return;
        }
        if (role === 'coordinator' && sessionRole === 'CONDUCTOR') {
            window.ui.toast('La torre de control requiere una cuenta de coordinador.', 'warning');
            return;
        }
        if (role === 'driver' && !this.canUseDriverView(sessionRole)) role = 'coordinator';
        if (role === window.store.state.activeRole) return;
        window.store.setState({ activeRole: role });
        await window.TruckCarService.loadAll();
    },

    toggleRotation() {
        const newLandscape = !window.store.state.isLandscape;
        window.store.setState({ isLandscape: newLandscape });

        const phoneFrame = document.getElementById('phone-mockup-frame');
        if (phoneFrame) {
            if (newLandscape) {
                phoneFrame.classList.add('landscape-mode');
            } else {
                phoneFrame.classList.remove('landscape-mode');
            }
        }

        setTimeout(() => {
            if (window.mapCtrl && window.mapCtrl.map) {
                window.mapCtrl.map.invalidateSize();
            }
        }, 350);
    },

    // ------------------------------------------------------------------ conductor
    /** Posición para el registro del vehículo: la del GPS reciente, o una lectura nueva (null sin permiso o señal). */
    async currentCoords() {
        const recent = window.DeviceLocation.last(2 * 60 * 1000);
        if (recent) return recent.coords;
        const fix = await window.DeviceLocation.fix({ timeoutMs: 6000 });
        return fix ? fix.coords : null;
    },

    async openVehicleForm() {
        const driver = window.TruckCarData.currentDriver;
        if (!driver) return;
        const firstTime = !driver.state;
        const saved = await window.VehicleForm.open(driver, async (vehicle, cityCoords) => {
            // Al editar sin GPS se conserva la última posición registrada; en el primer registro hace falta una.
            const coords = cityCoords || await this.currentCoords() || driver.coords;
            if (!coords) {
                throw Object.assign(new Error((window.DeviceLocation.error || 'No se pudo leer el GPS.')
                    + ' Elija aquí la ciudad donde está.'), { field: 'location' });
            }
            await window.TruckCarService.saveVehicle(vehicle, coords);
        });
        if (!saved) return;
        window.store.setState({});
        window.ui.toast(firstTime ? 'Vehículo registrado: ya puede recibir cargas.' : 'Vehículo actualizado.', 'success');
    },

    async toggleAvailability() {
        const driver = window.TruckCarData.currentDriver;
        if (!driver || !driver.state) return;
        const available = String(driver.status).toUpperCase() === 'INACTIVO';
        window.store.setState({ busyAction: 'availability' });
        try {
            await window.TruckCarService.setAvailability(available, available ? await this.currentCoords() : null);
            window.ui.toast(available ? 'Disponible: el motor le puede proponer cargas.' : 'No disponible: no recibirá propuestas.',
                available ? 'success' : 'info');
        } catch (error) {
            window.ui.failure('No se pudo cambiar la disponibilidad', error, 'cambiar la disponibilidad');
        } finally {
            window.store.setState({ busyAction: null });
        }
    },

    async handleAcceptTrip() {
        window.store.setState({ busyAction: 'accept' });
        try {
            await window.TruckCarService.acceptAssignment();
            window.voiceEngine.speak('Carga aceptada. Calculando ruta segura para su vehículo.');
            window.ui.toast('Carga aceptada en Load-Allocation.', 'success');
            await window.TruckCarService.loadRoutePlan();
            window.store.setState({ busyAction: null, driverScreen: 'route_overview' });
        } catch (error) {
            window.store.setState({ busyAction: null });
            window.ui.failure('No se pudo aceptar la carga', error, 'aceptar la carga');
        }
    },

    async handleRejectTrip() {
        const reason = await window.Sheet.prompt({
            title: 'Rechazar esta carga',
            message: 'El motor de asignación la ofrecerá a otro conductor. ¿Por qué no puede tomarla?',
            icon: 'fa-circle-xmark',
            tone: 'danger',
            suggestions: ['Exceso de horas de conducción', 'Falla mecánica', 'Flete no acorde', 'Ruta no apta para mi vehículo'],
            placeholder: 'Otro motivo…',
            confirmLabel: 'Rechazar carga'
        });
        if (!reason) return;
        window.store.setState({ busyAction: 'reject' });
        try {
            await window.TruckCarService.rejectAssignment();
            window.voiceEngine.speak('Viaje rechazado. El sistema reasignará la carga.');
            window.ui.toast('Rechazo registrado. El motor de asignación buscará otro conductor.', 'success');
            window.store.setState({ busyAction: null, driverScreen: 'profile' });
        } catch (error) {
            window.store.setState({ busyAction: null });
            window.ui.failure('No se pudo rechazar la carga', error, 'rechazar la carga');
        }
    },

    async refreshAssignment() {
        await window.TruckCarService.loadDriverAssignment();
        await window.TruckCarService.loadRoutePlan();
        window.store.setState({});
    },

    /** Inicia el viaje real (ASSIGNED -> IN_TRANSIT) y abre la navegación; si ya está en tránsito, la reanuda. */
    async startNavigation() {
        const load = window.TruckCarData.activeLoadOrder;
        if (!load || (load.status !== 'ASSIGNED' && load.status !== 'IN_TRANSIT')) {
            window.ui.toast('Acepte una carga antes de iniciar el viaje.', 'warning');
            return;
        }
        if (load.status === 'ASSIGNED') {
            window.store.setState({ busyAction: 'start-trip' });
            try {
                await window.TruckCarService.startTrip();
                window.ui.toast('Viaje iniciado: la carga está en tránsito.', 'success');
            } catch (error) {
                window.store.setState({ busyAction: null });
                window.ui.failure('No se pudo iniciar el viaje', error, 'iniciar el viaje');
                return;
            }
        }
        window.store.setState({ busyAction: null, driverScreen: 'navigation' });
        window.DeviceLocation.watch();
        // La guía paso a paso sale de la ruta real (Route-AI + OSRM); la primera instrucción se anuncia con la
        // primera posición GPS.
        window.RouteGuidance.prepare(window.TruckCarData.activeLoadOrder);
        window.voiceEngine.speak('Navegación iniciada hacia ' + window.DriverApp.destinationLabel() + '.', true);
    },

    /** Registra la entrega con su prueba (IN_TRANSIT -> DELIVERED). */
    async finishTrip() {
        const load = window.TruckCarData.activeLoadOrder;
        if (!load || load.status !== 'IN_TRANSIT') {
            window.ui.toast('No hay un viaje en tránsito para finalizar.', 'warning');
            return;
        }
        // Formulario de POD (receptor, firma en lienzo y foto). Si el backend rechaza la entrega, el formulario
        // sigue abierto con el error para no perder la firma.
        const delivered = await window.PodUI.openDeliveryForm(load, (pod) => window.TruckCarService.deliverLoad(pod));
        if (!delivered) return;
        window.voiceEngine.speak('Entrega registrada. Viaje finalizado.');
        window.ui.toast('Entrega registrada (DELIVERED) con firma y prueba de entrega.', 'success');
        window.RouteGuidance.reset();
        window.store.setState({ busyAction: null, driverScreen: 'assigned_load' });
    },

    /** Repite en voz la instrucción de navegación actual. */
    repeatInstruction() {
        const s = window.RouteGuidance.snapshot();
        const hud = window.RouteGuidance.hudText(s);
        window.voiceEngine.speak((s.hasPosition && s.status === 'ready' ? 'En ' + hud.distance + ', ' : '') + hud.instruction, true);
    },

    toggleVoice() {
        const current = window.store.state.voiceEnabled;
        window.store.setState({ voiceEnabled: !current });
        if (!current) {
            window.voiceEngine.speak('Guía de voz para camión activada.');
        }
    },

    toggleOfflineSimulation() {
        const current = window.store.state.isOffline;
        window.store.setState({ isOffline: !current });
        if (!current) {
            window.ui.toast('Simulación: sin cobertura. El mapa sigue con las capas en memoria.', 'warning');
            window.voiceEngine.speak('Modo offline activado. Navegando con mapas descargados.');
        } else {
            window.ui.toast('Simulación: conexión restablecida.', 'success');
            window.voiceEngine.speak('Conexión restablecida.');
            // Igual que el evento online del navegador: se envía lo guardado sin señal.
            window.OfflineQueue.flush();
        }
    },

    /**
     * PWA offline: Service Worker (app y teselas en caché) y cola durable. La pantalla offline del conductor se
     * repinta con cada cambio de la cola, y los rechazos del servidor se avisan al conductor.
     */
    initOffline() {
        if ('serviceWorker' in navigator) {
            navigator.serviceWorker.register('sw.js').catch(error =>
                console.warn('[TruckCar] No se pudo registrar el Service Worker', error));
            // Una versión nueva del Service Worker tomó el control: se recarga una vez para no seguir con el CSS y el JS
            // que sirvió la anterior. En la primera instalación (sin controlador previo) no hace falta.
            const hadController = !!navigator.serviceWorker.controller;
            let reloading = false;
            navigator.serviceWorker.addEventListener('controllerchange', () => {
                if (!hadController || reloading) return;
                reloading = true;
                window.location.reload();
            });
        }
        const data = window.TruckCarData;
        // Mapa guardado para usar sin señal: lo que dice el índice del Service Worker (js/tileStore.js), con el tamaño y
        // el vencimiento reales de cada tesela vigente.
        const refreshTileCount = () => {
            if (!window.indexedDB || !window.TileStore) return;
            window.TileStore.summary().then(summary => {
                data.offlineSyncData.cachedTiles = summary.count;
                data.offlineSyncData.cachedTilesBytes = summary.bytes;
                data.offlineSyncData.cachedTilesExpiry = summary.firstExpiry;
            }).catch(() => {});
        };
        refreshTileCount();
        // Al entrar en la pantalla Offline se vuelve a leer el índice: la fecha "guardado hasta" es la real del momento.
        let lastScreen = null;
        window.store.subscribe((state) => {
            if (state.driverScreen === 'offline' && lastScreen !== 'offline' && window.TileStore) {
                window.TileStore.summary().then(summary => {
                    data.offlineSyncData.cachedTiles = summary.count;
                    data.offlineSyncData.cachedTilesBytes = summary.bytes;
                    data.offlineSyncData.cachedTilesExpiry = summary.firstExpiry;
                    if (window.store.state.driverScreen === 'offline') this.renderCurrentView(window.store.state);
                }).catch(() => {});
            }
            lastScreen = state.driverScreen;
        });
        window.OfflineQueue.onChange(() => {
            const state = window.store.state;
            if (window.DriverApp) window.DriverApp.renderOfflineBadge();
            if (state.activeRole === 'driver' && state.driverScreen === 'offline') {
                refreshTileCount();
                this.renderCurrentView(state);
            }
        });
        window.addEventListener('truckcar:sync-rejected', (event) => {
            window.ui.toast('El servidor rechazó ' + event.detail.length + ' evento(s) sincronizado(s): '
                + event.detail[0], 'warning');
        });
        window.addEventListener('online', () => window.ui.toast('Conexión restablecida: sincronizando…', 'success'));
        window.addEventListener('offline', () => window.ui.toast('Sin conexión: las acciones se guardan en el teléfono.', 'warning'));
    },

    /**
     * Posición para el SOS y los reportes viales: solo el GPS real del dispositivo (la última lectura confirmada). Nunca
     * la guía de navegación, la simulación de prueba ni la posición guardada en el backend.
     */
    currentPosition(maxAgeMs) {
        const fix = window.DeviceLocation.last(maxAgeMs);
        return fix ? fix.coords : null;
    },

    /** Reporte vial de un toque (hoja con la cuadrícula de tipos, js/views/driverActions.js). */
    openReportModal(presetType) {
        window.DriverActions.openReportSheet(presetType);
    },

    async upvoteAlert(id) {
        try {
            await window.TruckCarService.confirmAlert(id);
            window.ui.toast('Confirmación registrada.', 'success');
            window.store.setState({});
        } catch (error) {
            window.ui.failure('No se pudo confirmar la alerta', error, 'confirmar la alerta');
        }
    }
};

document.addEventListener('DOMContentLoaded', () => {
    window.app.init();
});

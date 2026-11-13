window.app = {
    pollTimer: null,
    views: {},
    mountHooks: [],
    renderHooks: [],
    sessionEndHooks: [],

    registerView(role, view) {
        this.views[role] = view;
    },

    onMount(hook) {
        this.mountHooks.push(hook);
    },

    onRender(hook) {
        this.renderHooks.push(hook);
    },

    onSessionEnd(hook) {
        this.sessionEndHooks.push(hook);
    },

    init() {
        if (window.PublicTracking.maybeStart()) return;
        if (!window.TruckCarConfig.demoTools) {
            try { localStorage.removeItem('truckcar.telemetryMode'); } catch (e) { }
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

        window.addEventListener('storage', (event) => this.onSessionStorageChange(event));

        const session = window.TruckCarApi.session;
        if (session.isActive()) {
            this.startSession(session.get());
        } else if (session.isRenewable()) {
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


    onSessionStorageChange(event) {
        if (event.key !== null && event.key !== window.TruckCarConfig.storageKeys.session) return;
        const stored = window.TruckCarApi.session.get();
        const state = window.store.state;
        const user = state.currentUser;
        if (!state.isAuthenticated) {
            if (stored && window.TruckCarApi.session.isActive()) this.startSession(stored);
            return;
        }
        if (!stored) {
            this.endSession();
            return;
        }
        const otherAccount = stored.role !== state.sessionRole || (user && stored.userId && user.id !== stored.userId);
        if (otherAccount) {
            this.endSession({ keepStoredSession: true });
            this.startSession(stored);
        } else {
            this.scheduleSessionRefresh();
        }
    },

    loadDemoSession() {
        if (window.DemoSession) return Promise.resolve(window.DemoSession);
        if (!this.demoSessionLoading) {
            this.demoSessionLoading = new Promise((resolve, reject) => {
                const script = document.createElement('script');
                script.src = 'js/demo/demoSession.js';
                script.onload = () => resolve(window.DemoSession);
                script.onerror = () => {
                    this.demoSessionLoading = null;
                    script.remove();
                    reject(new Error('No se pudo cargar la sesión de demostración'));
                };
                document.head.appendChild(script);
            });
        }
        return this.demoSessionLoading;
    },

    async startDemoSession(role = 'driver') {
        if (!window.TruckCarConfig.demoTools) {
            window.ui.toast('La sesión de demostración solo está disponible con ?demo=1.', 'warning');
            return;
        }
        try {
            const demo = await this.loadDemoSession();
            demo.start(role);
        } catch (error) {
            window.ui.failure('No se pudo iniciar la sesión de demostración', error);
        }
    },

    isPhone() {
        return typeof window.matchMedia === 'function' && !window.matchMedia('(min-width: 768px)').matches;
    },

    canUseDriverView(sessionRole) {
        return window.TruckCarService.roleAccess(sessionRole).driver || !this.isPhone();
    },

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

    roleToView(role) {
        return window.TruckCarService.roleAccess(role).home;
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

    clearSessionCaches() {
        if (!('serviceWorker' in navigator)) return;
        navigator.serviceWorker.ready
            .then((registration) => {
                if (registration.active) registration.active.postMessage({ type: 'TRUCKCAR_SESSION_ENDED' });
            })
            .catch(() => { });
    },

    endSession({ keepStoredSession = false } = {}) {
        this.clearSessionCaches();
        clearTimeout(this.sessionRefreshTimer);
        clearInterval(this.pollTimer);
        clearInterval(this.shipmentsTimer);
        this.sessionEndHooks.forEach(hook => hook());
        window.TruckCarTelemetry.disconnect();
        window.TruckCarService.reset();
        if (!keepStoredSession) window.TruckCarApi.session.clear();
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
    },

    async reloadData() {
        window.store.setState({ dataStatus: { ...window.store.state.dataStatus, errors: {} } });
        await window.TruckCarService.loadAll();
    },

    renderCurrentView(state) {
        const mount = document.getElementById('app-mount');
        if (!mount) return;

        this.updateHeader(state);
        if (!state.isAuthenticated) {
            mount.innerHTML = window.LoginView.render(state);
            window.Native.markScreen(mount, 'login');
            this.renderHooks.forEach(hook => hook(state));
            window.Native.NetworkStatus.render();
            return;
        }

        const view = this.views[state.activeRole];
        const keepAliveMaps = Object.values(this.views).flatMap(registered => registered.keepAliveMaps || []);
        const liveMap = window.mapCtrl.map ? window.mapCtrl.map.getContainer() : null;
        const keepMap = liveMap && keepAliveMaps.includes(liveMap.id) ? liveMap : null;

        if (view) mount.innerHTML = view.render(state);

        const placeholder = keepMap && document.getElementById(keepMap.id);
        if (placeholder && placeholder !== keepMap) {
            placeholder.replaceWith(keepMap);
            window.mapCtrl.map.invalidateSize();
        }

        if (view && view.mountMap) view.mountMap(state);

        this.mountHooks.forEach(hook => hook(state));
        window.TruckCarTelemetry.renderStatusBadges();

        const screenKey = state.activeRole + ':' + (view && view.screen ? view.screen(state) : state.coordinatorTab);
        window.Native.markScreen(mount, screenKey);
        window.Native.NetworkStatus.render();
        window.Native.animateCounters(mount);
        this.renderHooks.forEach(hook => hook(state));
    },

    syncLiveTracking(state) {
        const live = window.LiveTracking;
        if (!state.isAuthenticated) {
            live.stopAll();
            return;
        }
        const onTower = state.activeRole === 'coordinator' && state.coordinatorTab !== 'shipments';
        const onShipments = state.activeRole === 'generator'
            || (state.activeRole === 'coordinator' && state.coordinatorTab === 'shipments');

        if (window.TruckCarService.roleAccess(state.sessionRole).roadBlockages && (onTower || state.activeRole === 'driver')) {
            live.followRoadBlockages((payload) => this.onRoadBlockage(payload));
        } else {
            live.unfollowRoadBlockages();
        }

        if (onTower) {
            live.followFleet((truck) => {
                if (window.mapCtrl.isMountedOn('coordinator-map-container')) window.mapCtrl.moveFleetMarker(truck);
            });
        } else {
            live.unfollowFleet();
        }

        if (onShipments) {
            const followed = (window.TruckCarData.publishedLoads || [])
                .filter(l => window.TruckCarService.loadActions(l).trackTruck)
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

    async onRoadBlockage(payload) {
        const blockage = await window.TruckCarService.handleRoadBlockage(payload);
        if (!blockage) return;
        const title = window.ui.orNotAvailable(blockage.title);
        window.ui.toast('Bloqueo vial: ' + title, 'warning', { description: blockage.corridor || blockage.reason || undefined });
        if (window.store.state.activeRole === 'driver') {
            window.voiceEngine.speak('Atención. Bloqueo vial reportado: ' + title + '.', true);
        }
        window.store.setState({});
    },

    updateHeader(state) {
        const role = state.isAuthenticated ? state.sessionRole : null;
        const show = (id, visible) => {
            const el = document.getElementById(id);
            if (el) el.classList.toggle('hidden', !visible);
        };
        const access = window.TruckCarService.roleAccess(role);
        show('role-switcher', !!(window.TruckCarConfig && window.TruckCarConfig.demoTools) && access.controlTower && this.canUseDriverView(role));
        show('rotate-device-btn', !access.shipmentsOnly);
        show('sim-toggle-btn', !access.shipmentsOnly);
        document.body.dataset.view = state.isAuthenticated ? state.activeRole : 'login';
        const frame = document.getElementById('phone-mockup-frame');
        if (frame) {
            const driverLike = !state.isAuthenticated || state.activeRole === 'driver';
            frame.classList.toggle('phone-frame', driverLike);
            frame.classList.toggle('landscape-mode', driverLike && state.isLandscape);
            frame.classList.toggle('coordinator-frame', !driverLike);
            frame.style.position = 'relative';
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
    },

    handleGeneratorMapMount(state) {
        this.scheduleMapMount(() => {
            if (!document.getElementById('generator-map-container')) return;
            const load = window.GeneratorPanel.selectedLoad(window.store.state);
            const key = load ? load.backendId : null;
            if (window.mapCtrl.isMountedOn('generator-map-container')) {
                window.mapCtrl.drawShipment(load, window.GeneratorPanel.truckFor(load), { fit: window.mapCtrl.shipmentKey !== key });
            } else {
                window.mapCtrl.initMap('generator-map-container', [4.6097, -74.0817], 6);
                window.mapCtrl.drawShipment(load, window.GeneratorPanel.truckFor(load));
            }
            window.mapCtrl.shipmentKey = key;
        });
    },

    scheduleMapMount(fn) {
        clearTimeout(this.mapMountTimer);
        this.mapMountTimer = setTimeout(fn, 150);
    },

    handleDriverMapMount(state) {
        this.scheduleMapMount(() => {
            if (state.driverScreen === 'route_overview') {
                if (!document.getElementById('overview-map-container')) return;
                window.mapCtrl.initMap('overview-map-container', [4.6097, -74.0817], 7);
                window.mapCtrl.observeBottomSheet(document.querySelector('[data-route-sheet]'));
                window.mapCtrl.drawOverviewRoutes();
            } else if (state.driverScreen === 'navigation') {
                if (!document.getElementById('live-nav-map-container')) return;
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
        const access = window.TruckCarService.roleAccess(sessionRole);
        if (access.shipmentsOnly) {
            if (window.store.state.activeRole !== access.home) window.store.setState({ activeRole: access.home });
            return;
        }
        if (role === 'coordinator' && !access.controlTower) {
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

    async startNavigation() {
        const load = window.TruckCarData.activeLoadOrder;
        const actions = load ? window.TruckCarService.loadActions(load) : {};
        if (!actions.navigate) {
            window.ui.toast('Acepte una carga antes de iniciar el viaje.', 'warning');
            return;
        }
        if (actions.startTrip) {
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
        window.RouteGuidance.prepare(window.TruckCarData.activeLoadOrder);
        window.voiceEngine.speak('Navegación iniciada hacia ' + window.DriverApp.destinationLabel() + '.', true);
    },

    async finishTrip() {
        const load = window.TruckCarData.activeLoadOrder;
        if (!load || !window.TruckCarService.loadActions(load).deliver) {
            window.ui.toast('No hay un viaje en tránsito para finalizar.', 'warning');
            return;
        }
        const delivered = await window.PodUI.openDeliveryForm(load, (pod) => window.TruckCarService.deliverLoad(pod));
        if (!delivered) return;
        window.voiceEngine.speak('Entrega registrada. Viaje finalizado.');
        window.ui.toast('Entrega registrada (DELIVERED) con firma y prueba de entrega.', 'success');
        window.RouteGuidance.reset();
        window.store.setState({ busyAction: null, driverScreen: 'assigned_load' });
    },

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
            window.OfflineQueue.flush();
        }
    },

    initOffline() {
        if ('serviceWorker' in navigator) {
            navigator.serviceWorker.register('sw.js').catch(error =>
                console.warn('[TruckCar] No se pudo registrar el Service Worker', error));
            const hadController = !!navigator.serviceWorker.controller;
            let reloading = false;
            navigator.serviceWorker.addEventListener('controllerchange', () => {
                if (!hadController || reloading) return;
                reloading = true;
                window.location.reload();
            });
            navigator.serviceWorker.addEventListener('message', (event) => {
                if (event.data && event.data.type === 'TRUCKCAR_BACKGROUND_SYNC') {
                    if (window.OfflineQueue) window.OfflineQueue.flush();
                }
            });
        }
        const data = window.TruckCarData;
        const refreshTileCount = () => {
            if (!window.indexedDB || !window.TileStore) return;
            window.TileStore.summary().then(summary => {
                data.offlineSyncData.cachedTiles = summary.count;
                data.offlineSyncData.cachedTilesBytes = summary.bytes;
                data.offlineSyncData.cachedTilesExpiry = summary.firstExpiry;
            }).catch(() => {});
        };
        refreshTileCount();
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

    currentPosition(maxAgeMs) {
        const fix = window.DeviceLocation.last(maxAgeMs);
        return fix ? fix.coords : null;
    },

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

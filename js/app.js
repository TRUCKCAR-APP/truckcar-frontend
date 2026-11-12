window.ui = {
    escape(value) {
        return String(value === null || value === undefined ? '' : value)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    },

    toast(message, type = 'info', options = {}) {
        if (!window.Toaster) return;
        window.Toaster.show({ title: message, type, ...options });
    },

    failure(title, error, context) {
        if (error && error.status === 401) return;
        if (window.Sheet && window.Sheet.explainError(error, context)) return;
        this.toast(title, 'error', { description: this.errorMessage(error) });
    },

    errorMessage(error) {
        if (!error) return 'Error desconocido';
        const suffix = error.correlationId ? ' [trace ' + String(error.correlationId).slice(0, 8) + ']' : '';
        return (error.message || String(error)) + suffix;
    },

    SYNC_SECTIONS: {
        alerts: 'las alertas', routes: 'la ruta', fleet: 'la flota', user: 'su perfil', profile: 'el perfil',
        driver: 'el perfil', assignment: 'la carga', load: 'la carga', loads: 'las cargas', shipments: 'los envíos',
        deliveries: 'las entregas', evaluation: 'la evaluación de despacho'
    },

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


    startDemoSession(role = 'driver') {
        if (!window.TruckCarConfig.demoTools) {
            window.ui.toast('La sesión de demostración solo está disponible con ?demo=1.', 'warning');
            return;
        }
        const isDriver = role === 'driver';
        const session = {
            accessToken: 'demo-token',
            userId: isDriver ? 'abc27ef4-1e64-4b94-809a-9605ddc3d2e5' : 'coord-1',
            email: isDriver ? 'conductor@truckcar.demo' : 'torre@truckcar.demo',
            role: isDriver ? 'CONDUCTOR' : 'COORDINADOR',
            expiresAt: Date.now() + 86400000
        };
        try { localStorage.setItem(window.TruckCarConfig.storageKeys.session, JSON.stringify(session)); } catch (e) {}

        window.TruckCarData.currentDriver = {
            id: 'abc27ef4-1e64-4b94-809a-9605ddc3d2e5',
            userId: 'abc27ef4-1e64-4b94-809a-9605ddc3d2e5',
            name: 'Carlos Conductor',
            email: 'conductor@truckcar.demo',
            phone: '3104567890',
            licenseNumber: 'C3-994821',
            hoursDrivenToday: 2.5,
            maxDailyHours: 9,
            restRequired: false,
            status: 'EN_TRANSITO',
            rating: 4.8,
            tripsCompleted: 126,
            hasVehicle: true,
            vehicle: {
                plate: 'TDK-410',
                brand: 'Kenworth T800 2021',
                category: 'TRACTOMULA_3S3',
                height: 4.1,
                grossWeight: 40.0,
                tareWeight: 16.0,
                maxPayload: 34.0,
                badges: ['Verificado', 'GPS Activo']
            },
            coords: [4.6486, -74.1481]
        };

        window.TruckCarData.activeLoadOrder = {
            id: 'CARGA-88',
            backendId: 88,
            status: 'IN_TRANSIT',
            assignmentStatus: 'ACCEPTED',
            assignedDriverId: 'abc27ef4-1e64-4b94-809a-9605ddc3d2e5',
            assignedDriverName: 'Carlos Conductor',
            assignedVehiclePlate: 'TDK-410',
            cargoType: 'Café excelso de exportación',
            netWeight: 24.0,
            origin: { city: 'Bogotá', department: 'Cundinamarca', latitude: 4.6097, longitude: -74.0817 },
            destination: { city: 'Ibagué', department: 'Tolima', latitude: 4.4389, longitude: -75.2322 },
            routeDistanceKm: 204.0,
            estimatedHours: 4.5,
            pricing: { offeredBudget: 3800000 }
        };

        window.TruckCarData.availableLoads = [window.TruckCarData.activeLoadOrder];

        window.TruckCarData.fleetVehicles = [
            {
                id: 'abc27ef4-1e64-4b94-809a-9605ddc3d2e5',
                driverId: 'abc27ef4-1e64-4b94-809a-9605ddc3d2e5',
                driverName: 'Carlos Conductor',
                plate: 'TDK-410',
                model: 'Kenworth T800 2021',
                rawType: 'TRACTOMULA_3S3',
                vehicleType: 'Kenworth T800 • Tractomula 3S3',
                height: 4.1,
                tareWeight: 16.0,
                maxPayload: 34.0,
                phone: '3104567890',
                status: 'EN_TRANSITO',
                speed: 62,
                hoursActive: '2.5h',
                lastCheckin: 'Hace 1 min',
                currentLoadId: 88,
                coords: [4.6486, -74.1481]
            },
            {
                id: '4462bf82-702a-4745-b231-ae0b4ea4b24d',
                driverId: '4462bf82-702a-4745-b231-ae0b4ea4b24d',
                driverName: 'Diana Ríos',
                plate: 'SNT-238',
                model: 'International WorkStar 2019',
                rawType: 'DOBLETROQUE',
                vehicleType: 'International • Dobletroque',
                height: 3.8,
                tareWeight: 12.0,
                maxPayload: 22.0,
                phone: '3157891234',
                status: 'DISPONIBLE',
                speed: 0,
                hoursActive: '0h',
                lastCheckin: 'Hace 5 min',
                coords: [4.7110, -74.0721]
            },
            {
                id: '207a8e39-990e-48da-9b85-10178c83a8cb',
                driverId: '207a8e39-990e-48da-9b85-10178c83a8cb',
                driverName: 'Ana Ruiz',
                plate: 'TKR-527',
                model: 'Freightliner Cascadia 2022',
                rawType: 'TRACTOMULA_3S3',
                vehicleType: 'Freightliner • Tractomula 3S3',
                height: 4.2,
                tareWeight: 15.5,
                maxPayload: 35.0,
                phone: '3189998877',
                status: 'DESCANSO',
                speed: 0,
                hoursActive: '8.5h',
                lastCheckin: 'Hace 12 min',
                coords: [4.5339, -75.6811]
            }
        ];

        window.TruckCarData.dispatchEvaluation = {
            loadId: 88,
            evaluatedAt: 'Hace 15 min',
            candidates: [
                {
                    driverId: 'abc27ef4-1e64-4b94-809a-9605ddc3d2e5',
                    driverName: 'Carlos Conductor',
                    vehiclePlate: 'TDK-410',
                    driverPhone: '3104567890',
                    score: 94,
                    isCurrentAssignment: true,
                    deadheadDistanceKm: 4.2,
                    decisionStatus: 'ACCEPTED',
                    executedAt: 'Hace 1 h',
                    reason: 'Mayor compatibilidad de gálibo y cercanía al punto de carga en Bogotá.',
                }
            ]
        };

        window.TruckCarData.communityAlerts = [
            {
                id: 1,
                type: 'landslide',
                title: 'Paso a un carril por derrumbe',
                corridor: 'Bogotá – Fusagasugá km 42',
                severity: 'ALTA',
                badge: 'Derrumbe',
                verified: true,
                timeAgo: 'Hace 15 min',
                coords: [4.425, -74.28]
            },
            {
                id: 2,
                type: 'bridge',
                title: 'Gálibo bajo en puente (4.1 m)',
                corridor: 'La Línea km 18',
                severity: 'ALTA',
                badge: 'Gálibo Bajo',
                verified: true,
                timeAgo: 'Hace 40 min',
                coords: [4.46, -75.35]
            }
        ];

        window.store.setState({
            isAuthenticated: true,
            currentUser: {
                id: session.userId,
                firstName: isDriver ? 'Carlos' : 'Tomás',
                lastName: isDriver ? 'Conductor' : 'Torre',
                email: session.email,
                role: session.role
            },
            sessionRole: session.role,
            activeRole: role,
            authError: null
        });

        window.ui.toast('Sesión demo iniciada como ' + (isDriver ? 'Conductor' : 'Torre de Control'), 'success');
    },

    isPhone() {
        return typeof window.matchMedia === 'function' && !window.matchMedia('(min-width: 768px)').matches;
    },

    canUseDriverView(sessionRole) {
        return sessionRole === 'CONDUCTOR' || !this.isPhone();
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
        if (window.TruckCarMessaging) {
            const load = window.TruckCarData.activeLoadOrder;
            const driver = window.TruckCarData.currentDriver;
            window.TruckCarMessaging.initContext(load ? load.backendId : null, driver ? driver.id : null);
        }
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

    endSession() {
        this.clearSessionCaches();
        clearTimeout(this.sessionRefreshTimer);
        clearInterval(this.pollTimer);
        clearInterval(this.shipmentsTimer);
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
            this.syncLiveTracking(state);
            mount.innerHTML = window.LoginView.render(state);
            window.Native.markScreen(mount, 'login');
            window.DriverActions.syncSos(state);
            window.SosMonitor.sync(state);
            window.DeviceLocation.sync(state);
            window.Native.NetworkStatus.render();
            return;
        }

        const liveMap = window.mapCtrl.map ? window.mapCtrl.map.getContainer() : null;
        const keepMap = liveMap && this.KEEP_ALIVE_MAPS.includes(liveMap.id) ? liveMap : null;

        if (state.activeRole === 'generator') {
            mount.innerHTML = window.GeneratorPanel.render(state);
        } else if (state.activeRole === 'driver') {
            mount.innerHTML = window.DriverApp.render(state);
        } else if (state.activeRole === 'coordinator' && state.coordinatorTab === 'shipments') {
            mount.innerHTML = window.GeneratorPanel.render(state);
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

    updateHeader(state) {
        const role = state.isAuthenticated ? state.sessionRole : null;
        const show = (id, visible) => {
            const el = document.getElementById(id);
            if (el) el.classList.toggle('hidden', !visible);
        };
        const controlTower = role === 'COORDINADOR' || role === 'ADMIN';
        show('role-switcher', !!(window.TruckCarConfig && window.TruckCarConfig.demoTools) && controlTower && this.canUseDriverView(role));
        show('rotate-device-btn', role !== 'GENERADOR');
        show('sim-toggle-btn', role !== 'GENERADOR');
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
        if (sessionRole === 'GENERADOR') {
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
        window.RouteGuidance.prepare(window.TruckCarData.activeLoadOrder);
        window.voiceEngine.speak('Navegación iniciada hacia ' + window.DriverApp.destinationLabel() + '.', true);
    },

    async finishTrip() {
        const load = window.TruckCarData.activeLoadOrder;
        if (!load || load.status !== 'IN_TRANSIT') {
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

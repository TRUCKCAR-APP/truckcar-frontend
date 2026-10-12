window.ui = {
    escape(value) {
        return String(value === null || value === undefined ? '' : value)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    },

    toast(message, type = 'info') {
        const colors = {
            info: 'bg-slate-800 border-slate-600 text-slate-100',
            success: 'bg-emerald-900/90 border-emerald-500/60 text-emerald-100',
            error: 'bg-rose-900/90 border-rose-500/60 text-rose-100',
            warning: 'bg-amber-900/90 border-amber-500/60 text-amber-100'
        };
        let container = document.getElementById('toast-container');
        if (!container) {
            container = document.createElement('div');
            container.id = 'toast-container';
            container.className = 'fixed bottom-4 left-1/2 -translate-x-1/2 z-[2000] flex flex-col gap-2 items-center pointer-events-none';
            document.body.appendChild(container);
        }
        const toast = document.createElement('div');
        toast.className = 'px-4 py-2.5 rounded-xl border shadow-2xl text-xs font-semibold max-w-md pointer-events-auto ' + (colors[type] || colors.info);
        toast.textContent = message;
        container.appendChild(toast);
        setTimeout(() => toast.remove(), 5000);
    },

    errorMessage(error) {
        if (!error) return 'Error desconocido';
        const suffix = error.correlationId ? ' [trace ' + String(error.correlationId).slice(0, 8) + ']' : '';
        return (error.message || String(error)) + suffix;
    },

    /** Banner con el estado de sincronización con el backend, reutilizado por ambas vistas. */
    syncBanner(state) {
        const status = state.dataStatus || {};
        const errors = Object.entries(status.errors || {});
        if (status.loading) {
            return `<div class="px-3 py-1.5 bg-indigo-500/10 border-b border-indigo-500/30 text-[11px] text-indigo-300 flex items-center gap-2 shrink-0">
                <i class="fas fa-spinner fa-spin"></i> Sincronizando con el API Gateway...</div>`;
        }
        if (errors.length) {
            return `<div class="px-3 py-1.5 bg-rose-500/10 border-b border-rose-500/30 text-[11px] text-rose-300 flex items-center justify-between gap-2 shrink-0">
                <span class="truncate"><i class="fas fa-triangle-exclamation"></i> ${errors.map(([k, v]) => this.escape(k + ': ' + v)).join(' · ')}</span>
                <button onclick="window.app.reloadData()" class="shrink-0 underline font-bold">Reintentar</button></div>`;
        }
        return '';
    }
};

window.app = {
    pollTimer: null,

    init() {
        window.store.subscribe((state) => this.renderCurrentView(state));

        window.addEventListener('truckdar:unauthorized', () => {
            if (window.store.state.isAuthenticated) {
                window.ui.toast('La sesión expiró. Inicie sesión nuevamente.', 'warning');
                this.endSession();
            }
        });

        // 403: la cuenta no tiene permiso para esa vista. Se vuelve a la vista propia del rol, sin franja de error.
        window.addEventListener('truckdar:forbidden', () => {
            const state = window.store.state;
            if (!state.isAuthenticated) return;
            const home = this.roleToView(state.sessionRole);
            if (state.activeRole !== home) {
                window.store.setState({ activeRole: home });
                window.ui.toast(home === 'generator'
                    ? 'Su cuenta de generador de carga solo tiene acceso a "Mis envíos".'
                    : 'Su cuenta no tiene acceso a esa vista.', 'info');
                window.TruckDarService.loadAll();
            }
        });

        const session = window.TruckDarApi.session;
        if (session.isActive()) {
            this.startSession(session.get());
        } else {
            session.clear();
            this.renderCurrentView(window.store.state);
        }
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
        await window.TruckDarService.loadAll();
        this.schedulePolling();
    },

    endSession() {
        clearInterval(this.pollTimer);
        clearInterval(this.shipmentsTimer);
        window.DriverTelemetry.stop();
        window.LiveTracking.stopAll();
        window.TruckDarTelemetry.disconnect();
        window.TruckDarService.reset();
        window.TruckDarApi.session.clear();
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
            const session = await window.TruckDarApi.auth.login(form.get('email').trim(), form.get('password'));
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
            const session = await window.TruckDarApi.auth.register({
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
            await window.TruckDarApi.auth.logout();
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
            await window.TruckDarService.refreshCoordinator();
        }, window.TruckDarConfig.pollingIntervalMs);
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
    },

    async reloadData() {
        window.store.setState({ dataStatus: { ...window.store.state.dataStatus, errors: {} } });
        await window.TruckDarService.loadAll();
    },

    // ------------------------------------------------------------------ render
    renderCurrentView(state) {
        const mount = document.getElementById('app-mount');
        if (!mount) return;

        this.updateHeader(state);
        if (!state.isAuthenticated) {
            this.syncLiveTracking(state);
            mount.innerHTML = window.LoginView.render(state);
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
        window.TruckDarTelemetry.renderStatusBadges();
        window.DriverTelemetry.renderBadge();
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
            const followed = (window.TruckDarData.publishedLoads || [])
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
     * herramientas de simulación del conductor (rotar, avanzar GPS) no aplican a un generador.
     */
    updateHeader(state) {
        const role = state.isAuthenticated ? state.sessionRole : null;
        const show = (id, visible) => {
            const el = document.getElementById(id);
            if (el) el.classList.toggle('hidden', !visible);
        };
        const controlTower = role === 'COORDINADOR' || role === 'ADMIN';
        show('role-switcher', controlTower);
        show('rotate-device-btn', role !== 'GENERADOR');
        show('gps-step-btn', role !== 'GENERADOR');
        const active = 'bg-emerald-600 text-white shadow';
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
                window.mapCtrl.drawOverviewRoutes();
            } else if (state.driverScreen === 'navigation') {
                if (!document.getElementById('live-nav-map-container')) return;
                const steps = window.TruckDarData.liveNavigationSteps;
                const step = steps[state.navStepIndex] || steps[0];
                window.mapCtrl.initMap('live-nav-map-container', [step.coords.lat, step.coords.lng], 13);
                window.mapCtrl.drawLiveNavigation(state.navStepIndex);
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
        if (role === window.store.state.activeRole) return;
        window.store.setState({ activeRole: role });
        await window.TruckDarService.loadAll();
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
    async handleAcceptTrip() {
        window.store.setState({ busyAction: 'accept' });
        try {
            await window.TruckDarService.acceptAssignment();
            window.voiceEngine.speak('Carga aceptada. Calculando ruta segura para su vehículo.');
            window.ui.toast('Carga aceptada en Load-Allocation.', 'success');
            await window.TruckDarService.loadRoutePlan();
            window.store.setState({ busyAction: null, driverScreen: 'route_overview' });
        } catch (error) {
            window.store.setState({ busyAction: null });
            window.ui.toast('No se pudo aceptar la carga: ' + window.ui.errorMessage(error), 'error');
        }
    },

    async handleRejectTrip() {
        const reason = prompt('Indique el motivo de rechazo (Ej: exceso de horas de conducción, falla mecánica, flete no acorde):');
        if (!reason) return;
        window.store.setState({ busyAction: 'reject' });
        try {
            await window.TruckDarService.rejectAssignment();
            window.voiceEngine.speak('Viaje rechazado. El sistema reasignará la carga.');
            window.ui.toast('Rechazo registrado. El motor de asignación buscará otro conductor.', 'success');
            window.store.setState({ busyAction: null, driverScreen: 'profile' });
        } catch (error) {
            window.store.setState({ busyAction: null });
            window.ui.toast('No se pudo rechazar la carga: ' + window.ui.errorMessage(error), 'error');
        }
    },

    async refreshAssignment() {
        await window.TruckDarService.loadDriverAssignment();
        await window.TruckDarService.loadRoutePlan();
        window.store.setState({});
    },

    /** Inicia el viaje real (ASSIGNED -> IN_TRANSIT) y abre la navegación; si ya está en tránsito, la reanuda. */
    async startNavigation() {
        const load = window.TruckDarData.activeLoadOrder;
        if (!load || (load.status !== 'ASSIGNED' && load.status !== 'IN_TRANSIT')) {
            window.ui.toast('Acepte una carga antes de iniciar el viaje.', 'warning');
            return;
        }
        if (load.status === 'ASSIGNED') {
            window.store.setState({ busyAction: 'start-trip' });
            try {
                await window.TruckDarService.startTrip();
                window.ui.toast('Viaje iniciado: la carga está en tránsito.', 'success');
            } catch (error) {
                window.store.setState({ busyAction: null });
                window.ui.toast('No se pudo iniciar el viaje: ' + window.ui.errorMessage(error), 'error');
                return;
            }
        }
        window.store.setState({ busyAction: null, driverScreen: 'navigation', navStepIndex: 0, simulatedSpeed: 48 });
        const step0 = window.TruckDarData.liveNavigationSteps[0];
        window.voiceEngine.speak(step0.voiceAudioText, true);
    },

    nextSimulationStep() {
        const currentIndex = window.store.state.navStepIndex;
        const totalSteps = window.TruckDarData.liveNavigationSteps.length;
        const nextIndex = (currentIndex + 1) % totalSteps;

        const nextStep = window.TruckDarData.liveNavigationSteps[nextIndex];
        window.store.setState({
            navStepIndex: nextIndex,
            simulatedSpeed: nextStep.speedLimit - 5
        });

        window.voiceEngine.speak(nextStep.voiceAudioText, false);

        if (window.mapCtrl && window.mapCtrl.map) {
            window.mapCtrl.updateTruckPosition(nextStep.coords.lat, nextStep.coords.lng);
        }
    },

    /** Registra la entrega con su prueba (IN_TRANSIT -> DELIVERED). */
    async finishTrip() {
        const load = window.TruckDarData.activeLoadOrder;
        if (!load || load.status !== 'IN_TRANSIT') {
            window.ui.toast('No hay un viaje en tránsito para finalizar.', 'warning');
            return;
        }
        // Formulario de POD (receptor, firma en lienzo y foto). Si el backend rechaza la entrega, el formulario
        // sigue abierto con el error para no perder la firma.
        const delivered = await window.PodUI.openDeliveryForm(load, (pod) => window.TruckDarService.deliverLoad(pod));
        if (!delivered) return;
        window.voiceEngine.speak('Entrega registrada. Viaje finalizado.');
        window.ui.toast('Entrega registrada (DELIVERED) con firma y prueba de entrega.', 'success');
        window.store.setState({ busyAction: null, driverScreen: 'assigned_load', navStepIndex: 0 });
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
        }
    },

    /** Posición actual para reportes: GPS simulado de navegación, luego posición registrada del vehículo. */
    currentPosition() {
        const state = window.store.state;
        const steps = window.TruckDarData.liveNavigationSteps;
        if (state.driverScreen === 'navigation' && steps[state.navStepIndex]) {
            return [steps[state.navStepIndex].coords.lat, steps[state.navStepIndex].coords.lng];
        }
        const driver = window.TruckDarData.currentDriver;
        if (driver && driver.coords) return driver.coords;
        if (window.mapCtrl && window.mapCtrl.currentCoords) return window.mapCtrl.currentCoords;
        return null;
    },

    async openReportModal(presetType = 'scale') {
        const reportTypeNames = {
            scale: 'Báscula de Pesaje',
            bridge: 'Gálibo Bajo / Puente Peligroso',
            police: 'Retén Policial / Control Vía',
            rest: 'Parador de Camiones 24h'
        };
        const title = reportTypeNames[presetType] || 'Novedad de Carretera';
        const coords = this.currentPosition();
        if (!coords) {
            window.ui.toast('No hay una posición GPS disponible para el reporte.', 'warning');
            return;
        }
        const comment = prompt('Reportar alerta comunitaria: ' + title + '\nEscriba detalles u observaciones:', 'Reporte confirmado en mi carril.');
        if (comment === null) return;

        try {
            await window.TruckDarService.reportAlert(presetType, comment, coords);
            window.voiceEngine.speak('Gracias compañero. Alerta de ' + title + ' compartida con la red de transporte.');
            window.ui.toast('Alerta publicada en Community-Alerts.', 'success');
            window.store.setState({});
        } catch (error) {
            window.ui.toast('No se pudo publicar la alerta: ' + window.ui.errorMessage(error), 'error');
        }
    },

    async upvoteAlert(id) {
        try {
            await window.TruckDarService.confirmAlert(id);
            window.ui.toast('Confirmación registrada.', 'success');
            window.store.setState({});
        } catch (error) {
            window.ui.toast('No se pudo confirmar la alerta: ' + window.ui.errorMessage(error), 'error');
        }
    }
};

document.addEventListener('DOMContentLoaded', () => {
    window.app.init();
});

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

        const session = window.TruckDarApi.session;
        if (session.isActive()) {
            this.startSession(session.get());
        } else {
            session.clear();
            this.renderCurrentView(window.store.state);
        }
    },

    // ------------------------------------------------------------------ sesión
    roleToView(role) {
        return role === 'CONDUCTOR' ? 'driver' : 'coordinator';
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
        window.TruckDarService.reset();
        window.TruckDarApi.session.clear();
        window.store.setState({
            isAuthenticated: false,
            currentUser: null,
            sessionRole: null,
            busyAction: null,
            dataStatus: { loading: false, errors: {}, lastSync: null },
            driverScreen: 'assigned_load'
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
    },

    async reloadData() {
        window.store.setState({ dataStatus: { ...window.store.state.dataStatus, errors: {} } });
        await window.TruckDarService.loadAll();
    },

    // ------------------------------------------------------------------ render
    renderCurrentView(state) {
        const mount = document.getElementById('app-mount');
        if (!mount) return;

        if (!state.isAuthenticated) {
            mount.innerHTML = window.LoginView.render(state);
            return;
        }

        if (state.activeRole === 'driver') {
            mount.innerHTML = window.DriverApp.render(state);
            this.handleDriverMapMount(state);
        } else if (state.activeRole === 'coordinator') {
            mount.innerHTML = window.CoordinatorPanel.render(state);
            this.handleCoordinatorMapMount(state);
        }
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
            window.mapCtrl.initMap('coordinator-map-container', [4.4389, -75.2322], 7);
            window.mapCtrl.drawCoordinatorFleet();
        });
    },

    async setRole(role) {
        const sessionRole = window.store.state.sessionRole;
        if (!window.store.state.isAuthenticated) return;
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

    startNavigation() {
        window.store.setState({ driverScreen: 'navigation', navStepIndex: 0, simulatedSpeed: 48 });
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

    finishTrip() {
        const load = window.TruckDarData.activeLoadOrder;
        const destination = load ? load.destination.name : 'el destino';
        if (confirm('¿Desea finalizar la ruta y confirmar la entrega en ' + destination + '?')) {
            window.voiceEngine.speak('Destino alcanzado. Ruta finalizada sin incidentes.');
            window.ui.toast('Ruta finalizada. (El cierre de viaje aún no tiene endpoint en el backend.)', 'info');
            window.store.setState({ driverScreen: 'profile', navStepIndex: 0 });
        }
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

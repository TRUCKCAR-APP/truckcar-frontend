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
                    : home === 'company'
                        ? 'Su cuenta de transportadora solo tiene acceso a "Mis conductores".'
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
            generatorFormError: null,
            twoFactor: null,
            passwordReset: null,
            authMode: 'login'
        });
    },

    async submitLogin(event) {
        event.preventDefault();
        if (window.ui.reportFormProblem(event.target)) return;
        const form = new FormData(event.target);
        window.store.setState({ busyAction: 'auth', authError: null });
        try {
            const email = form.get('email').trim();
            const result = await window.TruckCarApi.auth.login(email, form.get('password'));
            if (result && result.requiresTwoFactor) {
                // Contraseña correcta y cuenta con 2FA: paso 2 (el token temporal vive solo en memoria).
                window.store.setState({ busyAction: null, authError: null, authMode: '2fa',
                    twoFactor: { tempToken: result.tempToken, expiresAt: result.expiresAt, email, backup: false } });
                return;
            }
            await this.startSession(result);
        } catch (error) {
            window.store.setState({ busyAction: null, authError: this.authErrorMessage(error) });
        }
    },

    /** Paso 2 del login: código de la app autenticadora o código de respaldo. */
    async submitTwoFactor(event) {
        event.preventDefault();
        const pending = window.store.state.twoFactor;
        if (!pending || Date.now() > pending.expiresAt) {
            this.cancelTwoFactor('La verificación venció. Inicie sesión de nuevo.');
            return;
        }
        const code = String(new FormData(event.target).get('code') || '').trim();
        const valid = pending.backup ? /^[A-Za-z0-9]{4}-?[A-Za-z0-9]{4}$/.test(code) : /^\d{6}$/.test(code);
        if (!valid) {
            window.store.setState({ authError: pending.backup
                ? 'Escriba un código de respaldo como ABCD-2345.'
                : 'Escriba los 6 dígitos que muestra su app autenticadora.' });
            return;
        }
        window.store.setState({ busyAction: 'auth', authError: null });
        try {
            const session = await window.TruckCarApi.auth.verifyTwoFactor(pending.tempToken, code);
            window.store.setState({ twoFactor: null, authMode: 'login' });
            await this.startSession(session);
        } catch (error) {
            const expired = error && error.details && /invalid-2fa-token$/.test(String(error.details.type || ''));
            if (expired) {
                this.cancelTwoFactor(window.ui.errorMessage(error));
                return;
            }
            window.store.setState({ busyAction: null, authError: window.ui.errorMessage(error) });
        }
    },

    toggleBackupCode() {
        const pending = window.store.state.twoFactor;
        if (pending) window.store.setState({ twoFactor: { ...pending, backup: !pending.backup }, authError: null });
    },

    /** Vuelve al primer paso (botón Volver, token vencido o rechazado). */
    cancelTwoFactor(message = null) {
        window.store.setState({ authMode: 'login', twoFactor: null, busyAction: null, authError: message });
    },

    // ── Recuperar la contraseña ──────────────────────────────────────────────────────────────────────────────────

    /** Abre "¿Olvidó su contraseña?" con el correo que ya estaba escrito en el login. */
    startPasswordReset() {
        clearTimeout(this.resetTimer);
        const typed = document.querySelector('.login-form input[name="email"]');
        const current = window.store.state.passwordReset;
        const email = (typed && typed.value.trim()) || (current && current.email) || window.store.state.loginEmail || '';
        window.store.setState({ authMode: 'forgot', authError: null, authNotice: null, busyAction: null,
            passwordReset: { step: 'email', email, resetToken: null, resendAt: 0 } });
    },

    async submitResetEmail(event) {
        event.preventDefault();
        if (window.ui.reportFormProblem(event.target)) return;
        const email = String(new FormData(event.target).get('email') || '').trim();
        await this.requestResetCode(email);
    },

    async requestResetCode(email) {
        window.store.setState({ busyAction: 'auth', authError: null });
        try {
            const response = await window.TruckCarApi.auth.password.forgot(email);
            const wait = (response && response.resendAfterSeconds ? response.resendAfterSeconds : 60) * 1000;
            window.store.setState({ busyAction: null,
                passwordReset: { step: 'code', email, resetToken: null, resendAt: Date.now() + wait } });
            // Habilita "Enviarme otro código" cuando termina la espera.
            clearTimeout(this.resetTimer);
            this.resetTimer = setTimeout(() => {
                const reset = window.store.state.passwordReset;
                if (reset && reset.step === 'code') window.store.setState({ passwordReset: { ...reset } });
            }, wait + 50);
        } catch (error) {
            window.store.setState({ busyAction: null, authError: this.authErrorMessage(error) });
        }
    },

    async resendResetCode() {
        const reset = window.store.state.passwordReset;
        if (!reset || Date.now() < reset.resendAt) return;
        await this.requestResetCode(reset.email);
        if (!window.store.state.authError) window.store.setState({ authError: null });
    },

    async submitResetCode(event) {
        event.preventDefault();
        const reset = window.store.state.passwordReset;
        if (!reset) return;
        const code = String(new FormData(event.target).get('code') || '').replace(/\s/g, '');
        if (!/^\d{6}$/.test(code)) {
            window.store.setState({ authError: 'Escriba los 6 dígitos que le llegaron al correo.' });
            return;
        }
        window.store.setState({ busyAction: 'auth', authError: null });
        try {
            const response = await window.TruckCarApi.auth.password.verify(reset.email, code);
            window.store.setState({ busyAction: null, passwordReset: { ...reset, step: 'password', resetToken: response.resetToken } });
        } catch (error) {
            window.store.setState({ busyAction: null, authError: this.authErrorMessage(error) });
        }
    },

    async submitNewPassword(event) {
        event.preventDefault();
        const reset = window.store.state.passwordReset;
        if (!reset || !reset.resetToken) return;
        const form = new FormData(event.target);
        const password = String(form.get('newPassword') || '');
        if (password.length < 8 || password.length > 72) {
            window.store.setState({ authError: 'La contraseña debe tener entre 8 y 72 caracteres.' });
            return;
        }
        if (password !== String(form.get('confirmPassword') || '')) {
            window.store.setState({ authError: 'Las dos contraseñas no coinciden.' });
            return;
        }
        window.store.setState({ busyAction: 'auth', authError: null });
        try {
            await window.TruckCarApi.auth.password.reset(reset.resetToken, password);
            window.store.setState({ busyAction: null, authMode: 'login', passwordReset: null, loginEmail: reset.email,
                authNotice: 'Contraseña actualizada. Inicie sesión con la contraseña nueva.' });
        } catch (error) {
            const expired = error && error.details && /invalid-reset-token$/.test(String(error.details.type || ''));
            window.store.setState(expired
                ? { busyAction: null, authError: window.ui.errorMessage(error),
                    passwordReset: { step: 'email', email: reset.email, resetToken: null, resendAt: 0 } }
                : { busyAction: null, authError: this.authErrorMessage(error) });
        }
    },

    cancelPasswordReset() {
        clearTimeout(this.resetTimer);
        const reset = window.store.state.passwordReset;
        window.store.setState({ authMode: 'login', passwordReset: null, busyAction: null, authError: null,
            loginEmail: reset && reset.email ? reset.email : window.store.state.loginEmail });
    },

    authErrorMessage(error) {
        if (error && error.isRateLimited) {
            return window.TruckCarApi.RATE_LIMITED_MESSAGE;
        }
        return window.ui.errorMessage(error);
    },

    async submitRegister(event) {
        event.preventDefault();
        if (window.ui.reportFormProblem(event.target)) return;
        const form = new FormData(event.target);
        window.store.setState({ busyAction: 'auth', authError: null });
        try {
            const session = await window.TruckCarApi.auth.register(window.LoginView.registrationPayload(form));
            await this.startSession(session);
        } catch (error) {
            window.store.setState({ busyAction: null, authError: this.authErrorMessage(error) });
        }
    },

    async logout() {
        try {
            await window.TruckCarApi.auth.logout();
        } catch (error) {
        }
        this.endSession();
    },

    shipmentsPollingMs() {
        const config = window.TruckCarConfig;
        return window.TruckCarTelemetry.isOnline ? config.shipmentsPollingOnlineMs : config.shipmentsPollingOfflineMs;
    },

    schedulePolling() {
        clearInterval(this.pollTimer);
        this.pollTimer = setInterval(async () => {
            const state = window.store.state;
            const typing = document.activeElement && ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName);
            if (!state.isAuthenticated || state.activeRole !== 'coordinator' || typing) return;
            await window.TruckCarService.refreshCoordinator();
            if (state.coordinatorTab === 'loads') await window.TowerLoads.refresh({ silent: true });
        }, window.TruckCarConfig.pollingIntervalMs);
        clearInterval(this.shipmentsTimer);
        this.shipmentsTimer = setInterval(async () => {
            const state = window.store.state;
            const typing = document.activeElement && ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName);
            const podOpen = document.getElementById('pod-viewer-modal');
            const onShipments = state.activeRole === 'generator'
                || (state.activeRole === 'coordinator' && state.coordinatorTab === 'shipments');
            if (!state.isAuthenticated || !onShipments || typing || podOpen) return;
            if (Date.now() - (window.generatorCtrl.lastRefreshAt() || 0) < this.shipmentsPollingMs() - 1000) return;
            await window.generatorCtrl.refresh(true);
        }, window.TruckCarConfig.shipmentsPollingOfflineMs);
        clearInterval(this.driverTimer);
        this.driverTimer = setInterval(() => this.pollDriverProposals(), window.TruckCarConfig.driverPollingMs);
        clearInterval(this.countdownTimer);
        this.countdownTimer = setInterval(() => this.tickCountdowns(), 1000);
        clearInterval(this.inboxTimer);
        this.inboxTimer = setInterval(() => this.pollInbox(), 30000);
        this.pollInbox();
    },

    async pollInbox() {
        const state = window.store.state;
        if (!state.isAuthenticated || state.sessionRole !== 'CONDUCTOR' || !state.currentUser) return;
        const service = window.TruckCarService;
        if (service.accountPending(state.currentUser)) {
            try {
                const user = await service.loadCurrentUser();
                if (user && user.status === 'ACTIVE') {
                    window.ui.toast('Su cuenta fue verificada', 'success', {
                        description: (window.DriverAffiliation && window.DriverAffiliation.loadsBlockedReason(user))
                            || 'Ya puede recibir cargas.'
                    });
                }
            } catch (error) {
            }
        }
        const before = (window.TruckCarData.notifications || []).map(n => n.id).join();
        try {
            await service.loadNotifications();
        } catch (error) {
            return;
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
        const onTrip = current && window.TruckCarService.loadActions(current).transmitPosition;
        if (!state.isAuthenticated || state.activeRole !== 'driver' || state.sessionRole !== 'CONDUCTOR'
            || state.busyAction || typing || overlayOpen || onTrip || this.pollingProposals) return;
        this.pollingProposals = true;
        try {
            const key = (l) => (l ? [l.backendId, l.status, l.assignmentStatus].join(':') : '');
            const lost = await window.TruckCarService.loadDriverAssignment();
            const after = window.TruckCarData.activeLoadOrder;
            const change = window.DriverApp.proposalChange(current, after);
            if (change === 'new') this.announceProposal(after);
            if (lost) this.announceLostLoad(lost);
            if (key(current) !== key(after)) window.store.setState(lost || (change === 'new' && window.store.state.driverScreen !== 'navigation')
                ? { driverScreen: 'assigned_load' } : {});
        } finally {
            this.pollingProposals = false;
        }
    },

    announceProposal(load) {
        const route = (load.origin.city || 'Origen') + ' → ' + (load.destination.city || 'destino');
        const minutes = window.TruckCarConfig.assignmentResponseMinutes;
        window.ui.toast('Nueva carga propuesta', 'success',
            { description: route + ' · ' + load.netWeight + ' t. Tiene ' + minutes + ' minutos para responder.' });
        window.voiceEngine.proposalAlert();
        window.voiceEngine.speak('Nueva carga propuesta: ' + route.replace('→', 'a') + ', ' + load.netWeight
            + ' toneladas. Tiene ' + minutes + ' minutos para responder.');
    },

    announceLostLoad(lost) {
        const notice = window.TruckCarService.lostLoadNotice(lost);
        window.ui.toast(notice.title, notice.tone, notice.description ? { description: notice.description } : {});
        if (!notice.alert) return;
        window.voiceEngine.proposalAlert();
        window.voiceEngine.speak(notice.title);
    },

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

    renderCurrentView(state) {
        const mount = document.getElementById('app-mount');
        if (!mount) return;

        this.updateHeader(state);
        if (!state.isAuthenticated) {
            mount.innerHTML = window.LoginView.render(state);
            window.Native.markScreen(mount, state.authMode === '2fa' ? 'login:2fa'
                : state.authMode === 'forgot' ? 'login:forgot' : 'login');
            const code = mount.querySelector('#two-factor-code, #reset-code, #reset-password, #reset-email');
            if (code && !(code.id === 'reset-email' && code.value)) code.focus({ preventScroll: true });
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
            live.followBlockages((payload) => this.onRoadBlockage(payload));
        } else {
            live.unfollowBlockages();
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
            live.followStatuses(window.GeneratorPanel.liveStatusLoadIds(state),
                (msg) => window.generatorCtrl.applyLiveStatus(msg));
        } else {
            live.unfollowTrips();
            live.unfollowStatuses();
        }
    },

    notifyBlockage(blockage, onDriver) {
        const what = blockage.description || blockage.title || 'bloqueo vial';
        const confidence = Number.isFinite(blockage.confidence) ? ' (confianza ' + Math.round(blockage.confidence * 100) + ' %)' : '';
        const by = blockage.source === 'COMMUNITY' ? 'Confirmado por la comunidad' : 'Alerta procesada por IA' + confidence;
        window.ui.toast(by + ': ' + what + '.' + (onDriver ? '' : ' Los conductores en esa vía recalculan su ruta.'), 'warning');
    },

    async onRoadBlockage(payload) {
        if (!payload) return;
        const onDriver = window.store.state.activeRole === 'driver';
        const rerouting = onDriver ? window.RouteGuidance.handleBlockage(payload) : false;
        const blockage = await window.TruckCarService.handleRoadBlockage(payload);
        const announcedByGuidance = await rerouting;
        if (!blockage) return;
        if (!announcedByGuidance) this.notifyBlockage(payload, onDriver);
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
        show('rotate-device-btn', !access.singleView);
        show('sim-toggle-btn', !access.singleView);
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
        if (tab === 'loads') window.TowerLoads.refresh();
        if (['restrictions', 'users', 'templates'].includes(tab)) window.TowerAdmin.load(tab);
    },

    handleGeneratorMapMount(state) {
        this.scheduleMapMount(() => {
            if (!document.getElementById('generator-map-container')) return;
            const load = window.GeneratorPanel.selectedLoad(window.store.state);
            const key = load ? load.backendId : null;
            if (window.mapCtrl.isMountedOn('generator-map-container')) {
                window.mapCtrl.drawShipment(load, window.GeneratorPanel.truckFor(load), { fit: window.mapCtrl.shipmentKey !== key });
            } else {
                window.mapCtrl.initMap('generator-map-container', null, 6);
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
                window.mapCtrl.initMap('overview-map-container', null, 7);
                window.mapCtrl.observeBottomSheet(document.querySelector('[data-route-sheet]'));
                window.mapCtrl.drawOverviewRoutes();
            } else if (state.driverScreen === 'navigation') {
                if (!document.getElementById('live-nav-map-container')) return;
                if (window.mapCtrl.isMountedOn('live-nav-map-container')) {
                    window.mapCtrl.refreshLiveNavigation();
                    window.RouteGuidance.renderHud();
                    return;
                }
                const point = window.DriverTelemetry.lastPoint;
                const fix = point ? point.coords : (window.DeviceLocation.last() || {}).coords;
                window.mapCtrl.initMap('live-nav-map-container', fix || null, fix ? 15 : 7);
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
            window.mapCtrl.initMap('coordinator-map-container', null, 7);
            window.mapCtrl.drawCoordinatorFleet();
        });
    },

    async setRole(role) {
        const sessionRole = window.store.state.sessionRole;
        if (!window.store.state.isAuthenticated) return;
        const access = window.TruckCarService.roleAccess(sessionRole);
        if (access.singleView) {
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
        const saved = await window.VehicleForm.open(driver, async (vehicle) => {
            await window.TruckCarService.saveVehicle(vehicle, await this.currentCoords());
        });
        if (!saved) return;
        window.store.setState({});
        const pending = window.DriverApp.accountPending(window.store.state);
        window.ui.toast(!firstTime ? 'Vehículo actualizado.'
            : pending ? 'Vehículo registrado. Recibirá cargas cuando un administrador verifique su cuenta.'
                : 'Vehículo registrado: ya puede recibir cargas.', 'success');
    },

    async toggleAvailability() {
        const driver = window.TruckCarData.currentDriver;
        if (!driver || !driver.state) return;
        const available = !window.TruckCarService.driverAvailable(driver);
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

    /** Acepta la carga propuesta. Con { rethrow: true } (copiloto de voz) relanza el error después de mostrarlo. */
    async handleAcceptTrip({ rethrow = false } = {}) {
        window.store.setState({ busyAction: 'accept' });
        try {
            await window.TruckCarService.acceptAssignment();
            window.voiceEngine.speak('Carga aceptada. Calculando ruta segura para su vehículo.', false, { force: rethrow });
            window.ui.toast('Carga aceptada en Load-Allocation.', 'success');
            await window.TruckCarService.loadRoutePlan();
            window.store.setState({ busyAction: null, driverScreen: 'route_overview' });
            return true;
        } catch (error) {
            window.store.setState({ busyAction: null });
            window.ui.failure('No se pudo aceptar la carga', error, 'aceptar la carga');
            if (rethrow) throw error;
            return false;
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
        // El error ya se mostró en performRejectTrip.
        await this.performRejectTrip().catch(() => {});
    },

    /** Rechaza la carga propuesta (botón o copiloto de voz). Devuelve true si quedó rechazada. */
    async performRejectTrip({ quiet = false } = {}) {
        window.store.setState({ busyAction: 'reject' });
        try {
            await window.TruckCarService.rejectAssignment();
            if (!quiet) window.voiceEngine.speak('Viaje rechazado. El sistema reasignará la carga.');
            window.ui.toast('Rechazo registrado. El motor de asignación buscará otro conductor.', 'success');
            window.store.setState({ busyAction: null, driverScreen: 'profile' });
            return true;
        } catch (error) {
            window.store.setState({ busyAction: null });
            window.ui.failure('No se pudo rechazar la carga', error, 'rechazar la carga');
            throw error;
        }
    },

    async refreshAssignment() {
        const lost = await window.TruckCarService.loadDriverAssignment();
        if (lost) this.announceLostLoad(lost);
        else window.TruckCarService.dismissLostLoad();
        await window.TruckCarService.loadRoutePlan();
        window.store.setState(lost ? { driverScreen: 'assigned_load' } : {});
        return lost;
    },

    /** Inicia el viaje y la navegación. Con { rethrow: true } (copiloto de voz) relanza el error después de mostrarlo. */
    async startNavigation({ rethrow = false } = {}) {
        const load = window.TruckCarData.activeLoadOrder;
        const actions = load ? window.TruckCarService.loadActions(load) : {};
        if (!actions.navigate) {
            window.ui.toast('Acepte una carga antes de iniciar el viaje.', 'warning');
            return false;
        }
        if (actions.startTrip) {
            window.store.setState({ busyAction: 'start-trip' });
            try {
                await window.TruckCarService.startTrip();
                window.ui.toast('Viaje iniciado: la carga está en tránsito.', 'success');
            } catch (error) {
                window.store.setState({ busyAction: null });
                if (error && error.status === 409 && await this.refreshAssignment()) return false;
                window.ui.failure('No se pudo iniciar el viaje', error, 'iniciar el viaje');
                if (rethrow) throw error;
                return false;
            }
        }
        this.tripSheetExpanded = false;
        window.store.setState({ busyAction: null, driverScreen: 'navigation' });
        window.DeviceLocation.watch();
        window.RouteGuidance.prepare(window.TruckCarData.activeLoadOrder);
        window.voiceEngine.speak('Navegación iniciada hacia ' + window.DriverApp.destinationLabel() + '.', true, { force: rethrow });
        return true;
    },

    /** Destinos por nombre cerca de la posición del conductor. */
    async searchPlaces(query) {
        const fix = window.DeviceLocation && window.DeviceLocation.last(10 * 60 * 1000);
        const places = await window.TruckCarApi.routes.places(query, fix ? fix.coords[0] : undefined, fix ? fix.coords[1] : undefined);
        return Array.isArray(places) ? places : [];
    },

    openDestinationSearch() {
        window.DestinationSearch.open();
    },

    /** Lleva la guía al lugar elegido (desde la búsqueda o por voz) y abre la pantalla Navegar. */
    async goToPlace(place, { silent = false } = {}) {
        this.tripSheetExpanded = false;
        window.store.setState({ driverScreen: 'navigation' });
        const result = await window.RouteGuidance.navigateTo(place);
        if (!result.ok && !silent) {
            if (result.reason === 'no-position') {
                window.ui.toast('Sin posición GPS', 'warning', { description: 'Encienda la ubicación del teléfono para calcular la ruta desde donde está.' });
            } else if (result.reason !== 'changed') {
                window.ui.toast('No se pudo calcular la ruta', 'warning', { description: 'Sin conexión con el servicio de rutas. Intente de nuevo.' });
            }
        } else if (result.ok && !silent) {
            window.voiceEngine.speak('Ruta a ' + place.title + ' calculada.', true);
        }
        window.store.setState({});
        return result;
    },

    /** Despliega u oculta los detalles de la barra del viaje (también deslizando la barra hacia arriba o abajo). */
    toggleTripSheet(force) {
        this.tripSheetExpanded = typeof force === 'boolean' ? force : !this.tripSheetExpanded;
        const sheet = document.querySelector('[data-trip-sheet]');
        if (!sheet) return;
        sheet.dataset.expanded = String(this.tripSheetExpanded);
        sheet.querySelectorAll('[aria-expanded]').forEach(b => b.setAttribute('aria-expanded', String(this.tripSheetExpanded)));
        const toggle = sheet.querySelector('.trip-toggle');
        if (toggle) toggle.setAttribute('aria-label', this.tripSheetExpanded ? 'Ocultar los detalles del viaje' : 'Ver los detalles del viaje');
    },

    /** La X pregunta antes: un toque accidental no debe cortar la guía mientras se maneja. */
    async confirmEndFreeNavigation() {
        const free = window.RouteGuidance.freeDestination;
        if (!free) return;
        const ok = await window.Sheet.confirm({ title: '¿Terminar la navegación?', message: 'Dejará de guiarlo hacia ' + free.title + '.',
            confirmLabel: 'Terminar', cancelLabel: 'Seguir' });
        if (ok) this.endFreeNavigation();
    },

    endFreeNavigation() {
        if (window.RouteGuidance.endFreeNavigation()) {
            window.ui.toast('Navegación terminada', 'success');
            const load = window.TruckCarData.activeLoadOrder;
            if (load) window.RouteGuidance.prepare(load);
            window.store.setState({});
        }
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
        window.RouteGuidance.forget(load.backendId);
        window.store.setState({ busyAction: null, driverScreen: 'assigned_load' });
    },

    repeatInstruction() {
        const s = window.RouteGuidance.snapshot();
        const hud = window.RouteGuidance.hudText(s);
        window.voiceEngine.speak((s.hasPosition && s.status === 'ready' ? 'En ' + hud.distance + ', ' : '') + hud.instruction, true);
    },

    toggleAlertSound() {
        const enabled = window.store.state.alertSoundEnabled === false;
        window.TruckCarStore.saveAlertSound(enabled);
        window.store.setState({ alertSoundEnabled: enabled });
        if (enabled) window.voiceEngine.proposalAlert();
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

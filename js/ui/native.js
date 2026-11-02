/**
 * Piezas de "app nativa" de la PWA:
 *  - NetworkStatus: indicador de red que combina el navegador, la cola durable (js/offlineQueue.js) y la telemetría
 *    en vivo (STOMP). Estados: En línea · Sincronizando N pendientes · Modo sin señal · Reconectando telemática.
 *  - Instalación: botón "Instalar app" con beforeinstallprompt (Android/Chrome/Edge) e instrucciones en iOS, donde
 *    Safari no expone ese evento.
 *  - Movimiento: transición solo al cambiar de pantalla, contadores animados y vibración háptica.
 */
window.Native = (function () {
    const esc = (value) => window.ui.escape(value);
    const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const standalone = () => window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;

    // ------------------------------------------------------------------ vibración
    /** Patrones cortos: confirmación, advertencia y SOS. Sin soporte (iOS Safari) no hace nada. */
    function haptic(kind = 'tap') {
        const patterns = { tap: 10, success: [12, 40, 18], warning: [30, 60, 30], sos: [90, 50, 90, 50, 200] };
        try {
            if (navigator.vibrate) navigator.vibrate(patterns[kind] || patterns.tap);
        } catch (e) { /* sin vibración */ }
    }

    // ------------------------------------------------------------------ estado de red
    const NetworkStatus = {
        snapshot() {
            const state = window.store ? window.store.state : {};
            const queue = window.OfflineQueue ? window.OfflineQueue.status() : { pending: 0 };
            const telemetry = window.TruckCarTelemetry ? window.TruckCarTelemetry.status : 'offline';
            const offline = !navigator.onLine || Boolean(state.isOffline);
            const pending = queue.pending || 0;
            if (offline) {
                return {
                    state: 'offline', icon: 'fa-signal', short: 'Sin señal',
                    label: pending ? `Sin señal · ${pending} guardado${pending === 1 ? '' : 's'}` : 'Sin señal',
                    detail: (pending ? pending + ' guardado' + (pending === 1 ? '' : 's') + '. ' : '')
                        + 'Las acciones se guardan en el teléfono y se envían solas al recuperar la señal.'
                };
            }
            if (pending > 0) {
                return {
                    state: 'syncing', icon: 'fa-arrows-rotate', spin: true,
                    label: `Sincronizando ${pending} pendiente${pending === 1 ? '' : 's'}…`,
                    detail: queue.lastError
                        ? `Reintento automático${queue.nextRetryAt ? ' a las ' + new Date(queue.nextRetryAt).toLocaleTimeString('es-CO') : ''}: ${queue.lastError}`
                        : 'Enviando lo registrado sin señal, en orden y sin duplicar.'
                };
            }
            if (state.isAuthenticated && telemetry === 'reconnecting') {
                return { state: 'reconnecting', icon: 'fa-tower-broadcast', label: 'Reconectando telemática…', detail: 'La posición en vivo se reanuda sola.' };
            }
            return {
                state: 'online', icon: 'fa-signal',
                label: 'En línea',
                detail: queue.lastSyncAt ? 'Última sincronización: ' + new Date(queue.lastSyncAt).toLocaleTimeString('es-CO') : 'Conectado al servidor.'
            };
        },

        render() {
            const s = this.snapshot();
            document.querySelectorAll('[data-network-status]').forEach((el) => {
                // En la cabecera, sin señal dice solo "Sin señal" (no cabe junto al SOS); los pendientes van en el título
                // del indicador y en la pantalla Offline.
                if (el.dataset.renderedState === s.state && el.dataset.renderedLabel === s.label) return;
                el.dataset.renderedState = s.state;
                el.dataset.renderedLabel = s.label;
                // Punto + texto, sin píldora ni fondo. Sin señal o reconectando es una advertencia: triángulo y texto.
                const warn = s.state === 'offline' || s.state === 'reconnecting';
                const mark = warn
                    ? '<svg class="net-warn" aria-hidden="true"><use href="assets/icons.svg#warning-fill"></use></svg>'
                    : `<span class="net-dot${s.spin ? ' is-busy' : ''}" aria-hidden="true"></span>`;
                el.innerHTML = `<span class="net-status" data-state="${s.state}" role="status" title="${esc(s.detail)}">${mark}<span>${esc(s.short || s.label)}</span></span>`;
            });
        },

        init() {
            const rerender = () => this.render();
            window.addEventListener('online', rerender);
            window.addEventListener('offline', rerender);
            if (window.OfflineQueue) window.OfflineQueue.onChange(rerender);
            if (window.TruckCarTelemetry) window.TruckCarTelemetry.onStatusChange(rerender);
            if (window.store) window.store.subscribe(rerender);
        }
    };

    // ------------------------------------------------------------------ instalación
    const Install = {
        deferred: null,
        DISMISS_KEY: 'truckcar.installDismissedAt',

        recentlyDismissed() {
            try {
                const at = Number(localStorage.getItem(this.DISMISS_KEY) || 0);
                return Date.now() - at < 7 * 24 * 3600 * 1000;
            } catch (e) {
                return false;
            }
        },

        init() {
            window.addEventListener('beforeinstallprompt', (event) => {
                event.preventDefault(); // la app decide cuándo ofrecerlo: después del login, no al abrir
                this.deferred = event;
                this.maybeOffer();
            });
            window.addEventListener('appinstalled', () => {
                this.deferred = null;
                this.hide();
                window.ui.toast('TruckCar quedó instalada en su teléfono.', 'success');
            });
        },

        /** iOS Safari no tiene beforeinstallprompt: "standalone" en navigator es su forma de saberlo. */
        canGuideIos() {
            return 'standalone' in window.navigator && !window.navigator.standalone;
        },

        maybeOffer() {
            const state = window.store && window.store.state;
            if (!state || !state.isAuthenticated || standalone() || this.recentlyDismissed()) return;
            if (!this.deferred && !this.canGuideIos()) return;
            if (document.getElementById('install-banner')) return;
            const banner = document.createElement('div');
            banner.id = 'install-banner';
            banner.className = 'install-banner';
            banner.innerHTML = `
                <div class="card-float rounded-[22px] p-3 pr-3.5 flex items-center gap-3">
                    <img src="assets/icon-192.png" alt="" class="w-12 h-12 rounded-[14px] shrink-0">
                    <div class="min-w-0 flex-1">
                        <div class="text-[14px] font-extrabold text-white leading-tight">Instale TruckCar en su celular</div>
                        <div class="text-[12px] text-slate-400 leading-snug">Pantalla completa, inicio instantáneo y funciona sin señal.</div>
                    </div>
                    <div class="flex flex-col gap-1.5 shrink-0">
                        <button type="button" data-install class="px-3.5 py-2 rounded-xl bg-brand-600 text-white text-[13px] font-bold">Instalar</button>
                        <button type="button" data-install-later class="px-3.5 py-1 rounded-xl text-slate-400 text-[12px] font-semibold">Ahora no</button>
                    </div>
                </div>`;
            document.body.appendChild(banner);
            banner.querySelector('[data-install]').addEventListener('click', () => this.install());
            banner.querySelector('[data-install-later]').addEventListener('click', () => {
                try { localStorage.setItem(this.DISMISS_KEY, String(Date.now())); } catch (e) { /* sin almacenamiento */ }
                this.hide();
            });
            setTimeout(() => banner.classList.add('is-visible'), 1200);
        },

        async install() {
            if (this.deferred) {
                const prompt = this.deferred;
                this.deferred = null;
                prompt.prompt();
                const choice = await prompt.userChoice.catch(() => null);
                if (choice && choice.outcome === 'dismissed') {
                    try { localStorage.setItem(this.DISMISS_KEY, String(Date.now())); } catch (e) { /* sin almacenamiento */ }
                }
                this.hide();
                return;
            }
            this.hide();
            window.Sheet.open({
                title: 'Instalar en iPhone o iPad',
                subtitle: 'Safari instala la app desde el menú Compartir.',
                icon: 'fa-mobile-screen-button',
                body: `<ol class="space-y-3 text-[14px] text-slate-200">
                    <li class="flex items-center gap-3"><span class="stepper-dot is-current">1</span> Toque <i class="fas fa-arrow-up-from-bracket text-brand-400"></i> <b>Compartir</b> en la barra de Safari.</li>
                    <li class="flex items-center gap-3"><span class="stepper-dot is-current">2</span> Elija <b>Añadir a pantalla de inicio</b>.</li>
                    <li class="flex items-center gap-3"><span class="stepper-dot is-current">3</span> Abra TruckCar desde el ícono: sin barras del navegador.</li>
                </ol>`,
                actions: [{ label: 'Entendido', tone: 'primary' }]
            });
        },

        hide() {
            const banner = document.getElementById('install-banner');
            if (!banner) return;
            banner.classList.remove('is-visible');
            setTimeout(() => banner.remove(), 480);
        }
    };

    // ------------------------------------------------------------------ movimiento
    let lastScreenKey = null;

    /** Anima la entrada solo cuando cambia la pantalla: el refresco automático re-renderiza sin moverse. */
    function markScreen(mount, key) {
        if (key === lastScreenKey) return;
        const first = lastScreenKey === null;
        lastScreenKey = key;
        if (first || reducedMotion()) return;
        const target = mount.querySelector('[data-screen]') || mount.firstElementChild;
        if (!target) return;
        target.classList.remove('screen-enter');
        void target.offsetWidth; // reinicia la animación si la clase ya estaba
        target.classList.add('screen-enter');
        // Entrada escalonada de las tarjetas de la pantalla nueva (solo en este cambio de pantalla).
        target.querySelectorAll('[data-stagger]').forEach(el => el.classList.add('stagger'));
    }

    const counterValues = new Map();

    /**
     * Contadores: <span data-count="12" data-count-key="kpi-fleet">12</span>. Animan desde el último valor mostrado
     * hasta el nuevo (ease-out, 700 ms); en el primer render y con movimiento reducido se muestran directamente.
     */
    function animateCounters(root = document) {
        root.querySelectorAll('[data-count]').forEach((el) => {
            const to = Number(el.dataset.count);
            const key = el.dataset.countKey || '';
            const from = counterValues.has(key) ? counterValues.get(key) : to;
            counterValues.set(key, to);
            const suffix = el.dataset.countSuffix || '';
            if (from === to || reducedMotion() || !Number.isFinite(to)) {
                el.textContent = to + suffix;
                return;
            }
            const start = performance.now();
            const duration = 700;
            const tick = (now) => {
                const t = Math.min(1, (now - start) / duration);
                const eased = 1 - Math.pow(1 - t, 3);
                el.textContent = Math.round(from + (to - from) * eased) + suffix;
                if (t < 1 && el.isConnected) requestAnimationFrame(tick);
            };
            requestAnimationFrame(tick);
        });
    }

    // ------------------------------------------------------------------ accesos directos del manifiesto
    const SHORTCUT_SCREENS = ['assigned_load', 'alerts', 'navigation', 'route_overview', 'offline', 'profile'];

    /** ?screen=alerts (atajos del ícono instalado): se aplica una vez, al entrar como conductor. */
    function applyShortcut() {
        const params = new URLSearchParams(window.location.search);
        const screen = params.get('screen');
        if (!screen || !SHORTCUT_SCREENS.includes(screen)) return;
        const state = window.store.state;
        if (!state.isAuthenticated || state.activeRole !== 'driver') return;
        window.history.replaceState(null, '', window.location.pathname);
        window.store.setState({ driverScreen: screen });
    }

    function init() {
        NetworkStatus.init();
        Install.init();
        document.documentElement.classList.toggle('is-standalone', standalone());
    }

    return { haptic, NetworkStatus, Install, markScreen, animateCounters, applyShortcut, init };
})();

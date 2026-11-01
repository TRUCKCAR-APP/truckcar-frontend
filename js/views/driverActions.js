/**
 * Acciones rápidas del conductor:
 *  - Progreso del viaje y botón principal que avanza el estado (Aceptar → Iniciar viaje → Llegué: registrar entrega).
 *  - Reporte vial de un toque: hoja con la cuadrícula de tipos (Community-Alerts; sin señal va a la cola offline).
 *  - SOS: botón flotante que se activa manteniéndolo presionado 1,5 s (un toque accidental no hace nada).
 *
 * El botón SOS se monta una vez fuera de #app-mount: las vistas se re-renderizan en cada setState (telemetría,
 * refresco) y un re-render a mitad de la presión la cancelaría.
 */
window.DriverActions = (function () {
    const esc = (value) => window.ui.escape(value);
    const HOLD_MS = 1500;
    const RING = 2 * Math.PI * 25;

    // ------------------------------------------------------------------ progreso del viaje
    const STEPS = [
        { key: 'proposed', label: 'Propuesta' },
        { key: 'assigned', label: 'Aceptada' },
        { key: 'transit', label: 'En tránsito' },
        { key: 'delivered', label: 'Entregada' }
    ];

    function stepIndex(load) {
        if (!load) return -1;
        if (load.status === 'DELIVERED') return 3;
        if (load.status === 'IN_TRANSIT') return 2;
        if (load.status === 'ASSIGNED') return 1;
        return 0;
    }

    function tripProgressHtml(load) {
        const current = stepIndex(load);
        const parts = [];
        STEPS.forEach((step, i) => {
            const cls = i < current ? 'is-done' : i === current ? 'is-current' : '';
            parts.push(`<div class="flex flex-col items-center gap-1 w-14 shrink-0">
                <span class="stepper-dot ${cls}">${i < current ? '<i class="fas fa-check text-[11px]"></i>' : i + 1}</span>
                <span class="text-[10.5px] font-semibold ${i <= current ? 'text-slate-200' : 'text-slate-500'} text-center leading-tight">${step.label}</span>
            </div>`);
            if (i < STEPS.length - 1) {
                parts.push(`<div class="stepper-line -mt-4"><span style="transform: scaleX(${i < current ? 1 : 0})"></span></div>`);
            }
        });
        return `<div class="stepper card px-3 py-3" role="list" aria-label="Progreso del viaje">${parts.join('')}</div>`;
    }

    // ------------------------------------------------------------------ reporte vial de un toque
    /** Tipos del backend (Community-Alerts). "Trancón" no existe aún como tipo de alerta en el servidor. */
    const REPORTS = [
        { type: 'landslide', label: 'Derrumbe', icon: 'fa-hill-rockslide', tone: 'text-rose-400' },
        { type: 'danger', label: 'Accidente', icon: 'fa-car-burst', tone: 'text-rose-400' },
        { type: 'workshop', label: 'Obra en vía', icon: 'fa-person-digging', tone: 'text-amber-400' },
        { type: 'police', label: 'Retén', icon: 'fa-shield-halved', tone: 'text-sky-400' },
        { type: 'scale', label: 'Báscula', icon: 'fa-weight-hanging', tone: 'text-amber-300' },
        { type: 'bridge', label: 'Gálibo bajo', icon: 'fa-ruler-vertical', tone: 'text-rose-300' },
        { type: 'rest', label: 'Parador seguro', icon: 'fa-square-parking', tone: 'text-emerald-400' }
    ];

    function openReportSheet(preset) {
        const coords = window.app.currentPosition();
        const body = document.createElement('div');
        body.innerHTML = `
            ${coords ? '' : `<p class="mb-3 p-3 rounded-2xl bg-amber-500/10 border border-amber-500/30 text-[13px] text-amber-200">
                <i class="fas fa-location-crosshairs"></i> Aún no hay una posición GPS: active la ubicación para reportar.</p>`}
            <div class="grid grid-cols-3 gap-2.5">
                ${REPORTS.map(r => `
                    <button type="button" class="report-tile ${r.type === preset ? '!border-brand-500' : ''}" data-report="${r.type}" ${coords ? '' : 'disabled'}>
                        <i class="fas ${r.icon} ${r.tone}"></i><span>${r.label}</span>
                    </button>`).join('')}
            </div>
            <details class="mt-3 group">
                <summary class="list-none cursor-pointer text-[13px] font-semibold text-slate-400 py-2 flex items-center gap-2">
                    <i class="fas fa-pen text-[11px]"></i> Añadir un detalle (opcional)
                    <i class="fas fa-chevron-down text-[10px] transition group-open:rotate-180"></i>
                </summary>
                <textarea rows="2" maxlength="300" data-report-detail class="login-input w-full text-sm resize-none mt-1"
                    placeholder="Ej. carril derecho cerrado, paso a un solo carril" enterkeyhint="done"></textarea>
            </details>
            <p class="text-[12px] text-slate-500 mt-2 leading-snug">Un toque publica el reporte con su posición actual. Sin señal se guarda y se envía al reconectar.</p>`;

        window.Sheet.open({
            title: 'Reportar en la vía',
            subtitle: 'Avise a otros conductores en un toque.',
            icon: 'fa-bullhorn',
            tone: 'warning',
            body,
            onMount(sheet, close) {
                sheet.querySelectorAll('[data-report]').forEach(tile => tile.addEventListener('click', async () => {
                    const report = REPORTS.find(r => r.type === tile.dataset.report);
                    const detail = sheet.querySelector('[data-report-detail]').value.trim();
                    sheet.querySelectorAll('[data-report]').forEach(t => { t.disabled = true; });
                    tile.innerHTML = '<i class="fas fa-circle-notch fa-spin text-brand-400"></i><span>Enviando…</span>';
                    try {
                        const alert = await window.TruckCarService.reportAlert(report.type,
                            detail || report.label + ' reportado desde la cabina.', coords);
                        window.Native.haptic('success');
                        tile.classList.add('is-sent');
                        tile.innerHTML = '<i class="fas fa-circle-check text-emerald-400"></i><span>Reportado</span>';
                        window.voiceEngine.speak('Gracias. Alerta de ' + report.label + ' compartida.');
                        setTimeout(() => close(true), 650);
                        window.ui.toast(alert && alert.pendingSync ? 'Reporte guardado sin señal' : 'Reporte publicado',
                            alert && alert.pendingSync ? 'warning' : 'success',
                            { description: alert && alert.pendingSync
                                ? report.label + ': se enviará al recuperar la señal.'
                                : report.label + ' visible para la red de conductores.' });
                        window.store.setState({});
                    } catch (error) {
                        close(false);
                        window.ui.failure('No se pudo publicar el reporte', error, 'publicar el reporte');
                    }
                }));
            }
        });
    }

    // ------------------------------------------------------------------ SOS
    let sos = null;

    function buildSos(host) {
        const el = document.createElement('div');
        el.innerHTML = `
            <span class="sos-hint" role="status">Mantenga presionado para pedir ayuda</span>
            <button type="button" class="sos-fab" aria-label="SOS de emergencia: mantenga presionado 1,5 segundos">
                <svg class="sos-ring" viewBox="0 0 54 54" aria-hidden="true">
                    <circle cx="27" cy="27" r="25" stroke-dasharray="${RING}" stroke-dashoffset="${RING}"></circle>
                </svg>
                <span class="sos-label">SOS</span>
            </button>`;
        const hint = el.querySelector('.sos-hint');
        const button = el.querySelector('.sos-fab');
        const circle = el.querySelector('circle');
        host.appendChild(hint);
        host.appendChild(button);

        let raf = null;
        let startedAt = 0;
        let hintTimer = null;

        const setProgress = (p) => { circle.style.strokeDashoffset = String(RING * (1 - p)); };
        const showHint = (visible) => {
            clearTimeout(hintTimer);
            hint.classList.toggle('is-visible', visible);
            if (visible) hintTimer = setTimeout(() => hint.classList.remove('is-visible'), 1800);
        };
        const reset = (animate) => {
            cancelAnimationFrame(raf);
            raf = null;
            button.classList.remove('is-holding');
            circle.style.transition = animate ? 'stroke-dashoffset 220ms cubic-bezier(0.23, 1, 0.32, 1)' : 'none';
            setProgress(0);
        };
        const tick = (now) => {
            const p = Math.min(1, (now - startedAt) / HOLD_MS);
            setProgress(p);
            if (p < 1) {
                raf = requestAnimationFrame(tick);
                return;
            }
            raf = null;
            button.classList.remove('is-holding');
            showHint(false);
            window.Native.haptic('sos');
            activate().finally(() => reset(true));
        };

        button.addEventListener('pointerdown', (event) => {
            button.setPointerCapture(event.pointerId);
            startedAt = performance.now();
            circle.style.transition = 'none';
            button.classList.add('is-holding');
            showHint(true);
            window.Native.haptic('tap');
            raf = requestAnimationFrame(tick);
        });
        const release = () => { if (raf) reset(true); };
        button.addEventListener('pointerup', release);
        button.addEventListener('pointercancel', release);
        button.addEventListener('lostpointercapture', release);
        // Teclado: Enter/Espacio mantenidos también activan (accesibilidad), un toque suelto solo muestra la ayuda.
        button.addEventListener('keydown', (event) => {
            if ((event.key === 'Enter' || event.key === ' ') && !raf && !event.repeat) {
                event.preventDefault();
                startedAt = performance.now();
                button.classList.add('is-holding');
                raf = requestAnimationFrame(tick);
            }
        });
        button.addEventListener('keyup', release);
        button.addEventListener('contextmenu', (event) => event.preventDefault());
        return { hint, button };
    }

    /** Una lectura GPS puntual cuando la app aún no tiene posición (máx. 5 s): [lat, lng, precisión] o null. */
    function freshFix() {
        if (!navigator.geolocation) return Promise.resolve(null);
        return new Promise((resolve) => {
            navigator.geolocation.getCurrentPosition(
                (p) => resolve([p.coords.latitude, p.coords.longitude, p.coords.accuracy]),
                () => resolve(null),
                { enableHighAccuracy: true, timeout: 5000, maximumAge: 30000 });
        });
    }

    function sosStatusHtml(kind, title, detail) {
        const tones = {
            sending: ['fa-circle-notch fa-spin', 'bg-slate-800/60 border-slate-700 text-slate-200'],
            sent: ['fa-circle-check', 'bg-emerald-500/10 border-emerald-500/30 text-emerald-200'],
            queued: ['fa-cloud-arrow-up', 'bg-amber-500/10 border-amber-500/30 text-amber-200'],
            failed: ['fa-triangle-exclamation', 'bg-rose-500/10 border-rose-500/30 text-rose-200']
        };
        const [icon, cls] = tones[kind];
        return `<div class="p-3 rounded-2xl border ${cls} text-[13px] leading-snug flex gap-2.5" role="status">
            <i class="fas ${icon} mt-0.5"></i><div><b class="block">${esc(title)}</b>${detail ? `<span class="opacity-90">${esc(detail)}</span>` : ''}</div></div>`;
    }

    /**
     * SOS: POST /api/v1/alerts/sos con la posición actual. La hoja se abre al instante y muestra el resultado real:
     * torre avisada (id y hora del servidor), guardado sin señal (cola durable) o error. La llamada al 123 siempre está.
     */
    async function activate() {
        let coords = window.app.currentPosition();
        let accuracy = null;
        const load = window.TruckCarData.activeLoadOrder;
        const driver = window.TruckCarData.currentDriver || {};
        let send = null;

        const result = window.Sheet.open({
            title: 'SOS activado',
            subtitle: 'Mantenga la calma. Si hay heridos o peligro inmediato, llame a la línea de emergencias.',
            icon: 'fa-life-ring',
            tone: 'danger',
            body: `
                <div data-sos-status>${sosStatusHtml('sending', 'Avisando a la torre de control…', 'Enviando su posición.')}</div>
                <div class="card p-3.5 space-y-2 text-[13px] mt-3">
                    <div class="flex justify-between gap-3"><span class="text-slate-400">Posición</span>
                        <b class="font-mono text-right" data-sos-position>${coords ? coords[0].toFixed(5) + ', ' + coords[1].toFixed(5) : 'Buscando GPS…'}</b></div>
                    <div class="flex justify-between gap-3"><span class="text-slate-400">Vehículo</span>
                        <b class="font-mono">${esc((driver.vehicle && driver.vehicle.plate) || '—')}</b></div>
                    <div class="flex justify-between gap-3"><span class="text-slate-400">Carga</span>
                        <b>${load ? esc(load.id) : 'Sin carga activa'}</b></div>
                </div>`,
            actions: [
                { label: 'Llamar al 123', tone: 'danger', icon: 'fa-phone', value: 'call' },
                { label: 'Cerrar', tone: 'secondary', value: 'close' }
            ],
            onMount(sheet) {
                const status = sheet.querySelector('[data-sos-status]');
                const show = (...args) => { status.innerHTML = sosStatusHtml(...args); };
                send = (async () => {
                    if (!coords) {
                        const fix = await freshFix();
                        if (fix) { coords = [fix[0], fix[1]]; accuracy = fix[2]; }
                        sheet.querySelector('[data-sos-position]').textContent =
                            coords ? coords[0].toFixed(5) + ', ' + coords[1].toFixed(5) : 'Sin GPS';
                    }
                    if (!coords) {
                        show('failed', 'No hay posición GPS', 'Sin ubicación la torre no puede ubicarlo: active el GPS o llame al 123.');
                        window.Native.haptic('warning');
                        return;
                    }
                    try {
                        const sos = await window.TruckCarService.triggerSos(coords, accuracy);
                        if (sos.pendingSync) {
                            show('queued', 'SOS guardado sin señal', 'Se enviará a la torre en cuanto haya cobertura. Si puede, llame al 123.');
                            window.voiceEngine.speak('Sin señal. El SOS se enviará al recuperar la cobertura.');
                        } else {
                            const at = new Date(sos.receivedAt || sos.triggeredAt || Date.now())
                                .toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' });
                            show('sent', 'Torre de control avisada', 'SOS #' + sos.id + ' recibido a las ' + at + '. Un coordinador lo atenderá.');
                            window.Native.haptic('success');
                            window.voiceEngine.speak('SOS enviado. La torre de control fue avisada.', true);
                        }
                    } catch (error) {
                        show('failed', 'No se pudo enviar el SOS', window.ui.errorMessage(error) + '. Llame al 123.');
                        window.Native.haptic('warning');
                    }
                })();
            }
        });
        if (await result === 'call') window.location.href = 'tel:123';
        await send;
    }

    /** Muestra el SOS solo al conductor autenticado, sobre la app y por encima de la barra de pestañas. */
    function syncSos(state) {
        const visible = state.isAuthenticated && state.activeRole === 'driver';
        if (!visible) {
            if (sos) sos.button.hidden = true;
            if (sos) sos.hint.hidden = true;
            return;
        }
        const host = document.getElementById('phone-mockup-frame');
        if (!host) return;
        if (!sos) sos = buildSos(host);
        sos.button.hidden = false;
        sos.hint.hidden = false;
    }

    return { tripProgressHtml, openReportSheet, syncSos, activate, REPORTS };
})();

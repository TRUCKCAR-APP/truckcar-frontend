window.DriverActions = (function () {
    const esc = (value) => window.ui.escape(value);
    const HOLD_MS = 1500;
    const OLD_POSITION_MS = 2 * 60 * 1000;
    const icon = (name) => `<svg aria-hidden="true"><use href="assets/icons.svg#${name}"></use></svg>`;

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

    const REPORTS = [
        { type: 'landslide', label: 'Derrumbe', icon: 'mountains' },
        { type: 'danger', label: 'Accidente', icon: 'car-profile' },
        { type: 'workshop', label: 'Obra en vía', icon: 'traffic-cone' },
        { type: 'police', label: 'Retén', icon: 'police-car' },
        { type: 'scale', label: 'Báscula', icon: 'scales' },
        { type: 'bridge', label: 'Gálibo bajo', icon: 'arrows-vertical' },
        { type: 'rest', label: 'Parador seguro', icon: 'bed' }
    ];
    const warn = (text) => `<div class="warn-line">${icon('warning-fill')}<span>${esc(text)}</span></div>`;

    function openReportSheet(preset) {
        let coords = window.app.currentPosition(2 * 60 * 1000);
        const body = document.createElement('div');
        body.innerHTML = `
            ${coords ? '' : `<div data-report-gps class="report-gps"><p class="status-line"><span class="spinner" aria-hidden="true"></span><span class="status-sub">Buscando su posición GPS…</span></p></div>`}
            <div class="report-grid">
                ${REPORTS.map(r => `
                    <button type="button" class="report-tile${r.type === preset ? ' is-preset' : ''}" data-report="${r.type}" ${coords ? '' : 'disabled'}>
                        ${icon(r.icon)}<span>${r.label}</span>
                    </button>`).join('')}
            </div>
            <details class="report-detail">
                <summary>${icon('pencil-simple')}Añadir un detalle (opcional)${icon('caret-down')}</summary>
                <textarea rows="2" maxlength="300" data-report-detail class="field-input report-detail-input"
                    placeholder="Ej. carril derecho cerrado, paso a un solo carril" enterkeyhint="done"></textarea>
            </details>
            <p class="sheet-note">Sin señal, el reporte se guarda en el teléfono y se envía al reconectar.</p>`;

        window.Sheet.open({
            title: 'Reportar en la vía',
            subtitle: 'Un toque publica el reporte con su posición actual.',
            body,
            onMount(sheet, close) {
                if (!coords) {
                    window.DeviceLocation.fix({ timeoutMs: 8000 }).then((fix) => {
                        const note = sheet.querySelector('[data-report-gps]');
                        if (!fix) {
                            if (note) note.innerHTML = warn((window.DeviceLocation.error || 'Sin señal GPS.') + ' Active la ubicación para reportar.');
                            return;
                        }
                        coords = fix.coords;
                        if (note) note.remove();
                        sheet.querySelectorAll('[data-report]').forEach(t => { t.disabled = false; });
                    });
                }
                sheet.querySelectorAll('[data-report]').forEach(tile => tile.addEventListener('click', async () => {
                    const report = REPORTS.find(r => r.type === tile.dataset.report);
                    const detail = sheet.querySelector('[data-report-detail]').value.trim();
                    sheet.querySelectorAll('[data-report]').forEach(t => { t.disabled = true; });
                    tile.innerHTML = '<span class="spinner" aria-hidden="true"></span><span>Enviando…</span>';
                    try {
                        const alert = await window.TruckCarService.reportAlert(report.type,
                            detail, coords);
                        window.Native.haptic('success');
                        tile.classList.add('is-sent');
                        tile.innerHTML = icon('check-circle-fill') + '<span>Reportado</span>';
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

    let sos = null;

    function buildSos(host) {
        const el = document.createElement('div');
        el.innerHTML = `
            <span class="sos-hint" role="status">Mantenga presionado para pedir ayuda</span>
            <button type="button" class="sos-fab" aria-label="SOS de emergencia: mantenga presionado 1,5 segundos">
                <span class="sos-face">${icon('siren')}SOS</span>
            </button>`;
        const hint = el.querySelector('.sos-hint');
        const button = el.querySelector('.sos-fab');
        host.appendChild(hint);
        host.appendChild(button);

        let raf = null;
        let startedAt = 0;
        let hintTimer = null;
        let holdFired = false;

        const setProgress = (p) => { button.style.setProperty('--hold', String(p)); };
        const showHint = (visible) => {
            clearTimeout(hintTimer);
            hint.classList.toggle('is-visible', visible);
            if (visible) hintTimer = setTimeout(() => hint.classList.remove('is-visible'), 1800);
        };
        const reset = (animate) => {
            cancelAnimationFrame(raf);
            raf = null;
            button.classList.remove('is-holding');
            button.classList.toggle('is-releasing', !!animate);
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
            holdFired = true;
            button.classList.remove('is-holding');
            showHint(false);
            window.Native.haptic('sos');
            activate().finally(() => reset(true));
        };

        button.addEventListener('pointerdown', (event) => {
            button.setPointerCapture(event.pointerId);
            holdFired = false;
            startedAt = performance.now();
            button.classList.remove('is-releasing');
            button.classList.add('is-holding');
            showHint(true);
            window.Native.haptic('tap');
            raf = requestAnimationFrame(tick);
        });
        const release = () => {
            if (raf) reset(true);
            if (holdFired) setTimeout(() => { holdFired = false; }, 0);
        };
        button.addEventListener('pointerup', release);
        button.addEventListener('pointercancel', release);
        button.addEventListener('lostpointercapture', release);
        button.addEventListener('keydown', (event) => {
            if ((event.key === 'Enter' || event.key === ' ') && !raf && !event.repeat) {
                event.preventDefault();
                holdFired = false;
                startedAt = performance.now();
                button.classList.add('is-holding');
                raf = requestAnimationFrame(tick);
            }
        });
        button.addEventListener('keyup', (event) => {
            const short = !!raf && (event.key === 'Enter' || event.key === ' ');
            release();
            if (short) openSosConfirm(button);
        });
        button.addEventListener('click', () => {
            if (holdFired) {
                holdFired = false;
                return;
            }
            if (!raf) openSosConfirm(button);
        });
        button.addEventListener('contextmenu', (event) => event.preventDefault());
        return { hint, button };
    }

    async function sosPosition() {
        const recent = window.DeviceLocation.last(15000);
        if (recent) return { fix: recent, stale: false };
        const fresh = await window.DeviceLocation.fix({ timeoutMs: 6000 });
        if (fresh) return { fix: fresh, stale: false };
        const last = window.DeviceLocation.last();
        return last ? { fix: last, stale: true } : null;
    }

    const decimal = (value) => value.toLocaleString('es-CO', { minimumFractionDigits: 5, maximumFractionDigits: 5 });

    function positionLabel(position) {
        if (!position) return 'Sin GPS';
        const { fix } = position;
        return decimal(fix.coords[0]) + ', ' + decimal(fix.coords[1]) + (fix.accuracy ? ' ±' + Math.round(fix.accuracy) + ' m' : '');
    }

    function readingLabel(position) {
        if (!position) return 'Sin lectura';
        const age = window.DeviceLocation.age(position.fix);
        return position.stale ? 'última confirmada ' + age : age;
    }

    function sosStatusHtml(kind, detail) {
        const call = ' <b>Llame al 123 ahora.</b>';
        switch (kind) {
            case 'sending': return `<div class="sos-line is-pending"><span>Avisando a la torre de control…</span></div>`;
            case 'sent': return `<div class="sos-line">${icon('check-circle-fill')}<span>Torre de control avisada · ${esc(detail)}</span></div>`;
            case 'queued': return `<div class="sos-line is-pending">${icon('warning-fill')}<span>Sin señal: el aviso se enviará al recuperar la señal.${call}</span></div>`;
            case 'no-gps': return `<div class="sos-line is-pending">${icon('warning-fill')}<span>La alerta NO se envió: no hay posición GPS (${esc(detail)}). Sin ubicación la torre no puede ubicarlo.${call}</span></div>`;
            case 'not-saved': return `<div class="sos-line is-pending">${icon('warning-fill')}<span>La alerta NO se envió ni quedó guardada: ${esc(detail)}.${call}</span></div>`;
            case 'late-cancel': return `<div class="sos-line">${icon('warning-fill')}<span>${esc(detail)} <b>Llame al 123 para avisar del error.</b></span></div>`;
            case 'old-position': return `<div class="sos-line is-pending">${icon('warning-fill')}<span>La posición enviada es la ${esc(detail)}: puede no ser exacta.${call}</span></div>`;
            default: return `<div class="sos-line is-pending">${icon('warning-fill')}<span>La alerta NO se envió: ${esc(detail)}.${call}</span></div>`;
        }
    }

    const NOT_SENT = ['no-gps', 'failed', 'not-saved'];
    const LATE_CANCEL = {
        'in-flight': 'La alerta ya se está enviando y no se puede cancelar desde la app.',
        sent: 'La alerta ya se envió y no se puede cancelar desde la app.',
        queued: 'La alerta ya quedó guardada y se enviará al recuperar la señal; no se puede cancelar desde la app.'
    };

    function openSosModal({ plate, load, onMount }) {
        return new Promise((resolve) => {
            const host = document.getElementById('phone-mockup-frame') || document.body;
            const previousFocus = document.activeElement;
            const modal = document.createElement('div');
            modal.className = 'sos-modal';
            modal.setAttribute('role', 'alertdialog');
            modal.setAttribute('aria-modal', 'true');
            modal.setAttribute('aria-labelledby', 'sos-modal-title');
            modal.setAttribute('aria-describedby', 'sos-modal-status');
            modal.innerHTML = `
                <svg class="sos-modal-icon" aria-hidden="true"><use href="assets/icons.svg#siren"></use></svg>
                <h2 id="sos-modal-title">SOS activado</h2>
                <p data-sos-calm>Mantenga la calma. Si hay heridos o peligro inmediato, llame a la línea de emergencias.</p>
                <div id="sos-modal-status" data-sos-status role="status" aria-live="assertive">${sosStatusHtml('sending')}</div>
                <dl>
                    <dt>Posición</dt><dd data-sos-position>Obteniendo GPS del teléfono…</dd>
                    <dt>Lectura GPS</dt><dd data-sos-reading>—</dd>
                    <dt>Vehículo</dt><dd>${esc(plate || '—')}</dd>
                    <dt>Carga</dt><dd>${load ? esc(load.id) : 'Sin carga activa'}</dd>
                </dl>
                <span class="spacer"></span>
                <button type="button" class="sos-call" data-sos-action="call">${icon('phone')}Llamar al 123</button>
                <button type="button" class="sos-close" data-sos-action="cancel">Cancelar: fue un error</button>
                <button type="button" class="sos-close" data-sos-action="close">Cerrar</button>`;
            let ticker = null;
            document.body.classList.add('sos-open');
            const close = (value) => {
                clearInterval(ticker);
                document.body.classList.remove('sos-open');
                document.removeEventListener('keydown', onKey);
                modal.remove();
                if (previousFocus && previousFocus.focus) previousFocus.focus({ preventScroll: true });
                resolve(value);
            };
            const onKey = (event) => { if (event.key === 'Escape') close('close'); };
            document.addEventListener('keydown', onKey);
            modal.querySelectorAll('[data-sos-action]:not([data-sos-action="cancel"])').forEach(button =>
                button.addEventListener('click', () => close(button.dataset.sosAction)));
            host.appendChild(modal);
            modal.tabIndex = -1;
            modal.focus({ preventScroll: true });
            const tick = (fn) => { clearInterval(ticker); fn(); ticker = setInterval(fn, 1000); };
            onMount(modal, tick, close);
        });
    }

    async function activate() {
        const load = window.TruckCarData.activeLoadOrder;
        const driver = window.TruckCarData.currentDriver || {};
        let send = null;

        const result = openSosModal({
            plate: driver.vehicle && driver.vehicle.plate,
            load,
            onMount(modal, tick, close) {
                const status = modal.querySelector('[data-sos-status]');
                const calm = modal.querySelector('[data-sos-calm]');
                const cancel = modal.querySelector('[data-sos-action="cancel"]');
                let oldPosition = '';
                let requested = false;
                let cancelled = false;
                let lateCancel = false;
                let current = ['sending'];
                const show = (kind, detail) => {
                    current = [kind, detail];
                    const sent = kind === 'sent' || kind === 'queued';
                    const late = lateCancel && LATE_CANCEL[requested && kind === 'sending' ? 'in-flight' : kind];
                    status.innerHTML = sosStatusHtml(kind, detail)
                        + (sent && oldPosition ? sosStatusHtml('old-position', oldPosition) : '')
                        + (late ? sosStatusHtml('late-cancel', late) : '');
                    calm.hidden = kind !== 'sending' && kind !== 'sent';
                    cancel.hidden = NOT_SENT.includes(kind);
                    if (NOT_SENT.includes(kind)) modal.querySelector('#sos-modal-title').textContent = 'SOS no enviado';
                };
                cancel.addEventListener('click', () => {
                    if (!requested) {
                        cancelled = true;
                        close('cancel');
                        return;
                    }
                    lateCancel = true;
                    show(...current);
                });
                send = (async () => {
                    const position = await sosPosition();
                    if (cancelled) return;
                    modal.querySelector('[data-sos-position]').textContent = positionLabel(position);
                    tick(() => { modal.querySelector('[data-sos-reading]').textContent = readingLabel(position); });
                    if (!position) {
                        show('no-gps', String(window.DeviceLocation.error || 'sin señal GPS').replace(/\.\s*$/, ''));
                        window.Native.haptic('warning');
                        return;
                    }
                    if (position.stale && Date.now() - position.fix.time > OLD_POSITION_MS) {
                        oldPosition = readingLabel(position);
                    }
                    if (cancelled) return;
                    requested = true;
                    try {
                        const sos = await window.TruckCarService.triggerSos(position.fix.coords, position.fix.accuracy);
                        if (sos.pendingSync) {
                            show('queued');
                            window.voiceEngine.speak('Sin señal. El SOS se enviará al recuperar la cobertura. Llame al 123.');
                        } else {
                            const at = new Date(sos.receivedAt || sos.triggeredAt || Date.now())
                                .toLocaleTimeString('es-CO', { hour: 'numeric', minute: '2-digit' });
                            show('sent', 'SOS #' + sos.id + ', ' + at);
                            window.Native.haptic('success');
                            window.voiceEngine.speak('SOS enviado. La torre de control fue avisada.', true);
                        }
                    } catch (error) {
                        show(Number.isFinite(error && error.status) && error.status > 0 ? 'failed' : 'not-saved', window.ui.errorMessage(error));
                        window.Native.haptic('warning');
                    }
                })();
            }
        });
        const outcome = await result;
        if (outcome === 'call') window.location.href = 'tel:123';
        if (outcome === 'cancel') window.ui.toast('SOS cancelado', 'success', { description: 'No se envió ninguna alerta.' });
        await send;
    }

    let confirming = false;

    function openConfirm({ trigger, tone = '', iconName, title, description, warning = '', confirmLabel, confirmIcon = '', cancelLabel, onConfirm }) {
        if (confirming || document.body.classList.contains('sos-open')) return;
        confirming = true;
        const host = document.getElementById('phone-mockup-frame') || document.body;
        const previousFocus = trigger || document.activeElement;
        const dialog = document.createElement('div');
        dialog.className = 'sos-modal sos-confirm' + (tone ? ' ' + tone : '');
        dialog.setAttribute('role', 'alertdialog');
        dialog.setAttribute('aria-modal', 'true');
        dialog.setAttribute('aria-labelledby', 'sos-confirm-title');
        dialog.setAttribute('aria-describedby', 'sos-confirm-desc' + (warning ? ' sos-confirm-warning' : ''));
        dialog.innerHTML = `
            <svg class="sos-modal-icon" aria-hidden="true"><use href="assets/icons.svg#${iconName}"></use></svg>
            <h2 id="sos-confirm-title" tabindex="-1">${esc(title)}</h2>
            <p id="sos-confirm-desc">${esc(description)}</p>
            ${warning ? `<p id="sos-confirm-warning" class="sos-confirm-warning">${icon('warning-fill')}<span>${esc(warning)}</span></p>` : ''}
            <span class="spacer"></span>
            <button type="button" class="sos-call" data-sos-confirm="send">${confirmIcon ? icon(confirmIcon) : ''}${esc(confirmLabel)}</button>
            <button type="button" class="sos-close" data-sos-confirm="cancel">${esc(cancelLabel)}</button>`;
        const buttons = [...dialog.querySelectorAll('[data-sos-confirm]')];
        let sending = false;
        const close = () => {
            document.removeEventListener('keydown', onKey);
            document.body.classList.remove('sos-open');
            dialog.remove();
            confirming = false;
            if (previousFocus && previousFocus.focus) previousFocus.focus({ preventScroll: true });
        };
        const onKey = (event) => {
            if (event.key === 'Escape' && !sending) {
                event.preventDefault();
                close();
            } else if (event.key === 'Tab') {
                event.preventDefault();
                const index = buttons.indexOf(document.activeElement);
                const last = buttons.length - 1;
                const next = event.shiftKey ? (index <= 0 ? last : index - 1) : (index === -1 || index === last ? 0 : index + 1);
                buttons[next].focus();
            }
        };
        buttons[0].addEventListener('click', () => {
            if (sending) return;
            sending = true;
            buttons.forEach(button => { button.disabled = true; });
            close();
            onConfirm();
        });
        buttons[1].addEventListener('click', () => { if (!sending) close(); });
        document.addEventListener('keydown', onKey);
        document.body.classList.add('sos-open');
        host.appendChild(dialog);
        dialog.querySelector('#sos-confirm-title').focus({ preventScroll: true });
    }

    function openSosConfirm(trigger) {
        openConfirm({
            trigger,
            iconName: 'siren',
            title: '¿Enviar SOS a la torre de control?',
            description: 'La torre recibirá su posición GPS, su vehículo y su carga.',
            confirmLabel: 'Sí, enviar SOS',
            confirmIcon: 'siren',
            cancelLabel: 'Cancelar',
            onConfirm: () => {
                window.Native.haptic('sos');
                activate();
            }
        });
    }

    function hasPendingSos() {
        try {
            const status = window.OfflineQueue.status();
            return !!(status && status.byKind && status.byKind['alert.sos'] > 0);
        } catch (error) {
            return false;
        }
    }

    function confirmLogout(trigger) {
        const pending = hasPendingSos();
        openConfirm({
            trigger,
            tone: 'is-neutral',
            iconName: 'sign-out',
            title: '¿Cerrar sesión?',
            description: 'Tendrá que volver a ingresar para seguir usando la app.',
            warning: pending ? 'Tiene una alerta SOS pendiente de enviarse. Si cierra sesión, no se enviará hasta que vuelva a iniciar sesión en este teléfono. Si es una emergencia, llame al 123.' : '',
            confirmLabel: pending ? 'Cerrar sesión de todos modos' : 'Cerrar sesión',
            cancelLabel: 'Seguir conectado',
            onConfirm: () => window.app.logout()
        });
    }

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

    return { tripProgressHtml, openReportSheet, syncSos, activate, confirmLogout, REPORTS };
})();

/**
 * Hojas inferiores (bottom sheets) y diálogos. En el teléfono suben desde abajo con la curva de las hojas de iOS y se
 * cierran arrastrando hacia abajo; en pantallas anchas aparecen como diálogo centrado.
 *
 *  Sheet.open({ title, subtitle, icon, tone, body, actions, dismissible, draggable, onMount }) -> Promise<valor|null>
 *  Sheet.confirm({ title, message, confirmLabel, tone })                                       -> Promise<boolean>
 *  Sheet.prompt({ title, message, placeholder, suggestions, required, confirmLabel })          -> Promise<string|null>
 *  Sheet.explainError(error, contexto)  -> muestra un diálogo comprensible para 401/403/409; true si lo manejó.
 *
 * Se montan en <body>: las vistas se re-renderizan completas en cada setState y no deben llevárselas.
 */
window.Sheet = (function () {
    const esc = (value) => window.ui.escape(value);
    // Ícono de la hoja sobre una superficie neutra; el significado lo da el color del ícono (advertencia u ok), nunca un
    // fondo teñido. Una acción destructiva (rechazar, cancelar) no es una emergencia: no va en rojo, que es del SOS.
    const TONES = {
        primary: 'text-slate-100 bg-slate-800 border-transparent',
        warning: 'text-warn-500 bg-slate-800 border-transparent',
        danger: 'text-warn-500 bg-slate-800 border-transparent',
        success: 'text-ok-500 bg-slate-800 border-transparent'
    };
    const BUTTONS = {
        primary: 'btn-cta',
        success: 'btn-cta',
        danger: 'btn-secondary w-full',
        secondary: 'btn-secondary w-full'
    };
    let openCount = 0;

    function open(options) {
        const opts = { dismissible: true, draggable: true, actions: [], ...options };
        return new Promise((resolve) => {
            const previousFocus = document.activeElement;
            const backdrop = document.createElement('div');
            backdrop.className = 'sheet-backdrop';
            backdrop.innerHTML = `
                <div class="sheet" role="dialog" aria-modal="true" aria-labelledby="sheet-title-${++openCount}">
                    <div class="sheet-handle" aria-hidden="true"></div>
                    <div class="sheet-body">
                        <div class="sheet-head">
                            ${opts.icon ? `<div class="w-11 h-11 shrink-0 rounded-2xl border grid place-items-center text-lg ${TONES[opts.tone] || TONES.primary}"><i class="fas ${opts.icon}"></i></div>` : ''}
                            <div class="min-w-0 flex-1">
                                <h2 id="sheet-title-${openCount}" class="sheet-title"></h2>
                                ${opts.subtitle ? '<p class="sheet-subtitle"></p>' : ''}
                            </div>
                            ${opts.dismissible ? '<button type="button" data-sheet-close class="header-icon-btn" aria-label="Cerrar"><svg class="ui-icon" aria-hidden="true"><use href="assets/icons.svg#x"></use></svg></button>' : ''}
                        </div>
                        <div class="sheet-content"></div>
                        ${opts.actions.length ? `<div class="sheet-actions grid gap-2.5 pt-4">${opts.actions.map((a, i) => `
                            <button type="button" data-sheet-action="${i}" class="${BUTTONS[a.tone] || BUTTONS.secondary}">
                                ${a.icon ? `<i class="fas ${a.icon}"></i>` : ''}<span></span>
                            </button>`).join('')}</div>` : ''}
                    </div>
                </div>`;
            backdrop.querySelector('h2').textContent = opts.title;
            if (opts.subtitle) backdrop.querySelector('.sheet-subtitle').textContent = opts.subtitle;
            const content = backdrop.querySelector('.sheet-content');
            if (typeof opts.body === 'string') content.innerHTML = opts.body;
            else if (opts.body instanceof Node) content.appendChild(opts.body);
            opts.actions.forEach((a, i) => {
                backdrop.querySelector(`[data-sheet-action="${i}"] span`).textContent = a.label;
            });

            const sheet = backdrop.querySelector('.sheet');
            let closed = false;
            const close = (value) => {
                if (closed) return;
                closed = true;
                document.removeEventListener('keydown', onKey);
                backdrop.classList.remove('is-open');
                sheet.style.transform = '';
                setTimeout(() => backdrop.remove(), 430);
                if (previousFocus && previousFocus.focus) previousFocus.focus({ preventScroll: true });
                resolve(value === undefined ? null : value);
            };
            const onKey = (event) => { if (event.key === 'Escape' && opts.dismissible) close(null); };
            document.addEventListener('keydown', onKey);

            // Solo cierra un toque que empezó en el fondo: el click sintético al soltar el dedo que abrió la hoja (p. ej.
            // tras mantener el SOS) cae sobre el fondo y no debe cerrarla.
            let pressedBackdrop = false;
            backdrop.addEventListener('pointerdown', (event) => { pressedBackdrop = event.target === backdrop; });
            backdrop.addEventListener('click', (event) => {
                if (event.target === backdrop && pressedBackdrop && opts.dismissible) close(null);
                pressedBackdrop = false;
            });
            backdrop.querySelectorAll('[data-sheet-close]').forEach(b => b.addEventListener('click', () => close(null)));
            opts.actions.forEach((a, i) => {
                backdrop.querySelector(`[data-sheet-action="${i}"]`).addEventListener('click', async () => {
                    if (a.onClick) {
                        const result = await a.onClick(sheet);
                        if (result === false) return; // la acción pidió mantener la hoja abierta (p. ej. validación)
                    }
                    close(a.value === undefined ? i : a.value);
                });
            });
            if (opts.draggable && opts.dismissible) bindDrag(backdrop, sheet, () => close(null));

            document.body.appendChild(backdrop);
            if (opts.onMount) opts.onMount(sheet, close);
            // Doble frame: el estado inicial (fuera de pantalla) se pinta antes de transicionar.
            requestAnimationFrame(() => requestAnimationFrame(() => {
                backdrop.classList.add('is-open');
                const focusTarget = sheet.querySelector('[autofocus], input, textarea, [data-sheet-action]');
                if (focusTarget) focusTarget.focus({ preventScroll: true });
            }));
        });
    }

    /**
     * Arrastrar la manija (o la cabecera) hacia abajo cierra la hoja. Hacia arriba hay resistencia, como en iOS.
     * Se cierra si se arrastró más del 30 % de la altura o con un gesto rápido (> 0,5 px/ms).
     */
    function bindDrag(backdrop, sheet, onClose) {
        const handle = sheet.querySelector('.sheet-handle');
        let startY = 0;
        let startTime = 0;
        let dy = 0;
        let dragging = false;
        const onDown = (event) => {
            if (window.matchMedia('(min-width: 768px)').matches) return;
            if (event.target.closest('button, input, textarea, select, canvas, a')) return;
            dragging = true;
            startY = event.clientY;
            startTime = performance.now();
            dy = 0;
            sheet.setPointerCapture(event.pointerId);
            sheet.classList.add('is-dragging');
        };
        const onMove = (event) => {
            if (!dragging) return;
            const raw = event.clientY - startY;
            dy = raw > 0 ? raw : raw / 6; // resistencia al subir
            sheet.style.transform = `translateY(${dy}px)`;
            backdrop.style.opacity = String(Math.max(0.35, 1 - Math.max(0, dy) / (sheet.offsetHeight * 1.4)));
        };
        const onUp = () => {
            if (!dragging) return;
            dragging = false;
            sheet.classList.remove('is-dragging');
            backdrop.style.opacity = '';
            const velocity = dy / Math.max(1, performance.now() - startTime);
            if (dy > sheet.offsetHeight * 0.3 || velocity > 0.5) {
                onClose();
                return;
            }
            sheet.style.transform = '';
        };
        handle.addEventListener('pointerdown', onDown);
        sheet.querySelector('.sheet-body > div').addEventListener('pointerdown', onDown); // la cabecera también
        sheet.addEventListener('pointermove', onMove);
        sheet.addEventListener('pointerup', onUp);
        sheet.addEventListener('pointercancel', onUp);
    }

    function confirm({ title, message, confirmLabel = 'Confirmar', cancelLabel = 'Cancelar', tone = 'primary', icon }) {
        return open({
            title,
            subtitle: message,
            icon: icon || (tone === 'danger' ? 'fa-triangle-exclamation' : 'fa-circle-question'),
            tone: tone === 'danger' ? 'danger' : tone,
            actions: [
                { label: confirmLabel, tone: tone === 'danger' ? 'danger' : 'primary', value: true },
                { label: cancelLabel, tone: 'secondary', value: false }
            ]
        }).then(value => value === true);
    }

    /** Pide un texto (motivo de rechazo, de cancelación…) con sugerencias de un toque. */
    function prompt({ title, message, placeholder = '', suggestions = [], required = true, confirmLabel = 'Enviar', tone = 'primary', icon = 'fa-pen' }) {
        const body = document.createElement('div');
        body.className = 'space-y-3';
        body.innerHTML = `
            ${suggestions.length ? `<div class="flex flex-wrap gap-2">${suggestions.map((s, i) =>
                `<button type="button" data-suggestion="${i}" class="chip !py-2 !px-3 text-slate-200">${esc(s)}</button>`).join('')}</div>` : ''}
            <textarea rows="3" maxlength="500" class="login-input w-full text-sm resize-none" enterkeyhint="done"></textarea>
            <p class="field-hint" aria-live="polite"></p>`;
        const textarea = body.querySelector('textarea');
        textarea.placeholder = placeholder;
        body.querySelectorAll('[data-suggestion]').forEach(chip => chip.addEventListener('click', () => {
            textarea.value = suggestions[Number(chip.dataset.suggestion)];
            body.querySelectorAll('[data-suggestion]').forEach(c => c.classList.toggle('!border-brand-500', c === chip));
            body.querySelector('.field-hint').textContent = '';
        }));
        return open({
            title, subtitle: message, icon, tone, body,
            actions: [
                {
                    label: confirmLabel, tone: tone === 'danger' ? 'danger' : 'primary',
                    onClick: () => {
                        if (required && !textarea.value.trim()) {
                            body.querySelector('.field-hint').textContent = 'Este campo es obligatorio.';
                            textarea.setAttribute('aria-invalid', 'true');
                            textarea.focus();
                            return false;
                        }
                        return true;
                    },
                    value: '__submit__'
                },
                { label: 'Cancelar', tone: 'secondary', value: null }
            ]
        }).then(value => (value === '__submit__' ? textarea.value.trim() : null));
    }

    /**
     * Errores que el usuario puede entender y resolver: sesión vencida (401), permiso (403) y conflicto de estado (409,
     * p. ej. la carga ya la tomó otro conductor). El resto lo muestra quien llama como toast.
     */
    function explainError(error, context = 'la operación') {
        const status = error && error.status;
        const trace = error && error.correlationId ? `Referencia de soporte: ${String(error.correlationId).slice(0, 8)}` : '';
        const detail = (error && error.message) || '';
        if (status === 409) {
            open({
                title: 'Alguien llegó primero',
                subtitle: `No se pudo completar ${context}: el estado cambió mientras tanto (por ejemplo, otro conductor aceptó la carga o el viaje ya avanzó).`,
                icon: 'fa-code-compare', tone: 'warning',
                body: `<p class="text-[12px] text-slate-400 leading-relaxed">${esc(detail)}${trace ? '<br>' + esc(trace) : ''}</p>`,
                actions: [{ label: 'Actualizar datos', tone: 'primary', icon: 'fa-rotate', onClick: () => window.app.reloadData() }]
            });
            return true;
        }
        if (status === 403) {
            open({
                title: 'Sin permiso para esta acción',
                subtitle: `Su cuenta no puede realizar ${context}. Si cree que es un error, pida a un administrador que revise su rol.`,
                icon: 'fa-lock', tone: 'danger',
                body: trace ? `<p class="text-[12px] text-slate-400">${esc(trace)}</p>` : '',
                actions: [{ label: 'Entendido', tone: 'secondary' }]
            });
            return true;
        }
        if (status === 401) {
            open({
                title: 'Su sesión terminó',
                subtitle: 'Por seguridad, la sesión se cierra cuando no se puede renovar. Inicie sesión de nuevo; lo guardado sin señal se conserva en el teléfono.',
                icon: 'fa-user-lock', tone: 'warning',
                actions: [{ label: 'Iniciar sesión', tone: 'primary', icon: 'fa-right-to-bracket' }]
            });
            return true;
        }
        return false;
    }

    return { open, confirm, prompt, explainError };
})();

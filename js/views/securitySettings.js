// Seguridad de la cuenta: doble autenticación (TOTP) para cualquier rol. Se abre desde Vehículo (conductor) o desde el
// botón Seguridad del encabezado (torre, generador, transportadora). Una sola hoja con pasos:
// estado → QR y clave manual → primer código → códigos de respaldo (una única vez) / desactivar con la contraseña.
window.TwoFactorUI = (function () {
    const esc = (value) => window.ui.escape(value);
    const icon = (name) => `<svg class="ui-icon" aria-hidden="true"><use href="assets/icons.svg#${name}"></use></svg>`;

    function enabled(user) {
        return Boolean(user && user.twoFactorEnabled);
    }

    function statusLabel(user) {
        return enabled(user) ? 'Activa' : 'Desactivada';
    }

    /** Clave Base32 en grupos de 4 para copiarla a mano sin errores. */
    function groupSecret(secret) {
        return String(secret || '').replace(/(.{4})/g, '$1 ').trim();
    }

    /** Texto del archivo descargable con los códigos de respaldo. */
    function backupCodesText(codes, email) {
        return ['Códigos de respaldo de TruckCar', 'Cuenta: ' + (email || ''), 'Generados: ' + new Date().toLocaleString('es-CO'), '',
            'Cada código sirve una sola vez para entrar si no tiene su app autenticadora.', '',
            ...codes.map((code, i) => (i + 1) + '. ' + code), ''].join('\n');
    }

    function statusHtml(user) {
        return enabled(user)
            ? `<div class="notice" data-2fa-status="on"><div class="warn-line">${icon('check-circle-fill')}<span>Verificación en dos pasos activa</span></div>
                   <p>Al iniciar sesión se pide el código de su app autenticadora además de la contraseña.</p></div>
               <label class="field"><span class="field-label">Contraseña actual</span>
                   <input name="password" type="password" autocomplete="current-password" class="field-input" data-2fa-password></label>
               <p class="field-help">Para desactivarla escriba su contraseña. Se cerrarán sus sesiones en otros dispositivos.</p>
               <div class="hidden text-xs text-warn-500" data-2fa-error role="alert"></div>
               <button type="button" class="btn-quiet" data-2fa-action="disable">Desactivar la verificación en dos pasos</button>`
            : `<div class="notice" data-2fa-status="off"><div class="warn-line">${icon('warning-fill')}<span>Verificación en dos pasos desactivada</span></div>
                   <p>Agregue una segunda protección: además de la contraseña, un código que genera una app en su teléfono
                   (Google Authenticator, Authy o Microsoft Authenticator). Funciona sin SMS ni correo.</p></div>
               <div class="hidden text-xs text-warn-500" data-2fa-error role="alert"></div>
               <button type="button" class="btn-accent" data-2fa-action="setup">${icon('lock')}Activar la verificación en dos pasos</button>`;
    }

    function setupHtml(setup) {
        return `<ol class="two-factor-steps">
                <li>Abra su app autenticadora y escanee este código QR.</li>
            </ol>
            <img src="${esc(setup.qrImage)}" alt="Código QR para la app autenticadora" class="two-factor-qr" width="200" height="200">
            <p class="field-help">¿No puede escanear? Escriba esta clave en la app (cuenta TruckCar, basada en tiempo):</p>
            <div class="two-factor-secret"><code data-2fa-secret>${esc(groupSecret(setup.secret))}</code>
                <button type="button" class="btn-quiet" data-2fa-action="copy-secret">${icon('copy')}Copiar</button></div>
            <label class="field"><span class="field-label">Código de 6 dígitos que muestra la app</span>
                <input name="code" type="text" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" autocomplete="one-time-code"
                    enterkeyhint="done" class="field-input two-factor-input" data-2fa-code></label>
            <div class="hidden text-xs text-warn-500" data-2fa-error role="alert"></div>
            <button type="button" class="btn-accent" data-2fa-action="verify">${icon('check')}Confirmar y activar</button>`;
    }

    function backupHtml(codes) {
        return `<div class="notice" data-2fa-status="codes"><div class="warn-line">${icon('warning-fill')}<span>Guarde estos códigos ahora</span></div>
                <p>Si pierde el teléfono, cada código le deja entrar una vez. No se volverán a mostrar.</p></div>
            <ol class="two-factor-codes" data-2fa-codes>${codes.map(code => `<li><code>${esc(code)}</code></li>`).join('')}</ol>
            <div class="two-factor-row">
                <button type="button" class="btn-quiet" data-2fa-action="copy-codes">${icon('copy')}Copiar</button>
                <button type="button" class="btn-quiet" data-2fa-action="download-codes">${icon('download-simple')}Descargar</button>
            </div>`;
    }

    async function copy(text, done) {
        try {
            await navigator.clipboard.writeText(text);
            window.ui.toast(done, 'success');
        } catch (e) {
            window.ui.toast('No se pudo copiar: selecciónelo y cópielo a mano.', 'warning');
        }
    }

    function download(text) {
        const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
        const link = document.createElement('a');
        link.href = url;
        link.download = 'truckcar-codigos-de-respaldo.txt';
        document.body.appendChild(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    }

    function showError(body, error) {
        const box = body.querySelector('[data-2fa-error]');
        if (!box) return;
        box.textContent = typeof error === 'string' ? error : window.ui.errorMessage(error);
        box.classList.remove('hidden');
    }

    async function refreshUser() {
        try { await window.TruckCarService.loadCurrentUser(); } catch (e) { }
        window.store.setState({});
    }

    function open() {
        const user = window.store.state.currentUser;
        const body = document.createElement('div');
        body.className = 'space-y-3 text-left two-factor';
        let setup = null;
        let codes = null;
        const render = (html) => { body.innerHTML = html; const field = body.querySelector('input'); if (field) field.focus({ preventScroll: true }); };
        render(statusHtml(user));

        body.addEventListener('click', async (event) => {
            const button = event.target.closest('[data-2fa-action]');
            if (!button || button.disabled) return;
            const action = button.dataset['2faAction'];
            if (action === 'copy-secret') return copy(setup.secret, 'Clave copiada.');
            if (action === 'copy-codes') return copy(codes.join('\n'), 'Códigos copiados.');
            if (action === 'download-codes') return download(backupCodesText(codes, user && user.email));
            button.disabled = true;
            try {
                if (action === 'setup') {
                    setup = await window.TruckCarApi.auth.twoFactor.setup();
                    render(setupHtml(setup));
                } else if (action === 'verify') {
                    const code = body.querySelector('[data-2fa-code]').value.trim();
                    if (!/^\d{6}$/.test(code)) {
                        showError(body, 'Escriba los 6 dígitos que muestra la app.');
                        return;
                    }
                    const result = await window.TruckCarApi.auth.twoFactor.verifySetup(code);
                    codes = result.backupCodes || [];
                    render(backupHtml(codes));
                    window.ui.toast('Verificación en dos pasos activada.', 'success');
                    refreshUser();
                } else if (action === 'disable') {
                    const password = body.querySelector('[data-2fa-password]').value;
                    if (!password) {
                        showError(body, 'Escriba su contraseña para desactivarla.');
                        return;
                    }
                    await window.TruckCarApi.auth.twoFactor.disable({ password });
                    window.ui.toast('Verificación en dos pasos desactivada.', 'success');
                    await refreshUser();
                    render(statusHtml(window.store.state.currentUser));
                }
            } catch (error) {
                showError(body, error);
            } finally {
                button.disabled = false;
            }
        });
        body.addEventListener('keydown', (event) => {
            if (event.key !== 'Enter' || event.target.tagName !== 'INPUT') return;
            event.preventDefault();
            const primary = body.querySelector('[data-2fa-action="verify"], [data-2fa-action="disable"]');
            if (primary) primary.click();
        });

        return window.Sheet.open({
            title: 'Seguridad de la cuenta',
            subtitle: 'Verificación en dos pasos con una app autenticadora.',
            icon: 'fa-shield-halved',
            body,
            actions: [{ label: 'Cerrar', tone: 'secondary', value: null }]
        });
    }

    return { open, statusLabel, groupSecret, backupCodesText, statusHtml, setupHtml, backupHtml };
})();

window.LoginView = {
    /**
     * Panel de marca: solo se ve en pantallas anchas (computador y tableta horizontal, css/main.css), a la izquierda del
     * formulario. En el celular queda oculto y el formulario ocupa toda la pantalla, como antes.
     */
    brandPanel() {
        const point = (icon, title, text) => `<li><svg class="ui-icon" aria-hidden="true"><use href="assets/icons.svg#${icon}"></use></svg>
            <span><strong>${title}</strong>${text}</span></li>`;
        return `
            <aside class="login-aside" aria-label="Qué es TruckCar">
                <img src="assets/brand/truckcar-logo-blanco.png" alt="TruckCar" class="login-aside-logo" width="854" height="831">
                <p class="login-aside-title">Transporte de carga pesada, conectado de la bodega a la entrega.</p>
                <ul class="login-aside-points">
                    ${point('path', 'Rutas para su camión', 'Calculadas con su altura, peso y ejes, con peajes y restricciones de la vía.')}
                    ${point('microphone', 'Copiloto por voz', 'Reportes, paradas y alertas sin soltar el volante.')}
                    ${point('cloud-arrow-down', 'Funciona sin señal', 'Guarda la ruta y las entregas, y sincroniza cuando vuelve la conexión.')}
                    ${point('truck', 'Torre de control', 'La flota, las cargas y los SOS en vivo para la transportadora.')}
                </ul>
            </aside>`;
    },

    render(state) {
        if (state.authMode === '2fa' && state.twoFactor) return this.renderTwoFactor(state);
        if (state.authMode === 'forgot' && state.passwordReset) return this.renderPasswordReset(state);
        const isRegister = state.authMode === 'register';
        const busy = state.busyAction === 'auth';
        const config = window.TruckCarConfig;
        const esc = window.ui.escape;
        const icon = (name) => `<svg class="ui-icon" aria-hidden="true"><use href="assets/icons.svg#${name}"></use></svg>`;
        const field = (label, input, hint = '') => `<label class="field"><span class="field-label">${label}</span>${input}${hint}</label>`;

        return `
            <div data-screen class="login-screen">${this.brandPanel()}
                <form onsubmit="window.app.${isRegister ? 'submitRegister' : 'submitLogin'}(event)" class="login-form" novalidate>
                    <span class="brand-logo login-mark">
                        <img src="assets/brand/truckcar-logo.png" alt="TruckCar" class="brand-logo-light" width="854" height="831">
                        <img src="assets/brand/truckcar-logo-blanco.png" alt="TruckCar" class="brand-logo-dark" width="854" height="831">
                    </span>
                    <h1>${isRegister ? 'Cree su cuenta en TruckCar' : 'Inicie sesión en TruckCar'}</h1>
                    <p class="login-lead">${isRegister
                        ? 'Para conductores, transportadoras y empresas que generan carga.'
                        : 'Cargas, ruta segura para su vehículo y entregas con prueba, incluso sin señal.'}</p>

                    ${config.gatewayUrl ? '' : `
                        <div class="notice login-error" role="alert">
                            <div class="warn-line">${icon('warning-fill')}<span>Esta instalación no tiene configurada la dirección del servidor. Pida una versión actualizada de la aplicación.</span></div>
                        </div>`}

                    ${state.authError ? `
                        <div class="notice login-error" role="alert">
                            <div class="warn-line">${icon('warning-fill')}<span>${esc(state.authError)}</span></div>
                        </div>` : ''}
                    ${state.authNotice && !isRegister ? `
                        <div class="notice login-error login-ok" role="status">
                            <div class="warn-line">${icon('check-circle-fill')}<span>${esc(state.authNotice)}</span></div>
                        </div>` : ''}

                    ${isRegister ? `
                        <div class="login-pair">
                            ${field('Nombre', '<input name="firstName" required autocomplete="given-name" autocapitalize="words" enterkeyhint="next" class="field-input">')}
                            ${field('Apellido', '<input name="lastName" required autocomplete="family-name" autocapitalize="words" enterkeyhint="next" class="field-input">')}
                        </div>
                        ${field('Teléfono <span class="field-req">· opcional</span>', '<input name="phoneNumber" type="tel" inputmode="tel" autocomplete="tel" enterkeyhint="next" class="field-input">')}
                        ${field('Tipo de cuenta', `<select name="accountType" required class="field-input" onchange="window.LoginView.onAccountType(this)">
                                ${this.ACCOUNT_TYPES.map(t => `<option value="${t.value}">${t.label}</option>`).join('')}
                            </select>`, `<p class="field-help" data-account-help>${esc(this.ACCOUNT_TYPES[0].help)}</p>`)}
                        <div data-account-group="CONDUCTOR_EMPRESA" hidden>
                            ${field('Transportadora', `<select name="companyId" required disabled class="field-input" data-company-select>
                                    <option value="">Cargando transportadoras…</option>
                                </select>`, '<p class="field-help">Su empresa debe aprobar la afiliación para que usted reciba cargas.</p>')}
                        </div>
                        <div data-account-group="TRANSPORTADORA" hidden>
                            ${field('Razón social de la empresa', '<input name="companyName" required disabled maxlength="150" autocomplete="organization" class="field-input">')}
                            ${field('NIT', '<input name="companyNit" required disabled inputmode="numeric" maxlength="20" placeholder="900123456-7" class="field-input">')}
                        </div>
                    ` : ''}

                    ${field('Correo', `<input name="email" type="email" inputmode="email" required autocomplete="username" autocapitalize="none" autocorrect="off" spellcheck="false" enterkeyhint="next" placeholder="correo@empresa.com" class="field-input" value="${esc(isRegister ? '' : state.loginEmail || '')}">`)}
                    <label class="field">
                        <span class="field-label">Contraseña${isRegister ? ' <span class="field-req">· mínimo 8 caracteres</span>' : ''}</span>
                        <span class="login-password">
                            <input id="login-password" name="password" type="password" required minlength="${isRegister ? 8 : 1}" autocomplete="${isRegister ? 'new-password' : 'current-password'}" enterkeyhint="go" class="field-input">
                            <button type="button" class="header-icon-btn" aria-label="Mostrar la contraseña" aria-pressed="false"
                                    onclick="const i = document.getElementById('login-password'); const show = i.type === 'password'; i.type = show ? 'text' : 'password'; this.setAttribute('aria-pressed', String(show)); this.setAttribute('aria-label', show ? 'Ocultar la contraseña' : 'Mostrar la contraseña'); this.querySelector('use').setAttribute('href', 'assets/icons.svg#' + (show ? 'eye-slash' : 'eye'));">
                                ${icon('eye')}
                            </button>
                        </span>
                    </label>
                    ${isRegister ? '' : '<p class="login-forgot"><button type="button" onclick="window.app.startPasswordReset()">¿Olvidó su contraseña?</button></p>'}
                    ${isRegister ? '<p class="field-help">Las cuentas de coordinador (torre de control) las habilita un administrador. Un conductor de transportadora también puede ser registrado por su empresa.</p>' : ''}

                    <button type="submit" ${busy ? 'disabled' : ''} class="btn-accent login-submit">
                        ${busy ? '<span class="spinner" aria-hidden="true"></span>' : icon(isRegister ? 'user-plus' : 'sign-in')}
                        <span>${isRegister ? 'Crear mi cuenta' : 'Entrar'}</span>
                    </button>

                    <p class="login-alt">${isRegister ? '¿Ya tiene cuenta?' : '¿No tiene cuenta?'}
                        <button type="button" onclick="window.store.setState({ authMode: '${isRegister ? 'login' : 'register'}', authError: null })">${isRegister ? 'Iniciar sesión' : 'Registrarse'}</button>
                    </p>

                    ${config.demoTools ? `<p class="login-api">API: ${esc(config.apiBaseUrl)}</p><div class="pt-4 mt-4 border-t border-slate-800 text-center space-y-2">
                        <span class="text-xs text-slate-400 block font-medium">Modo demostración rápido (sin backend):</span>
                        <div class="flex items-center justify-center gap-2 flex-wrap">
                            <button type="button" onclick="window.app.startDemoSession('driver')" class="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 rounded-xl text-xs font-bold transition flex items-center gap-1.5">
                                <i class="fas fa-mobile-screen"></i> Ver como Conductor
                            </button>
                            <button type="button" onclick="window.app.startDemoSession('coordinator')" class="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 rounded-xl text-xs font-bold transition flex items-center gap-1.5">
                                <i class="fas fa-tower-broadcast"></i> Ver como Torre de Control
                            </button>
                        </div>
                    </div>` : ''}
                </form>
            </div>
        `;
    },

    /** Paso 2 del login con doble autenticación: código de 6 dígitos o código de respaldo. */
    renderTwoFactor(state) {
        const esc = window.ui.escape;
        const busy = state.busyAction === 'auth';
        const pending = state.twoFactor;
        const icon = (name) => `<svg class="ui-icon" aria-hidden="true"><use href="assets/icons.svg#${name}"></use></svg>`;
        const input = pending.backup
            ? '<input id="two-factor-code" name="code" type="text" required maxlength="9" autocomplete="off" autocapitalize="characters" autocorrect="off" spellcheck="false" enterkeyhint="go" placeholder="ABCD-2345" class="field-input two-factor-input" aria-describedby="two-factor-help">'
            : '<input id="two-factor-code" name="code" type="text" required inputmode="numeric" pattern="[0-9]{6}" maxlength="6" autocomplete="one-time-code" enterkeyhint="go" placeholder="123456" class="field-input two-factor-input" aria-describedby="two-factor-help">';
        return `
            <div data-screen class="login-screen">${this.brandPanel()}
                <form onsubmit="window.app.submitTwoFactor(event)" class="login-form" novalidate data-two-factor>
                    <span class="brand-logo login-mark">
                        <img src="assets/brand/truckcar-logo.png" alt="TruckCar" class="brand-logo-light" width="854" height="831">
                        <img src="assets/brand/truckcar-logo-blanco.png" alt="TruckCar" class="brand-logo-dark" width="854" height="831">
                    </span>
                    <h1>Verificación en dos pasos</h1>
                    <p class="login-lead">${pending.backup
                        ? 'Escriba uno de los códigos de respaldo que guardó al activar la verificación. Cada uno sirve una sola vez.'
                        : 'Abra su app autenticadora (Google Authenticator, Authy o Microsoft Authenticator) y escriba el código de 6 dígitos de TruckCar.'}</p>
                    ${state.authError ? `
                        <div class="notice login-error" role="alert">
                            <div class="warn-line">${icon('warning-fill')}<span>${esc(state.authError)}</span></div>
                        </div>` : ''}
                    <label class="field">
                        <span class="field-label">${pending.backup ? 'Código de respaldo' : 'Código de verificación'}</span>
                        ${input}
                    </label>
                    <p id="two-factor-help" class="field-help">Cuenta: ${esc(pending.email || '')}</p>
                    <button type="submit" ${busy ? 'disabled' : ''} class="btn-accent login-submit">
                        ${busy ? '<span class="spinner" aria-hidden="true"></span>' : icon('sign-in')}
                        <span>Verificar y entrar</span>
                    </button>
                    <p class="login-alt">
                        <button type="button" onclick="window.app.toggleBackupCode()">${pending.backup ? 'Usar el código de la app' : 'Usar un código de respaldo'}</button>
                    </p>
                    <p class="login-alt">
                        <button type="button" onclick="window.app.cancelTwoFactor()">Volver al inicio de sesión</button>
                    </p>
                </form>
            </div>
        `;
    },

    /**
     * Recuperar la contraseña en tres pasos: correo → código de 6 dígitos que llega al correo → contraseña nueva.
     * El correo de confirmación no dice si la cuenta existe (el servidor responde igual en ambos casos).
     */
    renderPasswordReset(state) {
        const esc = window.ui.escape;
        const busy = state.busyAction === 'auth';
        const reset = state.passwordReset;
        const icon = (name) => `<svg class="ui-icon" aria-hidden="true"><use href="assets/icons.svg#${name}"></use></svg>`;
        const field = (label, input, hint = '') => `<label class="field"><span class="field-label">${label}</span>${input}${hint}</label>`;
        const submit = (text, iconName) => `
            <button type="submit" ${busy ? 'disabled' : ''} class="btn-accent login-submit">
                ${busy ? '<span class="spinner" aria-hidden="true"></span>' : icon(iconName)}<span>${text}</span>
            </button>`;
        const error = state.authError ? `
            <div class="notice login-error" role="alert">
                <div class="warn-line">${icon('warning-fill')}<span>${esc(state.authError)}</span></div>
            </div>` : '';
        const back = `<p class="login-alt"><button type="button" onclick="window.app.cancelPasswordReset()">Volver al inicio de sesión</button></p>`;
        const password = (id, name, label, help) => `
            <label class="field">
                <span class="field-label">${label}</span>
                <span class="login-password">
                    <input id="${id}" name="${name}" type="password" required minlength="8" maxlength="72" autocomplete="new-password" enterkeyhint="next" class="field-input"${help ? ' aria-describedby="' + id + '-help"' : ''}>
                    <button type="button" class="header-icon-btn" aria-label="Mostrar la contraseña" aria-pressed="false"
                            onclick="const i = document.getElementById('${id}'); const show = i.type === 'password'; i.type = show ? 'text' : 'password'; this.setAttribute('aria-pressed', String(show)); this.setAttribute('aria-label', show ? 'Ocultar la contraseña' : 'Mostrar la contraseña'); this.querySelector('use').setAttribute('href', 'assets/icons.svg#' + (show ? 'eye-slash' : 'eye'));">
                        ${icon('eye')}
                    </button>
                </span>
                ${help ? `<span id="${id}-help" class="field-help">${help}</span>` : ''}
            </label>`;

        let body;
        if (reset.step === 'code') {
            const wait = Math.max(0, Math.ceil((reset.resendAt - Date.now()) / 1000));
            body = `
                <h1>Revise su correo</h1>
                <p class="login-lead">Si <strong>${esc(reset.email)}</strong> tiene una cuenta, le enviamos un código de 6 dígitos. Vence en 10 minutos; revise también la carpeta de spam.</p>
                ${error}
                <form onsubmit="window.app.submitResetCode(event)" class="login-form-step" novalidate data-reset-step="code">
                    ${field('Código del correo', '<input id="reset-code" name="code" type="text" required inputmode="numeric" pattern="[0-9]{6}" maxlength="6" autocomplete="one-time-code" enterkeyhint="go" placeholder="123456" class="field-input two-factor-input">')}
                    ${submit('Verificar código', 'check')}
                </form>
                <p class="login-alt">${wait > 0
                    ? `<span data-reset-wait>Puede pedir otro código en ${wait} s</span>`
                    : '<button type="button" onclick="window.app.resendResetCode()" data-reset-resend>Enviarme otro código</button>'}</p>
                <p class="login-alt"><button type="button" onclick="window.app.startPasswordReset()">Cambiar el correo</button></p>`;
        } else if (reset.step === 'password') {
            body = `
                <h1>Cree una contraseña nueva</h1>
                <p class="login-lead">Para ${esc(reset.email)}. Al guardarla se cerrará la sesión en los demás dispositivos.</p>
                ${error}
                <form onsubmit="window.app.submitNewPassword(event)" class="login-form-step" novalidate data-reset-step="password">
                    ${password('reset-password', 'newPassword', 'Contraseña nueva <span class="field-req">· mínimo 8 caracteres</span>', '')}
                    ${password('reset-password-confirm', 'confirmPassword', 'Repita la contraseña nueva', '')}
                    ${submit('Guardar contraseña', 'lock')}
                </form>`;
        } else {
            body = `
                <h1>¿Olvidó su contraseña?</h1>
                <p class="login-lead">Escriba el correo de su cuenta y le enviaremos un código de 6 dígitos para crear una contraseña nueva.</p>
                ${error}
                <form onsubmit="window.app.submitResetEmail(event)" class="login-form-step" novalidate data-reset-step="email">
                    ${field('Correo', `<input id="reset-email" name="email" type="email" inputmode="email" required autocomplete="username" autocapitalize="none" autocorrect="off" spellcheck="false" enterkeyhint="send" placeholder="correo@empresa.com" class="field-input" value="${esc(reset.email || '')}">`)}
                    ${submit('Enviarme el código', 'paper-plane-tilt')}
                </form>`;
        }
        return `
            <div data-screen class="login-screen">${this.brandPanel()}
                <div class="login-form" data-password-reset="${esc(reset.step)}">
                    <span class="brand-logo login-mark">
                        <img src="assets/brand/truckcar-logo.png" alt="TruckCar" class="brand-logo-light" width="854" height="831">
                        <img src="assets/brand/truckcar-logo-blanco.png" alt="TruckCar" class="brand-logo-dark" width="854" height="831">
                    </span>
                    ${body}
                    ${back}
                </div>
            </div>
        `;
    },

    ACCOUNT_TYPES: [
        { value: 'CONDUCTOR_INDEPENDIENTE', label: 'Conductor independiente',
            help: 'Navegación para camión, rutas seguras y alertas viales. No recibe cargas de la plataforma.' },
        { value: 'CONDUCTOR_EMPRESA', label: 'Conductor de una transportadora',
            help: 'Recibe las cargas de la plataforma cuando su transportadora aprueba la afiliación.' },
        { value: 'TRANSPORTADORA', label: 'Empresa transportadora',
            help: 'Registra a sus conductores y aprueba las solicitudes de afiliación.' },
        { value: 'GENERADOR', label: 'Generador de carga (empresa)',
            help: 'Publica cargas y sigue sus envíos en tiempo real.' }
    ],

    /** Muestra los campos del tipo de cuenta elegido; los ocultos quedan deshabilitados (no se validan ni se envían). */
    onAccountType(select) {
        const form = select.form;
        const type = select.value;
        form.querySelectorAll('[data-account-group]').forEach(group => {
            const visible = group.dataset.accountGroup === type;
            group.hidden = !visible;
            group.querySelectorAll('input, select').forEach(el => { el.disabled = !visible; });
        });
        const spec = this.ACCOUNT_TYPES.find(t => t.value === type);
        const help = form.querySelector('[data-account-help]');
        if (help && spec) help.textContent = spec.help;
        if (type === 'CONDUCTOR_EMPRESA') this.loadCompanies(form.querySelector('[data-company-select]'));
    },

    async loadCompanies(select) {
        if (!select || select.dataset.loaded === 'true') return;
        const option = (value, text) => {
            const el = document.createElement('option');
            el.value = value;
            el.textContent = text;
            return el;
        };
        try {
            const companies = await window.TruckCarService.loadCompanyCatalog();
            select.replaceChildren(option('', companies.length ? 'Elija su transportadora' : 'Aún no hay transportadoras registradas'),
                ...companies.map(c => option(c.id, c.name)));
            select.dataset.loaded = 'true';
        } catch (error) {
            select.replaceChildren(option('', 'No se pudieron cargar las transportadoras'));
        }
    },

    /** Cuerpo de POST /auth/register según el tipo de cuenta del formulario. */
    registrationPayload(form) {
        const text = (name) => String(form.get(name) || '').trim();
        const payload = {
            email: text('email'),
            password: form.get('password'),
            firstName: text('firstName'),
            lastName: text('lastName'),
            phoneNumber: text('phoneNumber') || null
        };
        switch (form.get('accountType')) {
            case 'CONDUCTOR_EMPRESA':
                return { ...payload, role: 'CONDUCTOR', driverType: 'EMPRESA', companyId: text('companyId') || null };
            case 'TRANSPORTADORA':
                return { ...payload, role: 'TRANSPORTADORA', companyName: text('companyName'), companyNit: text('companyNit') };
            case 'GENERADOR':
                return { ...payload, role: 'GENERADOR' };
            default:
                return { ...payload, role: 'CONDUCTOR', driverType: 'INDEPENDIENTE' };
        }
    }
};

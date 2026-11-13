window.LoginView = {
    render(state) {
        const isRegister = state.authMode === 'register';
        const busy = state.busyAction === 'auth';
        const config = window.TruckCarConfig;
        const esc = window.ui.escape;
        const icon = (name) => `<svg class="ui-icon" aria-hidden="true"><use href="assets/icons.svg#${name}"></use></svg>`;
        const field = (label, input, hint = '') => `<label class="field"><span class="field-label">${label}</span>${input}${hint}</label>`;

        return `
            <div data-screen class="login-screen">
                <form onsubmit="window.app.${isRegister ? 'submitRegister' : 'submitLogin'}(event)" class="login-form">
                    <span class="brand-logo login-mark">
                        <img src="assets/brand/truckcar-logo.png" alt="TruckCar" class="brand-logo-light" width="854" height="831">
                        <img src="assets/brand/truckcar-logo-blanco.png" alt="TruckCar" class="brand-logo-dark" width="854" height="831">
                    </span>
                    <h1>${isRegister ? 'Cree su cuenta en TruckCar' : 'Inicie sesión en TruckCar'}</h1>
                    <p class="login-lead">${isRegister
                        ? 'Para conductores y empresas que generan carga.'
                        : 'Cargas, ruta segura para su vehículo y entregas con prueba, incluso sin señal.'}</p>

                    ${config.gatewayUrl ? '' : `
                        <div class="notice login-error" role="alert">
                            <div class="warn-line">${icon('warning-fill')}<span>Esta instalación no tiene configurada la dirección del servidor. Pida una versión actualizada de la aplicación.</span></div>
                        </div>`}

                    ${state.authError ? `
                        <div class="notice login-error" role="alert">
                            <div class="warn-line">${icon('warning-fill')}<span>${esc(state.authError)}</span></div>
                        </div>` : ''}

                    ${isRegister ? `
                        <div class="login-pair">
                            ${field('Nombre', '<input name="firstName" required autocomplete="given-name" autocapitalize="words" enterkeyhint="next" class="field-input">')}
                            ${field('Apellido', '<input name="lastName" required autocomplete="family-name" autocapitalize="words" enterkeyhint="next" class="field-input">')}
                        </div>
                        ${field('Teléfono <span class="field-req">· opcional</span>', '<input name="phoneNumber" type="tel" inputmode="tel" autocomplete="tel" enterkeyhint="next" class="field-input">')}
                        ${field('Tipo de cuenta', `<select name="role" required class="field-input">
                                <option value="CONDUCTOR">Conductor</option>
                                <option value="GENERADOR">Generador de carga (empresa)</option>
                            </select>`)}
                    ` : ''}

                    ${field('Correo', '<input name="email" type="email" inputmode="email" required autocomplete="username" autocapitalize="none" autocorrect="off" spellcheck="false" enterkeyhint="next" placeholder="correo@empresa.com" class="field-input">')}
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
                    ${isRegister ? '<p class="field-help">Las cuentas de coordinador (torre de control) las habilita un administrador.</p>' : ''}

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
    }
};

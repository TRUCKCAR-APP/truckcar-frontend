window.LoginView = {
    render(state) {
        const isRegister = state.authMode === 'register';
        const busy = state.busyAction === 'auth';
        const config = window.TruckCarConfig;

        return `
            <div data-screen class="h-full w-full flex flex-col items-center justify-center bg-slate-950 px-5 overflow-y-auto"
                 style="padding-top: calc(24px + var(--safe-top)); padding-bottom: calc(24px + var(--safe-bottom)); background: radial-gradient(120% 60% at 50% 0%, rgba(37, 99, 235, 0.18), transparent 60%), var(--bg)">
                <form onsubmit="window.app.${isRegister ? 'submitRegister' : 'submitLogin'}(event)" class="w-full max-w-sm space-y-5">
                    <div class="text-center space-y-3">
                        <img src="assets/icon.svg" alt="" class="w-16 h-16 rounded-[20px] mx-auto shadow-2xl shadow-brand-900/60">
                        <div>
                            <h1 class="text-[26px] font-black text-white tracking-tight leading-tight">${isRegister ? 'Crear cuenta' : 'Bienvenido a TruckCar'}</h1>
                            <p class="text-[14px] text-slate-400 mt-1">${isRegister
                                ? 'Conductores y empresas generadoras de carga.'
                                : 'Rutas seguras, entregas firmadas y alertas viales, incluso sin señal.'}</p>
                        </div>
                    </div>

                    ${state.authError ? `
                        <div class="p-3 bg-rose-500/10 border border-rose-500/40 rounded-2xl text-[13px] text-rose-200 flex items-start gap-2" role="alert">
                            <i class="fas fa-circle-exclamation mt-0.5"></i>
                            <span>${window.ui.escape(state.authError)}</span>
                        </div>
                    ` : ''}

                    <div class="card p-4 space-y-3">
                        ${isRegister ? `
                            <div class="grid grid-cols-2 gap-2">
                                <input name="firstName" required autocomplete="given-name" autocapitalize="words" enterkeyhint="next" placeholder="Nombre" class="login-input w-full">
                                <input name="lastName" required autocomplete="family-name" autocapitalize="words" enterkeyhint="next" placeholder="Apellido" class="login-input w-full">
                            </div>
                            <input name="phoneNumber" type="tel" inputmode="tel" autocomplete="tel" enterkeyhint="next" placeholder="Teléfono (opcional)" class="login-input w-full">
                            <select name="role" required class="login-input w-full" aria-label="Tipo de cuenta">
                                <option value="CONDUCTOR">Conductor</option>
                                <option value="GENERADOR">Generador de carga (empresa)</option>
                            </select>
                        ` : ''}

                        <input name="email" type="email" inputmode="email" required autocomplete="username" autocapitalize="none" autocorrect="off" spellcheck="false" enterkeyhint="next" placeholder="correo@empresa.com" class="login-input w-full" aria-label="Correo electrónico">
                        <div class="relative">
                            <input id="login-password" name="password" type="password" required minlength="${isRegister ? 8 : 1}" autocomplete="${isRegister ? 'new-password' : 'current-password'}" enterkeyhint="go" placeholder="Contraseña${isRegister ? ' (mín. 8 caracteres)' : ''}" class="login-input w-full pr-12" aria-label="Contraseña">
                            <button type="button" onclick="const i = document.getElementById('login-password'); i.type = i.type === 'password' ? 'text' : 'password'; this.firstElementChild.className = 'fas ' + (i.type === 'password' ? 'fa-eye' : 'fa-eye-slash');"
                                    class="absolute right-1 top-1/2 -translate-y-1/2 w-10 h-10 grid place-items-center text-slate-400" aria-label="Mostrar u ocultar la contraseña">
                                <i class="fas fa-eye"></i>
                            </button>
                        </div>
                        ${isRegister ? '<p class="text-[12px] text-slate-400 leading-snug">Las cuentas de coordinador (torre de control) las habilita un administrador.</p>' : ''}
                    </div>

                    <button type="submit" ${busy ? 'disabled' : ''} class="btn-cta">
                        <i class="fas ${busy ? 'fa-circle-notch fa-spin' : (isRegister ? 'fa-user-plus' : 'fa-right-to-bracket')}"></i>
                        ${isRegister ? 'Crear mi cuenta' : 'Entrar'}
                    </button>

                    <button type="button" onclick="window.store.setState({ authMode: '${isRegister ? 'login' : 'register'}', authError: null })" class="w-full py-2 text-[14px] text-slate-300 font-semibold">
                        ${isRegister ? '¿Ya tiene cuenta? <span class="text-brand-400">Iniciar sesión</span>' : '¿No tiene cuenta? <span class="text-brand-400">Registrarse</span>'}
                    </button>

                    <p class="text-[10px] text-slate-500 font-mono text-center break-all">API: ${window.ui.escape(config.apiBaseUrl)}</p>
                </form>
            </div>
        `;
    }
};

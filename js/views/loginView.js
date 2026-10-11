window.LoginView = {
    render(state) {
        const isRegister = state.authMode === 'register';
        const busy = state.busyAction === 'auth';
        const config = window.TruckDarConfig;

        return `
            <div class="h-full w-full flex items-center justify-center bg-slate-950 p-4 overflow-y-auto">
                <form onsubmit="window.app.${isRegister ? 'submitRegister' : 'submitLogin'}(event)" class="w-full max-w-sm bg-slate-900 border border-slate-800 rounded-3xl p-6 shadow-2xl space-y-4">
                    <div class="flex items-center gap-3">
                        <div class="w-11 h-11 rounded-2xl bg-gradient-to-tr from-emerald-600 to-teal-500 flex items-center justify-center text-white shadow-lg">
                            <i class="fas fa-truck-fast text-lg"></i>
                        </div>
                        <div>
                            <h1 class="text-lg font-black text-white">${isRegister ? 'Crear cuenta' : 'Iniciar sesión'}</h1>
                            <p class="text-[11px] text-slate-400">Autenticación con User-Identity vía API Gateway</p>
                        </div>
                    </div>

                    ${state.authError ? `
                        <div class="p-2.5 bg-rose-500/10 border border-rose-500/40 rounded-xl text-xs text-rose-300 flex items-start gap-2">
                            <i class="fas fa-circle-exclamation mt-0.5"></i>
                            <span>${window.ui.escape(state.authError)}</span>
                        </div>
                    ` : ''}

                    ${isRegister ? `
                        <div class="grid grid-cols-2 gap-2">
                            <input name="firstName" required placeholder="Nombre" class="login-input">
                            <input name="lastName" required placeholder="Apellido" class="login-input">
                        </div>
                        <input name="phoneNumber" placeholder="Teléfono (opcional)" class="login-input w-full">
                        <select name="role" required class="login-input w-full">
                            <option value="CONDUCTOR">Conductor</option>
                            <option value="COORDINADOR">Coordinador (Torre de Control)</option>
                        </select>
                    ` : ''}

                    <input name="email" type="email" required autocomplete="username" placeholder="correo@empresa.com" class="login-input w-full">
                    <input name="password" type="password" required minlength="${isRegister ? 8 : 1}" autocomplete="${isRegister ? 'new-password' : 'current-password'}" placeholder="Contraseña${isRegister ? ' (mín. 8 caracteres)' : ''}" class="login-input w-full">

                    <button type="submit" ${busy ? 'disabled' : ''} class="w-full py-3 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-60 text-white rounded-2xl font-extrabold text-sm flex items-center justify-center gap-2 transition">
                        <i class="fas ${busy ? 'fa-spinner fa-spin' : (isRegister ? 'fa-user-plus' : 'fa-right-to-bracket')}"></i>
                        ${isRegister ? 'Registrarme' : 'Entrar'}
                    </button>

                    <button type="button" onclick="window.store.setState({ authMode: '${isRegister ? 'login' : 'register'}', authError: null })" class="w-full text-xs text-slate-400 hover:text-emerald-400">
                        ${isRegister ? '¿Ya tiene cuenta? Iniciar sesión' : '¿No tiene cuenta? Registrarse'}
                    </button>

                    <p class="text-[10px] text-slate-500 font-mono text-center break-all">API: ${config.apiBaseUrl}</p>
                </form>
            </div>
        `;
    }
};

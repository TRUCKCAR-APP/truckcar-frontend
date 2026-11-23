window.ui = {
    escape(value) {
        return String(value === null || value === undefined ? '' : value)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    },

    NOT_AVAILABLE: 'No disponible',

    orNotAvailable(value) {
        return value === null || value === undefined || value === '' ? this.NOT_AVAILABLE : value;
    },

    number(value, digits, unit) {
        if (typeof value !== 'number' || Number.isNaN(value)) return this.NOT_AVAILABLE;
        return value.toLocaleString('es-CO', { minimumFractionDigits: digits, maximumFractionDigits: digits }) + (unit ? ' ' + unit : '');
    },

    speedText(speed) {
        return typeof speed === 'number' ? speed + ' km/h' : 'Velocidad: ' + this.NOT_AVAILABLE;
    },

    fieldLabel(field) {
        const label = (field.labels && field.labels[0]) || null;
        if (label) {
            const copy = label.cloneNode(true);
            copy.querySelectorAll('input, select, textarea, button, .field-req').forEach(node => node.remove());
            const text = copy.textContent.replace(/\s+/g, ' ').trim();
            if (text) return text;
        }
        return field.getAttribute('aria-label') || field.name || field.id || 'campo';
    },

    fieldProblem(field) {
        const validity = field.validity;
        if (!validity || validity.valid) return null;
        const label = '«' + this.fieldLabel(field) + '»';
        if (validity.valueMissing) return 'Complete el campo ' + label + '.';
        if (validity.typeMismatch && field.type === 'email') return 'Escriba un correo válido en ' + label + ', por ejemplo nombre@empresa.com.';
        if (validity.tooShort) return 'El campo ' + label + ' debe tener al menos ' + field.minLength + ' caracteres.';
        if (validity.tooLong) return 'El campo ' + label + ' admite máximo ' + field.maxLength + ' caracteres.';
        if (validity.rangeUnderflow) return 'El valor de ' + label + ' debe ser ' + field.min + ' o más.';
        if (validity.rangeOverflow) return 'El valor de ' + label + ' debe ser ' + field.max + ' o menos.';
        if (validity.badInput || validity.stepMismatch) return 'Escriba un número válido en ' + label + '.';
        return 'Revise el campo ' + label + '.';
    },

    clearFormProblem(form) {
        form.querySelectorAll('[data-form-problem]').forEach(node => node.remove());
        form.querySelectorAll('[data-form-invalid]').forEach((field) => {
            field.removeAttribute('aria-invalid');
            field.removeAttribute('aria-describedby');
            field.removeAttribute('data-form-invalid');
        });
    },

    reportFormProblem(form) {
        this.clearFormProblem(form);
        const field = [...form.elements].find(el => el.willValidate && el.validity && !el.validity.valid);
        if (!field) return false;
        const hint = document.createElement('p');
        hint.className = 'field-hint';
        hint.id = 'form-problem-' + (field.name || field.id || 'campo');
        hint.setAttribute('role', 'alert');
        hint.setAttribute('data-form-problem', '');
        hint.textContent = this.fieldProblem(field);
        (field.closest('label') || field).insertAdjacentElement('afterend', hint);
        field.setAttribute('aria-invalid', 'true');
        field.setAttribute('aria-describedby', hint.id);
        field.setAttribute('data-form-invalid', '');
        field.focus();
        return true;
    },

    toast(message, type = 'info', options = {}) {
        if (!window.Toaster) return;
        window.Toaster.show({ title: message, type, ...options });
    },

    failure(title, error, context) {
        if (error && error.status === 401) return;
        if (window.Sheet && window.Sheet.explainError(error, context)) return;
        this.toast(title, 'error', { description: this.errorMessage(error) });
    },

    /**
     * Mensaje de un error para el usuario, en palabras que entienda: nunca códigos HTTP, nombres de servicios, rutas,
     * códigos de rastreo ni textos técnicos o en inglés. El mensaje del servidor se usa solo si ya está escrito para una
     * persona (en español y sin jerga técnica) y el error no es una falla interna (5xx); si no, uno claro según el caso.
     * El detalle técnico va a la consola, con el código de rastreo, para quien da soporte.
     * context: 'login' (correo y contraseña), '2fa' (código de verificación) o 'reset' (código del correo).
     */
    errorMessage(error, context) {
        const status = error && Number.isFinite(error.status) ? error.status : null;
        const raw = error ? String(error.detail || error.message || (typeof error === 'string' ? error : '')).trim() : '';
        if (error && typeof console !== 'undefined' && console.warn) {
            console.warn('[TruckCar] error', status, error.path || '', error.correlationId || '', raw);
        }
        const text = this.friendlyError(status, raw, context, error || {});
        return /[.!?»]$/.test(text) ? text : text + '.';
    },

    /** Textos técnicos que no se muestran: jerga de sistemas, nombres de servicios, códigos, rangos, etc. */
    TECHNICAL_TEXT: /(\bHTTP\b|\bAPI\b|gateway|exception|\bnull\b|undefined|JSON|\bSQL|java\.|\bstack\b|time ?out|\bTOTP\b|hmac|\bDLQ\b|\bUUID\b|\bCIDR\b|\bCORS\b|\bJWT\b|\btoken\b|\bID:|latitude|longitude|\[[-\d.,\s]+\]|[A-Z][a-z]+-[A-Z][a-z]+(-[A-Z][a-z]+)? (respondió|no respondió)|\bError \d{3}\b|\bstatus\b|[{}<>]|\[trace|https?:\/\/|\b[0-9a-f]{8}-[0-9a-f]{4}-|_[A-Z]{2,}|[A-Z]{2,}_[A-Z]{2,})/i,
    ENGLISH_TEXT: /\b(the|must|should|cannot|failed|unauthorized|forbidden|bad request|internal|server error|unavailable|not found|required|invalid|blank|empty|denied|expired|wrong|please|too many|requests?|exceeded|limit|try again|error occurred|something went wrong)\b/i,

    /** Mensaje del servidor ya pensado para una persona. */
    isHumanText(text) {
        return Boolean(text) && text.length <= 240 && /[a-záéíóúñ]{3}/i.test(text)
            && !this.TECHNICAL_TEXT.test(text) && !this.ENGLISH_TEXT.test(text);
    },

    friendlyError(status, raw, context, error) {
        // Mensajes conocidos del servidor que conviene decir de otra forma.
        if ((status === 401 && context === 'login') || (!/sesi[oó]n expirada/i.test(raw) && /credenciales inv[aá]lidas|bad credentials|contraseña (incorrecta|inv[aá]lida)/i.test(raw))) {
            return 'El correo o la contraseña no son correctos. Revíselos e intente de nuevo';
        }
        if (/correo ya (se encuentra|est[aá]) registrado/i.test(raw)) {
            return 'Ya existe una cuenta con ese correo. Inicie sesión o use «¿Olvidó su contraseña?»';
        }
        // Código de verificación o del correo: lo que diga el servidor si se entiende («la sesión de verificación venció»).
        if (status === 401 && (context === '2fa' || context === 'reset')) {
            return this.isHumanText(raw) && !/sesi[oó]n expirada/i.test(raw) && raw.split(/\s+/).length > 3 ? raw.replace(/:\s*$/, '')
                : 'El código no es correcto o ya venció. Revise que sea el más reciente';
        }
        if (status === 0 || status === null && !raw) {
            if (/^Esta instalación no tiene configurada/.test(raw)) return raw;
            if (typeof navigator !== 'undefined' && navigator.onLine === false) {
                return 'No tiene conexión a internet. Revise los datos móviles o el wifi e intente de nuevo';
            }
            if (/tiempo de espera|timeout|abort/i.test(raw)) {
                return 'El servidor está tardando en responder. Revise su señal e intente de nuevo';
            }
            return 'No pudimos conectar con TruckCar. Revise su conexión a internet e intente de nuevo en un momento';
        }
        // Un bloqueo explicado por el servidor («pida un código nuevo») se respeta; si no, el texto general.
        if (status === 429 && this.isHumanText(raw) && !/^(Hizo demasiados intentos|Demasiados intentos)/.test(raw)) {
            return raw.replace(/:\s*$/, '');
        }
        if (status === 429) {
            const wait = Number.isFinite(error.retryAfterSeconds) && error.retryAfterSeconds > 0
                ? error.retryAfterSeconds + (error.retryAfterSeconds === 1 ? ' segundo' : ' segundos') : 'unos segundos';
            return 'Hizo demasiados intentos seguidos. Espere ' + wait + ' e intente de nuevo';
        }
        // Una falla interna nunca muestra su detalle (siempre es técnico).
        if (status >= 500) {
            return status === 504 ? 'El servicio tardó demasiado en responder. Intente de nuevo en un momento'
                : 'El servicio no está disponible en este momento. Intente de nuevo en unos minutos';
        }
        if (this.isHumanText(raw) && !/^(Solicitud inválida|Recurso no encontrado|Conflicto con el estado actual|Sesión expirada|No tiene permisos para esta operación)/.test(raw)) {
            return raw.replace(/:\s*$/, '');
        }
        switch (status) {
            case 400: case 422: return 'Algunos datos no son válidos. Revíselos e intente de nuevo';
            case 401: return 'Su sesión terminó. Inicie sesión de nuevo';
            case 403: return 'Su cuenta no tiene permiso para hacer esto. Si cree que es un error, pida a un administrador que revise su rol';
            case 404: return 'No encontramos lo que buscaba; puede que ya no exista. Actualice e intente de nuevo';
            case 409: return 'La información cambió mientras tanto. Actualice e intente de nuevo';
            case 413: return 'El archivo es demasiado grande. Intente con una foto más liviana';
            default: return 'Algo salió mal. Intente de nuevo en un momento';
        }
    },

    SYNC_SECTIONS: {
        alerts: 'las alertas', routes: 'la ruta', fleet: 'la flota', user: 'su perfil', profile: 'el perfil',
        driver: 'el perfil', assignment: 'la carga', load: 'la carga', loads: 'las cargas', shipments: 'los envíos',
        deliveries: 'las entregas', evaluation: 'la evaluación de despacho'
    },

    syncBanner(state) {
        const status = state.dataStatus || {};
        const own = state.activeRole === 'driver'
            ? { alerts: 'alerts', route_overview: 'routes' }[state.driverScreen] : null;
        const errors = Object.entries(status.errors || {}).filter(([key]) => key !== own);
        const icon = (name) => '<svg aria-hidden="true"><use href="assets/icons.svg#' + name + '"></use></svg>';
        if (status.loading) {
            return '<div class="sync-banner" role="status"><span class="spinner" aria-hidden="true"></span>Actualizando…</div>';
        }
        if (errors.length) {
            const what = [...new Set(errors.map(([key]) => this.SYNC_SECTIONS[key] || key))];
            const list = what.length > 1 ? what.slice(0, -1).join(', ') + ' y ' + what[what.length - 1] : what[0];
            const detail = errors.map(([k, v]) => k + ': ' + v).join(' · ');
            return `<div class="sync-banner is-warn" role="status" title="${this.escape(detail)}">
                <span class="sync-text">${icon('warning-fill')}No se pudo actualizar ${this.escape(list)}</span>
                <button onclick="window.app.reloadData()" class="sync-retry">Reintentar</button></div>`;
        }
        return '';
    },

    STATUS_LABELS: {
        PROPOSED: 'Propuesta', NOTIFIED: 'Propuesta', AVAILABLE: 'Disponible', ASSIGNED: 'Aceptada',
        IN_TRANSIT: 'En tránsito', DELIVERED: 'Entregada', CANCELLED: 'Cancelada',
        DISPONIBLE: 'Disponible', EN_TRANSITO: 'En tránsito', DESCANSO: 'Descanso requerido', CON_CARGA: 'Con carga aceptada', SIN_VEHICULO: 'Sin vehículo',
        ACCEPTED: 'Aceptada', REJECTED: 'Rechazada', TIMEOUT: 'Sin respuesta a tiempo',
        UNASSIGNED_NO_DRIVERS: 'Sin conductores disponibles', ACTIVO: 'Activo', INACTIVO: 'Inactivo', DESCONOCIDO: 'Sin estado',
        SUCCESSFUL: 'Conductor seleccionado', NO_DRIVERS_AVAILABLE: 'Sin conductores disponibles',
        DEGRADED_USING_CACHE: 'Con datos guardados', RECOMMENDATION_PENDING: 'Recomendación pendiente',
        ASSIGNMENT_CONFLICT: 'Rechazada por conflicto', ASSIGNMENT_FAILED: 'Asignación sin respuesta'
    },

    statusLabel(code) {
        if (!code) return 'Sin estado';
        return this.STATUS_LABELS[code] || String(code).charAt(0) + String(code).slice(1).toLowerCase().replace(/_/g, ' ');
    }
};

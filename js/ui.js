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

    errorMessage(error) {
        if (!error) return 'Error desconocido';
        const suffix = error.correlationId ? ' [trace ' + String(error.correlationId).slice(0, 8) + ']' : '';
        return (error.message || String(error)) + suffix;
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

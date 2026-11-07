/**
 * Formulario del vehículo del conductor: registrarlo la primera vez o editarlo. Con el vehículo registrado, el conductor
 * queda ACTIVO y el motor de asignación ya lo considera (tipo, capacidad y posición). Usa la misma estructura que el
 * formulario de entrega (podModals.js): cabecera con cerrar, campos que se desplazan y el botón principal fijo abajo.
 *
 *  VehicleForm.open(driver, onSubmit) -> Promise<boolean>   true si se guardó, false si se cerró sin guardar.
 *      onSubmit(vehicle, coords): coords es la ciudad elegida, o null si eligió el GPS (lo lee quien llama).
 *  VehicleForm.validate(values)       -> { errors, vehicle } la validación pura, también la usan las pruebas.
 */
window.VehicleForm = (function () {
    const esc = (value) => window.ui.escape(value);
    const OVERLAY_ID = 'vehicle-form-modal';

    // Los tipos que una carga puede pedir (Load-Allocation TruckTypeRequired): con otro tipo el motor nunca lo elige.
    const TRUCK_TYPES = [
        ['TRACTOMULA_3S3', 'Tractocamión 3S3'], ['MINIMULA', 'Minimula'], ['DOBLETROQUE', 'Doble troque'],
        ['CUATRO_MANOS', 'Cuatro manos'], ['SENCILLO', 'Sencillo'], ['TURBO', 'Turbo']
    ];
    const LICENSES = ['C1', 'C2', 'C3'];

    /** "abc123" o "ABC 123" -> "ABC-123". Placas de servicio público y particular: 3 letras y 3 dígitos. */
    function normalizePlate(value) {
        const compact = String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
        return /^[A-Z]{3}\d{3}$/.test(compact) ? compact.slice(0, 3) + '-' + compact.slice(3) : null;
    }

    /** Coordenadas de una ciudad del catálogo del generador (las mismas de origen y destino de las cargas). */
    function cityCoords(name) {
        const city = window.GeneratorPanel && window.GeneratorPanel.findCity(name);
        return city ? [city.latitude, city.longitude] : null;
    }

    function cities() {
        return (window.GeneratorPanel && window.GeneratorPanel.CITIES) || [];
    }

    function number(value) {
        const n = Number(String(value ?? '').trim().replace(',', '.'));
        return String(value ?? '').trim() === '' || !Number.isFinite(n) ? null : n;
    }

    function validate(values) {
        const errors = {};
        const plate = normalizePlate(values.vehiclePlate);
        if (!plate) errors.vehiclePlate = 'Escriba la placa con 3 letras y 3 números (ej. TDK-410).';
        const type = TRUCK_TYPES.some(([code]) => code === values.vehicleType) ? values.vehicleType : null;
        if (!type) errors.vehicleType = 'Elija el tipo de vehículo.';
        const height = number(values.maxHeightMeters);
        if (height == null || height < 2 || height > 5) errors.maxHeightMeters = 'La altura va entre 2 y 5 m.';
        const payload = number(values.maxPayloadTons);
        if (payload == null || payload <= 0 || payload > 60) errors.maxPayloadTons = 'La capacidad va entre 0,1 y 60 t.';
        const tare = number(values.tareWeightTons);
        if (tare == null || tare <= 0 || tare > 30) errors.tareWeightTons = 'La tara va entre 0,1 y 30 t.';
        // "gps" o el nombre de una ciudad del catálogo: sin posición, la cercanía no suma y el motor casi nunca lo elige.
        const location = values.location === 'gps' ? 'gps' : (cityCoords(values.location) ? values.location : null);
        if (!location) errors.location = 'Elija el GPS o la ciudad donde está.';
        return {
            errors,
            location,
            vehicle: Object.keys(errors).length ? null : {
                vehiclePlate: plate,
                vehicleModel: String(values.vehicleModel || '').trim() || null,
                vehicleType: type,
                licenseCategory: LICENSES.includes(values.licenseCategory) ? values.licenseCategory : null,
                maxHeightMeters: height,
                maxPayloadTons: payload,
                tareWeightTons: tare,
                runtValid: Boolean(values.runtValid),
                electronicTollTagActive: Boolean(values.electronicTollTagActive),
                coldChainCertified: Boolean(values.coldChainCertified),
                hazmatAuthorized: Boolean(values.hazmatAuthorized)
            }
        };
    }

    function close(overlay) {
        overlay.id = '';
        overlay.classList.remove('is-open');
        setTimeout(() => overlay.remove(), 430);
    }

    function open(driver, onSubmit) {
        const existing = document.getElementById(OVERLAY_ID);
        if (existing) existing.remove();
        const s = (driver && driver.state) || {};
        const editing = Boolean(driver && driver.state);
        const icon = (name) => `<svg class="ui-icon" aria-hidden="true"><use href="assets/icons.svg#${name}"></use></svg>`;
        const field = (name, label, input, required = true) => `
            <label class="field">
                <span class="field-label">${label}${required ? ' <span class="field-req">· obligatorio</span>' : ''}</span>
                ${input}
                <span class="field-error hidden" data-error-for="${name}" role="alert"></span>
            </label>`;
        const num = (name, value, placeholder, step = '0.1') =>
            `<input name="${name}" type="number" inputmode="decimal" step="${step}" min="0" value="${esc(value ?? '')}" class="field-input" placeholder="${placeholder}">`;
        const check = (name, label, checked) => `
            <label class="vehicle-check">
                <input type="checkbox" name="${name}" ${checked ? 'checked' : ''}>
                <span>${label}</span>
            </label>`;

        const overlay = document.createElement('div');
        overlay.id = OVERLAY_ID;
        overlay.className = 'sheet-backdrop';
        overlay.innerHTML = `
            <form class="pod-form sheet" novalidate aria-labelledby="vehicle-form-title">
                <div class="sheet-handle" aria-hidden="true"></div>
                <div class="pod-head">
                    <div class="min-w-0">
                        <h2 id="vehicle-form-title">${editing ? 'Editar vehículo' : 'Registrar mi vehículo'}</h2>
                        <p class="secondary">Con estos datos el motor le asigna cargas que su camión puede llevar.</p>
                    </div>
                    <button type="button" data-action="cancel" class="header-icon-btn" aria-label="Cerrar sin guardar">${icon('x')}</button>
                </div>

                <div class="pod-fields">
                    <div class="pod-error hidden" data-form-error role="alert">
                        <div class="warn-line">${icon('warning-fill')}<span>No se pudo guardar el vehículo</span></div>
                        <p data-form-error-text></p>
                    </div>

                    ${field('vehiclePlate', 'Placa', `<input name="vehiclePlate" value="${esc(s.vehiclePlate || '')}" maxlength="8" autocomplete="off" autocapitalize="characters" autocorrect="off" spellcheck="false" class="field-input" placeholder="TDK-410">`)}
                    ${field('vehicleType', 'Tipo de vehículo', `<select name="vehicleType" class="field-input">
                        <option value="">Elija el tipo</option>
                        ${TRUCK_TYPES.map(([code, text]) => `<option value="${code}" ${code === s.vehicleType ? 'selected' : ''}>${text}</option>`).join('')}
                    </select>`)}
                    ${field('vehicleModel', 'Marca y modelo', `<input name="vehicleModel" value="${esc(s.vehicleModel || '')}" maxlength="80" autocomplete="off" class="field-input" placeholder="Kenworth T800">`, false)}
                    ${field('maxHeightMeters', 'Altura total (m)', num('maxHeightMeters', s.maxHeightMeters, '4,10', '0.01'))}
                    ${field('maxPayloadTons', 'Capacidad de carga (t)', num('maxPayloadTons', s.maxPayloadTons, '34'))}
                    ${field('tareWeightTons', 'Tara, el camión vacío (t)', num('tareWeightTons', s.tareWeightTons, '15'))}
                    ${field('licenseCategory', 'Categoría de la licencia', `<select name="licenseCategory" class="field-input">
                        <option value="">Sin indicar</option>
                        ${LICENSES.map(c => `<option value="${c}" ${c === s.licenseCategory ? 'selected' : ''}>${c}</option>`).join('')}
                    </select>`, false)}

                    <div class="field">
                        <span class="field-label">Documentos y permisos</span>
                        <div class="vehicle-checks">
                            ${check('runtValid', 'RUNT vigente', editing ? s.runtValid : true)}
                            ${check('electronicTollTagActive', 'TAG de telepeaje activo', s.electronicTollTagActive)}
                            ${check('coldChainCertified', 'Certificado de cadena de frío', s.coldChainCertified)}
                            ${check('hazmatAuthorized', 'Autorizado para mercancías peligrosas', s.hazmatAuthorized)}
                        </div>
                        <span class="field-help">Sin RUNT vigente el vehículo no recibe cargas.</span>
                    </div>
                    ${field('location', 'Dónde está ahora', `<select name="location" class="field-input">
                        <option value="gps">GPS de este dispositivo</option>
                        ${cities().map(c => `<option value="${esc(c.city)}">${esc(c.city)} · ${esc(c.department)}</option>`).join('')}
                    </select>`)}
                    <p class="field-help">El motor de asignación prefiere al conductor más cercano al origen de la carga. ${editing ? '' : 'Al guardar queda disponible para recibir cargas.'}</p>
                </div>

                <div class="pod-footer">
                    <button type="submit" class="btn-accent">${icon('check-circle')}<span>${editing ? 'Guardar cambios' : 'Registrar vehículo'}</span></button>
                </div>
            </form>`;
        document.body.appendChild(overlay);
        requestAnimationFrame(() => requestAnimationFrame(() => overlay.classList.add('is-open')));

        const form = overlay.querySelector('form');
        const submit = form.querySelector('[type="submit"]');
        const showErrors = (errors) => {
            form.querySelectorAll('[data-error-for]').forEach(el => {
                const message = errors[el.dataset.errorFor];
                el.textContent = message || '';
                el.classList.toggle('hidden', !message);
                const input = form.elements[el.dataset.errorFor];
                if (input) input.toggleAttribute('aria-invalid', Boolean(message));
            });
            const first = Object.keys(errors)[0];
            if (first && form.elements[first]) form.elements[first].focus();
        };

        return new Promise((resolve) => {
            form.querySelector('[data-action="cancel"]').addEventListener('click', () => { close(overlay); resolve(false); });
            form.addEventListener('submit', async (event) => {
                event.preventDefault();
                const values = Object.fromEntries(new FormData(form).entries());
                ['runtValid', 'electronicTollTagActive', 'coldChainCertified', 'hazmatAuthorized']
                    .forEach(name => { values[name] = form.elements[name].checked; });
                const { errors, vehicle, location } = validate(values);
                showErrors(errors);
                if (!vehicle) return;
                submit.disabled = true;
                submit.querySelector('span').textContent = location === 'gps' ? 'Leyendo el GPS…' : 'Guardando…';
                try {
                    await onSubmit(vehicle, location === 'gps' ? null : cityCoords(location));
                    close(overlay);
                    resolve(true);
                } catch (error) {
                    const box = form.querySelector('[data-form-error]');
                    box.classList.remove('hidden');
                    box.querySelector('[data-form-error-text]').textContent = error && error.status === 409
                        ? 'Esa placa ya está registrada a otro conductor.'
                        : window.ui.errorMessage(error);
                    submit.disabled = false;
                    submit.querySelector('span').textContent = editing ? 'Guardar cambios' : 'Registrar vehículo';
                }
            });
        });
    }

    return { open, validate, normalizePlate, cityCoords, TRUCK_TYPES };
})();

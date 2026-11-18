(function () {
    const config = window.TruckCarConfig;

    const RATE_LIMITED_MESSAGE = 'Demasiados intentos, espere unos segundos';

    class ApiError extends Error {
        constructor(message, { status = 0, details = null, correlationId = null, path = '', retryAfterSeconds = null } = {}) {
            super(message);
            this.name = 'ApiError';
            this.status = status;
            this.details = details;
            this.correlationId = correlationId;
            this.path = path;
            this.retryAfterSeconds = retryAfterSeconds;
        }

        get isUnauthorized() { return this.status === 401; }
        get isForbidden() { return this.status === 403; }
        get isNotFound() { return this.status === 404; }
        get isRateLimited() { return this.status === 429; }
        get isNetworkError() { return this.status === 0; }
    }

    function retryAfterOf(response) {
        const seconds = Number.parseInt(response.headers.get('Retry-After'), 10);
        return Number.isFinite(seconds) && seconds >= 0 ? seconds : null;
    }

    const session = {
        get() {
            try {
                const raw = localStorage.getItem(config.storageKeys.session);
                return raw ? JSON.parse(raw) : null;
            } catch (e) {
                return null;
            }
        },
        save(authResponse) {
            const claims = decodeJwt(authResponse.accessToken) || {};
            const value = {
                accessToken: authResponse.accessToken,
                refreshToken: authResponse.refreshToken,
                expiresAt: claims.exp ? claims.exp * 1000 : Date.now() + (authResponse.expiresIn || 0) * 1000,
                userId: claims.sub,
                email: claims.email,
                role: claims.role
            };
            try {
                localStorage.setItem(config.storageKeys.session, JSON.stringify(value));
            } catch (e) {
                console.warn('[TruckCar] No se pudo persistir la sesión', e);
            }
            return value;
        },
        clear() {
            try { localStorage.removeItem(config.storageKeys.session); } catch (e) { }
        },
        isActive() {
            const s = this.get();
            return Boolean(s && s.accessToken && s.expiresAt > Date.now());
        },
        isRenewable() {
            const s = this.get();
            return Boolean(s && s.refreshToken);
        }
    };

    const REFRESH_MARGIN_MS = 60 * 1000;
    let refreshInFlight = null;

    function withSessionLock(task) {
        const locks = typeof navigator !== 'undefined' && navigator.locks;
        return locks && typeof locks.request === 'function' ? locks.request('truckcar.session.refresh', task) : task();
    }

    function refreshSession() {
        if (!refreshInFlight) {
            const before = session.get();
            refreshInFlight = withSessionLock(async () => {
                const current = session.get();
                if (!current || !current.refreshToken) throw new ApiError('No hay sesión para renovar', { status: 401 });
                const renewedElsewhere = before && current.accessToken !== before.accessToken && current.expiresAt > Date.now();
                if (renewedElsewhere) return current;
                const response = await request('POST', '/auth/refresh', { body: { refreshToken: current.refreshToken }, auth: false });
                return session.save(response);
            }).finally(() => { refreshInFlight = null; });
        }
        return refreshInFlight;
    }

    async function ensureFreshSession() {
        const current = session.get();
        if (current && current.accessToken && current.expiresAt - REFRESH_MARGIN_MS > Date.now()) {
            return current;
        }
        return refreshSession();
    }

    function decodeJwt(token) {
        try {
            const payload = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
            const json = decodeURIComponent(atob(payload).split('')
                .map(c => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2)).join(''));
            return JSON.parse(json);
        } catch (e) {
            return null;
        }
    }

    function newCorrelationId() {
        if (window.crypto && typeof window.crypto.randomUUID === 'function') {
            return window.crypto.randomUUID();
        }
        return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
            const r = Math.random() * 16 | 0;
            return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
        });
    }

    function buildUrl(path, query) {
        const url = new URL(config.apiBaseUrl + path);
        if (query) {
            Object.entries(query).forEach(([key, value]) => {
                if (value !== undefined && value !== null && value !== '') {
                    url.searchParams.append(key, value);
                }
            });
        }
        return url.toString();
    }

    function validationDetails(body) {
        const details = body && body.details;
        if (!details || typeof details !== 'object') return [];
        return Object.values(details).filter(value => typeof value === 'string' && value.trim());
    }

    function extractErrorMessage(body, status) {
        if (body && typeof body === 'object') {
            if (body.message) return body.message;
            const details = validationDetails(body);
            if (details.length) return details.join('. ');
            if (body.reasonDetails) return body.reasonDetails;
            if (body.error && typeof body.error === 'string') return body.error;
            if (body.errors && typeof body.errors === 'object') {
                return Object.values(body.errors).join('. ');
            }
        }
        if (typeof body === 'string' && body.trim()) return body.trim().slice(0, 300);
        const defaults = {
            400: 'Solicitud inválida',
            401: 'Sesión expirada o credenciales inválidas',
            403: 'No tiene permisos para esta operación',
            404: 'Recurso no encontrado',
            409: 'Conflicto con el estado actual del recurso',
            429: RATE_LIMITED_MESSAGE,
            502: 'El servicio de destino no está disponible',
            503: 'Servicio temporalmente no disponible',
            504: 'El servicio tardó demasiado en responder'
        };
        return defaults[status] || ('Error HTTP ' + status);
    }

    async function request(method, path, { body, query, auth = true, timeoutMs, headers = {}, retried = false } = {}) {
        if (!config.gatewayUrl) {
            throw new ApiError('Esta instalación no tiene configurada la dirección del servidor. Pida una versión actualizada de la aplicación.', { status: 0, path });
        }
        if (auth && session.isRenewable()) {
            try {
                await ensureFreshSession();
            } catch (e) {
            }
        }
        const correlationId = newCorrelationId();
        const requestHeaders = {
            'Accept': 'application/json',
            'X-Correlation-Id': correlationId,
            ...headers
        };
        if (body !== undefined) {
            requestHeaders['Content-Type'] = 'application/json';
        }
        if (auth) {
            const current = session.get();
            if (current && current.accessToken) {
                requestHeaders['Authorization'] = 'Bearer ' + current.accessToken;
            }
        }

        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs || config.requestTimeoutMs);

        let response;
        try {
            response = await fetch(buildUrl(path, query), {
                method,
                headers: requestHeaders,
                body: body !== undefined ? JSON.stringify(body) : undefined,
                signal: controller.signal,
                mode: 'cors',
                credentials: 'omit'
            });
        } catch (error) {
            const message = error.name === 'AbortError'
                ? 'Tiempo de espera agotado consultando ' + path
                : 'No hay conexión con el API Gateway (' + config.gatewayUrl + ')';
            throw new ApiError(message, { status: 0, correlationId, path });
        } finally {
            clearTimeout(timer);
        }

        const responseCorrelation = response.headers.get('X-Correlation-Id') || correlationId;
        const contentType = response.headers.get('Content-Type') || '';
        let payload = null;
        if (response.status !== 204) {
            const text = await response.text();
            if (text) {
                payload = contentType.includes('application/json') ? safeJson(text) : text;
            }
        }

        if (!response.ok) {
            const error = new ApiError(extractErrorMessage(payload, response.status), {
                status: response.status,
                details: payload,
                correlationId: responseCorrelation,
                path,
                retryAfterSeconds: response.status === 429 ? retryAfterOf(response) : null
            });
            if (error.isUnauthorized && auth && !retried && session.isRenewable()) {
                try {
                    await refreshSession();
                } catch (refreshError) {
                    if (refreshError && refreshError.isRateLimited) {
                        throw refreshError;
                    }
                    session.clear();
                    window.dispatchEvent(new CustomEvent('truckcar:unauthorized', { detail: error }));
                    throw error;
                }
                return request(method, path, { body, query, auth, timeoutMs, headers, retried: true });
            }
            if (error.isUnauthorized && auth) {
                session.clear();
                window.dispatchEvent(new CustomEvent('truckcar:unauthorized', { detail: error }));
            } else if (error.isForbidden && auth) {
                window.dispatchEvent(new CustomEvent('truckcar:forbidden', { detail: error }));
            }
            throw error;
        }
        return payload;
    }

    function safeJson(text) {
        try { return JSON.parse(text); } catch (e) { return text; }
    }

    const http = {
        get: (path, options) => request('GET', path, options),
        post: (path, body, options = {}) => request('POST', path, { ...options, body }),
        put: (path, body, options = {}) => request('PUT', path, { ...options, body }),
        patch: (path, body, options = {}) => request('PATCH', path, { ...options, body }),
        delete: (path, options) => request('DELETE', path, options)
    };

    const enc = encodeURIComponent;

    const DRIVER_STATE_FIELDS = ['driverName', 'licenseCategory', 'rating', 'totalTrips', 'netCargoWeightTons',
        'drivingHoursToday', 'mandatoryRestLocation', 'hazmatAuthorized', 'coldChainCertified', 'runtValid',
        'electronicTollTagActive', 'activeBadges', 'currentLatitude', 'currentLongitude', 'currentSpeedKmH', 'status'];
    const VEHICLE_STATE_FIELDS = ['vehiclePlate', 'vehicleModel', 'vehicleType', 'maxHeightMeters', 'maxPayloadTons', 'tareWeightTons'];

    function finiteOrUndefined(value) {
        if (value === null || value === undefined || value === '') return undefined;
        const number = Number(value);
        return Number.isFinite(number) ? number : undefined;
    }

    async function patchDriverState(driverId, changes) {
        let current = null;
        try {
            current = await http.get('/fleets-drivers/drivers/' + enc(driverId));
        } catch (error) {
            if (!error.isNotFound) throw error;
        }
        const kept = {};
        DRIVER_STATE_FIELDS.concat(VEHICLE_STATE_FIELDS).forEach(field => {
            if (current && current[field] !== null && current[field] !== undefined) kept[field] = current[field];
        });
        return http.post('/fleets-drivers/state', { ...kept, driverId, ...changes });
    }

    function registerVehicle(driverId, vehicleData) {
        return patchDriverState(driverId, {
            vehiclePlate: vehicleData.plate ? String(vehicleData.plate).toUpperCase().trim() : undefined,
            vehicleModel: vehicleData.model ? String(vehicleData.model).trim() : undefined,
            vehicleType: vehicleData.type || undefined,
            maxHeightMeters: finiteOrUndefined(vehicleData.height),
            maxPayloadTons: finiteOrUndefined(vehicleData.maxPayload),
            tareWeightTons: finiteOrUndefined(vehicleData.tareWeight)
        });
    }

    async function drivingRoutes(points, { steps = false, alternatives = false } = {}) {
        const url = config.routingUrl + points.map(c => c[1] + ',' + c[0]).join(';')
            + '?overview=full&geometries=geojson' + (steps ? '&steps=true' : '') + (alternatives ? '&alternatives=true' : '');
        const response = await fetch(url);
        if (!response.ok) throw new ApiError('El servicio de rutas respondió ' + response.status, { status: response.status, path: 'routing' });
        const json = await response.json();
        const routes = (json.routes || []).filter(r => r && r.geometry && r.geometry.coordinates);
        if (!routes.length) {
            throw new ApiError('El servicio de rutas no devolvió una ruta', { status: 502, path: 'routing' });
        }
        return routes;
    }

    async function drivingRoute(points, options) {
        return (await drivingRoutes(points, options))[0];
    }

    window.TruckCarApi = {
        ApiError,
        RATE_LIMITED_MESSAGE,
        session,
        ensureFreshSession,
        decodeJwt,
        http,

        auth: {
            /**
             * Primer paso. Sin 2FA guarda la sesión y la devuelve. Con 2FA no hay sesión todavía: devuelve
             * { requiresTwoFactor: true, tempToken, expiresAt } para verifyTwoFactor (nada se guarda).
             */
            async login(email, password) {
                const response = await http.post('/auth/login', { email, password }, { auth: false });
                if (response && response.requiresTwoFactor) {
                    return {
                        requiresTwoFactor: true,
                        tempToken: response.tempToken,
                        expiresAt: Date.now() + (Number(response.expiresIn) || 300) * 1000
                    };
                }
                return session.save(response);
            },
            /** Segundo paso del login: token temporal + código TOTP o de respaldo → sesión. */
            async verifyTwoFactor(tempToken, code) {
                const response = await http.post('/auth/2fa/verify-login', { tempToken, code }, { auth: false });
                return session.save(response);
            },
            // Gestión de la doble autenticación (requiere sesión completa).
            twoFactor: {
                setup: () => http.post('/auth/2fa/setup', {}),
                verifySetup: (code) => http.post('/auth/2fa/verify-setup', { code }),
                disable: ({ password, code } = {}) => http.post('/auth/2fa/disable', { password: password || null, code: code || null })
            },
            async register(data) {
                const response = await http.post('/auth/register', data, { auth: false });
                return session.save(response);
            },
            refresh: () => refreshSession(),
            // Catálogo público de transportadoras (id y nombre) para el registro de un conductor de empresa.
            companies: () => http.get('/auth/companies', { auth: false }),
            async logout() {
                try { await http.post('/auth/logout'); } finally { session.clear(); }
            }
        },
        users: {
            me: () => http.get('/users/me'),
            updateMe: (data) => http.put('/users/me', data),
            getById: (id) => http.get('/users/' + enc(id)),
            list: ({ role, status, size = 200 } = {}) => http.get('/users', { query: { role, status, size, sort: 'createdAt,desc' } }),
            changeRole: (id, role) => http.patch('/users/' + enc(id) + '/role', { role }),
            changeStatus: (id, status) => http.patch('/users/' + enc(id) + '/status', { status }),
            // El conductor elige: { driverType: 'INDEPENDIENTE' } o { driverType: 'EMPRESA', companyId }.
            changeMyAffiliation: (choice) => http.put('/users/me/affiliation', choice)
        },
        // Transportadora autenticada: su empresa y sus conductores afiliados.
        companies: {
            list: () => http.get('/companies'),
            me: () => http.get('/companies/me'),
            drivers: () => http.get('/companies/me/drivers'),
            registerDriver: (driver) => http.post('/companies/me/drivers', driver),
            decide: (driverId, status) => http.patch('/companies/me/drivers/' + enc(driverId) + '/affiliation', { status }),
            unlink: (driverId) => http.delete('/companies/me/drivers/' + enc(driverId))
        },

        fleet: {
            listActive: () => http.get('/fleets-drivers/active'),
            listAvailable: () => http.get('/fleets-drivers/available'),
            getDriver: (driverId) => http.get('/fleets-drivers/drivers/' + enc(driverId)),
            getVehicle: (plate) => http.get('/fleets-drivers/vehicles/' + enc(plate)),
            updateState: (state) => http.post('/fleets-drivers/state', state),
            registerVehicle,
            patchState: patchDriverState
        },

        loads: {
            getById: (loadId) => http.get('/loads/' + enc(loadId)),
            listAvailable: (truckType) => http.get('/loads/available', { query: { truckType } }),
            listByCompany: (companyId) => http.get('/loads/company/' + enc(companyId)),
            published: () => http.get('/loads/published'),
            publish: (load) => http.post('/loads', load),
            accept: (loadId) => http.patch('/loads/' + enc(loadId) + '/assignment/accept'),
            reject: (loadId) => http.patch('/loads/' + enc(loadId) + '/assignment/reject'),
            assign: (loadId, driver) => http.patch('/loads/' + enc(loadId) + '/assign', driver),
            notifyAssignment: (loadId) => http.patch('/loads/' + enc(loadId) + '/assignment/notify'),
            mine: () => http.get('/loads/mine'),
            startTrip: (loadId) => http.patch('/loads/' + enc(loadId) + '/trip/start'),
            deliver: (loadId, pod) => http.patch('/loads/' + enc(loadId) + '/trip/deliver', pod),
            podUploadUrls: (loadId, files) =>
                http.post('/loads/' + enc(loadId) + '/proof-of-delivery/upload-urls', { files }),
            cancel: (loadId, reason) => http.patch('/loads/' + enc(loadId) + '/cancel', { reason }),
            list: (statuses) => http.get('/loads', { query: { status: statuses && statuses.length ? statuses.join(',') : undefined } }),
            proofOfDelivery: (loadId) => http.get('/loads/' + enc(loadId) + '/proof-of-delivery'),
            publicTrackingLink: (loadId) => http.post('/loads/' + enc(loadId) + '/public-tracking-link'),
            publicTracking: (token) => http.get('/loads/public-tracking/' + enc(token), { auth: false })
        },

        allocation: {
            matchLoad: (loadId) => http.post('/fleet-allocation/match/' + enc(loadId)),
            history: (loadId) => http.get('/fleet-allocation/history/' + enc(loadId)),
            optimize: (request) => http.post('/fleet-allocation/optimize', request)
        },

        routing: {
            drivingRoute,
            drivingRoutes
        },

        routes: {
            plan: (request) => http.post('/routes/plan', request, { timeoutMs: 45000 }),
            // Recálculo durante el viaje con HERE (perfil de camión y tráfico). Corto: si tarda, la guía usa su respaldo.
            reroute: (request) => http.post('/routes/reroute', request, { timeoutMs: 12000 }),
            historyByPlate: (plate) => http.get('/routes/history/' + enc(plate))
        },

        // Copiloto de voz: interpreta con IA (Voice-AI-Assistant) el texto que las reglas del teléfono no entendieron.
        // Solo viaja el texto ya transcrito, nunca el audio. Tiempo corto: el conductor espera la respuesta en voz alta.
        assistant: {
            interpret: (text, context) => http.post('/assistant/interpret', { text, context }, { timeoutMs: 6000 })
        },

        alerts: {
            listActive: () => http.get('/alerts'),
            nearby: (latitude, longitude, radiusMeters = 50000) =>
                http.get('/alerts/nearby', { query: { latitude, longitude, radiusMeters } }),
            create: (alert) => http.post('/alerts', alert),
            confirm: (alertId) => http.patch('/alerts/' + enc(alertId) + '/confirm'),
            sos: (sos) => http.post('/alerts/sos', sos, { timeoutMs: 8000 }),
            activeSos: () => http.get('/alerts/sos'),
            acknowledgeSos: (sosId) => http.patch('/alerts/sos/' + enc(sosId) + '/acknowledge')
        },

        templates: {
            list: () => http.get('/templates'),
            update: (id, templateText) => http.put('/templates/' + enc(id), { templateText })
        },

        notifications: {
            forUser: (userId, size = 30) =>
                http.get('/notifications/user/' + enc(userId), { query: { size, sort: 'createdAt,desc' } })
        },

        restrictions: {
            listActive: (query) => http.get('/restrictions', { query }),
            create: (restriction) => http.post('/restrictions', restriction),
            deactivate: (id) => http.patch('/restrictions/' + enc(id) + '/deactivate'),
            validateCompatibility: (request) => http.post('/restrictions/validate-compatibility', request),
            validateRoute: (request) => http.post('/restrictions/validate-route', request, { timeoutMs: 8000 })
        }
    };
})();

/**
 * Cliente HTTP de TruckDar: todas las llamadas pasan por el api-gateway.
 * - fetch + async/await, timeout con AbortController.
 * - Cabeceras estándar, JWT (Authorization: Bearer) y X-Correlation-Id por petición.
 * - Errores normalizados en ApiError { status, message, details, correlationId }.
 */
(function () {
    const config = window.TruckDarConfig;

    class ApiError extends Error {
        constructor(message, { status = 0, details = null, correlationId = null, path = '' } = {}) {
            super(message);
            this.name = 'ApiError';
            this.status = status;
            this.details = details;
            this.correlationId = correlationId;
            this.path = path;
        }

        get isUnauthorized() { return this.status === 401; }
        get isNotFound() { return this.status === 404; }
        get isNetworkError() { return this.status === 0; }
    }

    // ---------------------------------------------------------------- sesión
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
                expiresAt: claims.exp ? claims.exp * 1000 : Date.now() + (authResponse.expiresIn || 0),
                userId: claims.sub,
                email: claims.email,
                role: claims.role
            };
            try {
                localStorage.setItem(config.storageKeys.session, JSON.stringify(value));
            } catch (e) {
                console.warn('[TruckDar] No se pudo persistir la sesión', e);
            }
            return value;
        },
        clear() {
            try { localStorage.removeItem(config.storageKeys.session); } catch (e) { /* sin almacenamiento */ }
        },
        isActive() {
            const s = this.get();
            return Boolean(s && s.accessToken && s.expiresAt > Date.now());
        }
    };

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

    function extractErrorMessage(body, status) {
        if (body && typeof body === 'object') {
            if (body.message) return body.message;
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
            502: 'El servicio de destino no está disponible',
            503: 'Servicio temporalmente no disponible',
            504: 'El servicio tardó demasiado en responder'
        };
        return defaults[status] || ('Error HTTP ' + status);
    }

    // ---------------------------------------------------------------- núcleo
    async function request(method, path, { body, query, auth = true, timeoutMs, headers = {} } = {}) {
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
                path
            });
            if (error.isUnauthorized && auth) {
                session.clear();
                window.dispatchEvent(new CustomEvent('truckdar:unauthorized', { detail: error }));
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

    // ---------------------------------------------------------------- endpoints
    window.TruckDarApi = {
        ApiError,
        session,
        decodeJwt,
        http,

        /** User-Identity: /api/v1/auth, /api/v1/users */
        auth: {
            async login(email, password) {
                const response = await http.post('/auth/login', { email, password }, { auth: false });
                return session.save(response);
            },
            async register(data) {
                const response = await http.post('/auth/register', data, { auth: false });
                return session.save(response);
            },
            async refresh() {
                const current = session.get();
                if (!current || !current.refreshToken) throw new ApiError('No hay sesión para renovar', { status: 401 });
                const response = await http.post('/auth/refresh', { refreshToken: current.refreshToken }, { auth: false });
                return session.save(response);
            },
            async logout() {
                try { await http.post('/auth/logout'); } finally { session.clear(); }
            }
        },
        users: {
            me: () => http.get('/users/me'),
            updateMe: (data) => http.put('/users/me', data),
            getById: (id) => http.get('/users/' + enc(id))
        },

        /** fleets-drivers: estado de conductores y vehículos */
        fleet: {
            listActive: () => http.get('/fleets-drivers/active'),
            getDriver: (driverId) => http.get('/fleets-drivers/drivers/' + enc(driverId)),
            getVehicle: (plate) => http.get('/fleets-drivers/vehicles/' + enc(plate)),
            updateState: (state) => http.post('/fleets-drivers/state', state)
        },

        /** Load-Allocation: cargas y ciclo comercial de asignación */
        loads: {
            getById: (loadId) => http.get('/loads/' + enc(loadId)),
            listAvailable: (truckType) => http.get('/loads/available', { query: { truckType } }),
            listByCompany: (companyId) => http.get('/loads/company/' + enc(companyId)),
            publish: (load) => http.post('/loads', load),
            accept: (loadId) => http.patch('/loads/' + enc(loadId) + '/assignment/accept'),
            reject: (loadId) => http.patch('/loads/' + enc(loadId) + '/assignment/reject'),
            /** Cargas del conductor autenticado (propuestas, aceptadas y en tránsito). */
            mine: () => http.get('/loads/mine'),
            startTrip: (loadId) => http.patch('/loads/' + enc(loadId) + '/trip/start'),
            /** pod: { receiverName, receiverDocument, notes } */
            deliver: (loadId, pod) => http.patch('/loads/' + enc(loadId) + '/trip/deliver', pod),
            cancel: (loadId, reason) => http.patch('/loads/' + enc(loadId) + '/cancel', { reason })
        },

        /** AI-powered-fleet-allocation: motor de scoring de conductores */
        allocation: {
            matchLoad: (loadId) => http.post('/fleet-allocation/match/' + enc(loadId)),
            history: (loadId) => http.get('/fleet-allocation/history/' + enc(loadId)),
            optimize: (request) => http.post('/fleet-allocation/optimize', request)
        },

        /** Route-AI-agent: planeación de rutas para carga pesada */
        routes: {
            plan: (request) => http.post('/routes/plan', request, { timeoutMs: 45000 }),
            historyByPlate: (plate) => http.get('/routes/history/' + enc(plate))
        },

        /** Community-Alerts: reportes de vía con PostGIS */
        alerts: {
            listActive: () => http.get('/alerts'),
            nearby: (latitude, longitude, radiusMeters = 50000) =>
                http.get('/alerts/nearby', { query: { latitude, longitude, radiusMeters } }),
            create: (alert) => http.post('/alerts', alert),
            confirm: (alertId) => http.patch('/alerts/' + enc(alertId) + '/confirm')
        },

        /** Routing-Restrictions: restricciones y cierres viales */
        restrictions: {
            listActive: (query) => http.get('/restrictions', { query }),
            validateCompatibility: (request) => http.post('/restrictions/validate-compatibility', request)
        }
    };
})();

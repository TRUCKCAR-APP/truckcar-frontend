/**
 * Configuración de conexión con el backend TruckDar (api-gateway).
 *
 * Orden de resolución de la URL base:
 *   1. window.TRUCKDAR_API_BASE_URL (definida antes de cargar este script, p. ej. por el despliegue).
 *   2. <meta name="truckdar-api-base-url" content="https://..."> en index.html.
 *   3. Ejecución local (localhost / 127.0.0.1 / file://) -> gateway local en el puerto 8000.
 *   4. Despliegue: mismo origen que el frontend (el gateway publicado detrás del mismo dominio).
 */
(function () {
    const LOCAL_GATEWAY_URL = 'http://localhost:8000';
    const API_PREFIX = '/api/v1';

    const host = window.location.hostname;
    const isLocal = window.location.protocol === 'file:'
        || host === 'localhost'
        || host === '127.0.0.1'
        || host === '';

    const metaTag = document.querySelector('meta[name="truckdar-api-base-url"]');
    const explicitUrl = window.TRUCKDAR_API_BASE_URL || (metaTag && metaTag.content) || '';

    let gatewayUrl;
    if (explicitUrl) {
        gatewayUrl = explicitUrl;
    } else if (isLocal) {
        gatewayUrl = LOCAL_GATEWAY_URL;
    } else {
        gatewayUrl = window.location.origin;
    }
    gatewayUrl = gatewayUrl.replace(/\/+$/, '').replace(/\/api\/v1$/, '');

    window.TruckDarConfig = Object.freeze({
        environment: isLocal ? 'local' : 'production',
        gatewayUrl,
        apiBaseUrl: gatewayUrl + API_PREFIX,
        requestTimeoutMs: 15000,
        // Intervalo de refresco de flota/alertas en la torre de control (ms).
        pollingIntervalMs: 30000,
        storageKeys: {
            session: 'truckdar.session'
        }
    });

    console.info('[TruckDar] API base:', window.TruckDarConfig.apiBaseUrl,
        '(' + window.TruckDarConfig.environment + ')');
})();

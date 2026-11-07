/**
 * Configuración de conexión con el backend TruckCar (api-gateway).
 *
 * Orden de resolución de la URL base:
 *   1. window.TRUCKCAR_API_BASE_URL (definida antes de cargar este script, p. ej. por el despliegue).
 *   2. <meta name="truckcar-api-base-url" content="https://..."> en index.html.
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

    const metaTag = document.querySelector('meta[name="truckcar-api-base-url"]');
    const explicitUrl = window.TRUCKCAR_API_BASE_URL || (metaTag && metaTag.content) || '';

    let gatewayUrl;
    if (explicitUrl) {
        gatewayUrl = explicitUrl;
    } else if (isLocal) {
        gatewayUrl = LOCAL_GATEWAY_URL;
    } else {
        gatewayUrl = window.location.origin;
    }
    gatewayUrl = gatewayUrl.replace(/\/+$/, '').replace(/\/api\/v1$/, '');

    /*
     * Teselas del mapa: único punto de configuración (URL, atribución y parámetro de la clave). Para pasar al plan B
     * cambie MAP_PROVIDER a 'carto'; no hay respaldo automático entre proveedores (docs/redesign/REPORTE.md, §7).
     * La clave nunca va en el repositorio: la pone el despliegue en <meta name="truckcar-map-api-key"> o en
     * window.TRUCKCAR_MAP_API_KEY. En localhost queda vacía: Stadia no la exige ahí.
     */
    const MAP_PROVIDER = 'stadia';
    const MAP_PROVIDERS = {
        stadia: {
            url: 'https://tiles.stadiamaps.com/tiles/alidade_smooth_dark/{z}/{x}/{y}{r}.png',
            keyParam: 'api_key',
            maxZoom: 20,
            attribution: '&copy; <a href="https://stadiamaps.com/" target="_blank" rel="noopener">Stadia Maps</a> '
                + '&copy; <a href="https://openmaptiles.org/" target="_blank" rel="noopener">OpenMapTiles</a> '
                + '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>'
        },
        carto: {
            url: 'https://basemaps.cartocdn.com/rastertiles/dark_all/{z}/{x}/{y}{r}.png',
            keyParam: 'key',
            maxZoom: 20,
            attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> '
                + '&copy; <a href="https://carto.com/attributions" target="_blank" rel="noopener">CARTO</a>'
        }
    };
    const mapKeyTag = document.querySelector('meta[name="truckcar-map-api-key"]');
    const mapApiKey = window.TRUCKCAR_MAP_API_KEY || (mapKeyTag && mapKeyTag.content) || '';
    const provider = MAP_PROVIDERS[MAP_PROVIDER];
    const tileUrl = mapApiKey ? provider.url + '?' + provider.keyParam + '=' + encodeURIComponent(mapApiKey) : provider.url;

    // Herramientas de simulación (GPS, pérdida de señal, foto, giro de pantalla): solo con ?demo=1. Sin el parámetro
    // la app del conductor no muestra ninguna (css/main.css oculta .demo-only salvo en <html data-demo="1">).
    const demoTools = new URLSearchParams(window.location.search).get('demo') === '1';
    if (demoTools) document.documentElement.dataset.demo = '1';

    window.TruckCarConfig = Object.freeze({
        demoTools,
        map: Object.freeze({ provider: MAP_PROVIDER, tileUrl, attribution: provider.attribution, maxZoom: provider.maxZoom }),
        environment: isLocal ? 'local' : 'production',
        gatewayUrl,
        apiBaseUrl: gatewayUrl + API_PREFIX,
        requestTimeoutMs: 15000,
        // Intervalo de refresco de flota/alertas en la torre de control (ms).
        pollingIntervalMs: 30000,
        // El conductor sin viaje consulta sus propuestas con esta frecuencia (ms): la propuesta vence en minutos.
        driverPollingMs: 10000,
        // Plazo para responder una propuesta NOTIFIED (Load-Allocation TRUCKCAR_ASSIGNMENT_RESPONSE_TIMEOUT_MINUTES).
        assignmentResponseMinutes: 5,
        storageKeys: {
            session: 'truckcar.session'
        }
    });

    console.info('[TruckCar] API base:', window.TruckCarConfig.apiBaseUrl,
        '(' + window.TruckCarConfig.environment + ')');
})();

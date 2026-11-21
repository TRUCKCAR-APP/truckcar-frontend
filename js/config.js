(function () {
    const LOCAL_DEVELOPMENT_GATEWAY_URL = 'http://localhost:8000';
    const API_PREFIX = '/api/v1';

    const host = window.location.hostname;
    const nativeApp = Boolean(window.Capacitor && typeof window.Capacitor.isNativePlatform === 'function'
        && window.Capacitor.isNativePlatform());
    const localDevelopment = !nativeApp && window.location.protocol === 'http:'
        && (host === 'localhost' || host === '127.0.0.1');
    const servedByGateway = !nativeApp && !localDevelopment && /^https?:$/.test(window.location.protocol);

    const metaTag = document.querySelector('meta[name="truckcar-api-base-url"]');
    const explicitUrl = window.TRUCKCAR_API_BASE_URL || (metaTag && metaTag.content) || '';

    let gatewayUrl = '';
    if (explicitUrl) {
        gatewayUrl = explicitUrl;
    } else if (localDevelopment) {
        gatewayUrl = LOCAL_DEVELOPMENT_GATEWAY_URL;
    } else if (servedByGateway) {
        gatewayUrl = window.location.origin;
    }
    gatewayUrl = gatewayUrl.replace(/\/+$/, '').replace(/\/api\/v1$/, '');

    const mapKeyTag = document.querySelector('meta[name="truckcar-map-api-key"]');
    const mapApiKey = window.TRUCKCAR_MAP_API_KEY || (mapKeyTag && mapKeyTag.content) || '';
    // Stadia sin clave solo sirve teselas a localhost (en otro dominio responde 401) y CARTO ya exige clave en todas sus
    // URL (devuelve una tesela con «API KEY REQUIRED»). Fuera de localhost y sin clave se usa el mapa gris de Esri, que no
    // la pide: la base y, encima, la capa de nombres de calles. Con TRUCKCAR_MAP_API_KEY se usa Stadia en todo dominio.
    const onLocalhost = ['localhost', '127.0.0.1'].includes(window.location.hostname);
    const MAP_PROVIDER = mapApiKey || onLocalhost ? 'stadia' : 'esri';
    const MAP_PROVIDERS = {
        stadia: {
            url: 'https://tiles.stadiamaps.com/tiles/alidade_smooth_dark/{z}/{x}/{y}{r}.png',
            lightUrl: 'https://tiles.stadiamaps.com/tiles/alidade_smooth/{z}/{x}/{y}{r}.png',
            keyParam: 'api_key',
            maxZoom: 20,
            attribution: '&copy; <a href="https://stadiamaps.com/" target="_blank" rel="noopener">Stadia Maps</a> '
                + '&copy; <a href="https://openmaptiles.org/" target="_blank" rel="noopener">OpenMapTiles</a> '
                + '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>'
        },
        esri: {
            url: 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}',
            lightUrl: 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}',
            labelsUrl: 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}',
            lightLabelsUrl: 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Reference/MapServer/tile/{z}/{y}/{x}',
            keyParam: null,
            maxZoom: 20,
            // Esri dibuja hasta el nivel 16; más cerca, Leaflet amplía esas teselas.
            maxNativeZoom: 16,
            attribution: 'Tiles &copy; <a href="https://www.esri.com/" target="_blank" rel="noopener">Esri</a> '
                + '&mdash; Esri, HERE, Garmin, &copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>'
        }
    };
    const provider = MAP_PROVIDERS[MAP_PROVIDER];
    const withKey = (url) => mapApiKey && provider.keyParam ? url + '?' + provider.keyParam + '=' + encodeURIComponent(mapApiKey) : url;
    const tileUrl = withKey(provider.url);

    const responseTag = document.querySelector('meta[name="truckcar-assignment-response-minutes"]');
    const injectedResponseMinutes = Number(window.TRUCKCAR_ASSIGNMENT_RESPONSE_MINUTES || (responseTag && responseTag.content));

    const demoTools = new URLSearchParams(window.location.search).get('demo') === '1';
    if (demoTools) document.documentElement.dataset.demo = '1';

    window.TruckCarConfig = Object.freeze({
        demoTools,
        map: Object.freeze({ provider: MAP_PROVIDER, tileUrl, lightTileUrl: withKey(provider.lightUrl),
            labelsUrl: provider.labelsUrl || null, lightLabelsUrl: provider.lightLabelsUrl || null,
            attribution: provider.attribution, maxZoom: provider.maxZoom, maxNativeZoom: provider.maxNativeZoom || provider.maxZoom,
            /**
             * Capa del mapa para el tema dado: la base y, si el proveedor la tiene, la de nombres de calles encima.
             * setTheme(tema) cambia las dos sin recrear el mapa.
             */
            layer(theme) {
                const light = theme === 'light';
                const options = { maxZoom: provider.maxZoom, maxNativeZoom: provider.maxNativeZoom || provider.maxZoom, crossOrigin: true };
                const base = window.L.tileLayer(light ? withKey(provider.lightUrl) : tileUrl, { ...options, attribution: provider.attribution });
                const labelsFor = (dark) => (dark ? provider.labelsUrl : provider.lightLabelsUrl) || null;
                const labels = labelsFor(!light) ? window.L.tileLayer(labelsFor(!light), { ...options, zIndex: 2 }) : null;
                const group = window.L.layerGroup(labels ? [base, labels] : [base]);
                group.setTheme = (next) => {
                    const isLight = next === 'light';
                    base.setUrl(isLight ? withKey(provider.lightUrl) : tileUrl);
                    if (labels && labelsFor(!isLight)) labels.setUrl(labelsFor(!isLight));
                };
                return group;
            }
        }),
        environment: localDevelopment ? 'local' : 'production',
        nativeApp,
        gatewayUrl,
        apiBaseUrl: gatewayUrl ? gatewayUrl + API_PREFIX : '',
        routingUrl: 'https://router.project-osrm.org/route/v1/driving/',
        requestTimeoutMs: 15000,
        pollingIntervalMs: 30000,
        driverPollingMs: 10000,
        assignmentResponseMinutes: injectedResponseMinutes > 0 ? injectedResponseMinutes : 5,
        assignmentMaxAttempts: 5,
        shipmentsPollingOnlineMs: 60000,
        shipmentsPollingOfflineMs: 10000,
        storageKeys: {
            session: 'truckcar.session'
        }
    });
})();

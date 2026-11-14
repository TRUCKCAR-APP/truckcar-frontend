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

    const MAP_PROVIDER = 'stadia';
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
        carto: {
            url: 'https://basemaps.cartocdn.com/rastertiles/dark_all/{z}/{x}/{y}{r}.png',
            lightUrl: 'https://basemaps.cartocdn.com/rastertiles/light_all/{z}/{x}/{y}{r}.png',
            keyParam: 'key',
            maxZoom: 20,
            attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> '
                + '&copy; <a href="https://carto.com/attributions" target="_blank" rel="noopener">CARTO</a>'
        }
    };
    const mapKeyTag = document.querySelector('meta[name="truckcar-map-api-key"]');
    const mapApiKey = window.TRUCKCAR_MAP_API_KEY || (mapKeyTag && mapKeyTag.content) || '';
    const provider = MAP_PROVIDERS[MAP_PROVIDER];
    const withKey = (url) => mapApiKey ? url + '?' + provider.keyParam + '=' + encodeURIComponent(mapApiKey) : url;
    const tileUrl = withKey(provider.url);

    const demoTools = new URLSearchParams(window.location.search).get('demo') === '1';
    if (demoTools) document.documentElement.dataset.demo = '1';

    window.TruckCarConfig = Object.freeze({
        demoTools,
        map: Object.freeze({ provider: MAP_PROVIDER, tileUrl, lightTileUrl: withKey(provider.lightUrl), attribution: provider.attribution, maxZoom: provider.maxZoom }),
        environment: localDevelopment ? 'local' : 'production',
        nativeApp,
        gatewayUrl,
        apiBaseUrl: gatewayUrl ? gatewayUrl + API_PREFIX : '',
        routingUrl: 'https://router.project-osrm.org/route/v1/driving/',
        requestTimeoutMs: 15000,
        pollingIntervalMs: 30000,
        storageKeys: {
            session: 'truckcar.session'
        }
    });
})();

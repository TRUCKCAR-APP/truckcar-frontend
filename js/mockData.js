/**
 * Estado de datos de la interfaz.
 *
 * Las secciones respaldadas por microservicios arrancan vacías y las llena js/dataService.js
 * a través del api-gateway: currentDriver, activeLoadOrder, dispatchEvaluation, routes,
 * communityAlerts y fleetVehicles.
 *
 * Solo quedan datos locales del dispositivo:
 *   - offlineSyncData: estado de la señal y resumen de la caché de mapa (js/app.js lo llena desde el Service Worker).
 *     La cola sin señal vive en IndexedDB (js/offlineQueue.js).
 *
 * La navegación paso a paso sale de la ruta real de la carga (js/navigation.js: Route-AI + OSRM), y las restricciones de
 * gálibo y peso de esa ruta, de Routing-Restrictions.
 */
window.TruckCarData = {
    currentDriver: null,
    activeLoadOrder: null,
    availableLoads: [],
    dispatchEvaluation: { loadId: null, evaluatedAt: '—', candidates: [] },
    routes: null,
    communityAlerts: [],
    fleetVehicles: [],

    offlineSyncData: {
        isOffline: false
    },

};

/**
 * Estado de datos de la interfaz.
 *
 * Las secciones respaldadas por microservicios arrancan vacías y las llena js/dataService.js
 * a través del api-gateway: currentDriver, activeLoadOrder, dispatchEvaluation, routes,
 * communityAlerts y fleetVehicles.
 *
 * Solo quedan datos locales del dispositivo:
 *   - offlineSyncData: regiones de mapa y cola offline del dispositivo.
 *
 * La navegación paso a paso sale de la ruta real de la carga (js/navigation.js: Route-AI + OSRM).
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
        isOffline: false,
        cachedRegions: [
            { id: 'reg-1', name: 'Corredor Bogotá - Ibagué - Armenia', size: '48.2 MB', status: 'Descargado', updated: 'Hoy, 06:00' },
            { id: 'reg-2', name: 'Sector La Línea y Cruce Cordillera', size: '32.6 MB', status: 'Descargado', updated: 'Ayer' },
            { id: 'reg-3', name: 'Valle del Cauca - Buenaventura', size: '54.1 MB', status: 'Descargado', updated: 'Hoy, 07:15' }
        ],
        pendingQueue: [
            { id: 'Q-1', type: 'Punto de telemetría GPS (Km 142)', time: '18:22:10', status: 'En cola' },
            { id: 'Q-2', type: 'Confirmación paso Báscula Flandes', time: '18:24:35', status: 'En cola' },
            { id: 'Q-3', type: 'Reporte conductor: Vía despejada Cajamarca', time: '18:25:01', status: 'En cola' }
        ]
    },

};

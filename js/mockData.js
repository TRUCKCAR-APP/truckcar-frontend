/**
 * Estado de datos de la interfaz.
 *
 * Las secciones respaldadas por microservicios arrancan vacías y las llena js/dataService.js
 * a través del api-gateway: currentDriver, activeLoadOrder, dispatchEvaluation, routes,
 * communityAlerts y fleetVehicles.
 *
 * Solo quedan datos locales para lo que aún no tiene backend:
 *   - liveNavigationSteps: guía turn-by-turn simulada (botón "Avanzar GPS").
 *   - offlineSyncData: regiones de mapa y cola offline del dispositivo.
 */
window.TruckCarData = {
    currentDriver: null,
    activeLoadOrder: null,
    availableLoads: [],
    dispatchEvaluation: { loadId: null, evaluatedAt: '—', candidates: [] },
    routes: null,
    communityAlerts: [],
    fleetVehicles: [],

    liveNavigationSteps: [
        {
            stepIndex: 1,
            distanceLeft: '450 m',
            maneuver: 'turn-right',
            maneuverText: 'En 450 metros gire a la derecha por la Variante Mosquera hacia Peaje Chusacá',
            street: 'Variante Mosquera - Girardot',
            speedLimit: 60,
            currentSpeed: 54,
            coords: { lat: 4.6752, lng: -74.1450 },
            voiceAudioText: 'En cuatrocientos cincuenta metros gire a la derecha por la variante hacia Chusacá. Recuerde mantener carril derecho.',
            alert: {
                type: 'info',
                title: 'Gálibo Seguro',
                text: 'Puentes despejados para 4.25m'
            }
        },
        {
            stepIndex: 2,
            distanceLeft: '1.2 km',
            maneuver: 'straight',
            maneuverText: 'Continúe recto 1.2 km. Carril exclusivo de pesados habilitado',
            street: 'Ruta 40 - Doble Calzada',
            speedLimit: 70,
            currentSpeed: 64,
            coords: { lat: 4.5833, lng: -74.2389 },
            voiceAudioText: 'Continúe un kilómetro doscientos metros. Telepeaje habilitado en caseta tres.',
            alert: {
                type: 'scale',
                title: 'Báscula Próxima',
                text: 'Báscula Flandes operando a 15 km'
            }
        },
        {
            stepIndex: 3,
            distanceLeft: '800 m',
            maneuver: 'warning',
            maneuverText: 'Atención: Pendiente pronunciada 9% - Boquerón. Active freno de motor.',
            street: 'Descenso Alto de Rosas',
            speedLimit: 40,
            currentSpeed: 38,
            coords: { lat: 4.3411, lng: -74.3644 },
            voiceAudioText: 'Atención conductor: Pendiente pronunciada en descenso. Reduzca velocidad y aplique freno de motor en cambio bajo.',
            alert: {
                type: 'danger',
                title: 'Zona de Frenado',
                text: 'Rampa de emergencia a 2.4 km a la derecha'
            }
        },
        {
            stepIndex: 4,
            distanceLeft: '500 m',
            maneuver: 'scale',
            maneuverText: 'Báscula de Pesaje Obligatoria - Carril derecho abierto',
            street: 'Puesto de Control Flandes',
            speedLimit: 30,
            currentSpeed: 28,
            coords: { lat: 4.2882, lng: -74.8083 },
            voiceAudioText: 'Aproximándose a báscula de pesaje oficial. Ingrese a treinta kilómetros por hora por carril de pesaje dinámico.',
            alert: {
                type: 'scale',
                title: 'Pesaje Dinámico',
                text: 'Peso bruto registrado: 41.0 Toneladas (En norma)'
            }
        },
        {
            stepIndex: 5,
            distanceLeft: '300 m',
            maneuver: 'tunnel',
            maneuverText: 'Ingreso a Complejo de Túneles La Línea (Gálibo 4.80m)',
            street: 'Túnel Principal de La Línea',
            speedLimit: 50,
            currentSpeed: 48,
            coords: { lat: 4.4982, lng: -75.5689 },
            voiceAudioText: 'Ingresando a Túnel de La Línea. Gálibo verificado. Encienda luces bajas y mantenga cincuenta metros de distancia.',
            alert: {
                type: 'success',
                title: 'Túnel Seguro',
                text: 'Altura verificada: 4.80m vs 4.25m vehículo'
            }
        }
    ],

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

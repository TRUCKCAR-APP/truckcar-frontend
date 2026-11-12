window.DemoSession = {
    start(role = 'driver') {
        if (!window.TruckCarConfig.demoTools) {
            window.ui.toast('La sesión de demostración solo está disponible con ?demo=1.', 'warning');
            return;
        }
        const isDriver = role === 'driver';
        const session = {
            accessToken: 'demo-token',
            userId: isDriver ? 'abc27ef4-1e64-4b94-809a-9605ddc3d2e5' : 'coord-1',
            email: isDriver ? 'conductor@truckcar.demo' : 'torre@truckcar.demo',
            role: isDriver ? 'CONDUCTOR' : 'COORDINADOR',
            expiresAt: Date.now() + 86400000
        };
        try { localStorage.setItem(window.TruckCarConfig.storageKeys.session, JSON.stringify(session)); } catch (e) {}

        window.TruckCarData.currentDriver = {
            id: 'abc27ef4-1e64-4b94-809a-9605ddc3d2e5',
            userId: 'abc27ef4-1e64-4b94-809a-9605ddc3d2e5',
            name: 'Carlos Conductor',
            email: 'conductor@truckcar.demo',
            phone: '3104567890',
            licenseNumber: 'C3-994821',
            hoursDrivenToday: 2.5,
            maxDailyHours: 9,
            restRequired: false,
            status: 'EN_TRANSITO',
            rating: 4.8,
            tripsCompleted: 126,
            hasVehicle: true,
            vehicle: {
                plate: 'TDK-410',
                brand: 'Kenworth T800 2021',
                category: 'TRACTOMULA_3S3',
                height: 4.1,
                grossWeight: 40.0,
                tareWeight: 16.0,
                maxPayload: 34.0,
                badges: ['Verificado', 'GPS Activo']
            },
            coords: [4.6486, -74.1481]
        };

        window.TruckCarData.activeLoadOrder = {
            id: 'CARGA-88',
            backendId: 88,
            status: 'IN_TRANSIT',
            assignmentStatus: 'ACCEPTED',
            assignedDriverId: 'abc27ef4-1e64-4b94-809a-9605ddc3d2e5',
            assignedDriverName: 'Carlos Conductor',
            assignedVehiclePlate: 'TDK-410',
            cargoType: 'Café excelso de exportación',
            netWeight: 24.0,
            origin: { city: 'Bogotá', department: 'Cundinamarca', latitude: 4.6097, longitude: -74.0817 },
            destination: { city: 'Ibagué', department: 'Tolima', latitude: 4.4389, longitude: -75.2322 },
            routeDistanceKm: 204.0,
            estimatedHours: 4.5,
            pricing: { offeredBudget: 3800000 }
        };

        window.TruckCarData.availableLoads = [window.TruckCarData.activeLoadOrder];

        window.TruckCarData.fleetVehicles = [
            {
                id: 'abc27ef4-1e64-4b94-809a-9605ddc3d2e5',
                driverId: 'abc27ef4-1e64-4b94-809a-9605ddc3d2e5',
                driverName: 'Carlos Conductor',
                plate: 'TDK-410',
                model: 'Kenworth T800 2021',
                rawType: 'TRACTOMULA_3S3',
                vehicleType: 'Kenworth T800 • Tractomula 3S3',
                height: 4.1,
                tareWeight: 16.0,
                maxPayload: 34.0,
                phone: '3104567890',
                status: 'EN_TRANSITO',
                speed: 62,
                hoursActive: '2.5h',
                lastCheckin: 'Hace 1 min',
                currentLoadId: 88,
                coords: [4.6486, -74.1481]
            },
            {
                id: '4462bf82-702a-4745-b231-ae0b4ea4b24d',
                driverId: '4462bf82-702a-4745-b231-ae0b4ea4b24d',
                driverName: 'Diana Ríos',
                plate: 'SNT-238',
                model: 'International WorkStar 2019',
                rawType: 'DOBLETROQUE',
                vehicleType: 'International • Dobletroque',
                height: 3.8,
                tareWeight: 12.0,
                maxPayload: 22.0,
                phone: '3157891234',
                status: 'DISPONIBLE',
                speed: 0,
                hoursActive: '0h',
                lastCheckin: 'Hace 5 min',
                coords: [4.7110, -74.0721]
            },
            {
                id: '207a8e39-990e-48da-9b85-10178c83a8cb',
                driverId: '207a8e39-990e-48da-9b85-10178c83a8cb',
                driverName: 'Ana Ruiz',
                plate: 'TKR-527',
                model: 'Freightliner Cascadia 2022',
                rawType: 'TRACTOMULA_3S3',
                vehicleType: 'Freightliner • Tractomula 3S3',
                height: 4.2,
                tareWeight: 15.5,
                maxPayload: 35.0,
                phone: '3189998877',
                status: 'DESCANSO',
                speed: 0,
                hoursActive: '8.5h',
                lastCheckin: 'Hace 12 min',
                coords: [4.5339, -75.6811]
            }
        ];

        window.TruckCarData.dispatchEvaluation = {
            loadId: 88,
            evaluatedAt: 'Hace 15 min',
            candidates: [
                {
                    driverId: 'abc27ef4-1e64-4b94-809a-9605ddc3d2e5',
                    driverName: 'Carlos Conductor',
                    vehiclePlate: 'TDK-410',
                    driverPhone: '3104567890',
                    score: 94,
                    isCurrentAssignment: true,
                    deadheadDistanceKm: 4.2,
                    decisionStatus: 'ACCEPTED',
                    executedAt: 'Hace 1 h',
                    reason: 'Mayor compatibilidad de gálibo y cercanía al punto de carga en Bogotá.',
                }
            ]
        };

        window.TruckCarData.communityAlerts = [
            {
                id: 1,
                type: 'landslide',
                title: 'Paso a un carril por derrumbe',
                corridor: 'Bogotá – Fusagasugá km 42',
                severity: 'ALTA',
                badge: 'Derrumbe',
                verified: true,
                timeAgo: 'Hace 15 min',
                coords: [4.425, -74.28]
            },
            {
                id: 2,
                type: 'bridge',
                title: 'Gálibo bajo en puente (4.1 m)',
                corridor: 'La Línea km 18',
                severity: 'ALTA',
                badge: 'Gálibo Bajo',
                verified: true,
                timeAgo: 'Hace 40 min',
                coords: [4.46, -75.35]
            }
        ];

        window.store.setState({
            isAuthenticated: true,
            currentUser: {
                id: session.userId,
                firstName: isDriver ? 'Carlos' : 'Tomás',
                lastName: isDriver ? 'Conductor' : 'Torre',
                email: session.email,
                role: session.role
            },
            sessionRole: session.role,
            activeRole: role,
            authError: null
        });

        window.ui.toast('Sesión demo iniciada como ' + (isDriver ? 'Conductor' : 'Torre de Control'), 'success');
    }
};

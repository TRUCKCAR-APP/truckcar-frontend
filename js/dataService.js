/**
 * Capa de datos: consume window.TruckDarApi y adapta las respuestas del backend al modelo
 * que usan las vistas (window.TruckDarData). Las secciones sin backend equivalente
 * (pasos de navegación turn-by-turn y regiones offline) siguen siendo simulación local.
 */
(function () {
    const api = window.TruckDarApi;
    const data = window.TruckDarData;

    const ALERT_TYPE_TO_UI = {
        BASCULA: 'scale',
        GALIBO_REDUCIDO: 'bridge',
        RETEN: 'police',
        PARADOR_SEGURO: 'rest',
        DERRUMBE: 'danger',
        ACCIDENTE: 'danger',
        OBRA_EN_VIA: 'workshop'
    };
    const UI_TO_ALERT_TYPE = {
        scale: 'BASCULA',
        bridge: 'GALIBO_REDUCIDO',
        police: 'RETEN',
        rest: 'PARADOR_SEGURO',
        danger: 'ACCIDENTE',
        workshop: 'OBRA_EN_VIA'
    };
    const ALERT_BADGES = {
        BASCULA: 'Báscula Activa',
        GALIBO_REDUCIDO: 'Gálibo Bajo',
        RETEN: 'Puesto de Control',
        PARADOR_SEGURO: 'Parqueadero Seguro',
        DERRUMBE: 'Derrumbe',
        ACCIDENTE: 'Accidente',
        OBRA_EN_VIA: 'Obra en Vía'
    };
    const ALERT_VALIDATION_THRESHOLD = 3;

    // ------------------------------------------------------------- utilidades
    function timeAgo(isoDate) {
        if (!isoDate) return '';
        const diffMs = Date.now() - new Date(isoDate).getTime();
        if (Number.isNaN(diffMs)) return '';
        const minutes = Math.max(0, Math.round(diffMs / 60000));
        if (minutes < 1) return 'Hace un momento';
        if (minutes < 60) return 'Hace ' + minutes + ' min';
        const hours = Math.round(minutes / 60);
        if (hours < 24) return 'Hace ' + hours + (hours === 1 ? ' hora' : ' horas');
        const days = Math.round(hours / 24);
        return 'Hace ' + days + (days === 1 ? ' día' : ' días');
    }

    function formatCop(value) {
        if (value === null || value === undefined || value === '') return '—';
        const number = Number(value);
        if (Number.isNaN(number)) return String(value);
        return '$ ' + number.toLocaleString('es-CO', { maximumFractionDigits: 0 }) + ' COP';
    }

    function formatDateTime(isoDate) {
        if (!isoDate) return '—';
        const date = new Date(isoDate);
        if (Number.isNaN(date.getTime())) return '—';
        return date.toLocaleString('es-CO', { dateStyle: 'medium', timeStyle: 'short' });
    }

    function formatHours(hours) {
        if (hours === null || hours === undefined) return '—';
        const h = Math.floor(hours);
        const m = Math.round((hours - h) * 60);
        return h + 'h ' + String(m).padStart(2, '0') + 'm';
    }

    function coordsOrNull(lat, lng) {
        return (typeof lat === 'number' && typeof lng === 'number') ? [lat, lng] : null;
    }

    function setStatus(partial) {
        window.store.setState({ dataStatus: { ...window.store.state.dataStatus, ...partial } });
    }

    function recordError(section, error) {
        // 403: la vista no corresponde al rol; app.js redirige a la vista propia (evento truckdar:forbidden).
        if (error && error.status === 403) return;
        console.error('[TruckDar] Error cargando ' + section, error);
        const errors = { ...window.store.state.dataStatus.errors, [section]: error.message || String(error) };
        setStatus({ errors });
    }

    function clearError(section) {
        if (!(section in window.store.state.dataStatus.errors)) return;
        const errors = { ...window.store.state.dataStatus.errors };
        delete errors[section];
        setStatus({ errors });
    }

    // ------------------------------------------------------------- mapeadores
    function mapDriver(user, state) {
        const fullName = user ? [user.firstName, user.lastName].filter(Boolean).join(' ') : '';
        return {
            id: state ? state.driverId : (user && user.id),
            userId: user && user.id,
            name: fullName || (state && state.driverName) || (user && user.email) || 'Conductor',
            email: user && user.email,
            phone: (user && user.phoneNumber) || '—',
            avatar: null,
            licenseNumber: (state && state.licenseCategory) || (user && user.documentNumber) || '—',
            hoursDrivenToday: state && state.drivingHoursToday != null ? state.drivingHoursToday : 0,
            maxDailyHours: (state && state.maxDailyDrivingHours) || 9,
            restRequired: Boolean(state && state.restRequiredAlert),
            status: (state && state.status) || 'SIN_VEHICULO',
            rating: state && state.rating != null ? state.rating : '—',
            tripsCompleted: state && state.totalTrips != null ? state.totalTrips : 0,
            hasVehicle: Boolean(state),
            vehicle: state ? {
                plate: state.vehiclePlate,
                brand: state.vehicleModel || '—',
                category: state.vehicleType || '—',
                height: state.maxHeightMeters,
                maxWeight: state.grossWeightTons != null ? state.grossWeightTons : state.netCargoWeightTons,
                netCargoWeight: state.netCargoWeightTons,
                tareWeight: state.tareWeightTons,
                hazmatAuthorized: Boolean(state.hazmatAuthorized),
                coldChainCertified: Boolean(state.coldChainCertified),
                electronicTollTagActive: Boolean(state.electronicTollTagActive),
                runtValid: Boolean(state.runtValid),
                badges: state.activeBadges || []
            } : null,
            coords: state ? coordsOrNull(state.currentLatitude, state.currentLongitude) : null
        };
    }

    function mapFleetVehicle(state) {
        let status = (state.status || 'DESCONOCIDO').toUpperCase();
        if (state.restRequiredAlert) {
            status = 'DESCANSO';
        } else if (status === 'ACTIVO') {
            // Con un viaje IN_TRANSIT (fleets-drivers) el camión está en ruta aunque reporte velocidad 0.
            status = (state.currentSpeedKmH || 0) > 0 || state.currentLoadStatus === 'IN_TRANSIT' ? 'EN_TRANSITO' : 'DISPONIBLE';
        }
        return {
            id: state.driverId,
            driverId: state.driverId,
            driverName: state.driverName || state.driverId,
            plate: state.vehiclePlate,
            vehicleType: [state.vehicleModel, state.vehicleType].filter(Boolean).join(' · ') || '—',
            status,
            speed: Math.round(state.currentSpeedKmH || 0),
            hoursActive: state.drivingHoursToday != null ? state.drivingHoursToday + 'h' : '—',
            lastCheckin: timeAgo(state.lastUpdate),
            currentLoadId: state.currentLoadId,
            coords: coordsOrNull(state.currentLatitude, state.currentLongitude)
        };
    }

    function mapAlert(alert) {
        const confirmations = alert.confirmationsCount || 1;
        return {
            id: alert.id,
            type: ALERT_TYPE_TO_UI[alert.alertType] || 'danger',
            alertType: alert.alertType,
            severity: alert.severity,
            badge: ALERT_BADGES[alert.alertType] || alert.alertType,
            title: alert.title,
            description: alert.description || (alert.roadCorridor ? 'Corredor ' + alert.roadCorridor : ''),
            timeAgo: timeAgo(alert.reportedAt),
            author: alert.driverName || alert.driverId || 'Red TruckDar',
            upvotes: confirmations,
            coords: coordsOrNull(alert.latitude, alert.longitude),
            corridor: alert.roadCorridor,
            verified: confirmations >= ALERT_VALIDATION_THRESHOLD
        };
    }

    function mapLoad(load) {
        return {
            id: 'CARGA-' + load.id,
            backendId: load.id,
            customer: load.generatorCompanyName,
            generatorCompanyId: load.generatorCompanyId,
            origin: {
                name: [load.originCity, load.originDepartment].filter(Boolean).join(', '),
                city: load.originCity,
                coords: coordsOrNull(load.originLatitude, load.originLongitude)
            },
            destination: {
                name: [load.destinationCity, load.destinationDepartment].filter(Boolean).join(', '),
                city: load.destinationCity,
                coords: coordsOrNull(load.destinationLatitude, load.destinationLongitude)
            },
            cargoType: load.cargoDescription,
            requiredTruckType: load.requiredTruckType,
            netWeight: load.weightTons,
            volumeM3: load.volumeM3,
            freightPayment: formatCop(load.offeredBudget),
            scheduledDeparture: formatDateTime(load.publishedAt),
            status: load.status,
            assignmentStatus: load.assignmentStatus,
            assignedDriverId: load.assignedDriverId,
            assignedDriverName: load.assignedDriverName,
            assignedVehiclePlate: load.assignedVehiclePlate,
            correlationId: load.correlationId,
            publishedAt: load.publishedAt,
            assignedAt: load.assignedAt,
            tripStartedAt: load.tripStartedAt,
            deliveredAt: load.deliveredAt,
            podReceiverName: load.podReceiverName,
            podReceiverDocument: load.podReceiverDocument,
            podNotes: load.podNotes,
            podHasSignature: !!load.podHasSignature,
            podHasPhoto: !!load.podHasPhoto,
            deliveredAtLabel: formatDateTime(load.deliveredAt),
            cancellationReason: load.cancellationReason,
            cancelledAt: load.cancelledAt,
            // Se completan con el plan de ruta cuando está disponible.
            estimatedDuration: '—',
            totalDistance: '—',
            tollsCount: '—',
            specialRequirements: []
        };
    }

    function mapEvaluation(load, decisions) {
        const candidates = (decisions || [])
            .filter(d => d.selectedDriverId)
            .map((d, index) => ({
                driverId: d.selectedDriverId,
                driverName: d.selectedDriverName || d.selectedDriverId,
                vehiclePlate: d.selectedVehiclePlate || '—',
                score: d.matchingScore != null ? Math.round(d.matchingScore) : null,
                status: index === 0 ? 'Recomendación más reciente' : 'Recomendación anterior',
                statusClass: index === 0 ? 'success' : 'warning',
                deadheadDistanceKm: d.deadheadDistanceKm,
                reason: d.reasonDetails,
                decisionStatus: d.status,
                executedAt: formatDateTime(d.executedAt),
                isCurrentAssignment: load && d.selectedDriverId === load.assignedDriverId
            }));
        return {
            loadId: load ? load.id : null,
            evaluatedAt: decisions && decisions[0] ? formatDateTime(decisions[0].executedAt) : '—',
            candidates
        };
    }

    function mapRoutePlan(plan, load) {
        const waypoints = [];
        if (load && load.origin.coords) {
            waypoints.push({ name: load.origin.name + ' (Cargue)', coords: load.origin.coords, instruction: 'Punto de cargue' });
        }
        if (load && load.destination.coords) {
            waypoints.push({ name: load.destination.name + ' (Destino)', coords: load.destination.coords, instruction: 'Punto de entrega' });
        }
        const blocked = (plan.alternatives || []).find(alt => alt.isPassable === false);
        return {
            optimal: {
                id: 'PLAN-' + plan.planId,
                title: plan.recommendedCorridor || (plan.originCity + ' → ' + plan.destinationCity),
                name: 'Riesgo ' + (plan.riskLevel || 'N/D'),
                riskLevel: plan.riskLevel,
                distance: plan.totalDistanceKm != null ? Math.round(plan.totalDistanceKm) + ' km' : '—',
                eta: formatHours(plan.estimatedDurationHours),
                tolls: '—',
                hazards: plan.activeAlertsCount || 0,
                clearanceWarning: (plan.warnings && plan.warnings[0]) || plan.aiRecommendation || 'Sin advertencias activas',
                aiRecommendation: plan.aiRecommendation,
                features: (plan.segments || []).map(s =>
                    s.segmentName + (s.distanceKm != null ? ' · ' + Math.round(s.distanceKm) + ' km' : '')
                    + (s.condition ? ' (' + s.condition + ')' : '')),
                warnings: plan.warnings || [],
                waypoints
            },
            rejectedAlternate: blocked ? {
                id: 'ALT-' + blocked.corridorName,
                title: blocked.corridorName,
                name: 'Corredor descartado por el sistema de ruteo',
                distance: blocked.distanceKm != null ? Math.round(blocked.distanceKm) + ' km' : '—',
                eta: formatHours(blocked.estimatedHours),
                rejectionReasons: blocked.issues && blocked.issues.length ? blocked.issues : ['Corredor no transitable para este vehículo']
            } : null
        };
    }

    // ------------------------------------------------------------- cargas de datos
    const service = {
        mapLoad,

        async loadCurrentUser() {
            const user = await api.users.me();
            window.store.setState({ currentUser: user });
            return user;
        },

        async loadDriverProfile() {
            const user = window.store.state.currentUser;
            const session = api.session.get();
            const driverId = (user && user.id) || (session && session.userId);
            try {
                const state = driverId ? await api.fleet.getDriver(driverId) : null;
                data.currentDriver = mapDriver(user, state);
                clearError('driver');
            } catch (error) {
                if (error.isNotFound) {
                    data.currentDriver = mapDriver(user, null);
                    clearError('driver');
                } else {
                    recordError('driver', error);
                }
            }
        },

        async loadDriverAssignment() {
            const driver = data.currentDriver;
            if (!driver || !driver.id) return;
            try {
                // GET /loads/mine: propuestas vigentes, aceptadas y en tránsito del conductor autenticado.
                // Prioridad: el viaje en curso, luego el aceptado, luego la propuesta pendiente.
                const mine = (await api.loads.mine()) || [];
                const rank = load => load.status === 'IN_TRANSIT' ? 0 : load.status === 'ASSIGNED' ? 1 : 2;
                const current = mine.slice().sort((a, b) => rank(a) - rank(b))[0];
                const previous = data.activeLoadOrder;
                data.activeLoadOrder = current ? mapLoad(current) : null;
                if (data.activeLoadOrder && previous && previous.backendId === data.activeLoadOrder.backendId) {
                    // Conserva distancia y duración ya calculadas por Route-AI para la misma carga.
                    data.activeLoadOrder.totalDistance = previous.totalDistance;
                    data.activeLoadOrder.estimatedDuration = previous.estimatedDuration;
                }
                clearError('loads');
            } catch (error) {
                recordError('loads', error);
            }
        },

        async loadCoordinatorLoad() {
            try {
                const available = await api.loads.listAvailable();
                const loads = available || [];
                const selectedId = window.store.state.selectedLoadId;
                const selected = loads.find(l => l.id === selectedId) || loads[0] || null;
                data.availableLoads = loads.map(mapLoad);
                data.activeLoadOrder = selected ? mapLoad(selected) : null;
                window.store.setState({ selectedLoadId: selected ? selected.id : null });
                clearError('loads');
            } catch (error) {
                recordError('loads', error);
            }
            await this.loadEvaluation();
        },

        /** Historial de entregas de la torre de control (las firmas y fotos se piden al abrir cada POD). */
        async loadDeliveredLoads() {
            try {
                const delivered = (await api.loads.list(['DELIVERED'])) || [];
                data.deliveredLoads = delivered.slice(0, 30).map(mapLoad);
                clearError('deliveries');
            } catch (error) {
                recordError('deliveries', error);
            }
        },

        /** Panel del generador: sus envíos (todas las cargas que publicó, en cualquier status). */
        async loadPublishedLoads() {
            try {
                const published = (await api.loads.published()) || [];
                data.publishedLoads = published.map(mapLoad);
                clearError('shipments');
            } catch (error) {
                recordError('shipments', error);
            }
        },

        /** Posición actual de los conductores de los envíos aceptados o en ruta (fleets-drivers, por conductor). */
        async loadShipmentTrucks() {
            const drivers = [...new Set((data.publishedLoads || [])
                .filter(l => (l.status === 'ASSIGNED' || l.status === 'IN_TRANSIT') && l.assignedDriverId)
                .map(l => l.assignedDriverId))];
            const trucks = {};
            await Promise.all(drivers.map(async (driverId) => {
                try {
                    trucks[driverId] = mapFleetVehicle(await api.fleet.getDriver(driverId));
                } catch (error) {
                    // Sin estado en fleets-drivers: el envío se muestra sin posición del camión.
                }
            }));
            data.shipmentTrucks = trucks;
        },

        /** "Mis envíos": cargas propias y luego la posición de sus camiones. */
        async refreshShipments() {
            await this.loadPublishedLoads();
            await this.loadShipmentTrucks();
        },

        /** POST /loads: la empresa generadora la fija el backend con el usuario autenticado. */
        async publishLoad(request) {
            const created = await api.loads.publish(request);
            await this.loadPublishedLoads();
            return mapLoad(created);
        },

        /** POD completo (receptor, documento, notas, firma y foto) de una carga entregada. */
        getProofOfDelivery(loadId) {
            return api.loads.proofOfDelivery(loadId);
        },

        async loadEvaluation() {
            const load = data.activeLoadOrder;
            if (!load) {
                data.dispatchEvaluation = mapEvaluation(null, []);
                return;
            }
            try {
                const decisions = await api.allocation.history(load.backendId);
                data.dispatchEvaluation = mapEvaluation(load, decisions);
                clearError('evaluation');
            } catch (error) {
                data.dispatchEvaluation = mapEvaluation(load, []);
                recordError('evaluation', error);
            }
        },

        async loadFleet() {
            try {
                const states = await api.fleet.listActive();
                data.fleetVehicles = (states || []).map(mapFleetVehicle).filter(v => v.coords);
                clearError('fleet');
            } catch (error) {
                recordError('fleet', error);
            }
        },

        async loadAlerts() {
            try {
                const alerts = await api.alerts.listActive();
                data.communityAlerts = (alerts || []).map(mapAlert)
                    .sort((a, b) => (b.id || 0) - (a.id || 0));
                clearError('alerts');
            } catch (error) {
                recordError('alerts', error);
            }
        },

        /** Planea la ruta de la carga activa con Route-AI (una vez por carga para no generar planes duplicados). */
        async loadRoutePlan({ force = false } = {}) {
            const load = data.activeLoadOrder;
            const driver = data.currentDriver;
            if (!load || !driver || !driver.vehicle || !load.origin.city || !load.destination.city) {
                return;
            }
            if (!force && data.routes && data.routes.planForLoadId === load.backendId) return;
            try {
                const plan = await api.routes.plan({
                    vehiclePlate: driver.vehicle.plate,
                    truckType: driver.vehicle.category,
                    grossWeightTons: (driver.vehicle.tareWeight || 0) + (load.netWeight || 0),
                    heightMeters: driver.vehicle.height,
                    originCity: load.origin.city,
                    destinationCity: load.destination.city,
                    originLatitude: load.origin.coords ? load.origin.coords[0] : null,
                    originLongitude: load.origin.coords ? load.origin.coords[1] : null,
                    destinationLatitude: load.destination.coords ? load.destination.coords[0] : null,
                    destinationLongitude: load.destination.coords ? load.destination.coords[1] : null
                });
                data.routes = { ...mapRoutePlan(plan, load), planForLoadId: load.backendId };
                load.totalDistance = data.routes.optimal.distance;
                load.estimatedDuration = data.routes.optimal.eta;
                if (window.mapCtrl) window.mapCtrl.resetRouteCache();
                clearError('routes');
            } catch (error) {
                recordError('routes', error);
            }
        },

        /** Carga inicial según el rol de la sesión. */
        async loadAll() {
            setStatus({ loading: true });
            try {
                await this.loadCurrentUser();
            } catch (error) {
                recordError('user', error);
            }
            const role = window.store.state.activeRole;
            if (role === 'generator') {
                // Generador: solo sus envíos y la posición de los conductores asignados a ellos (no la flota completa).
                await this.refreshShipments();
            } else if (role === 'coordinator') {
                await Promise.all([this.loadFleet(), this.loadAlerts(), this.loadCoordinatorLoad(), this.loadDeliveredLoads(), this.loadPublishedLoads()]);
            } else {
                await this.loadDriverProfile();
                await Promise.all([this.loadDriverAssignment(), this.loadAlerts()]);
                await this.loadRoutePlan();
            }
            setStatus({ loading: false, lastSync: new Date().toISOString() });
        },

        async refreshCoordinator() {
            await Promise.all([this.loadFleet(), this.loadAlerts(), this.loadCoordinatorLoad(), this.loadDeliveredLoads(), this.loadPublishedLoads()]);
            setStatus({ lastSync: new Date().toISOString() });
        },

        // --------------------------------------------------------- acciones
        async acceptAssignment() {
            const load = data.activeLoadOrder;
            if (!load) throw new Error('No hay una carga asignada');
            const updated = await api.loads.accept(load.backendId);
            data.activeLoadOrder = { ...mapLoad(updated), totalDistance: load.totalDistance, estimatedDuration: load.estimatedDuration };
            return data.activeLoadOrder;
        },

        async rejectAssignment() {
            const load = data.activeLoadOrder;
            if (!load) throw new Error('No hay una carga asignada');
            await api.loads.reject(load.backendId);
            data.activeLoadOrder = null;
            data.routes = null;
        },

        /** ASSIGNED -> IN_TRANSIT. */
        async startTrip() {
            const load = data.activeLoadOrder;
            if (!load) throw new Error('No hay una carga asignada');
            const updated = await api.loads.startTrip(load.backendId);
            data.activeLoadOrder = { ...mapLoad(updated), totalDistance: load.totalDistance, estimatedDuration: load.estimatedDuration };
            return data.activeLoadOrder;
        },

        /** IN_TRANSIT -> DELIVERED con la prueba de entrega. */
        async deliverLoad(pod) {
            const load = data.activeLoadOrder;
            if (!load) throw new Error('No hay una carga en tránsito');
            const updated = await api.loads.deliver(load.backendId, pod);
            data.activeLoadOrder = null;
            data.routes = null;
            // Recibo de la última entrega para la pantalla del conductor (la firma y la foto ya están en memoria).
            data.lastDelivery = { load: mapLoad(updated), pod: { ...pod, deliveredAt: updated.deliveredAt } };
            return data.lastDelivery.load;
        },

        async cancelLoad(loadId, reason) {
            const updated = await api.loads.cancel(loadId, reason);
            // La bolsa de cargas de la torre solo se recarga en la torre (un GENERADOR no tiene acceso a ella).
            if (window.store.state.activeRole === 'coordinator') {
                await this.loadCoordinatorLoad();
            }
            return mapLoad(updated);
        },

        async requestMatching(loadId) {
            const result = await api.allocation.matchLoad(loadId);
            await this.loadCoordinatorLoad();
            return result;
        },

        async reportAlert(uiType, comment, coords) {
            const driver = data.currentDriver || {};
            const alertType = UI_TO_ALERT_TYPE[uiType] || 'ACCIDENTE';
            const created = await api.alerts.create({
                clientAlertId: (window.crypto && window.crypto.randomUUID) ? window.crypto.randomUUID() : String(Date.now()),
                driverId: driver.id || (api.session.get() || {}).userId,
                driverName: driver.name,
                alertType,
                severity: uiType === 'bridge' ? 'ALTA' : 'MEDIA',
                title: ALERT_BADGES[alertType],
                description: comment,
                latitude: coords[0],
                longitude: coords[1]
            });
            await this.loadAlerts();
            return mapAlert(created);
        },

        async confirmAlert(alertId) {
            await api.alerts.confirm(alertId);
            await this.loadAlerts();
        },

        reset() {
            data.currentDriver = null;
            data.activeLoadOrder = null;
            data.availableLoads = [];
            data.dispatchEvaluation = { loadId: null, evaluatedAt: '—', candidates: [] };
            data.routes = null;
            data.communityAlerts = [];
            data.fleetVehicles = [];
            data.deliveredLoads = [];
            data.publishedLoads = [];
            data.shipmentTrucks = {};
            data.lastDelivery = null;
        }
    };

    window.TruckDarService = service;
})();

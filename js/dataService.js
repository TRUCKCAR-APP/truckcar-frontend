(function () {
    const api = window.TruckCarApi;
    const data = window.TruckCarData;

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
        landslide: 'DERRUMBE',
        workshop: 'OBRA_EN_VIA'
    };
    const REPORT_SEVERITY = { danger: 'ALTA', landslide: 'ALTA', bridge: 'ALTA' };
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

    function given(source, field) {
        const value = source ? source[field] : null;
        return value === undefined || value === '' ? null : value;
    }

    function orNotAvailable(value) {
        return window.ui.orNotAvailable(value);
    }

    function coordsOrNull(lat, lng) {
        return (typeof lat === 'number' && typeof lng === 'number') ? [lat, lng] : null;
    }

    function setStatus(partial) {
        window.store.setState({ dataStatus: { ...window.store.state.dataStatus, ...partial } });
    }

    function syncDriverTelemetry() {
        const load = data.activeLoadOrder;
        const driver = data.currentDriver;
        if (load && load.status === 'IN_TRANSIT' && driver && driver.id) {
            window.DriverTelemetry.start(load, driver.id);
            window.RouteGuidance.prepare(load);
        } else if (window.DriverTelemetry.isRunning) {
            window.DriverTelemetry.stop();
            window.RouteGuidance.reset();
        }
    }

    function recordError(section, error) {
        if (error && (error.status === 403 || error.status === 401)) return;
        console.error('[TruckCar] Error cargando ' + section, error);
        const errors = { ...window.store.state.dataStatus.errors, [section]: error.message || String(error) };
        setStatus({ errors });
    }

    function clearError(section) {
        if (!(section in window.store.state.dataStatus.errors)) return;
        const errors = { ...window.store.state.dataStatus.errors };
        delete errors[section];
        setStatus({ errors });
    }

    function mapDriver(user, state) {
        const fullName = user ? [user.firstName, user.lastName].filter(Boolean).join(' ') : '';
        return {
            id: state ? state.driverId : (user && user.id),
            userId: user && user.id,
            name: fullName || (state && state.driverName) || (user && user.email) || 'Conductor',
            email: user && user.email,
            phone: (user && user.phoneNumber) || '—',
            avatar: null,
            licenseCategory: given(state, 'licenseCategory'),
            hoursDrivenToday: given(state, 'drivingHoursToday'),
            maxDailyHours: given(state, 'maxDailyDrivingHours'),
            remainingDrivingHours: given(state, 'remainingDrivingHours'),
            restRequired: given(state, 'restRequiredAlert'),
            mandatoryRestLocation: given(state, 'mandatoryRestLocation'),
            onTrip: given(state, 'onTrip'),
            accountVerified: given(state, 'accountVerified'),
            status: (state && state.status) || 'SIN_VEHICULO',
            rating: given(state, 'rating'),
            tripsCompleted: given(state, 'totalTrips'),
            hasVehicle: Boolean(state),
            vehicle: state ? {
                plate: state.vehiclePlate,
                brand: state.vehicleModel || '—',
                category: state.vehicleType || '—',
                height: state.maxHeightMeters,
                grossWeight: given(state, 'grossWeightTons'),
                netCargoWeight: state.netCargoWeightTons,
                maxPayload: state.maxPayloadTons,
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

    function driverPhone(state) {
        return null;
    }

    function mapFleetVehicle(state) {
        let status = (state.status || 'DESCONOCIDO').toUpperCase();
        if (state.restRequiredAlert) {
            status = 'DESCANSO';
        } else if (status === 'ACTIVO') {
            status = (state.currentSpeedKmH || 0) > 0 || state.currentLoadStatus === 'IN_TRANSIT' ? 'EN_TRANSITO' : 'DISPONIBLE';
        }
        return {
            id: state.driverId,
            driverId: state.driverId,
            driverName: state.driverName || state.driverId,
            plate: state.vehiclePlate,
            vehicleType: [state.vehicleModel, state.vehicleType].filter(Boolean).join(' · ') || '—',
            model: state.vehicleModel || '',
            rawType: state.vehicleType || '',
            height: state.maxHeightMeters || null,
            tareWeight: state.tareWeightTons || null,
            maxPayload: state.maxPayloadTons || null,
            phone: driverPhone(state),
            status,
            speed: state.currentSpeedKmH != null ? Math.round(state.currentSpeedKmH) : null,
            hoursActive: state.drivingHoursToday != null ? state.drivingHoursToday + ' h' : orNotAvailable(null),
            remainingDrivingHours: given(state, 'remainingDrivingHours'),
            maxDailyHours: given(state, 'maxDailyDrivingHours'),
            restRequired: given(state, 'restRequiredAlert'),
            mandatoryRestLocation: given(state, 'mandatoryRestLocation'),
            onTrip: given(state, 'onTrip'),
            accountVerified: given(state, 'accountVerified'),
            lastSeenAt: given(state, 'lastUpdate'),
            lastCheckin: orNotAvailable(timeAgo(state.lastUpdate)),
            currentLoadId: state.currentLoadId,
            currentLoadStatus: given(state, 'currentLoadStatus'),
            heading: state.currentHeading,
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
            author: alert.driverName || alert.driverId || 'Red TruckCar',
            upvotes: confirmations,
            coords: coordsOrNull(alert.latitude, alert.longitude),
            corridor: alert.roadCorridor,
            verified: confirmations >= ALERT_VALIDATION_THRESHOLD,
            pendingSync: Boolean(alert.pendingSync)
        };
    }

    async function offlineCapable(onlineFn, offlineFn) {
        if (window.OfflineQueue.isOffline()) return offlineFn();
        try {
            return await onlineFn();
        } catch (error) {
            if (window.OfflineQueue.isConnectivityError(error)) return offlineFn();
            throw error;
        }
    }

    function mapLoad(load) {
        return {
            raw: load,
            pendingSync: !!load.pendingSync,
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
            assignmentStatusChangedAt: given(load, 'assignmentStatusChangedAt'),
            tripStartedAt: load.tripStartedAt,
            deliveredAt: load.deliveredAt,
            podReceiverName: load.podReceiverName,
            podReceiverDocument: load.podReceiverDocument,
            podNotes: load.podNotes,
            podHasSignature: !!load.podHasSignature,
            podHasPhoto: !!load.podHasPhoto,
            deliveredAtLabel: formatDateTime(load.deliveredAt),
            cancellationReason: load.cancellationReason,
            cancelledAt: load.cancelledAt
        };
    }

    function mapEvaluatedCandidate(candidate) {
        return {
            driverId: given(candidate, 'driverId'),
            driverName: given(candidate, 'driverName'),
            vehiclePlate: given(candidate, 'vehiclePlate'),
            truckType: given(candidate, 'truckType'),
            deadheadDistanceKm: given(candidate, 'deadheadDistanceKm'),
            capacityUtilizationPercent: given(candidate, 'capacityUtilizationPercent'),
            score: given(candidate, 'score'),
            eligible: given(candidate, 'eligible'),
            reason: given(candidate, 'reason')
        };
    }

    function mapDecision(load, d) {
        return {
            decisionId: given(d, 'decisionId'),
            driverId: given(d, 'selectedDriverId'),
            driverName: d.selectedDriverName || d.selectedDriverId || null,
            vehiclePlate: given(d, 'selectedVehiclePlate'),
            score: d.matchingScore != null ? Math.round(d.matchingScore) : null,
            deadheadDistanceKm: given(d, 'deadheadDistanceKm'),
            reason: given(d, 'reasonDetails'),
            explanation: given(d, 'explanation'),
            evaluatedCandidates: Array.isArray(d.evaluatedCandidates) ? d.evaluatedCandidates.map(mapEvaluatedCandidate) : null,
            decisionStatus: d.status,
            executedAt: formatDateTime(d.executedAt),
            isCurrentAssignment: Boolean(load && d.selectedDriverId && d.selectedDriverId === load.assignedDriverId)
        };
    }

    function mapEvaluation(load, decisions) {
        return {
            loadId: load ? load.id : null,
            candidates: (decisions || []).map(d => mapDecision(load, d))
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
                riskLevel: given(plan, 'riskLevel'),
                activeAlertsCount: given(plan, 'activeAlertsCount'),
                totalDistanceKm: given(plan, 'totalDistanceKm'),
                estimatedDurationHours: given(plan, 'estimatedDurationHours'),
                aiRecommendation: given(plan, 'aiRecommendation'),
                segments: (plan.segments || []).map(s => ({
                    name: given(s, 'segmentName'),
                    distanceKm: given(s, 'distanceKm'),
                    condition: given(s, 'condition'),
                    checkpointName: given(s, 'checkpointName')
                })),
                checkpoints: (plan.segments || []).map(s => s.checkpointName).filter(Boolean),
                warnings: Array.isArray(plan.warnings) ? plan.warnings : null,
                waypoints
            },
            rejectedAlternate: blocked ? {
                id: 'ALT-' + blocked.corridorName,
                title: blocked.corridorName,
                rejectionReasons: blocked.issues && blocked.issues.length ? blocked.issues : [orNotAvailable(null)]
            } : null
        };
    }

    function plannedGrossWeightTons(vehicle, load) {
        if (load.status === 'IN_TRANSIT' && vehicle.grossWeight != null) return vehicle.grossWeight;
        return (vehicle.tareWeight || 0) + (load.netWeight || 0);
    }

    function mapRoadBlockage(blockage) {
        return {
            eventId: given(blockage, 'eventId'),
            alertId: given(blockage, 'alertId'),
            coords: coordsOrNull(blockage.latitude, blockage.longitude),
            alertType: given(blockage, 'alertType'),
            title: given(blockage, 'title'),
            description: given(blockage, 'description'),
            severity: given(blockage, 'severity'),
            reason: given(blockage, 'reason'),
            corridor: given(blockage, 'affectedCorridor'),
            occurredAt: given(blockage, 'occurredAt')
        };
    }

    const loaders = {};

    const service = {
        mapLoad,
        timeAgo,
        formatHours,

        registerLoader(role, loader) {
            loaders[role] = loader;
        },

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
                const mine = (await api.loads.mine()) || [];
                const rank = load => load.status === 'IN_TRANSIT' ? 0 : load.status === 'ASSIGNED' ? 1 : 2;
                const current = mine.slice().sort((a, b) => rank(a) - rank(b))[0];
                data.activeLoadOrder = current ? mapLoad(current) : null;
                syncDriverTelemetry();
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

        async loadDeliveredLoads() {
            try {
                const delivered = (await api.loads.list(['DELIVERED'])) || [];
                data.deliveredLoads = delivered.slice(0, 30).map(mapLoad);
                clearError('deliveries');
            } catch (error) {
                recordError('deliveries', error);
            }
        },

        async loadPublishedLoads() {
            try {
                const published = (await api.loads.published()) || [];
                data.publishedLoads = published.map(mapLoad);
                clearError('shipments');
            } catch (error) {
                recordError('shipments', error);
            }
        },

        async loadShipmentTrucks() {
            const drivers = [...new Set((data.publishedLoads || [])
                .filter(l => (l.status === 'ASSIGNED' || l.status === 'IN_TRANSIT') && l.assignedDriverId)
                .map(l => l.assignedDriverId))];
            const trucks = {};
            await Promise.all(drivers.map(async (driverId) => {
                try {
                    trucks[driverId] = mapFleetVehicle(await api.fleet.getDriver(driverId));
                } catch (error) {
                }
            }));
            data.shipmentTrucks = trucks;
        },

        async refreshShipments() {
            await this.loadPublishedLoads();
            const trucks = data.shipmentTrucks || {};
            const missing = (data.publishedLoads || []).some(l => (l.status === 'ASSIGNED' || l.status === 'IN_TRANSIT')
                && l.assignedDriverId && !trucks[l.assignedDriverId]);
            if (!window.TruckCarTelemetry.isOnline || missing) await this.loadShipmentTrucks();
        },

        async publishLoad(request) {
            const created = await api.loads.publish(request);
            await this.loadPublishedLoads();
            return mapLoad(created);
        },

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
                data.fleetVehicles = (states || []).map(mapFleetVehicle);
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
                    grossWeightTons: plannedGrossWeightTons(driver.vehicle, load),
                    heightMeters: driver.vehicle.height,
                    originCity: load.origin.city,
                    destinationCity: load.destination.city,
                    originLatitude: load.origin.coords ? load.origin.coords[0] : null,
                    originLongitude: load.origin.coords ? load.origin.coords[1] : null,
                    destinationLatitude: load.destination.coords ? load.destination.coords[0] : null,
                    destinationLongitude: load.destination.coords ? load.destination.coords[1] : null
                });
                data.routes = { ...mapRoutePlan(plan, load), planForLoadId: load.backendId };
                if (load.status === 'IN_TRANSIT') window.RouteGuidance.prepare(load);
                if (window.mapCtrl) window.mapCtrl.resetRouteCache();
                clearError('routes');
            } catch (error) {
                recordError('routes', error);
            }
        },

        async loadAll() {
            setStatus({ loading: true });
            try {
                await this.loadCurrentUser();
            } catch (error) {
                recordError('user', error);
            }
            const loader = loaders[window.store.state.activeRole];
            if (loader) await loader();
            setStatus({ loading: false, lastSync: new Date().toISOString() });
        },

        async refreshCoordinator() {
            const livePositions = window.TruckCarTelemetry.isOnline && (data.fleetVehicles || []).length > 0;
            await Promise.all([livePositions ? null : this.loadFleet(), this.loadAlerts(), this.loadCoordinatorLoad(),
                this.loadDeliveredLoads(), this.loadPublishedLoads()]);
            setStatus({ lastSync: new Date().toISOString() });
        },

        async acceptAssignment() {
            const load = data.activeLoadOrder;
            if (!load) throw new Error('No hay una carga asignada');
            const updated = await api.loads.accept(load.backendId);
            data.activeLoadOrder = mapLoad(updated);
            return data.activeLoadOrder;
        },

        async rejectAssignment() {
            const load = data.activeLoadOrder;
            if (!load) throw new Error('No hay una carga asignada');
            await api.loads.reject(load.backendId);
            data.activeLoadOrder = null;
            data.routes = null;
        },

        async startTrip() {
            const load = data.activeLoadOrder;
            if (!load) throw new Error('No hay una carga asignada');
            const updated = await offlineCapable(
                () => api.loads.startTrip(load.backendId),
                async () => {
                    await window.OfflineQueue.enqueue('trip.started', { loadId: load.backendId }, { tripId: load.backendId });
                    return { ...load.raw, status: 'IN_TRANSIT', tripStartedAt: new Date().toISOString(), pendingSync: true };
                });
            data.activeLoadOrder = mapLoad(updated);
            syncDriverTelemetry();
            return data.activeLoadOrder;
        },

        async deliverLoad(pod) {
            const load = data.activeLoadOrder;
            if (!load) throw new Error('No hay una carga en tránsito');
            const { signatureBlob, photoBlob, ...fields } = pod;
            const blobs = { signature: signatureBlob, photo: photoBlob };
            const updated = await offlineCapable(
                () => window.PodEvidence.deliver(load.backendId, fields, blobs),
                async () => {
                    await window.OfflineQueue.enqueue('trip.delivered', { loadId: load.backendId, ...fields },
                        { tripId: load.backendId, media: blobs });
                    return { ...load.raw, status: 'DELIVERED', deliveredAt: new Date().toISOString(),
                        podReceiverName: fields.receiverName, podHasSignature: !!signatureBlob,
                        podHasPhoto: !!photoBlob, pendingSync: true };
                });
            window.DriverTelemetry.stop();
            data.activeLoadOrder = null;
            data.routes = null;
            data.lastDelivery = {
                load: mapLoad(updated),
                pendingSync: !!updated.pendingSync,
                pod: {
                    ...fields,
                    loadId: load.backendId,
                    deliveredAt: updated.deliveredAt,
                    signatureUrl: signatureBlob ? URL.createObjectURL(signatureBlob) : null,
                    photoUrl: photoBlob ? URL.createObjectURL(photoBlob) : null
                }
            };
            return data.lastDelivery.load;
        },

        async cancelLoad(loadId, reason) {
            const updated = await api.loads.cancel(loadId, reason);
            if (window.store.state.activeRole === 'coordinator') {
                await this.loadCoordinatorLoad();
            }
            return mapLoad(updated);
        },

        async requestMatching(loadId) {
            const result = await api.allocation.matchLoad(loadId);
            data.lastMatching = { loadId, decision: mapDecision(null, result || {}) };
            await this.loadCoordinatorLoad();
            return result;
        },

        async reportAlert(uiType, comment, coords) {
            const driver = data.currentDriver || {};
            const alertType = UI_TO_ALERT_TYPE[uiType] || 'ACCIDENTE';
            const alert = {
                driverName: driver.name,
                alertType,
                severity: REPORT_SEVERITY[uiType] || 'MEDIA',
                title: ALERT_BADGES[alertType],
                description: comment,
                latitude: coords[0],
                longitude: coords[1]
            };
            const tripId = data.activeLoadOrder ? data.activeLoadOrder.backendId : null;
            const created = await offlineCapable(
                () => api.alerts.create({
                    ...alert,
                    clientAlertId: (window.crypto && window.crypto.randomUUID) ? window.crypto.randomUUID() : String(Date.now())
                }),
                async () => {
                    await window.OfflineQueue.enqueue('alert.reported', alert, { tripId });
                    return { ...alert, id: null, confirmationsCount: 1, reportedAt: new Date().toISOString(), pendingSync: true };
                });
            if (!created.pendingSync) await this.loadAlerts();
            return mapAlert(created);
        },

        async confirmAlert(alertId) {
            const queued = await offlineCapable(
                async () => { await api.alerts.confirm(alertId); return false; },
                async () => {
                    await window.OfflineQueue.enqueue('alert.confirmed', { alertId });
                    return true;
                });
            if (!queued) await this.loadAlerts();
        },

        async triggerSos(coords, accuracyMeters) {
            const driver = data.currentDriver || {};
            const load = data.activeLoadOrder;
            const latitude = coords ? Number(coords[0]) : NaN;
            const longitude = coords ? Number(coords[1]) : NaN;
            if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
                throw new Error('La alerta NO se envió: no hay posición GPS');
            }
            const sos = {
                latitude,
                longitude,
                accuracyMeters: Number.isFinite(accuracyMeters) ? Math.round(accuracyMeters) : null,
                loadId: load ? load.backendId : null,
                vehiclePlate: (driver.vehicle && driver.vehicle.plate) || null,
                driverName: driver.name || null
            };
            const clientEventId = window.OfflineQueue.uuid();
            const queue = async () => {
                await window.OfflineQueue.enqueue('alert.sos', sos, { tripId: sos.loadId, clientEventId });
                return { ...sos, id: null, status: 'ACTIVE', triggeredAt: new Date().toISOString(), pendingSync: true };
            };
            if (window.OfflineQueue.isOffline()) return queue();
            try {
                return await api.alerts.sos({ ...sos, clientEventId });
            } catch (error) {
                const status = error && Number.isFinite(error.status) ? error.status : 0;
                const retriable = status === 0 || status >= 500 || [401, 408, 429].includes(status);
                if (!retriable) throw error;
                return queue();
            }
        },

        async loadActiveSos() {
            data.activeSos = ((await api.alerts.activeSos()) || []).filter(s => s.status !== 'ACKNOWLEDGED' && s.status !== 'RESOLVED');
            return data.activeSos;
        },

        async acknowledgeSos(sosId) {
            await api.alerts.acknowledgeSos(sosId);
            data.activeSos = (data.activeSos || []).filter(s => s.id !== sosId);
        },

        async handleRoadBlockage(payload) {
            if (!payload) return null;
            const blockage = mapRoadBlockage(payload);
            const known = data.roadBlockages || (data.roadBlockages = []);
            if (blockage.eventId && known.some(b => b.eventId === blockage.eventId)) return null;
            known.unshift(blockage);
            known.length = Math.min(known.length, 20);
            await this.loadAlerts();
            if (window.store.state.activeRole === 'driver' && data.activeLoadOrder) {
                await this.loadRoutePlan({ force: true });
            }
            return blockage;
        },

        async createTrackingLink(loadId) {
            return api.loads.publicTrackingLink(loadId);
        },

        reset() {
            data.activeSos = [];
            data.currentDriver = null;
            data.activeLoadOrder = null;
            data.availableLoads = [];
            data.dispatchEvaluation = { loadId: null, candidates: [] };
            data.lastMatching = null;
            data.roadBlockages = [];
            data.routes = null;
            data.communityAlerts = [];
            data.fleetVehicles = [];
            data.deliveredLoads = [];
            data.publishedLoads = [];
            data.shipmentTrucks = {};
            data.lastDelivery = null;
        }
    };

    window.TruckCarService = service;
})();

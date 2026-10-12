window.DriverApp = {
    render(state) {
        const currentScreen = state.driverScreen;
        const isLandscape = state.isLandscape;
        
        let screenContent = '';
        if (currentScreen === 'profile') {
            screenContent = this.renderProfileScreen(state);
        } else if (currentScreen === 'assigned_load') {
            screenContent = this.renderAssignedLoadScreen(state);
        } else if (currentScreen === 'route_overview') {
            screenContent = this.renderRouteOverviewScreen(state);
        } else if (currentScreen === 'navigation') {
            screenContent = this.renderNavigationScreen(state, isLandscape);
        } else if (currentScreen === 'alerts') {
            screenContent = this.renderAlertsScreen(state);
        } else if (currentScreen === 'offline') {
            screenContent = this.renderOfflineScreen(state);
        }

        return `
            <div class="h-full w-full flex flex-col bg-slate-950 text-slate-100 overflow-hidden relative select-none">
                <div class="h-8 px-4 bg-slate-900/90 border-b border-slate-800 flex items-center justify-between text-[11px] text-slate-400 z-50 shrink-0">
                    <div class="flex items-center gap-2">
                        <span class="font-mono font-bold text-slate-200">${new Date().toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' })}</span>
                        <span class="px-1.5 py-0.5 bg-emerald-500/20 text-emerald-400 font-bold rounded text-[9px]">TRUCKDAR GPS</span>
                    </div>
                    <div class="flex items-center gap-3">
                        ${state.isOffline ?
                            '<span class="flex items-center gap-1 text-amber-400 font-bold animate-pulse"><i class="fas fa-plane-slash"></i> MODO OFFLINE</span>' :
                            '<span class="flex items-center gap-1 text-emerald-400"><i class="fas fa-satellite-dish"></i> En línea</span>'
                        }
                        <button onclick="window.app.logout()" class="flex items-center gap-1 hover:text-rose-400" title="Cerrar sesión">
                            <i class="fas fa-right-from-bracket"></i>
                        </button>
                    </div>
                </div>

                ${window.ui.syncBanner(state)}

                <div class="flex-1 relative overflow-hidden flex flex-col">
                    ${screenContent}
                </div>

                ${(isLandscape && currentScreen === 'navigation') ? '' : `
                    <div class="h-16 bg-slate-900 border-t border-slate-800 px-2 flex items-center justify-around z-40 shrink-0">
                        <button onclick="window.store.setState({ driverScreen: 'profile' })" class="flex flex-col items-center gap-1 px-3 py-1 rounded-xl transition ${currentScreen === 'profile' ? 'text-emerald-400 font-bold' : 'text-slate-400 hover:text-slate-200'}">
                            <i class="fas fa-truck text-base"></i>
                            <span class="text-[10px]">Vehículo</span>
                        </button>
                        <button onclick="window.store.setState({ driverScreen: 'assigned_load' })" class="flex flex-col items-center gap-1 px-3 py-1 rounded-xl transition relative ${currentScreen === 'assigned_load' ? 'text-emerald-400 font-bold' : 'text-slate-400 hover:text-slate-200'}">
                            <i class="fas fa-clipboard-list text-base"></i>
                            <span class="text-[10px]">Carga</span>
                            ${window.DriverApp.hasPendingLoad() ? '<span class="absolute top-0 right-3 w-2 h-2 bg-amber-400 rounded-full animate-ping"></span>' : ''}
                        </button>
                        <button onclick="window.store.setState({ driverScreen: 'route_overview' })" class="flex flex-col items-center gap-1 px-3 py-1 rounded-xl transition ${currentScreen === 'route_overview' ? 'text-emerald-400 font-bold' : 'text-slate-400 hover:text-slate-200'}">
                            <i class="fas fa-route text-base"></i>
                            <span class="text-[10px]">Rutas</span>
                        </button>
                        <button onclick="window.store.setState({ driverScreen: 'navigation' })" class="flex flex-col items-center gap-1 px-4 py-1.5 rounded-2xl bg-emerald-600 text-white font-bold shadow-lg shadow-emerald-600/30 transform hover:scale-105 active:scale-95 transition">
                            <i class="fas fa-location-arrow text-base"></i>
                            <span class="text-[10px]">Navegar</span>
                        </button>
                        <button onclick="window.store.setState({ driverScreen: 'alerts' })" class="flex flex-col items-center gap-1 px-3 py-1 rounded-xl transition ${currentScreen === 'alerts' ? 'text-emerald-400 font-bold' : 'text-slate-400 hover:text-slate-200'}">
                            <i class="fas fa-shield-alt text-base"></i>
                            <span class="text-[10px]">Alertas</span>
                        </button>
                        <button onclick="window.store.setState({ driverScreen: 'offline' })" class="flex flex-col items-center gap-1 px-3 py-1 rounded-xl transition ${currentScreen === 'offline' ? 'text-emerald-400 font-bold' : 'text-slate-400 hover:text-slate-200'}">
                            <i class="fas fa-download text-base"></i>
                            <span class="text-[10px]">Offline</span>
                        </button>
                    </div>
                `}
            </div>
        `;
    },

    hasPendingLoad() {
        const load = window.TruckDarData.activeLoadOrder;
        return Boolean(load && (load.assignmentStatus === 'PROPOSED' || load.assignmentStatus === 'NOTIFIED'));
    },

    destinationLabel() {
        const load = window.TruckDarData.activeLoadOrder;
        return load ? load.destination.city || load.destination.name : 'Sin destino';
    },

    routeEta() {
        const routes = window.TruckDarData.routes;
        return routes && routes.optimal ? routes.optimal.eta : '—';
    },

    routeDistance() {
        const routes = window.TruckDarData.routes;
        return routes && routes.optimal ? routes.optimal.distance : '—';
    },

    renderEmptyState(icon, title, text, actionHtml = '') {
        return `
            <div class="h-full flex flex-col items-center justify-center text-center p-6 gap-3">
                <div class="w-14 h-14 rounded-2xl bg-slate-900 border border-slate-800 flex items-center justify-center text-slate-500 text-xl">
                    <i class="fas ${icon}"></i>
                </div>
                <h3 class="font-bold text-white text-sm">${title}</h3>
                <p class="text-xs text-slate-400 max-w-xs">${text}</p>
                ${actionHtml}
            </div>
        `;
    },

    renderProfileScreen(state) {
        const esc = window.ui.escape;
        const driver = window.TruckDarData.currentDriver;
        if (!driver) {
            return state.dataStatus.loading
                ? this.renderEmptyState('fa-spinner fa-spin', 'Cargando perfil', 'Consultando User-Identity y fleets-drivers...')
                : this.renderEmptyState('fa-user-slash', 'Perfil no disponible', 'No se pudo cargar el perfil del conductor.',
                    '<button onclick="window.app.reloadData()" class="px-3 py-1.5 bg-emerald-600 text-white rounded-xl text-xs font-bold">Reintentar</button>');
        }
        const v = driver.vehicle;
        const fixed = (value, digits) => (typeof value === 'number' ? value.toFixed(digits) : '—');
        const initials = (driver.name || 'C').split(' ').map(p => p[0]).slice(0, 2).join('').toUpperCase();

        return `
            <div class="h-full overflow-y-auto p-4 space-y-4">
                <div class="flex items-center justify-between">
                    <div>
                        <h2 class="text-lg font-extrabold text-white flex items-center gap-2">
                            <i class="fas fa-truck text-emerald-400"></i> Perfil del Vehículo y Conductor
                        </h2>
                        <p class="text-xs text-slate-400">Parámetros técnicos para el cálculo seguro de ruteo y gálibo</p>
                    </div>
                    ${v ? `<span class="px-2.5 py-1 bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 rounded-lg text-xs font-bold font-mono">${esc(v.plate)}</span>` : ''}
                </div>

                <div class="bg-slate-900 border border-slate-800 rounded-2xl p-4 flex items-center gap-4">
                    <div class="w-14 h-14 rounded-full bg-emerald-600/20 border-2 border-emerald-400 flex items-center justify-center text-emerald-300 font-black">${esc(initials)}</div>
                    <div class="flex-1 min-w-0">
                        <div class="flex items-center justify-between">
                            <h3 class="font-bold text-white text-base truncate">${esc(driver.name)}</h3>
                            <span class="text-xs text-amber-400 font-bold"><i class="fas fa-star"></i> ${esc(driver.rating)}</span>
                        </div>
                        <p class="text-xs text-slate-400 truncate">${esc(driver.email || '')} · Licencia: <span class="font-mono text-slate-300">${esc(driver.licenseNumber)}</span></p>
                        <div class="mt-2 flex items-center gap-2 flex-wrap">
                            <span class="text-[11px] px-2 py-0.5 bg-slate-800 text-slate-300 rounded font-mono">
                                Horas hoy: <b class="${driver.hoursDrivenToday > 6 ? 'text-amber-400' : 'text-emerald-400'}">${esc(driver.hoursDrivenToday)}h / ${esc(driver.maxDailyHours)}h</b>
                            </span>
                            ${driver.restRequired
                                ? '<span class="text-[10px] text-amber-400 font-bold"><i class="fas fa-bed"></i> Descanso requerido</span>'
                                : `<span class="text-[10px] text-emerald-400 font-bold"><i class="fas fa-check-circle"></i> ${esc(driver.status)}</span>`}
                        </div>
                    </div>
                </div>

                ${v ? `
                    <div class="grid grid-cols-2 gap-3">
                        <div class="bg-slate-900 border border-slate-800 rounded-2xl p-3.5 flex flex-col justify-between">
                            <div class="flex items-center justify-between text-slate-400 text-xs">
                                <span>Gálibo Máximo (Altura)</span>
                                <i class="fas fa-ruler-vertical text-indigo-400"></i>
                            </div>
                            <div class="mt-2 flex items-baseline gap-1">
                                <span class="text-2xl font-extrabold text-white font-mono">${fixed(v.height, 2)}</span>
                                <span class="text-xs text-slate-400">metros</span>
                            </div>
                        </div>

                        <div class="bg-slate-900 border border-slate-800 rounded-2xl p-3.5 flex flex-col justify-between">
                            <div class="flex items-center justify-between text-slate-400 text-xs">
                                <span>Peso Bruto Máx.</span>
                                <i class="fas fa-weight-hanging text-amber-400"></i>
                            </div>
                            <div class="mt-2 flex items-baseline gap-1">
                                <span class="text-2xl font-extrabold text-white font-mono">${fixed(v.maxWeight, 1)}</span>
                                <span class="text-xs text-slate-400">Toneladas</span>
                            </div>
                            <span class="text-[10px] text-amber-400 mt-1 font-medium"><i class="fas fa-balance-scale"></i> Tara: ${fixed(v.tareWeight, 1)} Ton</span>
                        </div>

                        <div class="bg-slate-900 border border-slate-800 rounded-2xl p-3.5 flex flex-col justify-between">
                            <div class="flex items-center justify-between text-slate-400 text-xs">
                                <span>Tipo de Vehículo</span>
                                <i class="fas fa-road text-blue-400"></i>
                            </div>
                            <div class="mt-2">
                                <span class="text-sm font-bold text-white">${esc(v.category)}</span>
                            </div>
                            <span class="text-[10px] text-slate-400 mt-1">${esc(v.brand)}</span>
                        </div>

                        <div class="bg-slate-900 border border-slate-800 rounded-2xl p-3.5 flex flex-col justify-between">
                            <div class="flex items-center justify-between text-slate-400 text-xs">
                                <span>Carga Útil</span>
                                <i class="fas fa-boxes-stacked text-purple-400"></i>
                            </div>
                            <div class="mt-2">
                                <span class="text-sm font-bold text-white font-mono">${fixed(v.netCargoWeight, 1)} Ton</span>
                            </div>
                            <span class="text-[10px] text-slate-400 mt-1">${esc(driver.tripsCompleted)} viajes completados</span>
                        </div>
                    </div>

                    <div class="bg-slate-900 border border-slate-800 rounded-2xl p-4">
                        <h4 class="text-xs font-bold text-slate-300 uppercase tracking-wider mb-2.5">Certificaciones & Permisos</h4>
                        <div class="flex flex-wrap gap-2">
                            ${v.hazmatAuthorized ? '<span class="px-2.5 py-1 bg-blue-500/10 text-blue-400 border border-blue-500/30 rounded-lg text-xs font-medium flex items-center gap-1.5"><i class="fas fa-certificate"></i> Mercancías Peligrosas (HAZMAT)</span>' : ''}
                            ${v.coldChainCertified ? '<span class="px-2.5 py-1 bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 rounded-lg text-xs font-medium flex items-center gap-1.5"><i class="fas fa-snowflake"></i> Cadena de Frío</span>' : ''}
                            ${v.electronicTollTagActive ? '<span class="px-2.5 py-1 bg-indigo-500/10 text-indigo-400 border border-indigo-500/30 rounded-lg text-xs font-medium flex items-center gap-1.5"><i class="fas fa-tag"></i> TAG Telepeaje</span>' : ''}
                            ${v.runtValid ? '<span class="px-2.5 py-1 bg-slate-500/10 text-slate-300 border border-slate-500/30 rounded-lg text-xs font-medium flex items-center gap-1.5"><i class="fas fa-id-card"></i> RUNT vigente</span>' : ''}
                            ${(v.badges || []).map(b => `<span class="px-2.5 py-1 bg-amber-500/10 text-amber-300 border border-amber-500/30 rounded-lg text-xs font-medium">${esc(b)}</span>`).join('')}
                            ${!v.hazmatAuthorized && !v.coldChainCertified && !v.electronicTollTagActive && !v.runtValid && !(v.badges || []).length ? '<span class="text-xs text-slate-500">Sin certificaciones registradas</span>' : ''}
                        </div>
                    </div>
                ` : `
                    <div class="bg-slate-900 border border-dashed border-amber-500/40 rounded-2xl p-4 text-xs text-amber-300">
                        <b>Sin vehículo registrado.</b> fleets-drivers no tiene estado para el conductor
                        <span class="font-mono">${esc(driver.id)}</span>. Registre el vehículo con
                        <span class="font-mono">POST /api/v1/fleets-drivers/state</span> usando ese driverId.
                    </div>
                `}
            </div>
        `;
    },

    renderAssignedLoadScreen(state) {
        const esc = window.ui.escape;
        const load = window.TruckDarData.activeLoadOrder;
        const lastDelivery = window.TruckDarData.lastDelivery;
        if (!load && lastDelivery) {
            // Recibo de la entrega recién registrada (firma y foto ya en memoria; no se vuelven a descargar).
            const pod = { ...lastDelivery.pod, loadId: lastDelivery.load.backendId,
                          driverName: lastDelivery.load.assignedDriverName, vehiclePlate: lastDelivery.load.assignedVehiclePlate,
                          tripStartedAt: lastDelivery.load.tripStartedAt };
            return `
                <div class="h-full overflow-y-auto p-4 space-y-3">
                    <div class="text-center space-y-1">
                        <h3 class="font-extrabold text-white text-sm">Viaje finalizado</h3>
                        <p class="text-xs text-slate-400">La carga quedó en DELIVERED. Cuando el motor le proponga otra aparecerá aquí.</p>
                    </div>
                    ${window.PodUI.receiptHtml(pod, lastDelivery.load)}
                    <button onclick="window.app.refreshAssignment()" class="w-full py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-bold"><i class="fas fa-rotate"></i> Buscar nueva carga</button>
                </div>
            `;
        }
        if (!load) {
            return this.renderEmptyState('fa-clipboard-check', 'Sin carga asignada',
                'Cuando el motor de asignación le proponga una carga aparecerá aquí para aceptarla o rechazarla.',
                '<button onclick="window.app.refreshAssignment()" class="px-3 py-1.5 bg-emerald-600 text-white rounded-xl text-xs font-bold"><i class="fas fa-rotate"></i> Consultar de nuevo</button>');
        }
        const pending = load.status === 'AVAILABLE'
            && (load.assignmentStatus === 'PROPOSED' || load.assignmentStatus === 'NOTIFIED');
        const inTransit = load.status === 'IN_TRANSIT';
        const busy = state.busyAction;
        const badge = pending ? load.assignmentStatus : load.status;
        const title = pending ? 'Nueva Carga Propuesta' : inTransit ? 'Viaje en Curso' : 'Carga Aceptada';

        return `
            <div class="h-full overflow-y-auto p-4 space-y-4">
                <div class="flex items-center justify-between">
                    <div>
                        <div class="flex items-center gap-2">
                            <span class="px-2 py-0.5 bg-indigo-500/20 text-indigo-400 border border-indigo-500/30 rounded text-[10px] font-bold uppercase font-mono">
                                ${esc(badge || 'SIN ESTADO')}
                            </span>
                            <span class="text-xs text-slate-400">Orden #${esc(load.id)}</span>
                        </div>
                        <h2 class="text-lg font-extrabold text-white mt-1">${title}</h2>
                        <p class="text-[11px] text-slate-400">${esc(load.customer || '')}</p>
                    </div>
                </div>

                <div class="bg-slate-900 border border-slate-800 rounded-2xl p-4 space-y-3">
                    <div class="flex items-center justify-between border-b border-slate-800 pb-2.5">
                        <div>
                            <span class="text-[10px] text-slate-400 uppercase font-bold">Tipo de Carga</span>
                            <div class="font-bold text-sm text-white">${esc(load.cargoType)}</div>
                            <span class="text-[10px] text-slate-400 font-mono">${esc(load.requiredTruckType || '')}</span>
                        </div>
                        <div class="text-right">
                            <span class="text-[10px] text-slate-400 uppercase font-bold">Flete Ofrecido</span>
                            <div class="font-black text-base text-emerald-400 font-mono">${esc(load.freightPayment)}</div>
                        </div>
                    </div>

                    <div class="space-y-2 text-xs">
                        <div class="flex items-start gap-2">
                            <div class="w-5 text-emerald-400 text-center mt-0.5"><i class="fas fa-circle-dot"></i></div>
                            <div class="flex-1">
                                <div class="text-slate-400 text-[10px]">ORIGEN (publicada ${esc(load.scheduledDeparture)})</div>
                                <div class="font-semibold text-slate-200">${esc(load.origin.name)}</div>
                            </div>
                        </div>
                        <div class="border-l border-dashed border-slate-700 ml-2.5 h-3"></div>
                        <div class="flex items-start gap-2">
                            <div class="w-5 text-blue-400 text-center mt-0.5"><i class="fas fa-location-dot"></i></div>
                            <div class="flex-1">
                                <div class="text-slate-400 text-[10px]">DESTINO (${esc(load.estimatedDuration)} aprox)</div>
                                <div class="font-semibold text-slate-200">${esc(load.destination.name)}</div>
                            </div>
                        </div>
                    </div>

                    <div class="grid grid-cols-3 gap-2 pt-2 border-t border-slate-800 text-center">
                        <div class="p-2 bg-slate-800/50 rounded-xl">
                            <span class="text-[10px] text-slate-400 block">Peso Neto</span>
                            <span class="font-mono font-bold text-xs text-slate-200">${esc(load.netWeight)} Ton</span>
                        </div>
                        <div class="p-2 bg-slate-800/50 rounded-xl">
                            <span class="text-[10px] text-slate-400 block">Distancia</span>
                            <span class="font-mono font-bold text-xs text-slate-200">${esc(load.totalDistance)}</span>
                        </div>
                        <div class="p-2 bg-slate-800/50 rounded-xl">
                            <span class="text-[10px] text-slate-400 block">Volumen</span>
                            <span class="font-mono font-bold text-xs text-slate-200">${load.volumeM3 != null ? esc(load.volumeM3) + ' m³' : '—'}</span>
                        </div>
                    </div>
                </div>

                ${load.assignmentStatus === 'PROPOSED' ? `
                    <div class="p-3 bg-amber-500/10 border border-amber-500/30 rounded-2xl text-xs text-amber-300 flex items-start gap-2">
                        <i class="fas fa-bell mt-0.5"></i>
                        <div>
                            <b>Propuesta en proceso de notificación.</b> Podrá aceptar o rechazar cuando el servicio
                            de Notifications confirme el envío (estado NOTIFIED).
                            <button onclick="window.app.refreshAssignment()" class="block mt-1 underline font-bold">Consultar estado</button>
                        </div>
                    </div>
                ` : pending ? `
                    <div class="grid grid-cols-2 gap-3 pt-1">
                        <button onclick="window.app.handleRejectTrip()" ${busy ? 'disabled' : ''} class="py-3.5 bg-rose-600/20 hover:bg-rose-600/30 disabled:opacity-50 text-rose-300 border border-rose-500/40 rounded-2xl font-bold text-xs flex items-center justify-center gap-2 transition active:scale-95">
                            <i class="fas ${busy === 'reject' ? 'fa-spinner fa-spin' : 'fa-times-circle'}"></i> Rechazar Viaje
                        </button>
                        <button onclick="window.app.handleAcceptTrip()" ${busy ? 'disabled' : ''} class="py-3.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white rounded-2xl font-extrabold text-xs flex items-center justify-center gap-2 shadow-lg shadow-emerald-600/30 transition active:scale-95">
                            <i class="fas ${busy === 'accept' ? 'fa-spinner fa-spin' : 'fa-check-circle'}"></i> Aceptar & Ver Ruta
                        </button>
                    </div>
                ` : inTransit ? `
                    <div id="driver-telemetry-badge" class="flex flex-wrap items-center gap-1.5 px-3 py-2 bg-slate-900 border border-slate-800 rounded-xl text-[11px] text-slate-200" aria-live="polite">
                        <span class="inline-block w-2 h-2 rounded-full bg-slate-500"></span> Preparando telemetría…
                    </div>
                    <div class="grid grid-cols-2 gap-3 pt-1">
                        <button onclick="window.app.startNavigation()" ${busy ? 'disabled' : ''} class="py-3.5 bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-slate-200 border border-slate-700 rounded-2xl font-bold text-xs flex items-center justify-center gap-2 transition">
                            <i class="fas fa-location-arrow"></i> Continuar navegación
                        </button>
                        <button onclick="window.app.finishTrip()" ${busy ? 'disabled' : ''} class="py-3.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white rounded-2xl font-extrabold text-xs flex items-center justify-center gap-2 transition">
                            <i class="fas ${busy === 'deliver' ? 'fa-spinner fa-spin' : 'fa-clipboard-check'}"></i> Registrar entrega
                        </button>
                    </div>
                ` : `
                    <div class="grid grid-cols-2 gap-3 pt-1">
                        <button onclick="window.store.setState({ driverScreen: 'route_overview' })" class="py-3.5 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 rounded-2xl font-bold text-xs flex items-center justify-center gap-2 transition">
                            <i class="fas fa-route"></i> Ver ruta planeada
                        </button>
                        <button onclick="window.app.startNavigation()" ${busy ? 'disabled' : ''} class="py-3.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white rounded-2xl font-extrabold text-xs flex items-center justify-center gap-2 transition">
                            <i class="fas ${busy === 'start-trip' ? 'fa-spinner fa-spin' : 'fa-truck-moving'}"></i> Iniciar viaje
                        </button>
                    </div>
                `}
            </div>
        `;
    },

    renderRouteOverviewScreen(state) {
        const esc = window.ui.escape;
        const routes = window.TruckDarData.routes;
        const errors = state.dataStatus.errors || {};
        if (!routes || !routes.optimal) {
            const reason = !window.TruckDarData.activeLoadOrder
                ? 'Necesita una carga asignada para planear la ruta.'
                : !(window.TruckDarData.currentDriver && window.TruckDarData.currentDriver.vehicle)
                    ? 'Registre su vehículo en fleets-drivers para que Route-AI calcule una ruta compatible.'
                    : (errors.routes ? 'Route-AI respondió con error: ' + esc(errors.routes) : 'Calculando ruta con Route-AI...');
            return this.renderEmptyState('fa-route', 'Ruta no disponible', reason,
                window.TruckDarData.activeLoadOrder ? '<button onclick="window.TruckDarService.loadRoutePlan({ force: true }).then(() => window.store.setState({}))" class="px-3 py-1.5 bg-emerald-600 text-white rounded-xl text-xs font-bold">Planear ruta</button>' : '');
        }
        const opt = routes.optimal;
        const rej = routes.rejectedAlternate;

        return `
            <div class="h-full flex flex-col relative">
                <div class="h-44 w-full relative bg-slate-900">
                    <div id="overview-map-container" class="w-full h-full"></div>
                    <div class="absolute top-3 left-3 z-[400] flex gap-2">
                        <span class="px-2.5 py-1 bg-slate-950/80 backdrop-blur text-emerald-400 font-mono text-[11px] font-bold rounded-lg border border-slate-700 shadow">
                            <i class="fas fa-shield-halved"></i> ${esc(opt.name)}
                        </span>
                    </div>
                    <button onclick="window.mapCtrl.fitAllRoute()" class="absolute bottom-3 right-3 z-[400] p-2 bg-slate-900/90 text-white rounded-xl border border-slate-700 shadow text-xs">
                        <i class="fas fa-expand"></i>
                    </button>
                </div>

                <div class="flex-1 overflow-y-auto p-4 space-y-3">
                    <div class="bg-slate-900 border-2 border-emerald-500/50 rounded-2xl p-4 shadow-lg shadow-emerald-950/40 relative">
                        <div class="flex items-center justify-between mb-2">
                            <div class="flex items-center gap-2 min-w-0">
                                <span class="w-3 h-3 shrink-0 rounded-full bg-emerald-500 animate-pulse"></span>
                                <h3 class="font-bold text-white text-sm truncate">${esc(opt.title)}</h3>
                            </div>
                            <span class="px-2 py-0.5 bg-emerald-500/20 text-emerald-400 font-extrabold text-[10px] rounded uppercase font-mono">Recomendada</span>
                        </div>

                        <div class="grid grid-cols-3 gap-2 py-2 my-1 border-y border-slate-800 text-center font-mono">
                            <div>
                                <span class="text-[10px] text-slate-400 block font-sans">Distancia</span>
                                <span class="font-bold text-sm text-emerald-400">${esc(opt.distance)}</span>
                            </div>
                            <div>
                                <span class="text-[10px] text-slate-400 block font-sans">Tiempo Est.</span>
                                <span class="font-bold text-sm text-white">${esc(opt.eta)}</span>
                            </div>
                            <div>
                                <span class="text-[10px] text-slate-400 block font-sans">Alertas</span>
                                <span class="font-bold text-sm text-white">${esc(opt.hazards)}</span>
                            </div>
                        </div>

                        <div class="space-y-1.5 mt-3">
                            ${opt.features.map(f => `
                                <div class="flex items-center gap-2 text-xs text-slate-300">
                                    <i class="fas fa-check-circle text-emerald-400 text-[11px]"></i>
                                    <span>${esc(f)}</span>
                                </div>
                            `).join('')}
                        </div>

                        ${(opt.warnings || []).map(w => `
                            <div class="mt-2 p-2 bg-amber-500/10 border border-amber-500/30 rounded-xl text-[11px] text-amber-300 flex items-center gap-2">
                                <i class="fas fa-triangle-exclamation text-amber-400"></i><span>${esc(w)}</span>
                            </div>
                        `).join('')}

                        ${opt.aiRecommendation ? `
                            <div class="mt-3 p-2 bg-emerald-500/10 border border-emerald-500/30 rounded-xl text-[11px] text-emerald-300 flex items-start gap-2">
                                <i class="fas fa-robot text-emerald-400 mt-0.5"></i>
                                <span>${esc(opt.aiRecommendation)}</span>
                            </div>
                        ` : ''}
                    </div>

                    ${rej ? `
                        <div class="bg-slate-900/60 border border-rose-900/40 rounded-2xl p-3.5">
                            <div class="flex items-center justify-between mb-2">
                                <h4 class="text-xs font-bold text-rose-400 flex items-center gap-1.5">
                                    <i class="fas fa-ban"></i> ${esc(rej.title)}
                                </h4>
                                <span class="text-[10px] text-rose-400 font-mono font-bold">Ruta Descartada</span>
                            </div>
                            <div class="space-y-1 text-xs text-slate-400">
                                ${rej.rejectionReasons.map(r => `
                                    <div class="flex items-start gap-1.5 text-rose-300/80 text-[11px]">
                                        <i class="fas fa-times-circle text-rose-500 mt-0.5 shrink-0"></i>
                                        <span>${esc(r)}</span>
                                    </div>
                                `).join('')}
                            </div>
                        </div>
                    ` : ''}

                    <button onclick="window.app.startNavigation()" class="w-full py-4 bg-emerald-600 hover:bg-emerald-500 text-white rounded-2xl font-extrabold text-sm flex items-center justify-center gap-2 shadow-xl shadow-emerald-600/40 transition transform active:scale-98">
                        <i class="fas fa-play"></i> ${window.TruckDarData.activeLoadOrder && window.TruckDarData.activeLoadOrder.status === 'IN_TRANSIT' ? 'Continuar navegación' : 'Iniciar viaje y navegación'}
                    </button>
                </div>
            </div>
        `;
    },

    renderNavigationScreen(state, isLandscape) {
        const step = window.TruckDarData.liveNavigationSteps[state.navStepIndex] || window.TruckDarData.liveNavigationSteps[0];
        
        if (isLandscape) {
            return `
                <div class="h-full w-full relative bg-slate-950 overflow-hidden">
                    <div id="live-nav-map-container" class="w-full h-full absolute inset-0"></div>

                    <div class="landscape-overlay-left pointer-events-none">
                        <div class="hud-pill rounded-2xl p-3.5 shadow-2xl border border-slate-700/60 pointer-events-auto">
                            <div class="flex items-center gap-3">
                                <div class="w-12 h-12 rounded-xl bg-emerald-600 text-white flex items-center justify-center text-xl shadow-lg shrink-0">
                                    <i class="fas ${step.maneuver === 'turn-right' ? 'fa-arrow-right' : step.maneuver === 'tunnel' ? 'fa-archway' : step.maneuver === 'scale' ? 'fa-weight-hanging' : 'fa-arrow-up'}"></i>
                                </div>
                                <div>
                                    <div class="text-2xl font-black text-white font-mono">${step.distanceLeft}</div>
                                    <div class="text-xs text-slate-300 font-semibold line-clamp-2 leading-tight">${step.street}</div>
                                </div>
                            </div>
                            <div class="mt-2 pt-2 border-t border-slate-700/50 text-[11px] text-emerald-300 flex items-center gap-1.5">
                                <i class="fas fa-shield-alt"></i> ${step.alert.title}: ${step.alert.text}
                            </div>
                        </div>

                        <div class="flex items-center gap-3 pointer-events-auto">
                            <div class="hud-pill rounded-2xl p-3 flex items-center gap-3 border border-slate-700/60 shadow-xl">
                                <div class="text-center">
                                    <div class="text-3xl font-black text-emerald-400 font-mono">${state.simulatedSpeed}</div>
                                    <div class="text-[9px] uppercase font-bold text-slate-400">km/h</div>
                                </div>
                                <div class="speed-limit-sign">
                                    ${step.speedLimit}
                                </div>
                            </div>

                            <button onclick="window.app.toggleVoice()" class="hud-pill p-3.5 rounded-2xl border border-slate-700/60 text-white shadow-xl flex items-center justify-center transition active:scale-95 ${state.voiceEnabled ? 'text-emerald-400' : 'text-slate-500'}">
                                <i class="fas ${state.voiceEnabled ? 'fa-volume-up text-lg' : 'fa-volume-mute text-lg'}"></i>
                            </button>
                        </div>
                    </div>

                    <div class="landscape-overlay-right pointer-events-none">
                        <div class="flex flex-col gap-2 pointer-events-auto items-end">
                            <button onclick="window.app.openReportModal('scale')" class="w-11 h-11 bg-indigo-600 hover:bg-indigo-500 text-white rounded-full shadow-2xl flex items-center justify-center text-sm border-2 border-white/40 transition transform hover:scale-110 active:scale-90" title="Reportar Báscula">
                                <i class="fas fa-weight-hanging"></i>
                            </button>
                            <button onclick="window.app.openReportModal('bridge')" class="w-11 h-11 bg-rose-600 hover:bg-rose-500 text-white rounded-full shadow-2xl flex items-center justify-center text-sm border-2 border-white/40 transition transform hover:scale-110 active:scale-90" title="Alerta Gálibo">
                                <i class="fas fa-ruler-vertical"></i>
                            </button>
                            <button onclick="window.app.openReportModal('police')" class="w-11 h-11 bg-blue-600 hover:bg-blue-500 text-white rounded-full shadow-2xl flex items-center justify-center text-sm border-2 border-white/40 transition transform hover:scale-110 active:scale-90" title="Retén Policial">
                                <i class="fas fa-shield-alt"></i>
                            </button>
                        </div>

                        <div class="hud-pill rounded-2xl p-3 border border-slate-700/60 shadow-xl pointer-events-auto w-full">
                            <div class="text-right font-mono mb-2">
                                <span class="text-xs text-slate-400 block font-sans">Destino: ${window.ui.escape(window.DriverApp.destinationLabel())}</span>
                                <span class="text-sm font-bold text-white"><span class="text-emerald-400">${window.ui.escape(window.DriverApp.routeEta())}</span></span>
                            </div>
                            <div class="flex gap-2">
                                <button onclick="window.app.nextSimulationStep()" class="flex-1 py-2 bg-indigo-600 hover:bg-indigo-500 text-white font-bold rounded-xl text-xs flex items-center justify-center gap-1 transition">
                                    <i class="fas fa-step-forward"></i> Avanzar
                                </button>
                                <button onclick="window.app.finishTrip()" class="py-2 px-3 bg-rose-600 hover:bg-rose-500 text-white font-bold rounded-xl text-xs transition">
                                    <i class="fas fa-stop"></i>
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            `;
        }

        return `
            <div class="h-full flex flex-col relative bg-slate-950">
                <div class="bg-gradient-to-b from-slate-900 to-slate-900/90 border-b border-slate-800 p-3.5 z-20 shadow-xl">
                    <div class="flex items-center gap-3">
                        <div class="w-12 h-12 rounded-2xl bg-emerald-600 text-white flex items-center justify-center text-xl shadow-lg shrink-0">
                            <i class="fas ${step.maneuver === 'turn-right' ? 'fa-arrow-right' : step.maneuver === 'tunnel' ? 'fa-archway' : step.maneuver === 'scale' ? 'fa-weight-hanging' : 'fa-arrow-up'}"></i>
                        </div>
                        <div class="flex-1 min-w-0">
                            <div class="text-xl font-black text-white font-mono">${step.distanceLeft}</div>
                            <p class="text-xs text-slate-200 font-medium leading-tight truncate">${step.maneuverText}</p>
                            <span class="text-[10px] text-slate-400 font-mono">${step.street}</span>
                        </div>
                        <div class="speed-limit-sign shrink-0">
                            ${step.speedLimit}
                        </div>
                    </div>

                    <div class="mt-2.5 px-2.5 py-1.5 bg-slate-800/80 border border-slate-700/50 rounded-xl flex items-center justify-between text-xs">
                        <div class="flex items-center gap-1.5 text-emerald-300 text-[11px]">
                            <i class="fas fa-info-circle text-emerald-400"></i>
                            <span><b>${step.alert.title}</b>: ${step.alert.text}</span>
                        </div>
                        <button onclick="window.voiceEngine.speak('${step.voiceAudioText}', true)" class="text-slate-400 hover:text-emerald-400 p-1">
                            <i class="fas fa-volume-up"></i>
                        </button>
                    </div>
                </div>

                <div class="flex-1 relative">
                    <div id="driver-telemetry-badge" class="absolute top-2 left-2 right-2 z-[500] flex flex-wrap items-center gap-1.5 px-3 py-1.5 bg-slate-900/90 backdrop-blur border border-slate-700 rounded-xl text-[10px] text-slate-200 shadow-lg" aria-live="polite"></div>
                    <div id="live-nav-map-container" class="w-full h-full"></div>

                    <div class="absolute bottom-4 left-4 z-[400] speed-gauge rounded-2xl p-2.5 shadow-2xl border border-slate-700 text-center min-w-[75px]">
                        <div class="text-2xl font-black text-emerald-400 font-mono">${state.simulatedSpeed}</div>
                        <div class="text-[9px] font-bold uppercase text-slate-400">km/h</div>
                    </div>

                    <div class="absolute bottom-4 right-4 z-[400] flex flex-col gap-2">
                        <button onclick="window.app.toggleVoice()" class="w-11 h-11 bg-slate-900/90 text-white rounded-full shadow-xl border border-slate-700 flex items-center justify-center transition active:scale-95 ${state.voiceEnabled ? 'text-emerald-400' : 'text-slate-500'}">
                            <i class="fas ${state.voiceEnabled ? 'fa-volume-up' : 'fa-volume-mute'}"></i>
                        </button>
                        <button onclick="window.app.openReportModal()" class="w-12 h-12 bg-amber-500 text-slate-950 font-bold rounded-full shadow-2xl flex items-center justify-center text-lg border-2 border-white transition transform hover:scale-110 active:scale-90">
                            <i class="fas fa-bullhorn"></i>
                        </button>
                    </div>
                </div>

                <div class="p-3 bg-slate-900 border-t border-slate-800 flex items-center justify-between gap-2 z-20">
                    <div class="text-xs font-mono text-slate-300">
                        <span class="text-slate-400 text-[10px] block font-sans">Paso ${state.navStepIndex + 1} de ${window.TruckDarData.liveNavigationSteps.length}</span>
                        <b>${window.ui.escape(window.DriverApp.destinationLabel())}: ${window.ui.escape(window.DriverApp.routeDistance())}</b>
                    </div>
                    <div class="flex items-center gap-2">
                        <button onclick="window.app.nextSimulationStep()" class="px-3 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-bold flex items-center gap-1.5 transition shadow">
                            <i class="fas fa-step-forward"></i> Simular Avance
                        </button>
                        <button onclick="window.app.finishTrip()" class="px-3 py-2 bg-rose-600/30 hover:bg-rose-600 text-rose-300 hover:text-white rounded-xl text-xs font-bold transition">
                            Registrar entrega
                        </button>
                    </div>
                </div>
            </div>
        `;
    },

    renderAlertsScreen(state) {
        const esc = window.ui.escape;
        const allAlerts = window.TruckDarData.communityAlerts || [];
        const filter = state.alertFilter || 'all';
        const alerts = filter === 'all' ? allAlerts : allAlerts.filter(a => a.type === filter);
        const filters = [
            ['all', 'Todos'], ['scale', 'Básculas'], ['bridge', 'Gálibos Bajos'],
            ['police', 'Retenes'], ['rest', 'Paradores 24h'], ['danger', 'Incidentes']
        ];
        return `
            <div class="h-full overflow-y-auto p-4 space-y-4">
                <div class="flex items-center justify-between">
                    <div>
                        <h2 class="text-lg font-extrabold text-white flex items-center gap-2">
                            <i class="fas fa-bullhorn text-amber-400"></i> Alertas de Carretera
                        </h2>
                        <p class="text-xs text-slate-400">Reportes de Community-Alerts (validadas con 3 confirmaciones)</p>
                    </div>
                    <button onclick="window.app.openReportModal()" class="px-3 py-1.5 bg-amber-500 hover:bg-amber-400 text-slate-950 font-extrabold rounded-xl text-xs flex items-center gap-1.5 shadow transition">
                        <i class="fas fa-plus"></i> Reportar
                    </button>
                </div>

                <div class="flex gap-1.5 overflow-x-auto pb-1 text-xs">
                    ${filters.map(([key, label]) => `
                        <button onclick="window.store.setState({ alertFilter: '${key}' })" class="px-3 py-1 rounded-lg shrink-0 ${filter === key ? 'bg-emerald-600 text-white font-bold' : 'bg-slate-800 text-slate-300 hover:bg-slate-700'}">
                            ${label}${key === 'all' ? ' (' + allAlerts.length + ')' : ''}
                        </button>
                    `).join('')}
                </div>

                <div class="space-y-3">
                    ${alerts.length ? alerts.map(a => `
                        <div class="bg-slate-900 border border-slate-800 rounded-2xl p-3.5 space-y-2">
                            <div class="flex items-start justify-between">
                                <div class="flex items-center gap-2">
                                    <span class="px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                                        a.type === 'scale' ? 'bg-indigo-500/20 text-indigo-400 border border-indigo-500/30' :
                                        a.type === 'bridge' ? 'bg-rose-500/20 text-rose-400 border border-rose-500/30' :
                                        a.type === 'police' ? 'bg-blue-500/20 text-blue-400 border border-blue-500/30' :
                                        a.type === 'danger' ? 'bg-rose-500/20 text-rose-300 border border-rose-500/30' :
                                        'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                                    }">${esc(a.badge)}</span>
                                    <span class="text-[11px] text-slate-400">${esc(a.timeAgo)}</span>
                                    ${a.verified ? '<span class="text-[10px] text-emerald-400 font-bold"><i class="fas fa-circle-check"></i> Validada</span>' : ''}
                                </div>
                                <span class="text-xs text-emerald-400 font-bold flex items-center gap-1">
                                    <i class="fas fa-thumbs-up"></i> ${esc(a.upvotes)}
                                </span>
                            </div>

                            <h3 class="font-bold text-white text-sm">${esc(a.title)}</h3>
                            <p class="text-xs text-slate-300 leading-relaxed">${esc(a.description)}</p>

                            <div class="flex items-center justify-between pt-2 border-t border-slate-800/80 text-[11px] text-slate-400">
                                <span><i class="fas fa-user-circle"></i> ${esc(a.author)}</span>
                                <button onclick="window.app.upvoteAlert(${Number(a.id)})" class="text-emerald-400 hover:underline font-medium">
                                    Confirmar Alerta
                                </button>
                            </div>
                        </div>
                    `).join('') : `
                        <div class="p-6 text-center text-xs text-slate-400 bg-slate-900 border border-dashed border-slate-800 rounded-2xl">
                            No hay alertas activas${filter === 'all' ? '' : ' de este tipo'}.
                        </div>
                    `}
                </div>
            </div>
        `;
    },

    renderOfflineScreen(state) {
        const off = window.TruckDarData.offlineSyncData;
        return `
            <div class="h-full overflow-y-auto p-4 space-y-4">
                <div class="flex items-center justify-between">
                    <div>
                        <h2 class="text-lg font-extrabold text-white flex items-center gap-2">
                            <i class="fas fa-download text-emerald-400"></i> Modo Offline & Sincronización
                        </h2>
                        <p class="text-xs text-slate-400">Navegación continua en zonas sin cobertura celular</p>
                    </div>
                </div>

                <div class="p-3.5 bg-slate-900 border ${state.isOffline ? 'border-amber-500/60 bg-amber-500/5' : 'border-slate-800'} rounded-2xl flex items-center justify-between">
                    <div>
                        <div class="font-bold text-sm text-white flex items-center gap-2">
                            <i class="fas ${state.isOffline ? 'fa-plane-slash text-amber-400' : 'fa-signal text-emerald-400'}"></i>
                            Estado de Conectividad
                        </div>
                        <p class="text-xs text-slate-400 mt-0.5">${state.isOffline ? 'Sin señal en carretera (Operando en Offline)' : 'Conectado a Red 4G LTE'}</p>
                    </div>
                    <button onclick="window.app.toggleOfflineSimulation()" class="px-3.5 py-2 rounded-xl text-xs font-bold transition ${state.isOffline ? 'bg-emerald-600 hover:bg-emerald-500 text-white' : 'bg-slate-800 hover:bg-slate-700 text-amber-400 border border-amber-500/40'}">
                        ${state.isOffline ? 'Reconectar Red' : 'Simular Pérdida de Señal'}
                    </button>
                </div>

                <div class="bg-slate-900 border border-slate-800 rounded-2xl p-4 space-y-3">
                    <h3 class="text-xs font-bold text-slate-300 uppercase tracking-wider flex items-center justify-between">
                        <span>Mapas Vectoriales Descargados</span>
                        <span class="text-emerald-400 font-mono text-[11px]">134.9 MB Total</span>
                    </h3>
                    <div class="space-y-2">
                        ${off.cachedRegions.map(reg => `
                            <div class="p-2.5 bg-slate-800/60 border border-slate-700/50 rounded-xl flex items-center justify-between">
                                <div>
                                    <div class="font-semibold text-xs text-white">${reg.name}</div>
                                    <span class="text-[10px] text-slate-400 font-mono">${reg.size} • Actualizado: ${reg.updated}</span>
                                </div>
                                <span class="px-2 py-0.5 bg-emerald-500/20 text-emerald-400 text-[10px] font-bold rounded font-mono">
                                    <i class="fas fa-check"></i> ${reg.status}
                                </span>
                            </div>
                        `).join('')}
                    </div>
                </div>

                <div class="bg-slate-900 border border-slate-800 rounded-2xl p-4 space-y-3">
                    <div class="flex items-center justify-between">
                        <h3 class="text-xs font-bold text-slate-300 uppercase tracking-wider">Cola de Sincronización (${off.pendingQueue.length})</h3>
                        <span class="text-[10px] text-amber-400 animate-pulse font-mono">Auto-sync al conectar</span>
                    </div>
                    <div class="space-y-2">
                        ${off.pendingQueue.map(q => `
                            <div class="p-2 bg-slate-800/40 border border-slate-700/30 rounded-xl flex items-center justify-between text-xs">
                                <span class="text-slate-300">${q.type}</span>
                                <span class="text-[10px] text-slate-400 font-mono">${q.time}</span>
                            </div>
                        `).join('')}
                    </div>
                    <button onclick="alert('Cola de reportes sincronizada con éxito con la Central de Monitoreo.')" class="w-full py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-bold transition">
                        <i class="fas fa-rotate"></i> Forzar Sincronización
                    </button>
                </div>
            </div>
        `;
    }
};

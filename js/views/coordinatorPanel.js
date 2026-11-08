window.CoordinatorPanel = {
    render(state) {
        const esc = window.ui.escape;
        const data = window.TruckCarData;
        const fleet = data.fleetVehicles || [];
        const alerts = data.communityAlerts || [];
        const evaluation = data.dispatchEvaluation || { candidates: [] };
        const load = data.activeLoadOrder;
        const loads = data.availableLoads || [];
        const deliveries = data.deliveredLoads || [];
        const user = state.currentUser;

        const operating = fleet.filter(t => t.status === 'EN_TRANSITO' || t.status === 'DISPONIBLE').length;
        const clearanceAlerts = alerts.filter(a => a.type === 'bridge').length;
        const notices = this.buildNotices(fleet, alerts);

        return `
            <div class="h-full w-full flex flex-col bg-slate-950 text-slate-100 overflow-hidden font-sans">
                <header class="min-h-16 px-4 lg:px-6 py-2 bg-slate-900 border-b border-slate-800 flex flex-wrap items-center justify-between z-30 shrink-0 gap-x-4 gap-y-2">
                    <div class="flex items-center gap-2.5 min-w-0">
                        <div class="w-10 h-10 shrink-0 rounded-xl bg-slate-800 flex items-center justify-center text-slate-100">
                            <i class="fas fa-tower-broadcast text-lg"></i>
                        </div>
                        <!-- min-w-0: en 390 px la columna se encoge y sus filas se apilan en lugar de montarse una sobre otra. -->
                        <div class="min-w-0 flex-1">
                            <h1 class="text-base font-bold text-white tracking-tight leading-tight flex items-center gap-x-2 gap-y-0.5 flex-wrap">
                                <span>Central de monitoreo de flota</span>
                                ${Object.keys(state.dataStatus.errors).length
                                    ? '<span class="text-xs font-semibold text-warn-500 flex items-center gap-1.5 whitespace-nowrap"><i class="fas fa-triangle-exclamation"></i> Con errores</span>'
                                    : '<span class="text-xs font-medium text-slate-400 flex items-center gap-1.5 whitespace-nowrap"><span class="dot ok"></span> En línea</span>'}
                            </h1>
                            <p class="text-xs text-slate-400 flex flex-wrap items-center gap-x-2 gap-y-0.5 mt-0.5"><span data-network-status class="tower-net lg:hidden"></span><span class="whitespace-nowrap">Última sincronización: ${state.dataStatus.lastSync ? new Date(state.dataStatus.lastSync).toLocaleTimeString('es-CO') : '—'}</span></p>
                        </div>
                    </div>

                    ${this.renderTabs(state)}

                    <div class="flex items-center gap-3 lg:gap-6 flex-wrap">
                        <div class="flex items-center gap-3">
                            <div class="px-3.5 py-1.5 bg-slate-800/80 border border-slate-700/60 rounded-xl text-center">
                                <span class="text-xs text-slate-400 font-medium block">Flota activa</span>
                                <span class="text-sm font-bold text-white font-mono"><span data-count="${operating}" data-count-key="kpi-operating">${operating}</span> / ${fleet.length}</span>
                            </div>
                            <div class="px-3.5 py-1.5 bg-slate-800/80 border border-slate-700/60 rounded-xl text-center">
                                <span class="text-xs text-slate-400 font-medium block">Alertas en ruta</span>
                                <span class="text-sm font-bold text-white font-mono"><span data-count="${alerts.length}" data-count-key="kpi-alerts">${alerts.length}</span> novedades</span>
                            </div>
                            <div class="px-3.5 py-1.5 bg-slate-800/80 border border-slate-700/60 rounded-xl text-center">
                                <span class="text-xs text-slate-400 font-medium block">Gálibo reportado</span>
                                <span class="text-sm font-bold text-white font-mono"><span data-count="${clearanceAlerts}" data-count-key="kpi-clearance">${clearanceAlerts}</span> alertas</span>
                            </div>
                        </div>

                        <div class="flex items-center gap-3 pl-4 border-l border-slate-800">
                            <div class="w-9 h-9 rounded-xl bg-slate-800 flex items-center justify-center text-slate-200 font-bold text-xs">
                                ${esc(this.initials(user))}
                            </div>
                            <div class="text-left">
                                <div class="text-xs font-bold text-slate-200">${esc(user ? (user.firstName + ' ' + user.lastName) : 'Coordinador')}</div>
                                <div class="text-xs text-slate-400">${esc(window.CoordinatorPanel.roleLabel(state.sessionRole))}</div>
                            </div>
                            <button onclick="window.app.logout()" class="ml-1 w-9 h-9 grid place-items-center rounded-xl text-slate-400 hover:text-white text-xs" title="Cerrar sesión" aria-label="Cerrar sesión">
                                <i class="fas fa-right-from-bracket"></i>
                            </button>
                        </div>
                    </div>
                </header>

                ${window.ui.syncBanner(state)}

                <div data-screen class="flex-1 grid grid-cols-1 lg:grid-cols-12 gap-4 p-3 lg:p-4 overflow-y-auto lg:overflow-hidden" style="padding-bottom: calc(1rem + var(--safe-bottom))">
                    <div class="lg:col-span-4 flex flex-col gap-4 lg:overflow-hidden order-2 lg:order-1">
                        <div class="bg-slate-900 border border-slate-800 rounded-2xl p-4 flex flex-col gap-3 shadow-xl max-h-[60%] overflow-y-auto">
                            <div class="flex items-center justify-between border-b border-slate-800 pb-2.5">
                                <div class="flex items-center gap-2">
                                    <i class="fas fa-cubes-stacked text-slate-400"></i>
                                    <h2 class="font-bold text-sm text-white">Evaluación de despacho</h2>
                                </div>
                                ${load ? `<span class="text-xs font-semibold text-slate-400">${esc(load.id)}</span>` : ''}
                            </div>

                            ${loads.length > 1 ? `
                                <select onchange="window.coordinatorCtrl.selectLoad(this.value)" class="login-input w-full text-xs">
                                    ${loads.map(l => `<option value="${l.backendId}" ${load && l.backendId === load.backendId ? 'selected' : ''}>${esc(l.id + ' · ' + l.origin.city + ' → ' + l.destination.city)}</option>`).join('')}
                                </select>
                            ` : ''}

                            ${load ? `
                                <div class="text-xs text-slate-300 bg-slate-950/60 p-2.5 rounded-xl border border-slate-800 space-y-1">
                                    <div class="flex justify-between gap-2">
                                        <span class="text-slate-400 font-medium">Carga:</span>
                                        <span class="font-bold text-white text-right">${esc(load.cargoType)} (${esc(load.netWeight)} Ton)</span>
                                    </div>
                                    <div class="flex justify-between gap-2">
                                        <span class="text-slate-400 font-medium">Trayecto:</span>
                                        <span class="font-semibold text-white text-right">${esc(load.origin.city)} → ${esc(load.destination.city)}</span>
                                    </div>
                                    <div class="flex justify-between gap-2">
                                        <span class="text-slate-400 font-medium">Asignación:</span>
                                        <span class="font-semibold text-right ${this.assignmentColor(load.assignmentStatus)}">${this.assignmentWarn(load.assignmentStatus) ? '<i class="fas fa-triangle-exclamation"></i> ' : ''}${esc(load.assignmentStatus ? window.DriverApp.statusLabel(load.assignmentStatus) : 'Sin asignar')}${load.assignedDriverName ? ' · ' + esc(load.assignedDriverName) : ''}</span>
                                    </div>
                                </div>

                                ${load.status === 'AVAILABLE' || load.status === 'ASSIGNED' ? `
                                    <button onclick="window.coordinatorCtrl.cancelLoad(${load.backendId})" ${state.busyAction === 'cancel' ? 'disabled' : ''} class="w-full py-2 bg-slate-800 hover:bg-slate-700 disabled:opacity-60 text-white border border-slate-700 rounded-xl text-xs font-bold transition">
                                        <i class="fas ${state.busyAction === 'cancel' ? 'fa-spinner fa-spin' : 'fa-ban'}"></i> Cancelar carga
                                    </button>
                                ` : ''}

                                ${!load.assignmentStatus || load.assignmentStatus === 'UNASSIGNED_NO_DRIVERS' ? `
                                    <button onclick="window.coordinatorCtrl.requestMatching(${load.backendId})" ${state.busyAction === 'matching' ? 'disabled' : ''} class="w-full py-2.5 bg-accent-500 hover:bg-accent-600 disabled:opacity-60 text-graphite-950 rounded-xl text-xs font-bold transition">
                                        <i class="fas ${state.busyAction === 'matching' ? 'fa-spinner fa-spin' : 'fa-wand-magic-sparkles'}"></i> Ejecutar matching con IA
                                    </button>
                                ` : ''}

                                <div class="space-y-2">
                                    <span class="text-xs font-semibold text-slate-400">Decisiones del motor de asignación</span>
                                    ${evaluation.candidates.length ? evaluation.candidates.map((c, i) => `
                                        <div class="p-3 rounded-xl border transition ${c.isCurrentAssignment ? 'bg-slate-800/60 border-ok-500/50' : 'bg-slate-800/40 border-slate-700/40'}">
                                            <div class="flex items-center justify-between mb-1.5">
                                                <div class="flex items-center gap-2 min-w-0">
                                                    <span class="w-5 h-5 shrink-0 rounded-full flex items-center justify-center text-[10px] font-mono font-bold ${c.isCurrentAssignment ? 'bg-ok-500 text-graphite-950' : 'bg-slate-700 text-slate-300'}">${i + 1}</span>
                                                    <span class="font-bold text-xs text-white truncate">${esc(c.driverName)}</span>
                                                    <span class="font-mono text-[10px] text-slate-400">(${esc(c.vehiclePlate)})</span>
                                                </div>
                                                <span class="text-sm font-bold font-mono ${c.isCurrentAssignment ? 'text-white' : 'text-slate-300'}">${c.score != null ? c.score + '/100' : '—'}</span>
                                            </div>
                                            ${c.score != null ? `<div class="h-1.5 mb-2 rounded-full bg-slate-700/60 overflow-hidden" role="meter" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Number(c.score)}" aria-label="Puntaje del motor de asignación">
                                                <div class="h-full rounded-full origin-left ${c.isCurrentAssignment ? 'bg-ok-500' : 'bg-slate-400'}" style="transform: scaleX(${Math.max(0, Math.min(100, Number(c.score))) / 100}); transition: transform 600ms cubic-bezier(0.23, 1, 0.32, 1)"></div>
                                            </div>` : ''}
                                            <div class="grid grid-cols-2 gap-1.5 text-[10px] text-slate-300 pt-1 border-t border-slate-700/40">
                                                <div>Distancia en vacío: <b class="font-mono text-white">${c.deadheadDistanceKm != null ? Math.round(c.deadheadDistanceKm) + ' km' : '—'}</b></div>
                                                <div class="text-right text-slate-400">${esc(c.executedAt)}</div>
                                            </div>
                                            <div class="mt-2 flex items-center gap-2">
                                                <button onclick="window.coordinatorCtrl.showAiInspectionModal('${esc(c.driverId)}')" class="flex-1 py-1.5 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-white rounded-lg text-[11px] font-bold transition">
                                                    <i class="fas fa-magnifying-glass"></i> Ver criterios
                                                </button>
                                                 ${c.driverPhone ? `<a href="tel:${esc(c.driverPhone)}" class="px-2.5 py-1.5 bg-slate-800 hover:bg-ok-600/30 hover:text-ok-400 border border-slate-700 text-slate-200 rounded-lg text-[11px] font-bold transition flex items-center gap-1.5" title="Llamar a ${esc(c.driverName)}"><i class="fas fa-phone"></i> Llamar</a>` : `<span class="px-2.5 py-1.5 bg-slate-800/40 border border-slate-800 text-slate-500 rounded-lg text-[11px] font-bold flex items-center gap-1.5 cursor-not-allowed" title="Sin teléfono registrado"><i class="fas fa-phone-slash"></i> Sin tel.</span>`}
                                            </div>
                                        </div>
                                    `).join('') : `
                                        <div class="p-3 rounded-xl border border-dashed border-slate-700 text-[11px] text-slate-400 text-center">
                                            El motor de asignación aún no registra decisiones para esta carga.
                                        </div>
                                    `}
                                </div>
                            ` : `
                                <div class="p-4 rounded-xl border border-dashed border-slate-700 text-xs text-slate-400 text-center">
                                    <i class="fas fa-inbox text-lg mb-1 block"></i>
                                    No hay cargas disponibles en Load-Allocation.
                                </div>
                            `}
                        </div>

                        <div class="flex-1 bg-slate-900 border border-slate-800 rounded-2xl p-4 flex flex-col overflow-hidden shadow-xl">
                            <div class="flex items-center justify-between mb-3">
                                <h3 class="font-bold text-sm text-white">Flota en operación (${fleet.length})</h3>
                                <div class="flex items-center gap-1.5">                                     <button onclick="window.coordinatorCtrl.openVehicleModal()" class="px-2.5 py-1.5 bg-accent-500 hover:bg-accent-600 text-graphite-950 font-bold rounded-xl text-xs flex items-center gap-1.5 transition shadow-sm" title="Registrar o vincular vehículo para un conductor">                                         <i class="fas fa-truck"></i>                                         <span class="hidden sm:inline">Registrar vehículo</span>                                     </button>                                     <button onclick="window.coordinatorCtrl.refreshFleet()" class="w-8 h-8 grid place-items-center rounded-xl text-slate-400 hover:text-white text-xs bg-slate-800/80 hover:bg-slate-700" title="Actualizar desde fleets-drivers" aria-label="Actualizar la flota">                                         <i class="fas fa-rotate ${state.dataStatus.loading ? 'fa-spin' : ''}"></i>                                     </button>                                 </div>
                            </div>
                            <div class="flex-1 overflow-y-auto space-y-2 pr-1">
                                ${fleet.length ? fleet.map(truck => `
                                    <div onclick="window.coordinatorCtrl.selectTruck('${esc(truck.id)}')" class="p-2.5 bg-slate-800/50 hover:bg-slate-800 border border-slate-700/50 rounded-xl cursor-pointer transition flex items-center justify-between gap-2">
                                        <div class="flex items-center gap-3 min-w-0">
                                            <div class="w-2.5 h-2.5 shrink-0 rounded-full ${
                                                truck.status === 'EN_TRANSITO' ? 'bg-ok-500' :
                                                truck.status === 'DESCANSO' ? 'bg-warn-500' : 'bg-slate-500'
                                            }"></div>
                                            <div class="min-w-0">
                                                <div class="font-bold text-xs text-white truncate">${esc(truck.driverName)}</div>
                                                <div class="text-[10px] text-slate-400 font-mono truncate">${esc(truck.plate)} • ${esc(truck.vehicleType)}</div>
                                            </div>
                                        </div>
                                        <div class="flex items-center gap-2 shrink-0">
                                            <div class="text-right">
                                                <span class="text-xs font-semibold ${truck.status === 'DESCANSO' ? 'text-warn-500' : 'text-slate-200'}">${truck.status === 'DESCANSO' ? '<i class="fas fa-triangle-exclamation"></i> ' : ''}${esc(window.DriverApp.statusLabel(truck.status))}</span>
                                                <div class="text-[10px] text-slate-400 font-mono mt-0.5">${truck.speed} km/h · ${esc(truck.lastCheckin)}</div>
                                            </div>
                                            ${truck.phone ? `<a href="tel:${esc(truck.phone)}" onclick="event.stopPropagation()" class="w-7 h-7 rounded-lg bg-slate-700/80 hover:bg-ok-600/30 hover:text-ok-400 text-slate-300 grid place-items-center text-xs transition border border-slate-600/50" title="Llamar a ${esc(truck.driverName)}" aria-label="Llamar por teléfono"><i class="fas fa-phone"></i></a>` : `<span class="w-7 h-7 rounded-lg bg-slate-800/50 text-slate-600 grid place-items-center text-xs border border-slate-800 cursor-not-allowed" title="Conductor sin teléfono registrado" aria-label="Sin teléfono"><i class="fas fa-phone-slash"></i></span>`}
                                            <button type="button" onclick="event.stopPropagation(); window.coordinatorCtrl.openVehicleModal('${esc(truck.driverId || truck.id)}')" class="w-7 h-7 rounded-lg bg-slate-700/80 hover:bg-slate-600 text-slate-300 hover:text-white grid place-items-center text-xs transition border border-slate-600/50" title="Editar vehículo" aria-label="Editar vehículo"><i class="fas fa-truck"></i></button>
                                        </div>
                                    </div>
                                `).join('') : `
                                    <div class="p-4 text-center text-xs text-slate-400">
                                        No hay vehículos activos reportados en fleets-drivers.
                                    </div>
                                `}
                            </div>
                        </div>
                    </div>

                    <div class="lg:col-span-8 flex flex-col gap-4 lg:overflow-hidden order-1 lg:order-2">
                        <div class="flex-1 min-h-[55vh] lg:min-h-0 bg-slate-900 border border-slate-800 rounded-2xl relative overflow-hidden shadow-2xl">
                            <div id="coordinator-map-container" class="w-full h-full"></div>

                            <div class="absolute top-4 left-14 z-[400] bg-slate-900/90 backdrop-blur border border-slate-700 rounded-2xl p-3 shadow-2xl space-y-2 max-w-xs">
                                <div class="flex items-center gap-2">
                                    <span class="dot ok"></span>
                                    <span class="font-bold text-xs text-white">Monitoreo GPS y alertas</span>
                                </div>
                                <div class="text-[11px] text-slate-300">
                                    ${fleet.filter(truck => truck.coords).length} vehículo(s) con posición · ${alerts.length} alerta(s) activa(s)
                                </div>
                                <div data-telemetry-status class="flex items-center gap-1.5 text-[10px] text-slate-400" title="Posiciones de la flota por WebSocket (/topic/fleet-locations)"></div>
                                <div class="flex gap-2 pt-1">
                                    <button onclick="window.mapCtrl.fitAllRoute()" class="px-2.5 py-1 bg-slate-800 text-slate-300 rounded-lg text-[10px] hover:bg-slate-700 transition">
                                        Ver todo
                                    </button>
                                </div>
                            </div>

                            <div class="absolute bottom-4 right-4 z-[400] bg-slate-900/90 backdrop-blur border border-slate-700 rounded-xl p-2.5 text-[10px] text-slate-300 space-y-1 shadow-lg">
                                <div class="flex items-center gap-2"><span class="fleet-legend is-transit"></span> En tránsito</div>
                                <div class="flex items-center gap-2"><span class="fleet-legend"></span> Disponible</div>
                                <div class="flex items-center gap-2"><span class="fleet-legend is-rest"></span> Descanso requerido</div>
                                <div class="flex items-center gap-2"><i class="fas fa-triangle-exclamation text-warn-500"></i> Alerta vial</div>
                            </div>
                        </div>

                        <div class="grid grid-cols-1 md:grid-cols-3 md:h-48 gap-4">
                            <div class="bg-slate-900 border border-slate-800 rounded-2xl p-3.5 flex flex-col overflow-hidden shadow-xl">
                                <div class="flex items-center justify-between mb-2">
                                    <h3 class="font-extrabold text-xs text-white flex items-center gap-2">
                                        <i class="fas fa-file-signature text-slate-400"></i> Entregas recientes
                                    </h3>
                                    <span class="text-xs text-slate-400">${deliveries.length} con prueba de entrega</span>
                                </div>
                                <div class="flex-1 overflow-y-auto space-y-1.5 text-xs">
                                    ${deliveries.length ? deliveries.map(d => `
                                        <div class="p-2 bg-slate-800/50 border border-slate-700/50 rounded-xl flex items-center justify-between gap-2">
                                            <div class="min-w-0">
                                                <div class="font-bold text-white truncate">${esc(d.id)} · ${esc(d.destination.city)}</div>
                                                <div class="text-[10px] text-slate-400 truncate">Recibió ${esc(d.podReceiverName || '—')} · ${esc(d.deliveredAtLabel)}</div>
                                            </div>
                                            <button onclick="window.coordinatorCtrl.showProofOfDelivery(${d.backendId})" class="shrink-0 px-2.5 py-1.5 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-white rounded-lg text-xs font-bold" title="Ver prueba de entrega">
                                                <i class="fas ${d.podHasSignature ? 'fa-signature' : 'fa-receipt'}"></i> POD
                                            </button>
                                        </div>
                                    `).join('') : '<div class="text-slate-400 text-center p-3">Aún no hay entregas registradas.</div>'}
                                </div>
                            </div>

                            <div class="bg-slate-900 border border-slate-800 rounded-2xl p-3.5 flex flex-col overflow-hidden shadow-xl">
                                <div class="flex items-center justify-between mb-2">
                                    <h3 class="font-extrabold text-xs text-white flex items-center gap-2">
                                        <i class="fas fa-triangle-exclamation text-slate-400"></i> Novedades operativas
                                    </h3>
                                    <span class="text-xs text-slate-400">Alertas y flota</span>
                                </div>
                                <div class="flex-1 overflow-y-auto space-y-2 text-xs">
                                    ${notices.length ? notices.map(n => `
                                        <div class="p-2 ${n.style} rounded-xl flex items-start gap-2">
                                            <i class="fas ${n.icon} mt-0.5"></i>
                                            <div class="min-w-0 flex-1">
                                                <div><b class="text-white">${esc(n.title)}:</b> ${esc(n.text)}</div>
                                                ${n.alertId ? `<div class="flex gap-1.5 mt-1.5">
                                                    <button onclick="window.app.upvoteAlert(${n.alertId})" class="px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-white text-xs font-bold" title="Confirmar la alerta en Community-Alerts (un voto por usuario)">
                                                        <i class="fas fa-check"></i> Validar · ${n.upvotes}
                                                    </button>
                                                    <button onclick="window.coordinatorCtrl.dismissAlert(${n.alertId})" class="px-2.5 py-1.5 rounded-lg hover:bg-slate-800 text-slate-300 text-xs font-bold" title="Ocultar de esta vista (el backend no tiene descarte)">
                                                        <i class="fas fa-eye-slash"></i> Descartar
                                                    </button>
                                                </div>` : ''}
                                            </div>
                                        </div>
                                    `).join('') : '<div class="text-slate-400 text-center p-3">Sin novedades activas.</div>'}
                                </div>
                            </div>

                            <div class="bg-slate-900 border border-slate-800 rounded-2xl p-3.5 flex flex-col overflow-hidden shadow-xl">
                                <div class="flex items-center justify-between mb-2">
                                    <h3 class="font-extrabold text-xs text-white flex items-center gap-2">
                                        <i class="fas fa-comments text-slate-400"></i> Canal directo de despacho
                                    </h3>
                                    <span class="text-[10px] text-slate-500 font-mono">local · sin backend</span>
                                </div>

                                <div id="coordinator-chat-box" class="flex-1 overflow-y-auto space-y-1.5 text-xs p-1">
                                    ${(state.chatMessages || []).map(m => `
                                        <div class="${m.sender === 'coordinator' ? 'bg-slate-700 text-white ml-auto' : 'bg-slate-800/80 text-slate-200'} p-2 rounded-xl max-w-[85%]">
                                            <span class="text-[9px] block font-mono text-slate-400">${m.sender === 'coordinator' ? 'Central' : 'Conductor'} • ${esc(m.time)}</span>
                                            ${esc(m.text)}
                                        </div>
                                    `).join('')}
                                </div>

                                <div class="mt-2 flex gap-2">
                                    <input id="coord-msg-input" type="text" placeholder="Escribir instrucción al conductor..." class="flex-1 bg-slate-950 border border-slate-700 rounded-xl px-3 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-slate-400">
                                    <button onclick="window.coordinatorCtrl.sendDispatchMessage()" class="w-10 h-9 grid place-items-center bg-accent-500 hover:bg-accent-600 text-graphite-950 rounded-xl text-xs font-bold transition" aria-label="Enviar instrucción">
                                        <i class="fas fa-paper-plane"></i>
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                <div id="ai-inspection-modal" class="fixed inset-0 z-[1000] bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4 hidden">
                    <div class="bg-slate-900 border border-slate-700 rounded-3xl p-6 max-w-xl w-full shadow-2xl space-y-4">
                        <div class="flex items-center justify-between border-b border-slate-800 pb-3">
                            <div class="flex items-center gap-2.5">
                                <div class="w-8 h-8 rounded-lg bg-slate-800 text-slate-200 flex items-center justify-center">
                                    <i class="fas fa-sliders"></i>
                                </div>
                                <h3 class="font-bold text-base text-white">Criterios de la decisión de asignación</h3>
                            </div>
                            <button onclick="window.coordinatorCtrl.closeAiInspectionModal()" class="text-slate-400 hover:text-white text-lg">
                                <i class="fas fa-times"></i>
                            </button>
                        </div>
                        <div id="ai-inspection-body" class="text-xs text-slate-300 space-y-3 leading-relaxed"></div>
                        <div class="flex justify-end pt-2">
                            <button onclick="window.coordinatorCtrl.closeAiInspectionModal()" class="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-xl text-xs font-bold transition">
                                Cerrar
                            </button>
                        </div>
                    </div>
                </div>

                <div id="vehicle-registration-modal" class="fixed inset-0 z-[1000] bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4 hidden">
                    <div class="bg-slate-900 border border-slate-700 rounded-3xl p-5 sm:p-6 max-w-lg w-full shadow-2xl space-y-4 max-h-[90vh] overflow-y-auto">
                        <div class="flex items-center justify-between border-b border-slate-800 pb-3">
                            <div class="flex items-center gap-2.5">
                                <div class="w-9 h-9 rounded-xl bg-accent-500/15 text-accent-500 flex items-center justify-center">
                                    <i class="fas fa-truck text-base"></i>
                                </div>
                                <div>
                                    <h3 class="font-bold text-base text-white">Registrar / Vincular Vehículo</h3>
                                    <p class="text-xs text-slate-400">Datos para gálibo, peso y rutas con IA</p>
                                </div>
                            </div>
                            <button type="button" onclick="window.coordinatorCtrl.closeVehicleModal()" class="w-8 h-8 rounded-lg text-slate-400 hover:text-white grid place-items-center text-lg">
                                <i class="fas fa-times"></i>
                            </button>
                        </div>
                        <form id="vehicle-registration-form" onsubmit="window.coordinatorCtrl.submitVehicleForm(event)" class="space-y-3 text-xs">
                            <div>
                                <label class="block font-bold text-slate-300 mb-1">Conductor</label>
                                <select id="veh-driver-id" class="login-input w-full text-xs" required></select>
                            </div>
                            <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                <div>
                                    <label class="block font-bold text-slate-300 mb-1">Placa del vehículo</label>
                                    <input id="veh-plate" type="text" placeholder="Ej: TDK-410" required maxlength="10" class="login-input w-full text-xs uppercase font-mono">
                                    <span class="text-[10px] text-slate-400 mt-0.5 block">Formato colombiano</span>
                                </div>
                                <div>
                                    <label class="block font-bold text-slate-300 mb-1">Tipo de camión</label>
                                    <select id="veh-type" class="login-input w-full text-xs" required>
                                        <option value="TRACTOMULA_3S3">Tractomula 3S3</option>
                                        <option value="MINIMULA">Minimula</option>
                                        <option value="DOBLETROQUE">Doble troque</option>
                                        <option value="CUATRO_MANOS">Cuatro manos</option>
                                        <option value="SENCILLO">Sencillo</option>
                                        <option value="TURBO">Turbo</option>
                                        <option value="REFRIGERADO">Refrigerado</option>
                                    </select>
                                </div>
                            </div>
                            <div>
                                <label class="block font-bold text-slate-300 mb-1">Marca y Modelo</label>
                                <input id="veh-model" type="text" placeholder="Ej: Kenworth T800 2021" required class="login-input w-full text-xs">
                            </div>
                            <div class="grid grid-cols-3 gap-2.5">
                                <div>
                                    <label class="block font-bold text-slate-300 mb-1">Gálibo (m)</label>
                                    <input id="veh-height" type="number" step="0.05" min="1.0" max="6.0" placeholder="4.1" required class="login-input w-full text-xs font-mono">
                                </div>
                                <div>
                                    <label class="block font-bold text-slate-300 mb-1">Tara (t)</label>
                                    <input id="veh-tare" type="number" step="0.1" min="0.5" max="40.0" placeholder="16.0" required class="login-input w-full text-xs font-mono">
                                </div>
                                <div>
                                    <label class="block font-bold text-slate-300 mb-1">Capacidad (t)</label>
                                    <input id="veh-payload" type="number" step="0.1" min="0.5" max="60.0" placeholder="34.0" required class="login-input w-full text-xs font-mono">
                                </div>
                            </div>
                            <div class="pt-3 border-t border-slate-800 flex items-center justify-end gap-2.5">
                                <button type="button" onclick="window.coordinatorCtrl.closeVehicleModal()" class="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-xl text-xs font-bold transition">Cancelar</button>
                                <button type="submit" id="veh-submit-btn" class="px-4 py-2 bg-accent-500 hover:bg-accent-600 text-graphite-950 font-bold rounded-xl text-xs transition flex items-center gap-1.5"><i class="fas fa-check"></i><span>Guardar y Vincular</span></button>
                            </div>
                        </form>
                    </div>
                </div>
            </div>
        `;
    },

    /** Pestañas del rol COORDINADOR: torre de control (toda la flota) y panel del generador (sus envíos). */
    renderTabs(state) {
        const tab = state.coordinatorTab === 'shipments' ? 'shipments' : 'fleet';
        const item = (key, icon, text) => `
            <button onclick="window.app.setCoordinatorTab('${key}')" role="tab" aria-selected="${tab === key}"
                    class="px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 transition ${tab === key ? 'bg-accent-500/15 text-accent-500' : 'text-slate-300 hover:bg-slate-800'}">
                <i class="fas ${icon}"></i> ${text}
            </button>`;
        return `
            <nav class="flex items-center gap-1 p-1 bg-slate-950/60 border border-slate-800 rounded-xl" role="tablist" aria-label="Vistas del coordinador">
                ${item('fleet', 'fa-tower-broadcast', 'Torre de control')}
                ${item('shipments', 'fa-boxes-stacked', 'Mis envíos')}
            </nav>`;
    },

    initials(user) {
        if (!user) return 'TC';
        return ((user.firstName || ' ')[0] + (user.lastName || ' ')[0]).toUpperCase();
    },

    /** Rol de la sesión en palabras (no el código del backend). */
    roleLabel(role) {
        return { COORDINADOR: 'Coordinador', ADMIN: 'Administrador', GENERADOR: 'Generador de carga', CONDUCTOR: 'Conductor' }[role] || role || '';
    },

    /** Rechazo, vencimiento y "sin conductores" piden atención: van con triángulo además del color. */
    assignmentWarn(status) {
        return ['REJECTED', 'TIMEOUT', 'UNASSIGNED_NO_DRIVERS'].includes(status);
    },

    assignmentColor(status) {
        switch (status) {
            case 'ACCEPTED': return 'text-ok-500';
            case 'PROPOSED':
            case 'NOTIFIED': return 'text-slate-200';
            case 'REJECTED':
            case 'TIMEOUT':
            case 'UNASSIGNED_NO_DRIVERS': return 'text-warn-500';
            default: return 'text-slate-300';
        }
    },

    buildNotices(fleet, alerts) {
        const notices = [];
        fleet.filter(t => t.status === 'DESCANSO').forEach(t => notices.push({
            icon: 'fa-triangle-exclamation text-warn-500',
            style: 'bg-slate-800/50 text-slate-300',
            title: 'Descanso requerido',
            text: t.driverName + ' (' + t.plate + ') lleva ' + t.hoursActive + ' de conducción.'
        }));
        const dismissed = window.coordinatorCtrl.dismissedAlerts();
        alerts.filter(a => (a.verified || a.severity === 'CRITICA' || a.severity === 'ALTA') && !dismissed.has(a.id))
            .slice(0, 6).forEach(a => notices.push({
                icon: 'fa-triangle-exclamation text-warn-500',
                style: 'bg-slate-800/50 text-slate-300',
                title: a.badge + (a.verified ? ' (validada)' : ''),
                text: a.title + (a.corridor ? ' · ' + a.corridor : '') + ' · ' + a.timeAgo,
                alertId: a.id && !a.pendingSync ? a.id : null,
                upvotes: a.upvotes
            }));
        return notices;
    }
};

window.coordinatorCtrl = {
    /** Alertas descartadas por este coordinador: solo se ocultan de su vista (Community-Alerts no tiene descarte). */
    dismissedAlerts() {
        try {
            return new Set(JSON.parse(sessionStorage.getItem('truckcar.dismissedAlerts') || '[]'));
        } catch (e) {
            return new Set();
        }
    },

    dismissAlert(alertId) {
        const dismissed = this.dismissedAlerts();
        dismissed.add(alertId);
        try { sessionStorage.setItem('truckcar.dismissedAlerts', JSON.stringify([...dismissed])); } catch (e) { /* sin almacenamiento */ }
        window.store.setState({});
        window.ui.toast('Alerta ocultada de su vista', 'info', {
            description: 'Sigue activa para los conductores hasta que venza.',
            action: { label: 'Deshacer', onClick: () => this.restoreAlert(alertId) }
        });
    },

    restoreAlert(alertId) {
        const dismissed = this.dismissedAlerts();
        dismissed.delete(alertId);
        try { sessionStorage.setItem('truckcar.dismissedAlerts', JSON.stringify([...dismissed])); } catch (e) { /* sin almacenamiento */ }
        window.store.setState({});
    },

    showAiInspectionModal(driverId) {
        const modal = document.getElementById('ai-inspection-modal');
        const body = document.getElementById('ai-inspection-body');
        const evaluation = window.TruckCarData.dispatchEvaluation || { candidates: [] };
        const candidate = evaluation.candidates.find(c => c.driverId === driverId);
        if (!modal || !body || !candidate) return;
        const esc = window.ui.escape;
        body.innerHTML = `
            <p>El motor de asignación seleccionó a <b>${esc(candidate.driverName)} (${esc(candidate.vehiclePlate)})</b>
               con un puntaje de <b>${candidate.score != null ? candidate.score + '/100' : '—'}</b>.</p>
            <div class="p-3 bg-slate-950/80 rounded-2xl border border-slate-800 space-y-2">
                <div class="flex justify-between"><span class="text-slate-400">Ponderación del modelo</span><span class="font-mono text-slate-300">Cercanía 50% · Capacidad 30% · Calificación 20%</span></div>
                <div class="flex justify-between"><span class="text-slate-400">Distancia en vacío al cargue</span><span class="font-mono text-white font-bold">${candidate.deadheadDistanceKm != null ? candidate.deadheadDistanceKm.toFixed(1) + ' km' : '—'}</span></div>
                <div class="flex justify-between"><span class="text-slate-400">Estado de la decisión</span><span class="text-slate-200">${esc(window.DriverApp.statusLabel(candidate.decisionStatus))}</span></div>
                <div class="flex justify-between"><span class="text-slate-400">Ejecutada</span><span class="font-mono text-slate-200">${esc(candidate.executedAt)}</span></div>
            </div>
            <div class="p-3 bg-slate-950/80 border border-slate-800 rounded-2xl text-slate-200">
                <b>Justificación del motor:</b> ${esc(candidate.reason || 'Sin detalle registrado')}
            </div>
        `;
        modal.classList.remove('hidden');
    },

    /** Recibo firmado (receptor, documento, notas, firma y foto) de una carga DELIVERED. */
    showProofOfDelivery(loadId) {
        const load = (window.TruckCarData.deliveredLoads || []).find(l => l.backendId === loadId);
        window.PodUI.showProofOfDelivery(loadId, load);
    },

    closeAiInspectionModal() {
        const modal = document.getElementById('ai-inspection-modal');
        if (modal) modal.classList.add('hidden');
    },

    async refreshFleet() {
        await window.TruckCarService.refreshCoordinator();
        window.ui.toast('Flota, alertas y cargas actualizadas.', 'success');
    },

    async selectLoad(loadId) {
        window.store.setState({ selectedLoadId: Number(loadId) });
        await window.TruckCarService.loadCoordinatorLoad();
        window.store.setState({});
    },

    /** AVAILABLE | ASSIGNED -> CANCELLED (solo COORDINADOR o ADMIN; el backend lo valida con el rol del token). */
    async cancelLoad(loadId) {
        const reason = prompt('Motivo de la cancelación de la carga #' + loadId + ' (obligatorio):');
        if (reason === null) return;
        if (!reason.trim()) {
            window.ui.toast('Indique el motivo de la cancelación.', 'warning');
            return;
        }
        window.store.setState({ busyAction: 'cancel' });
        try {
            await window.TruckCarService.cancelLoad(loadId, reason.trim());
            window.ui.toast('Carga #' + loadId + ' cancelada.', 'success');
        } catch (error) {
            window.ui.failure('No se pudo cancelar la carga', error, 'cancelar la carga');
        } finally {
            window.store.setState({ busyAction: null });
        }
    },

    async requestMatching(loadId) {
        window.store.setState({ busyAction: 'matching' });
        try {
            const result = await window.TruckCarService.requestMatching(loadId);
            const message = result && result.selectedDriverName
                ? 'Matching ejecutado: propuesta para ' + result.selectedDriverName + ' (' + Math.round(result.matchingScore) + '/100).'
                : 'Matching ejecutado: ' + ((result && result.reasonDetails) || (result && result.status) || 'sin candidatos');
            window.ui.toast(message, result && result.selectedDriverName ? 'success' : 'warning');
        } catch (error) {
            window.ui.failure('No se pudo ejecutar el matching', error, 'ejecutar el matching');
        } finally {
            window.store.setState({ busyAction: null });
        }
    },

    focusTruck(truckId) {
        const truck = (window.TruckCarData.fleetVehicles || []).find(t => t.id === truckId);
        if (truck && truck.coords) window.mapCtrl.focusOn(truck.coords, 12);
    },

    selectTruck(truckId) {
        const truck = (window.TruckCarData.fleetVehicles || []).find(t => t.id === truckId);
        if (!truck) return;
        if (truck.coords) window.mapCtrl.focusOn(truck.coords, 12);
        window.ui.toast(truck.driverName + ' · ' + truck.plate + ' · ' + window.DriverApp.statusLabel(truck.status) + ' · ' + truck.speed + ' km/h · conducción ' + truck.hoursActive, 'info');
    },

    async sendDispatchMessage() {
        const input = document.getElementById('coord-msg-input');
        if (!input || !input.value.trim()) return;
        const text = input.value.trim();
        input.value = '';
        if (window.TruckCarMessaging) {
            try {
                await window.TruckCarMessaging.sendMessage(text);
            } catch (error) {
                window.ui.failure('No se pudo enviar el mensaje', error, 'contactar al conductor');
            }
        }
    },

    async openVehicleModal(selectedDriverId) {
        const modal = document.getElementById('vehicle-registration-modal');
        if (!modal) return;
        const select = document.getElementById('veh-driver-id');
        const plateInput = document.getElementById('veh-plate');
        const modelInput = document.getElementById('veh-model');
        const typeSelect = document.getElementById('veh-type');
        const heightInput = document.getElementById('veh-height');
        const tareInput = document.getElementById('veh-tare');
        const payloadInput = document.getElementById('veh-payload');

        const driverMap = new Map();
        (window.TruckCarData.fleetVehicles || []).forEach(t => {
            if (t.driverId) driverMap.set(t.driverId, { id: t.driverId, name: t.driverName, truck: t });
        });
        const evaluation = window.TruckCarData.dispatchEvaluation || { candidates: [] };
        (evaluation.candidates || []).forEach(c => {
            if (c.driverId && !driverMap.has(c.driverId)) {
                driverMap.set(c.driverId, { id: c.driverId, name: c.driverName, vehiclePlate: c.vehiclePlate });
            }
        });
        if (window.TruckCarData.currentDriver && window.TruckCarData.currentDriver.id) {
            const cd = window.TruckCarData.currentDriver;
            if (!driverMap.has(cd.id)) driverMap.set(cd.id, { id: cd.id, name: cd.name, driver: cd });
        }
        const submitBtn = document.getElementById('veh-submit-btn');
        if (driverMap.size === 0) {
            select.innerHTML = '<option value="" disabled selected>No hay conductores disponibles para vincular</option>';
            if (submitBtn) submitBtn.disabled = true;
            modal.classList.remove('hidden');
            return;
        }

        select.innerHTML = Array.from(driverMap.values()).map(d => {
            const isSel = selectedDriverId ? d.id === selectedDriverId : false;
            return `<option value="${window.ui.escape(d.id)}" ${isSel ? 'selected' : ''}>${window.ui.escape(d.name)}</option>`;
        }).join('');

        const targetId = selectedDriverId || (select.value || null);
        const chosen = targetId ? driverMap.get(targetId) : null;
        const truck = chosen ? (chosen.truck || chosen.driver) : null;

        plateInput.value = (truck && (truck.plate || (truck.vehicle && truck.vehicle.plate))) || '';
        modelInput.value = (truck && (truck.model || (truck.vehicle && truck.vehicle.brand))) || '';
        if (truck && (truck.rawType || (truck.vehicle && truck.vehicle.category))) {
            typeSelect.value = truck.rawType || truck.vehicle.category;
        } else {
            typeSelect.value = 'TRACTOMULA_3S3';
        }
        heightInput.value = (truck && (truck.height || (truck.vehicle && truck.vehicle.height))) || '4.1';
        tareInput.value = (truck && (truck.tareWeight || (truck.vehicle && truck.vehicle.tareWeight))) || '16.0';
        payloadInput.value = (truck && (truck.maxPayload || (truck.vehicle && truck.vehicle.maxPayload))) || '34.0';

        select.onchange = () => {
            const selDriver = driverMap.get(select.value);
            if (selDriver && selDriver.truck) {
                const tr = selDriver.truck;
                if (tr.plate) plateInput.value = tr.plate;
                if (tr.model) modelInput.value = tr.model;
                if (tr.rawType) typeSelect.value = tr.rawType;
                if (tr.height) heightInput.value = tr.height;
                if (tr.tareWeight) tareInput.value = tr.tareWeight;
                if (tr.maxPayload) payloadInput.value = tr.maxPayload;
            }
        };

        modal.classList.remove('hidden');
    },

    closeVehicleModal() {
        const modal = document.getElementById('vehicle-registration-modal');
        if (modal) modal.classList.add('hidden');
    },

    async submitVehicleForm(event) {
        event.preventDefault();
        const btn = document.getElementById('veh-submit-btn');
        const select = document.getElementById('veh-driver-id');
        const plate = document.getElementById('veh-plate').value.trim().toUpperCase();
        const model = document.getElementById('veh-model').value.trim();
        const type = document.getElementById('veh-type').value;
        const height = parseFloat(document.getElementById('veh-height').value);
        const tare = parseFloat(document.getElementById('veh-tare').value);
        const payload = parseFloat(document.getElementById('veh-payload').value);

        const driverId = select ? select.value : '';
        if (!driverId) {
            window.ui.toast('Seleccione un conductor válido registrado.', 'warning');
            return;
        }
        const driverName = (select && select.options[select.selectedIndex]) ? select.options[select.selectedIndex].text : driverId;

        const plateClean = plate.replace(/[^A-Z0-9]/g, '');
        const plateRegex = /^[A-Z]{3}[0-9]{3}$/;
        if (!plateRegex.test(plateClean)) {
            window.ui.toast('Placa inválida: debe tener formato colombiano (3 letras y 3 números, Ej: TDK-410).', 'warning');
            return;
        }
        if (!plate || !model || isNaN(height) || isNaN(tare) || isNaN(payload)) {
            window.ui.toast('Complete todos los campos del vehículo.', 'warning');
            return;
        }
        const duplicate = (window.TruckCarData.fleetVehicles || []).find(vehicle =>
            String(vehicle.plate || '').replace(/[^A-Z0-9]/gi, '').toUpperCase() === plateClean
            && vehicle.driverId !== driverId);
        if (duplicate) {
            window.ui.toast('Esta placa ya está asociada a otro conductor de la flota.', 'warning');
            return;
        }

        if (btn) {
            btn.disabled = true;
            btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Guardando...';
        }

        try {
            await window.TruckCarApi.fleet.registerVehicle(driverId, {
                plate, model, type, height, tareWeight: tare, maxPayload: payload
            });

            if (window.TruckCarData.currentDriver && (window.TruckCarData.currentDriver.id === driverId || window.TruckCarData.currentDriver.userId === driverId)) {
                const cd = window.TruckCarData.currentDriver;
                cd.hasVehicle = true;
                cd.vehicle = { plate, brand: model, category: type, height, tareWeight: tare, maxPayload: payload, grossWeight: tare, badges: ['Verificado'] };
            }

            await window.TruckCarService.loadFleet();
            window.store.setState({});
            window.ui.toast('Vehículo ' + plate + ' vinculado con éxito a ' + driverName + '.', 'success');
            this.closeVehicleModal();
        } catch (err) {
            window.ui.failure('No se pudo registrar el vehículo', err, 'registrar el vehículo');
        } finally {
            if (btn) {
                btn.disabled = false;
                btn.innerHTML = '<i class="fas fa-check"></i><span>Guardar y Vincular</span>';
            }
        }
    }
};

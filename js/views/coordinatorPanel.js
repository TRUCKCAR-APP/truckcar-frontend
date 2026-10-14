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
                <header class="h-16 px-6 bg-slate-900 border-b border-slate-800 flex items-center justify-between z-30 shrink-0">
                    <div class="flex items-center gap-2.5">
                        <div class="w-10 h-10 rounded-xl bg-gradient-to-tr from-emerald-600 to-teal-500 flex items-center justify-center text-white shadow-lg shadow-emerald-900/40">
                            <i class="fas fa-tower-broadcast text-lg"></i>
                        </div>
                        <div>
                            <h1 class="text-base font-extrabold text-white tracking-tight flex items-center gap-2">
                                CENTRAL DE MONITOREO DE FLOTA
                                <span class="px-2 py-0.5 ${Object.keys(state.dataStatus.errors).length ? 'bg-rose-500/20 text-rose-400 border-rose-500/30' : 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30'} border rounded text-[10px] font-mono uppercase">
                                    ${Object.keys(state.dataStatus.errors).length ? 'Con errores' : 'En Línea'}
                                </span>
                            </h1>
                            <p class="text-xs text-slate-400">Última sincronización: ${state.dataStatus.lastSync ? new Date(state.dataStatus.lastSync).toLocaleTimeString('es-CO') : '—'}</p>
                        </div>
                    </div>

                    ${this.renderTabs(state)}

                    <div class="flex items-center gap-6">
                        <div class="flex items-center gap-3">
                            <div class="px-3.5 py-1.5 bg-slate-800/80 border border-slate-700/60 rounded-xl text-center">
                                <span class="text-[10px] uppercase text-slate-400 font-bold block">Flota Activa</span>
                                <span class="text-sm font-black text-emerald-400 font-mono">${operating} / ${fleet.length}</span>
                            </div>
                            <div class="px-3.5 py-1.5 bg-slate-800/80 border border-slate-700/60 rounded-xl text-center">
                                <span class="text-[10px] uppercase text-slate-400 font-bold block">Alertas Ruta</span>
                                <span class="text-sm font-black text-amber-400 font-mono">${alerts.length} Novedades</span>
                            </div>
                            <div class="px-3.5 py-1.5 bg-slate-800/80 border border-slate-700/60 rounded-xl text-center">
                                <span class="text-[10px] uppercase text-slate-400 font-bold block">Gálibo Reportado</span>
                                <span class="text-sm font-black text-rose-400 font-mono">${clearanceAlerts} Alertas</span>
                            </div>
                        </div>

                        <div class="flex items-center gap-3 pl-4 border-l border-slate-800">
                            <div class="w-9 h-9 rounded-xl bg-indigo-600/30 border border-slate-700 flex items-center justify-center text-indigo-300 font-bold text-xs">
                                ${esc(this.initials(user))}
                            </div>
                            <div class="text-left">
                                <div class="text-xs font-bold text-slate-200">${esc(user ? (user.firstName + ' ' + user.lastName) : 'Coordinador')}</div>
                                <div class="text-[10px] text-slate-400">${esc(state.sessionRole || '')}</div>
                            </div>
                            <button onclick="window.app.logout()" class="ml-1 text-slate-400 hover:text-rose-400 text-xs" title="Cerrar sesión">
                                <i class="fas fa-right-from-bracket"></i>
                            </button>
                        </div>
                    </div>
                </header>

                ${window.ui.syncBanner(state)}

                <div class="flex-1 grid grid-cols-12 gap-4 p-4 overflow-hidden">
                    <div class="col-span-4 flex flex-col gap-4 overflow-hidden">
                        <div class="bg-slate-900 border border-slate-800 rounded-2xl p-4 flex flex-col gap-3 shadow-xl max-h-[60%] overflow-y-auto">
                            <div class="flex items-center justify-between border-b border-slate-800 pb-2.5">
                                <div class="flex items-center gap-2">
                                    <i class="fas fa-cubes-stacked text-indigo-400"></i>
                                    <h2 class="font-extrabold text-sm text-white">Evaluación de Despacho</h2>
                                </div>
                                ${load ? `<span class="px-2 py-0.5 bg-indigo-500/20 text-indigo-300 font-mono text-[10px] rounded font-bold">${esc(load.id)}</span>` : ''}
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
                                        <span class="font-mono text-emerald-400 text-right">${esc(load.origin.city)} → ${esc(load.destination.city)}</span>
                                    </div>
                                    <div class="flex justify-between gap-2">
                                        <span class="text-slate-400 font-medium">Asignación:</span>
                                        <span class="font-mono font-bold ${this.assignmentColor(load.assignmentStatus)}">${esc(load.assignmentStatus || 'SIN ASIGNAR')}${load.assignedDriverName ? ' · ' + esc(load.assignedDriverName) : ''}</span>
                                    </div>
                                </div>

                                ${load.status === 'AVAILABLE' || load.status === 'ASSIGNED' ? `
                                    <button onclick="window.coordinatorCtrl.cancelLoad(${load.backendId})" ${state.busyAction === 'cancel' ? 'disabled' : ''} class="w-full py-2 bg-rose-600/20 hover:bg-rose-600/30 disabled:opacity-60 text-rose-300 border border-rose-500/40 rounded-xl text-xs font-bold transition">
                                        <i class="fas ${state.busyAction === 'cancel' ? 'fa-spinner fa-spin' : 'fa-ban'}"></i> Cancelar carga
                                    </button>
                                ` : ''}

                                ${!load.assignmentStatus || load.assignmentStatus === 'UNASSIGNED_NO_DRIVERS' ? `
                                    <button onclick="window.coordinatorCtrl.requestMatching(${load.backendId})" ${state.busyAction === 'matching' ? 'disabled' : ''} class="w-full py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-60 text-white rounded-xl text-xs font-bold transition">
                                        <i class="fas ${state.busyAction === 'matching' ? 'fa-spinner fa-spin' : 'fa-wand-magic-sparkles'}"></i> Ejecutar matching con IA
                                    </button>
                                ` : ''}

                                <div class="space-y-2">
                                    <span class="text-[10px] uppercase font-bold text-slate-400 tracking-wider">Decisiones del motor de asignación</span>
                                    ${evaluation.candidates.length ? evaluation.candidates.map((c, i) => `
                                        <div class="p-3 rounded-xl border transition ${c.isCurrentAssignment ? 'bg-emerald-950/30 border-emerald-500/50 shadow-md' : 'bg-slate-800/40 border-slate-700/40'}">
                                            <div class="flex items-center justify-between mb-1.5">
                                                <div class="flex items-center gap-2 min-w-0">
                                                    <span class="w-5 h-5 shrink-0 rounded-full flex items-center justify-center text-[10px] font-mono font-bold ${c.isCurrentAssignment ? 'bg-emerald-500 text-slate-950' : 'bg-slate-700 text-slate-300'}">${i + 1}</span>
                                                    <span class="font-bold text-xs text-white truncate">${esc(c.driverName)}</span>
                                                    <span class="font-mono text-[10px] text-slate-400">(${esc(c.vehiclePlate)})</span>
                                                </div>
                                                <span class="text-sm font-black font-mono ${c.isCurrentAssignment ? 'text-emerald-400' : 'text-slate-300'}">${c.score != null ? c.score + '/100' : '—'}</span>
                                            </div>
                                            <div class="grid grid-cols-2 gap-1.5 text-[10px] text-slate-300 pt-1 border-t border-slate-700/40">
                                                <div>Distancia vacío: <b class="font-mono text-emerald-400">${c.deadheadDistanceKm != null ? Math.round(c.deadheadDistanceKm) + ' km' : '—'}</b></div>
                                                <div class="text-right text-slate-400">${esc(c.executedAt)}</div>
                                            </div>
                                            <div class="mt-2 flex items-center gap-2">
                                                <button onclick="window.coordinatorCtrl.showAiInspectionModal('${esc(c.driverId)}')" class="flex-1 py-1.5 bg-indigo-600/80 hover:bg-indigo-500 text-white rounded-lg text-[11px] font-bold transition">
                                                    <i class="fas fa-magnifying-glass"></i> Inspeccionar Criterios
                                                </button>
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
                                <h3 class="font-extrabold text-xs text-slate-200 uppercase tracking-wider">Flota en Operación (${fleet.length})</h3>
                                <button onclick="window.coordinatorCtrl.refreshFleet()" class="text-slate-400 hover:text-emerald-400 text-xs" title="Actualizar desde fleets-drivers">
                                    <i class="fas fa-rotate ${state.dataStatus.loading ? 'fa-spin' : ''}"></i>
                                </button>
                            </div>
                            <div class="flex-1 overflow-y-auto space-y-2 pr-1">
                                ${fleet.length ? fleet.map(truck => `
                                    <div onclick="window.coordinatorCtrl.selectTruck('${esc(truck.id)}')" class="p-2.5 bg-slate-800/50 hover:bg-slate-800 border border-slate-700/50 rounded-xl cursor-pointer transition flex items-center justify-between">
                                        <div class="flex items-center gap-3 min-w-0">
                                            <div class="w-2.5 h-2.5 shrink-0 rounded-full ${
                                                truck.status === 'EN_TRANSITO' ? 'bg-emerald-500 animate-pulse' :
                                                truck.status === 'DESCANSO' ? 'bg-amber-400' : 'bg-blue-400'
                                            }"></div>
                                            <div class="min-w-0">
                                                <div class="font-bold text-xs text-white truncate">${esc(truck.driverName)}</div>
                                                <div class="text-[10px] text-slate-400 font-mono truncate">${esc(truck.plate)} • ${esc(truck.vehicleType)}</div>
                                            </div>
                                        </div>
                                        <div class="text-right shrink-0">
                                            <span class="text-[10px] font-mono px-2 py-0.5 rounded font-bold ${
                                                truck.status === 'EN_TRANSITO' ? 'bg-emerald-500/20 text-emerald-400' :
                                                truck.status === 'DESCANSO' ? 'bg-amber-500/20 text-amber-400' : 'bg-blue-500/20 text-blue-400'
                                            }">${esc(truck.status)}</span>
                                            <div class="text-[10px] text-slate-400 font-mono mt-0.5">${truck.speed} km/h · ${esc(truck.lastCheckin)}</div>
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

                    <div class="col-span-8 flex flex-col gap-4 overflow-hidden">
                        <div class="flex-1 bg-slate-900 border border-slate-800 rounded-2xl relative overflow-hidden shadow-2xl">
                            <div id="coordinator-map-container" class="w-full h-full"></div>

                            <div class="absolute top-4 left-14 z-[400] bg-slate-900/90 backdrop-blur border border-slate-700 rounded-2xl p-3 shadow-2xl space-y-2 max-w-xs">
                                <div class="flex items-center gap-2">
                                    <span class="w-3 h-3 rounded-full bg-emerald-500 animate-pulse"></span>
                                    <span class="font-bold text-xs text-white">Monitoreo GPS & Alertas</span>
                                </div>
                                <div class="text-[11px] text-slate-300">
                                    ${fleet.length} vehículo(s) con posición · ${alerts.length} alerta(s) activa(s)
                                </div>
                                <div data-telemetry-status class="flex items-center gap-1.5 text-[10px] text-slate-400" title="Posiciones de la flota por WebSocket (/topic/fleet-locations)"></div>
                                <div class="flex gap-2 pt-1">
                                    <button onclick="window.mapCtrl.fitAllRoute()" class="px-2.5 py-1 bg-slate-800 text-slate-300 rounded-lg text-[10px] hover:bg-slate-700 transition">
                                        Ver todo
                                    </button>
                                </div>
                            </div>

                            <div class="absolute bottom-4 right-4 z-[400] bg-slate-900/90 backdrop-blur border border-slate-700 rounded-xl p-2.5 text-[10px] text-slate-300 space-y-1 shadow-lg">
                                <div class="flex items-center gap-2"><i class="fas fa-truck text-emerald-400"></i> En tránsito</div>
                                <div class="flex items-center gap-2"><i class="fas fa-truck text-blue-400"></i> Disponible</div>
                                <div class="flex items-center gap-2"><i class="fas fa-truck text-amber-400"></i> Descanso requerido</div>
                                <div class="flex items-center gap-2"><i class="fas fa-ruler-vertical text-rose-400"></i> Alerta de gálibo</div>
                            </div>
                        </div>

                        <div class="h-48 grid grid-cols-3 gap-4">
                            <div class="bg-slate-900 border border-slate-800 rounded-2xl p-3.5 flex flex-col overflow-hidden shadow-xl">
                                <div class="flex items-center justify-between mb-2">
                                    <h3 class="font-extrabold text-xs text-white flex items-center gap-2">
                                        <i class="fas fa-file-signature text-emerald-400"></i> Entregas Recientes
                                    </h3>
                                    <span class="text-[10px] text-emerald-400 font-mono">${deliveries.length} con POD</span>
                                </div>
                                <div class="flex-1 overflow-y-auto space-y-1.5 text-xs">
                                    ${deliveries.length ? deliveries.map(d => `
                                        <div class="p-2 bg-slate-800/50 border border-slate-700/50 rounded-xl flex items-center justify-between gap-2">
                                            <div class="min-w-0">
                                                <div class="font-bold text-white truncate">${esc(d.id)} · ${esc(d.destination.city)}</div>
                                                <div class="text-[10px] text-slate-400 truncate">Recibió ${esc(d.podReceiverName || '—')} · ${esc(d.deliveredAtLabel)}</div>
                                            </div>
                                            <button onclick="window.coordinatorCtrl.showProofOfDelivery(${d.backendId})" class="shrink-0 px-2 py-1 bg-emerald-600/80 hover:bg-emerald-500 text-white rounded-lg text-[10px] font-bold" title="Ver prueba de entrega">
                                                <i class="fas ${d.podHasSignature ? 'fa-signature' : 'fa-receipt'}"></i> POD
                                            </button>
                                        </div>
                                    `).join('') : '<div class="text-slate-400 text-center p-3">Aún no hay entregas registradas.</div>'}
                                </div>
                            </div>

                            <div class="bg-slate-900 border border-slate-800 rounded-2xl p-3.5 flex flex-col overflow-hidden shadow-xl">
                                <div class="flex items-center justify-between mb-2">
                                    <h3 class="font-extrabold text-xs text-white flex items-center gap-2">
                                        <i class="fas fa-triangle-exclamation text-amber-400"></i> Novedades Operativas
                                    </h3>
                                    <span class="text-[10px] text-emerald-400 font-mono">Alertas + Flota</span>
                                </div>
                                <div class="flex-1 overflow-y-auto space-y-2 text-xs">
                                    ${notices.length ? notices.map(n => `
                                        <div class="p-2 ${n.style} rounded-xl flex items-start gap-2">
                                            <i class="fas ${n.icon} mt-0.5"></i>
                                            <div><b class="text-white">${esc(n.title)}:</b> ${esc(n.text)}</div>
                                        </div>
                                    `).join('') : '<div class="text-slate-400 text-center p-3">Sin novedades activas.</div>'}
                                </div>
                            </div>

                            <div class="bg-slate-900 border border-slate-800 rounded-2xl p-3.5 flex flex-col overflow-hidden shadow-xl">
                                <div class="flex items-center justify-between mb-2">
                                    <h3 class="font-extrabold text-xs text-white flex items-center gap-2">
                                        <i class="fas fa-comments text-indigo-400"></i> Canal Directo de Despacho
                                    </h3>
                                    <span class="text-[10px] text-slate-500 font-mono">local · sin backend</span>
                                </div>

                                <div id="coordinator-chat-box" class="flex-1 overflow-y-auto space-y-1.5 text-xs p-1">
                                    ${(state.chatMessages || []).map(m => `
                                        <div class="${m.sender === 'coordinator' ? 'bg-emerald-900/40 border border-emerald-700/40 text-emerald-200 ml-auto' : 'bg-slate-800/80 text-slate-200'} p-2 rounded-xl max-w-[85%]">
                                            <span class="text-[9px] block font-mono ${m.sender === 'coordinator' ? 'text-emerald-400' : 'text-slate-400'}">${m.sender === 'coordinator' ? 'Central' : 'Conductor'} • ${esc(m.time)}</span>
                                            ${esc(m.text)}
                                        </div>
                                    `).join('')}
                                </div>

                                <div class="mt-2 flex gap-2">
                                    <input id="coord-msg-input" type="text" placeholder="Escribir instrucción al conductor..." class="flex-1 bg-slate-950 border border-slate-700 rounded-xl px-3 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-emerald-500">
                                    <button onclick="window.coordinatorCtrl.sendDispatchMessage()" class="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-bold transition">
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
                                <div class="w-8 h-8 rounded-lg bg-indigo-600/30 text-indigo-400 flex items-center justify-center">
                                    <i class="fas fa-sliders"></i>
                                </div>
                                <h3 class="font-bold text-base text-white">Criterios de la Decisión de Asignación</h3>
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
            </div>
        `;
    },

    /** Pestañas del rol COORDINADOR: torre de control (toda la flota) y panel del generador (sus envíos). */
    renderTabs(state) {
        const tab = state.coordinatorTab === 'shipments' ? 'shipments' : 'fleet';
        const item = (key, icon, text) => `
            <button onclick="window.app.setCoordinatorTab('${key}')" role="tab" aria-selected="${tab === key}"
                    class="px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 transition ${tab === key ? 'bg-emerald-600 text-white shadow' : 'text-slate-300 hover:bg-slate-800'}">
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

    assignmentColor(status) {
        switch (status) {
            case 'ACCEPTED': return 'text-emerald-400';
            case 'PROPOSED':
            case 'NOTIFIED': return 'text-amber-400';
            case 'REJECTED':
            case 'TIMEOUT':
            case 'UNASSIGNED_NO_DRIVERS': return 'text-rose-400';
            default: return 'text-slate-300';
        }
    },

    buildNotices(fleet, alerts) {
        const notices = [];
        fleet.filter(t => t.status === 'DESCANSO').forEach(t => notices.push({
            icon: 'fa-clock text-amber-400',
            style: 'bg-amber-500/10 border border-amber-500/30 text-amber-300',
            title: 'Descanso requerido',
            text: t.driverName + ' (' + t.plate + ') lleva ' + t.hoursActive + ' de conducción.'
        }));
        alerts.filter(a => a.verified || a.severity === 'CRITICA' || a.severity === 'ALTA').slice(0, 6).forEach(a => notices.push({
            icon: a.type === 'bridge' ? 'fa-road-barrier text-rose-400' : 'fa-triangle-exclamation text-rose-400',
            style: 'bg-rose-500/10 border border-rose-500/30 text-rose-300',
            title: a.badge + (a.verified ? ' (validada)' : ''),
            text: a.title + (a.corridor ? ' · ' + a.corridor : '') + ' · ' + a.timeAgo
        }));
        return notices;
    }
};

window.coordinatorCtrl = {
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
                <div class="flex justify-between"><span class="text-slate-400">Distancia en vacío al cargue</span><span class="font-mono text-emerald-400 font-bold">${candidate.deadheadDistanceKm != null ? candidate.deadheadDistanceKm.toFixed(1) + ' km' : '—'}</span></div>
                <div class="flex justify-between"><span class="text-slate-400">Estado de la decisión</span><span class="font-mono text-slate-200">${esc(candidate.decisionStatus)}</span></div>
                <div class="flex justify-between"><span class="text-slate-400">Ejecutada</span><span class="font-mono text-slate-200">${esc(candidate.executedAt)}</span></div>
            </div>
            <div class="p-3 bg-emerald-500/10 border border-emerald-500/30 rounded-2xl text-emerald-300">
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
            window.ui.toast('No se pudo cancelar la carga: ' + window.ui.errorMessage(error), 'error');
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
            window.ui.toast('No se pudo ejecutar el matching: ' + window.ui.errorMessage(error), 'error');
        } finally {
            window.store.setState({ busyAction: null });
        }
    },

    focusTruck(truckId) {
        const truck = (window.TruckCarData.fleetVehicles || []).find(t => t.id === truckId);
        if (truck) window.mapCtrl.focusOn(truck.coords, 12);
    },

    selectTruck(truckId) {
        const truck = (window.TruckCarData.fleetVehicles || []).find(t => t.id === truckId);
        if (!truck) return;
        window.mapCtrl.focusOn(truck.coords, 12);
        window.ui.toast(truck.driverName + ' · ' + truck.plate + ' · ' + truck.status + ' · ' + truck.speed + ' km/h · conducción ' + truck.hoursActive, 'info');
    },

    sendDispatchMessage() {
        const input = document.getElementById('coord-msg-input');
        if (!input || !input.value.trim()) return;
        const text = input.value.trim();
        const time = new Date().toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' });
        window.store.setState({
            chatMessages: [...(window.store.state.chatMessages || []), { sender: 'coordinator', text, time }]
        });
        window.voiceEngine.speak('Mensaje de central: ' + text);
    }
};

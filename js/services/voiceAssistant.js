// Copiloto TruckCar: comandos de voz manos libres para el conductor.
//
// Tres capas:
//  1. createController(deps): decide qué decir y qué hacer con cada transcripción (intenciones de VoiceIntents,
//     confirmación verbal de las acciones que cambian el estado de la carga). Sin DOM: se prueba con dependencias falsas.
//  2. Reconocedor: en la APK, el plugin nativo SpeechRecognition (@capacitor-community/speech-recognition), porque el
//     WebView de Android no implementa SpeechRecognition; en el navegador, la Web Speech API (webkitSpeechRecognition).
//  3. Interfaz: botón flotante, banner con la transcripción (no tapa el mapa ni captura toques) y teclas multimedia del
//     volante o de unos audífonos Bluetooth (MediaSession), que disparan la escucha con un toque físico.
//
// Palabra de activación ("Hola TruckCar" o "Copiloto"): solo en el navegador, con escucha continua. En Android el
// reconocedor del sistema no es continuo (cada sesión hace un pitido y se corta con el silencio), así que allí se
// activa con el botón o con las teclas multimedia.
window.VoiceAssistant = (function () {
    const intents = window.VoiceIntents;
    const CONFIRM_TIMEOUT_MS = 15000;

    // ── Formato para leer en voz alta ───────────────────────────────────────────────────────────────────────────

    function number(value, decimals = 0) {
        return Number(value).toLocaleString('es-CO', { maximumFractionDigits: decimals });
    }

    function spokenDistance(meters) {
        if (!Number.isFinite(meters)) return '';
        if (meters < 1000) return number(Math.max(10, Math.round(meters / 10) * 10)) + ' metros';
        const km = meters / 1000;
        return number(km, km < 10 ? 1 : 0) + (km >= 1 && km < 1.05 ? ' kilómetro' : ' kilómetros');
    }

    function spokenDuration(seconds) {
        if (!Number.isFinite(seconds)) return '';
        const minutes = Math.max(1, Math.round(seconds / 60));
        const h = Math.floor(minutes / 60);
        const m = minutes % 60;
        const hours = h ? h + (h === 1 ? ' hora' : ' horas') : '';
        const mins = m ? m + (m === 1 ? ' minuto' : ' minutos') : '';
        return [hours, mins].filter(Boolean).join(' y ');
    }

    function spokenHours(hours) {
        if (!Number.isFinite(hours)) return null;
        return spokenDuration(hours * 3600);
    }

    function spokenClock(date) {
        return date.toLocaleTimeString('es-CO', { hour: 'numeric', minute: '2-digit' });
    }

    /** Mensaje del error para leer: el detail del RFC 7807 que trae ApiError, sin el código de traza. */
    function errorText(error) {
        const message = error && (error.detail || error.message) ? String(error.detail || error.message) : 'error desconocido';
        return message.replace(/\s*\[trace [^\]]*\]\s*$/, '').replace(/[.\s]+$/, '');
    }

    const REPORTABLE = 'derrumbe, accidente, vía cerrada, obra, retén, báscula, gálibo bajo, parador seguro o tráfico pesado';
    const HELP = 'Puede reportar ' + REPORTABLE + '. También puede decir: enviar SOS, recalcular ruta, qué llevo, '
        + 'cuánto falta, cuántas horas llevo, alertas cercanas, aceptar carga, iniciar viaje o confirmar entrega.';
    const NOT_UNDERSTOOD = 'No entendí. Puede decir, por ejemplo: reportar accidente, recalcular ruta, qué llevo, o ayuda.';

    // Intenciones que puede devolver el intérprete con IA (Voice-AI-Assistant) y que este controlador ejecuta.
    const ASSISTANT_INTENTS = ['REPORT', 'SOS', 'NEARBY_ALERTS', 'ACCEPT_LOAD', 'REJECT_LOAD', 'START_TRIP',
        'CONFIRM_DELIVERY', 'REROUTE', 'REPEAT', 'HOURS', 'LOAD_INFO', 'HELP', 'CHAT'];
    const LOAD_INFO_FIELDS = ['eta', 'destination', 'weight', 'summary'];

    /**
     * Respuesta del intérprete con IA → intención con la misma forma que VoiceIntents.parse, o null si no sirve.
     * Se vuelve a validar aquí: un tipo de alerta o un campo que la app no conoce no se ejecuta.
     */
    function fromAssistant(response, text) {
        if (!response || typeof response !== 'object' || !ASSISTANT_INTENTS.includes(response.intent)) return null;
        const base = { type: response.intent, text, fromAssistant: true };
        switch (response.intent) {
        case 'REPORT': {
            const closure = response.alertType === 'workshop' && response.closure === true;
            const report = intents.REPORT_TYPES.find(r => r.type === response.alertType && Boolean(r.closure) === closure);
            if (!report) return null;
            return { ...base, alertType: report.type, label: report.label, closure,
                description: closure ? 'Vía cerrada (reporte por voz)' : null };
        }
        case 'LOAD_INFO':
            return LOAD_INFO_FIELDS.includes(response.field) ? { ...base, field: response.field } : null;
        case 'REROUTE':
            return { ...base, avoidAhead: response.avoidAhead === true };
        case 'CHAT':
            return typeof response.reply === 'string' && response.reply.trim()
                ? { ...base, reply: response.reply.trim().slice(0, 300) } : null;
        default:
            return base;
        }
    }

    // ── 1. Controlador ──────────────────────────────────────────────────────────────────────────────────────────

    /**
     * deps:
     *  say(text) → Promise           habla y resuelve al terminar.
     *  listen()                      pide escuchar de nuevo (respuesta a una confirmación).
     *  actions                       operaciones reales de la app (ver defaultActions).
     *  interpret(text) → Promise     opcional: intérprete con IA para lo que VoiceIntents no entendió; resuelve con
     *                                la respuesta de Voice-AI-Assistant o null (sin conexión, error o tiempo agotado).
     *  now() → ms                    reloj (inyectable en pruebas).
     */
    function createController(deps) {
        const now = deps.now || (() => Date.now());
        let pending = null;

        const say = (text) => deps.say(text);

        function askConfirmation(prompt, execute, cancelText) {
            pending = { execute, cancelText, expiresAt: now() + CONFIRM_TIMEOUT_MS, retried: false };
            return say(prompt).then(() => { deps.listen(); return { status: 'confirming' }; });
        }

        async function answer(text) {
            const current = pending;
            const reply = intents.parseAnswer(text);
            if (reply === 'yes') {
                pending = null;
                return current.execute();
            }
            if (reply === 'no') {
                pending = null;
                await say(current.cancelText || 'Cancelado.');
                return { status: 'cancelled' };
            }
            if (!text || current.retried) {
                pending = null;
                await say(text ? 'No le entendí. Acción cancelada.' : 'No escuché respuesta. Acción cancelada.');
                return { status: 'cancelled' };
            }
            current.retried = true;
            await say('Diga sí para confirmar, o cancelar.');
            deps.listen();
            return { status: 'confirming' };
        }

        async function run(what, fn) {
            try {
                return await fn();
            } catch (error) {
                await say('No se pudo ' + what + ': ' + errorText(error) + '.');
                return { status: 'error', error };
            }
        }

        async function handle(text) {
            if (pending && now() > pending.expiresAt) pending = null;
            if (pending) return answer(text);

            return dispatch(intents.parse(text));
        }

        async function dispatch(intent) {
            const a = deps.actions;
            switch (intent.type) {
            case 'EMPTY':
                return { status: 'ignored', intent };

            case 'REPORT': {
                const send = () => run('enviar el reporte', async () => {
                    const result = await a.report(intent.alertType, intent.description);
                    if (result && result.noPosition) {
                        await say('No tengo su posición GPS. Active la ubicación para reportar.');
                        return { status: 'error', intent };
                    }
                    await say(result && result.pendingSync
                        ? 'Sin señal: el reporte de ' + intent.label + ' se guardó y se enviará al recuperar la cobertura.'
                        : 'Reporte de ' + intent.label + ' registrado en su ubicación.');
                    return { status: 'done', intent };
                });
                // Lo que interpretó la IA se confirma antes de publicarlo para los demás conductores.
                if (intent.fromAssistant) {
                    return askConfirmation('¿Reporto ' + intent.label + ' en su ubicación? Diga sí o cancelar.', send);
                }
                return send();
            }

            case 'SOS':
                return askConfirmation('¿Envío una alerta SOS a la torre de control con su ubicación? Diga sí o cancelar.',
                    () => run('enviar el SOS', async () => {
                        // activate() abre el modal del SOS y espera a que el conductor lo cierre: no se espera aquí,
                        // el modal y su propia voz informan si se envió.
                        const sending = a.sos();
                        if (sending && sending.catch) sending.catch(() => {});
                        return { status: 'done', intent };
                    }));

            case 'REROUTE': {
                if (!a.hasRoute()) {
                    await say('No hay una navegación activa. Diga iniciar viaje para empezar la ruta.');
                    return { status: 'unavailable', intent };
                }
                await say(intent.avoidAhead ? 'Buscando una ruta que evite este tramo.' : 'Recalculando la ruta.');
                return run('recalcular la ruta', async () => {
                    const plan = await a.planReroute({ avoidAhead: intent.avoidAhead });
                    if (!plan || !plan.ok) {
                        const reason = plan && plan.reason;
                        await say(reason === 'no-detour' ? 'No encontré una ruta que evite ese tramo. Siga con precaución.'
                            : reason === 'restricted-alternatives'
                                ? 'Las rutas alternas tienen restricciones de gálibo o peso para su camión. Siga por la ruta actual.'
                                : 'Sin conexión con el servicio de rutas. Siga la ruta actual.');
                        return { status: 'unavailable', intent };
                    }
                    const apply = () => run('cambiar la ruta', async () => {
                        const result = await a.applyReroute(plan);
                        if (!result || !result.ok) {
                            await say('La ruta cambió mientras confirmaba. Pida de nuevo otra ruta si la necesita.');
                            return { status: 'unavailable', intent };
                        }
                        const time = spokenDuration(result.durationS);
                        await say('Nueva ruta: ' + spokenDistance(result.remainingM) + (time ? ', aproximadamente ' + time : '') + '.'
                            + (result.provider === 'HERE' ? ' Calculada para su camión con el tráfico actual.' : '')
                            + (result.restricted ? ' Atención: tiene restricciones de gálibo o peso para su vehículo.' : ''));
                        return { status: 'done', intent };
                    });
                    if (!plan.needsConfirmation) return apply();
                    const parts = [];
                    if (plan.longer) {
                        const km = plan.extraM > 0 ? spokenDistance(plan.extraM) + ' más larga' : '';
                        const min = plan.extraS > 0 ? spokenDuration(plan.extraS) + ' más' : '';
                        parts.push('La ruta alterna es ' + [km, min].filter(Boolean).join(', unos ') + '.');
                    }
                    if (plan.unchecked) parts.push('No pude verificar gálibo y peso en la ruta alterna.');
                    return askConfirmation(parts.join(' ') + ' ¿La tomo? Diga sí o cancelar.', apply, 'Sigo por la ruta actual.');
                });
            }

            case 'LOAD_INFO':
                return loadInfo(intent);

            case 'HOURS':
                return run('consultar su jornada', async () => {
                    const driver = await a.driver();
                    const driven = driver ? spokenHours(driver.hoursDrivenToday) : null;
                    if (!driver || driven === null) {
                        await say('No tengo los datos de su jornada en este momento.');
                        return { status: 'unavailable', intent };
                    }
                    const left = spokenHours(driver.remainingDrivingHours);
                    let text = 'Lleva ' + (driver.hoursDrivenToday > 0 ? driven : 'menos de un minuto') + ' de conducción hoy.';
                    if (driver.restRequired) {
                        text += ' Debe tomar el descanso obligatorio'
                            + (driver.mandatoryRestLocation ? ' en ' + driver.mandatoryRestLocation : '') + '.';
                    } else if (left) {
                        text += ' Le quedan ' + left + ' antes del descanso obligatorio.';
                    }
                    await say(text);
                    return { status: 'done', intent };
                });

            case 'ACCEPT_LOAD': {
                const load = a.currentLoad();
                if (!load || !a.loadActions(load).respond) {
                    await say('No tiene una propuesta de carga pendiente.');
                    return { status: 'unavailable', intent };
                }
                return askConfirmation('¿Acepta la carga ' + loadName(load) + ' hacia ' + destinationName(load) + '? Diga sí o cancelar.',
                    () => run('aceptar la carga', async () => {
                        await a.accept();
                        return { status: 'done', intent };
                    }));
            }

            case 'REJECT_LOAD': {
                const load = a.currentLoad();
                if (!load || !a.loadActions(load).respond) {
                    await say('No tiene una propuesta de carga pendiente.');
                    return { status: 'unavailable', intent };
                }
                return askConfirmation('¿Rechaza la carga hacia ' + destinationName(load) + '? El motor la ofrecerá a otro conductor. Diga sí o cancelar.',
                    () => run('rechazar la carga', async () => {
                        await a.reject();
                        await say('Carga rechazada. El sistema la ofrecerá a otro conductor.');
                        return { status: 'done', intent };
                    }));
            }

            case 'START_TRIP': {
                const load = a.currentLoad();
                const allowed = load ? a.loadActions(load) : {};
                if (!allowed.navigate) {
                    await say('Acepte una carga antes de iniciar el viaje.');
                    return { status: 'unavailable', intent };
                }
                const start = () => run('iniciar el viaje', async () => {
                    await a.startTrip();
                    return { status: 'done', intent };
                });
                if (!allowed.startTrip) return start();
                return askConfirmation('¿Inicia el viaje hacia ' + destinationName(load) + '? La carga quedará en tránsito. Diga sí o cancelar.', start);
            }

            case 'CONFIRM_DELIVERY': {
                const load = a.currentLoad();
                if (!load || !a.loadActions(load).deliver) {
                    await say('No hay un viaje en tránsito para entregar.');
                    return { status: 'unavailable', intent };
                }
                return askConfirmation('¿Confirma que desea registrar la entrega de la carga? Diga sí o cancelar.',
                    () => run('abrir el registro de entrega', async () => {
                        await say('Abriendo el registro de entrega. Con el vehículo detenido, complete el nombre de quien recibe y la firma.');
                        a.openDelivery();
                        return { status: 'done', intent };
                    }));
            }

            case 'REPEAT': {
                const text = a.instruction();
                await say(text || 'No hay una navegación activa.');
                return { status: text ? 'done' : 'unavailable', intent };
            }

            case 'NEARBY_ALERTS': {
                const list = a.nearbyAlerts();
                if (list === null) {
                    await say('No tengo su posición GPS para buscar alertas cercanas.');
                    return { status: 'unavailable', intent };
                }
                if (!list.length) {
                    await say('No hay alertas reportadas cerca de su posición.');
                    return { status: 'done', intent };
                }
                const items = list.slice(0, 3).map(item => item.label + ' a ' + spokenDistance(item.distanceM));
                await say((list.length === 1 ? 'Hay una alerta cerca: ' : 'Hay ' + list.length + ' alertas cerca: ') + items.join(', ') + '.');
                return { status: 'done', intent };
            }

            case 'HELP':
                await say(HELP);
                return { status: 'done', intent };

            case 'COPILOT_OFF':
                a.copilotOff();
                return { status: 'off', intent };

            case 'CHAT':
                await say(intent.reply);
                return { status: 'done', intent };

            default:
                return notUnderstood(intent);
            }
        }

        /** Lo que las reglas no entendieron se consulta una vez al intérprete con IA; si no ayuda, opciones breves. */
        async function notUnderstood(intent) {
            if (deps.interpret && intent.type === 'UNKNOWN' && !intent.fromAssistant && intent.text) {
                let response = null;
                try { response = await deps.interpret(intent.text); } catch (e) { response = null; }
                const next = fromAssistant(response, intent.text);
                if (next) {
                    const result = await dispatch(next);
                    return { ...result, source: 'assistant' };
                }
                if (response && response.intent === 'UNKNOWN' && typeof response.reply === 'string' && response.reply.trim()) {
                    await say(response.reply.trim().slice(0, 300));
                    return { status: 'unknown', intent, source: 'assistant' };
                }
            }
            await say(NOT_UNDERSTOOD);
            return { status: 'unknown', intent };
        }

        function loadName(load) {
            return load.cargoType ? 'de ' + load.cargoType : load.id;
        }

        function destinationName(load) {
            return (load.destination && (load.destination.name || load.destination.city)) || 'el destino';
        }

        async function loadInfo(intent) {
            const a = deps.actions;
            const load = a.currentLoad();
            if (!load) {
                await say('No tiene una carga asignada en este momento.');
                return { status: 'unavailable', intent };
            }
            const weight = Number.isFinite(Number(load.netWeight)) && load.netWeight !== null
                ? number(load.netWeight, 1) + ' toneladas' : null;
            const volume = Number.isFinite(Number(load.volumeM3)) && load.volumeM3 !== null
                ? number(load.volumeM3, 1) + ' metros cúbicos' : null;
            let text;
            if (intent.field === 'weight') {
                text = weight ? 'La carga pesa ' + weight + (volume ? ' y ocupa ' + volume : '') + '.' : 'La carga no tiene el peso registrado.';
            } else if (intent.field === 'destination') {
                text = 'El destino es ' + destinationName(load) + '.';
            } else if (intent.field === 'eta') {
                const left = a.remaining();
                if (!left) {
                    text = 'El destino es ' + destinationName(load) + '. La distancia y el tiempo restantes se calculan cuando inicie la navegación.';
                } else if (left.arrived) {
                    text = 'Ya llegó al destino. Diga confirmar entrega cuando esté listo.';
                } else {
                    const time = spokenDuration(left.durationS);
                    const at = Number.isFinite(left.durationS) ? spokenClock(new Date(now() + left.durationS * 1000)) : null;
                    text = 'Faltan ' + spokenDistance(left.remainingM) + (time ? ', aproximadamente ' + time : '')
                        + (at ? '. Llegada estimada a las ' + at : '') + '.';
                }
            } else {
                const what = load.cargoType ? 'Lleva ' + load.cargoType : 'Lleva la carga ' + load.id;
                const origin = load.origin && (load.origin.name || load.origin.city);
                text = what + (weight ? ', ' + weight : '') + (origin ? ', de ' + origin : '') + ' hacia ' + destinationName(load) + '.';
            }
            await say(text);
            return { status: 'done', intent };
        }

        return {
            handle,
            get awaitingAnswer() { return Boolean(pending) && now() <= pending.expiresAt; },
            cancelPending() { pending = null; }
        };
    }

    // ── Operaciones reales de la app ────────────────────────────────────────────────────────────────────────────

    function distanceM(a, b) {
        const rad = (d) => d * Math.PI / 180;
        const dLat = rad(b[0] - a[0]);
        const dLng = rad(b[1] - a[1]);
        const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[0])) * Math.cos(rad(b[0])) * Math.sin(dLng / 2) ** 2;
        return 6371000 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
    }

    async function positionFix() {
        const recent = window.app.currentPosition(2 * 60 * 1000);
        if (recent) return recent;
        const fix = await window.DeviceLocation.fix({ timeoutMs: 8000 });
        return fix ? fix.coords : null;
    }

    function defaultActions(copilot) {
        const service = window.TruckCarService;
        const data = () => window.TruckCarData;
        return {
            async report(alertType, description) {
                const coords = await positionFix();
                if (!coords) return { noPosition: true };
                const alert = await service.reportAlert(alertType, description, coords);
                window.store.setState({});
                return { pendingSync: Boolean(alert && alert.pendingSync) };
            },
            sos: () => window.DriverActions.activate(),
            hasRoute: () => Boolean(window.RouteGuidance && window.RouteGuidance.route),
            planReroute: (options) => window.RouteGuidance.planReroute(options),
            applyReroute: (plan) => window.RouteGuidance.applyReroute(plan),
            remaining: () => (window.RouteGuidance ? window.RouteGuidance.remaining() : null),
            currentLoad() {
                const load = data().activeLoadOrder;
                return load && service.isDriverCurrentLoad(load) ? load : null;
            },
            loadActions: (load) => service.loadActions(load),
            async driver() {
                try { await service.loadDriverProfile(); } catch (e) { }
                return data().currentDriver || null;
            },
            accept: () => window.app.handleAcceptTrip({ rethrow: true }),
            reject: () => window.app.performRejectTrip({ quiet: true }),
            startTrip: () => window.app.startNavigation({ rethrow: true }),
            openDelivery: () => { window.app.finishTrip(); },
            instruction() {
                const guidance = window.RouteGuidance;
                if (!guidance || !guidance.route) return null;
                const s = guidance.snapshot();
                const hud = guidance.hudText(s);
                return (s.hasPosition && s.status === 'ready' ? 'En ' + hud.distance + ', ' : '') + hud.instruction;
            },
            nearbyAlerts() {
                const here = window.app.currentPosition(5 * 60 * 1000);
                if (!here) return null;
                const alerts = (data().communityAlerts || []).filter(alert => alert.coords)
                    .map(alert => ({ label: (alert.badge || alert.title || 'Alerta').toLowerCase(), distanceM: distanceM(here, alert.coords) }));
                const blockages = (data().roadBlockages || []).filter(b => Number.isFinite(b.latitude) && Number.isFinite(b.longitude))
                    .map(b => ({ label: 'bloqueo: ' + (b.description || b.title || 'vía bloqueada').toLowerCase(), distanceM: distanceM(here, [b.latitude, b.longitude]) }));
                return [...blockages, ...alerts].filter(item => item.distanceM <= 50000).sort((x, y) => x.distanceM - y.distanceM);
            },
            copilotOff: () => copilot.deactivate()
        };
    }

    /**
     * Intérprete con IA a través del api-gateway. Sin conexión o si falla, null: el copiloto responde con sus opciones.
     * Solo viaja el texto de la orden y si hay carga o navegación activa, nunca el audio.
     */
    async function remoteInterpret(text, actions) {
        const api = window.TruckCarApi;
        if (!api || !api.assistant || (typeof navigator !== 'undefined' && navigator.onLine === false)) return null;
        let load = null;
        try { load = actions.currentLoad(); } catch (e) { load = null; }
        const context = { hasLoad: Boolean(load), navigating: Boolean(actions.hasRoute()),
            loadStatus: load && load.status ? String(load.status).slice(0, 40) : null };
        try {
            return await api.assistant.interpret(String(text).slice(0, 300), context);
        } catch (e) {
            return null;
        }
    }

    // ── 2. Reconocedores ────────────────────────────────────────────────────────────────────────────────────────

    function nativeBridge() {
        const cap = window.Capacitor;
        const native = cap && typeof cap.isNativePlatform === 'function' && cap.isNativePlatform();
        return native && typeof cap.nativePromise === 'function' && typeof cap.addListener === 'function' ? cap : null;
    }

    /** Plugin nativo de Android. Una sesión por orden: el reconocedor del sistema se corta solo con el silencio. */
    function nativeRecognizer(cap) {
        const call = (method, options = {}) => cap.nativePromise('SpeechRecognition', method, options);
        let stopping = null;
        return {
            kind: 'native',
            continuous: false,
            async available() {
                try { return Boolean((await call('available')).available); } catch (e) { return false; }
            },
            async ensurePermission() {
                const granted = (s) => s && (s.speechRecognition === 'granted' || s.microphone === 'granted');
                try {
                    if (granted(await call('checkPermissions'))) return true;
                    return granted(await call('requestPermissions'));
                } catch (e) {
                    return false;
                }
            },
            listenOnce({ onPartial }) {
                return new Promise((resolve) => {
                    let last = '';
                    let done = false;
                    const handles = [];
                    const finish = () => {
                        if (done) return;
                        done = true;
                        clearTimeout(timer);
                        handles.forEach(h => h && h.remove && h.remove());
                        stopping = null;
                        resolve(last);
                    };
                    handles.push(cap.addListener('SpeechRecognition', 'partialResults', (event) => {
                        const text = event && event.matches && event.matches[0];
                        if (text) { last = text; if (onPartial) onPartial(text); }
                    }));
                    handles.push(cap.addListener('SpeechRecognition', 'listeningState', (event) => {
                        if (event && event.status === 'stopped') setTimeout(finish, 250);
                    }));
                    const timer = setTimeout(() => { call('stop').catch(() => {}).then(finish); }, 9000);
                    stopping = () => call('stop').catch(() => {}).then(finish);
                    call('start', { language: 'es-CO', maxResults: 3, partialResults: true, popup: false })
                        .then((result) => {
                            const text = result && result.matches && result.matches[0];
                            if (text) { last = text; finish(); }
                        })
                        .catch(() => finish());
                });
            },
            abort() { if (stopping) stopping(); }
        };
    }

    /** Web Speech API (Chrome, Edge, Safari). Admite escucha continua para la palabra de activación. */
    function webRecognizer(Recognition) {
        let session = null;
        let wake = null;
        const make = (continuous) => {
            const r = new Recognition();
            r.lang = 'es-CO';
            r.interimResults = !continuous;
            r.maxAlternatives = 3;
            r.continuous = continuous;
            return r;
        };
        return {
            kind: 'web',
            continuous: true,
            async available() { return true; },
            async ensurePermission() { return true; },
            listenOnce({ onPartial }) {
                return new Promise((resolve) => {
                    const r = make(false);
                    let finalText = '';
                    let interim = '';
                    r.onresult = (event) => {
                        interim = '';
                        for (let i = event.resultIndex; i < event.results.length; i++) {
                            const text = event.results[i][0].transcript;
                            if (event.results[i].isFinal) finalText += text; else interim += text;
                        }
                        if (onPartial) onPartial((finalText + ' ' + interim).trim());
                    };
                    r.onerror = () => {};
                    r.onend = () => { session = null; resolve((finalText || interim).trim()); };
                    session = r;
                    try { r.start(); } catch (e) { session = null; resolve(''); }
                });
            },
            startWake(onFinal) {
                if (wake) return;
                let active = true;
                const loop = () => {
                    if (!active) return;
                    const r = make(true);
                    r.onresult = (event) => {
                        for (let i = event.resultIndex; i < event.results.length; i++) {
                            if (event.results[i].isFinal) onFinal(event.results[i][0].transcript);
                        }
                    };
                    r.onerror = (event) => { if (event && (event.error === 'not-allowed' || event.error === 'service-not-allowed')) active = false; };
                    r.onend = () => { if (active) setTimeout(loop, 400); };
                    wake = { r, stop() { active = false; try { r.abort(); } catch (e) { } } };
                    try { r.start(); } catch (e) { active = false; }
                };
                loop();
            },
            stopWake() { if (wake) { wake.stop(); wake = null; } },
            abort() { if (session) { try { session.abort(); } catch (e) { } } }
        };
    }

    function pickRecognizer() {
        const cap = nativeBridge();
        if (cap) return nativeRecognizer(cap);
        const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        return Recognition ? webRecognizer(Recognition) : null;
    }

    // ── 3. Interfaz y modo copiloto ─────────────────────────────────────────────────────────────────────────────

    /** WAV de 1 s en silencio: mantiene activa la sesión multimedia para recibir las teclas del volante o los audífonos. */
    function silentWav() {
        const rate = 8000;
        const bytes = new Uint8Array(44 + rate);
        const view = new DataView(bytes.buffer);
        const text = (offset, s) => [...s].forEach((c, i) => view.setUint8(offset + i, c.charCodeAt(0)));
        text(0, 'RIFF'); view.setUint32(4, 36 + rate, true); text(8, 'WAVE'); text(12, 'fmt ');
        view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
        view.setUint32(24, rate, true); view.setUint32(28, rate, true); view.setUint16(32, 1, true); view.setUint16(34, 8, true);
        text(36, 'data'); view.setUint32(40, rate, true);
        bytes.fill(128, 44);
        let binary = '';
        bytes.forEach(b => { binary += String.fromCharCode(b); });
        return 'data:audio/wav;base64,' + btoa(binary);
    }

    const copilot = {
        on: false,
        phase: 'idle',
        transcript: '',
        recognizer: null,
        controller: null,
        ui: null,
        media: null,
        bannerTimer: null,

        init() {
            if (this.controller) return;
            this.recognizer = pickRecognizer();
            const actions = defaultActions(this);
            this.controller = createController({
                say: (text) => this.say(text),
                listen: () => { this.wantsAnswer = true; },
                actions,
                interpret: (text) => remoteInterpret(text, actions)
            });
        },

        get supported() {
            this.init();
            return Boolean(this.recognizer);
        },

        async say(text) {
            this.phase = 'speaking';
            this.showBanner(text, 'speaking');
            await window.voiceEngine.say(text);
        },

        /** Botón: si está apagado lo enciende y escucha; si está encendido, escucha una orden. */
        async press() {
            this.init();
            window.voiceEngine.resumeAudio();
            if (!this.recognizer) {
                await window.voiceEngine.say('Este dispositivo no tiene reconocimiento de voz.');
                return;
            }
            if (!this.on) {
                await this.activate();
                return;
            }
            this.listenNow();
        },

        async activate() {
            this.init();
            if (this.on || !this.recognizer) return;
            const ok = await this.recognizer.available() && await this.recognizer.ensurePermission();
            if (!ok) {
                await window.voiceEngine.say('No tengo permiso para usar el micrófono. Actívelo en los ajustes del teléfono.');
                return;
            }
            this.on = true;
            this.enableMediaKeys();
            this.render();
            const wakeWord = this.recognizer.continuous ? ' Diga hola TruckCar seguido de su orden,' : '';
            await this.say('Copiloto activado.' + wakeWord + ' Toque el micrófono o el botón multimedia del volante para hablar.');
            this.listenNow();
        },

        async deactivate() {
            if (!this.on) return;
            this.on = false;
            this.controller.cancelPending();
            if (this.recognizer.stopWake) this.recognizer.stopWake();
            this.recognizer.abort();
            this.disableMediaKeys();
            this.phase = 'idle';
            this.render();
            await this.say('Copiloto desactivado.');
            this.hideBanner();
        },

        async listenNow() {
            if (!this.on || this.phase === 'listening' || this.phase === 'processing') return;
            if (this.recognizer.stopWake) this.recognizer.stopWake();
            window.voiceEngine.cancel();
            this.phase = 'listening';
            this.transcript = '';
            this.showBanner('Escuchando…', 'listening');
            window.voiceEngine.cue('start');
            const text = await this.recognizer.listenOnce({ onPartial: (partial) => this.showBanner(partial, 'listening') });
            window.voiceEngine.cue('end');
            await this.process(text);
        },

        async process(text) {
            this.phase = 'processing';
            this.wantsAnswer = false;
            if (text) this.showBanner('«' + text + '»', 'processing');
            await this.controller.handle(text || '');
            this.phase = 'idle';
            if (!this.on) return;
            if (this.wantsAnswer && this.controller.awaitingAnswer) {
                this.listenNow();
                return;
            }
            this.hideBanner(2500);
            this.resumeWake();
        },

        resumeWake() {
            if (!this.on || !this.recognizer.startWake) return;
            this.recognizer.startWake((heard) => {
                if (this.phase !== 'idle') return;
                const { woke, rest } = intents.stripWakeWord(heard);
                if (!woke) return;
                this.recognizer.stopWake();
                if (rest) {
                    window.voiceEngine.cue('start');
                    this.process(rest);
                } else {
                    this.listenNow();
                }
            });
        },

        enableMediaKeys() {
            if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return;
            try {
                const audio = new Audio(silentWav());
                audio.loop = true;
                audio.volume = 0.05;
                const played = audio.play();
                if (played && played.catch) played.catch(() => {});
                this.media = audio;
                if (window.MediaMetadata) navigator.mediaSession.metadata = new window.MediaMetadata({ title: 'Copiloto TruckCar', artist: 'Toque para hablar' });
                ['play', 'pause', 'nexttrack', 'previoustrack', 'stop'].forEach(action => {
                    try { navigator.mediaSession.setActionHandler(action, () => this.listenNow()); } catch (e) { }
                });
            } catch (e) { }
        },

        disableMediaKeys() {
            if (this.media) { try { this.media.pause(); } catch (e) { } this.media = null; }
            if (typeof navigator !== 'undefined' && 'mediaSession' in navigator) {
                ['play', 'pause', 'nexttrack', 'previoustrack', 'stop'].forEach(action => {
                    try { navigator.mediaSession.setActionHandler(action, null); } catch (e) { }
                });
            }
        },

        // ── Botón y banner ──

        build(host) {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'copilot-fab';
            button.innerHTML = '<svg aria-hidden="true"><use href="assets/icons.svg#microphone"></use></svg><span class="copilot-fab-label">Copiloto</span>';
            let holdTimer = null;
            let held = false;
            button.addEventListener('pointerdown', () => {
                held = false;
                clearTimeout(holdTimer);
                holdTimer = setTimeout(() => { held = true; if (this.on) this.deactivate(); }, 800);
            });
            const cancelHold = () => clearTimeout(holdTimer);
            button.addEventListener('pointerup', cancelHold);
            button.addEventListener('pointercancel', cancelHold);
            button.addEventListener('pointerleave', cancelHold);
            button.addEventListener('click', () => { if (held) { held = false; return; } this.press(); });
            button.addEventListener('contextmenu', (event) => event.preventDefault());
            const banner = document.createElement('div');
            banner.className = 'copilot-banner';
            banner.setAttribute('role', 'status');
            banner.setAttribute('aria-live', 'polite');
            banner.hidden = true;
            host.appendChild(banner);
            host.appendChild(button);
            return { button, banner };
        },

        render() {
            if (!this.ui) return;
            const { button } = this.ui;
            button.classList.toggle('is-on', this.on);
            button.classList.toggle('is-listening', this.phase === 'listening');
            button.setAttribute('aria-pressed', String(this.on));
            button.setAttribute('aria-label', this.on
                ? 'Copiloto activo: toque para dar una orden por voz, mantenga presionado para apagarlo'
                : 'Activar el copiloto de voz');
            button.querySelector('.copilot-fab-label').textContent = this.phase === 'listening' ? 'Escuchando' : 'Copiloto';
        },

        showBanner(text, phase) {
            if (!this.ui) return;
            clearTimeout(this.bannerTimer);
            const { banner } = this.ui;
            banner.textContent = text;
            banner.dataset.phase = phase;
            banner.hidden = false;
            this.render();
        },

        hideBanner(delay = 0) {
            if (!this.ui) return;
            clearTimeout(this.bannerTimer);
            this.bannerTimer = setTimeout(() => { if (this.ui && this.phase === 'idle') this.ui.banner.hidden = true; this.render(); }, delay);
        },

        /** Muestra el botón solo en la app del conductor; lo apaga al cerrar sesión o cambiar de vista. */
        sync(state) {
            const visible = state.isAuthenticated && state.activeRole === 'driver';
            if (!visible) {
                if (this.on) this.deactivate();
                if (this.ui) { this.ui.button.hidden = true; this.ui.banner.hidden = true; }
                return;
            }
            const host = document.getElementById('phone-mockup-frame');
            if (!host) return;
            if (!this.ui) this.ui = this.build(host);
            this.ui.button.hidden = false;
            this.ui.button.classList.toggle('is-unsupported', !this.supported);
            this.render();
        }
    };

    return { createController, fromAssistant, remoteInterpret, copilot, spokenDistance, spokenDuration, errorText,
        press: () => copilot.press(), sync: (state) => copilot.sync(state) };
})();

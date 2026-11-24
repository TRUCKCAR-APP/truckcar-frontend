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
    // Elegir entre varias opciones leídas en voz alta toma más tiempo que un sí o un no.
    const CHOICE_TIMEOUT_MS = 25000;
    const SETTINGS_KEY = 'truckcar.copilot';
    const DEFAULT_WAKE_PHRASE = 'TruckCar';

    /** Ajustes del Copiloto en este teléfono: activar con la voz y la frase de activación. */
    function loadSettings() {
        try {
            const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}');
            const phrase = typeof saved.wakePhrase === 'string' && saved.wakePhrase.trim().length >= 3
                ? saved.wakePhrase.trim().slice(0, 40) : DEFAULT_WAKE_PHRASE;
            return { wakeEnabled: saved.wakeEnabled === true, wakePhrase: phrase };
        } catch (e) {
            return { wakeEnabled: false, wakePhrase: DEFAULT_WAKE_PHRASE };
        }
    }

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

    /** «unos 25 minutos», «aproximadamente una hora y 30 minutos», «a un minuto»: tiempo aproximado bien dicho. */
    function about(seconds) {
        const text = spokenDuration(seconds);
        if (!text) return '';
        if (text === '1 minuto') return 'a un minuto';
        if (/^1 /.test(text)) return 'aproximadamente ' + text.replace(/^1 hora/, 'una hora').replace(/^1 minuto/, 'un minuto');
        return 'unos ' + text;
    }

    function spokenHours(hours) {
        if (!Number.isFinite(hours)) return null;
        return spokenDuration(hours * 3600);
    }

    function spokenClock(date) {
        return date.toLocaleTimeString('es-CO', { hour: 'numeric', minute: '2-digit' });
    }

    /** Mensaje del error para decir en voz alta: el mismo texto claro de la pantalla (ui.errorMessage), sin punto final. */
    function errorText(error) {
        const message = window.ui && typeof window.ui.friendlyError === 'function' ? window.ui.errorMessage(error)
            : String((error && (error.detail || error.message)) || 'algo salió mal');
        return message.replace(/\s*\[trace [^\]]*\]\s*/, '').replace(/[.\s]+$/, '');
    }

    const REPORTABLE = 'derrumbe, accidente, vía cerrada, obra, retén, báscula, gálibo bajo, parador seguro o tráfico pesado';
    const HELP = 'Puede reportar ' + REPORTABLE + '. También puede decir: enviar SOS, recalcular ruta, qué llevo, '
        + 'cuánto falta, cuántas horas llevo, alertas cercanas, aceptar carga, iniciar viaje o confirmar entrega. '
        + 'Si quiere parar, diga por ejemplo: quiero comer, necesito descansar, dónde tanqueo o necesito un baño; le '
        + 'propongo lugares sobre la ruta, sin devolverse, y el que elija queda como parada antes del destino. '
        + 'Después puede decir: cuánto falta para la parada, quita la parada o seguimos. '
        + 'También puede preguntar cuánto falta para el próximo peaje.';
    const NOT_UNDERSTOOD = 'No entendí. Puede decir, por ejemplo: reportar accidente, recalcular ruta, qué llevo, o ayuda.';

    // Intenciones que puede devolver el intérprete con IA (Voice-AI-Assistant) y que este controlador ejecuta.
    const ASSISTANT_INTENTS = ['REPORT', 'SOS', 'NEARBY_ALERTS', 'ACCEPT_LOAD', 'REJECT_LOAD', 'START_TRIP',
        'CONFIRM_DELIVERY', 'REROUTE', 'NAVIGATE', 'FIND_PLACES', 'TOLLS', 'REPEAT', 'HOURS', 'LOAD_INFO', 'HELP', 'CHAT',
        'STOP_REMOVE', 'STOP_INFO', 'RESUME_TRIP'];
    const LOAD_INFO_FIELDS = ['eta', 'destination', 'weight', 'summary'];

    // Categorías de FIND_PLACES: lo que se busca en HERE, cómo se nombra en voz alta y qué preguntar para pagar menos
    // (los precios no se tienen confirmados al día de hoy: nunca se inventan).
    const PLACE_KINDS = {
        hotel: { query: 'hotel', many: 'hoteles', saving: 'pregunte la tarifa por noche y si tiene parqueadero vigilado para el camión' },
        fuel: { query: 'estación de servicio', many: 'estaciones de servicio', saving: 'compare el precio del galón de ACPM en el surtidor antes de tanquear' },
        restaurant: { query: 'restaurante', many: 'restaurantes', saving: 'pregunte por el menú del día o el corrientazo' },
        store: { query: 'tienda', many: 'tiendas', saving: 'compare precios antes de pagar' },
        truck_parking: { query: 'parqueadero para camiones', many: 'parqueaderos', saving: 'pregunte la tarifa por noche o por hora y si es vigilado y apto para tractomula' },
        workshop: { query: 'taller mecánico de camiones', many: 'talleres', saving: 'pida el precio del arreglo antes de que empiecen' },
        rest: { query: 'estación de servicio', many: 'sitios para descansar', saving: 'pregunte si el parqueadero es vigilado y si cobran por la noche',
            alternative: 'Si está cansado, pare en un sitio seguro apenas pueda.' },
        coffee: { query: 'cafetería', many: 'cafeterías', saving: 'pregunte el precio antes de pedir' },
        toilet: { query: 'estación de servicio', many: 'sitios con baño', saving: 'en muchas estaciones el baño es gratis para clientes' },
        atm: { query: 'cajero automático', many: 'cajeros', saving: 'revise la comisión del cajero antes de retirar' },
        pharmacy: { query: 'droguería', many: 'droguerías', saving: 'pregunte por el medicamento genérico' },
        hospital: { query: 'hospital', many: 'hospitales o clínicas', saving: '' }
    };
    // Tipos de lugar en los que importa poco la hora: se nombran sin «abierto» o «cerrado».
    const STOP_WORDS = ['Uno', 'Dos', 'Tres'];

    /** Termina la frase con punto sin duplicarlo («3:10 p. m.»). */
    function endSentence(text) {
        return /.$/.test(text) ? text : text + '.';
    }

    function pesos(value, currency) {
        const amount = Math.round(value).toLocaleString('es-CO');
        return !currency || currency === 'COP' ? amount + ' pesos' : amount + ' ' + currency;
    }

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
        case 'NAVIGATE':
            return typeof response.place === 'string' && response.place.trim().length >= 2
                ? { ...base, place: response.place.trim().slice(0, 120) } : null;
        case 'FIND_PLACES':
            return PLACE_KINDS[response.category] ? { ...base, category: response.category, cheap: response.cheap === true,
                ...(response.fatigue === true ? { fatigue: true } : {}) } : null;
        case 'NEARBY_ALERTS':
            return { ...base, scope: response.scope === 'route' ? 'route' : 'around' };
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

        /** Pregunta cuál de count opciones: «la primera», «la segunda»… o cancelar. */
        function askChoice(prompt, count, choose, options) {
            pending = { choose, count, options, cancelText: 'Sigo como estaba.', expiresAt: now() + CHOICE_TIMEOUT_MS, retried: false };
            return say(prompt).then(() => { deps.listen(); return { status: 'choosing' }; });
        }

        async function answer(text) {
            const current = pending;
            if (current.choose) {
                const index = intents.parseChoice(text, current.count, current.options);
                if (index != null) {
                    pending = null;
                    return current.choose(index);
                }
                if (current.count === 1 && intents.parseAnswer(text) === 'yes') {
                    pending = null;
                    return current.choose(0);
                }
            }
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
            if (!text) {
                // Silencio: la sesión termina sin hablar; el conductor vuelve con la frase o el botón.
                pending = null;
                return { status: 'silence' };
            }
            if (current.retried) {
                pending = null;
                await say('No le entendí. Acción cancelada.');
                return { status: 'cancelled' };
            }
            current.retried = true;
            await say(current.choose ? 'Diga el número de la opción, por ejemplo la primera, o cancelar.' : 'Diga sí para confirmar, o cancelar.');
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
                const atStop = a.stopInfo ? a.stopInfo() : null;
                if (atStop && atStop.reached) return resumeTrip(intent);
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
                const pendingStop = a.stopInfo ? a.stopInfo() : null;
                if (intent.arrivedOnly && pendingStop && !pendingStop.reached) {
                    const marked = a.markStopReached();
                    await say('Listo, está en su parada: ' + marked.title + '. Cuando quiera seguir, diga «seguimos»; la ruta continúa al destino.');
                    return { status: 'done', intent, stop: marked.title };
                }
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
                const onRoute = intent.scope === 'route' && a.routeAlerts;
                const list = onRoute ? a.routeAlerts() : a.nearbyAlerts();
                if (list === null) {
                    await say(onRoute ? 'No tiene una ruta activa. Le digo lo que hay cerca.' : 'No tengo su posición GPS para buscar alertas cercanas.');
                    if (onRoute) return dispatch({ ...intent, scope: 'around' });
                    return { status: 'unavailable', intent };
                }
                const where = onRoute ? 'en lo que falta de la ruta' : 'cerca de su posición';
                if (!list.length) {
                    await say('No hay accidentes, cierres ni alertas reportados ' + where + '.');
                    return { status: 'done', intent };
                }
                const items = list.slice(0, 3).map(item => item.label + ' a ' + spokenDistance(item.distanceM)
                    + (item.timeAgo ? ', reportado ' + item.timeAgo.toLowerCase() : ''));
                await say((list.length === 1 ? 'Hay una alerta ' : 'Hay ' + list.length + ' alertas ') + where + ': ' + items.join('; ') + '.');
                return { status: 'done', intent };
            }

            case 'FIND_PLACES':
                return findPlaces(intent);

            case 'STOP_REMOVE':
                return removeStop(intent);

            case 'STOP_INFO':
                return stopInfo(intent);

            case 'RESUME_TRIP':
                return resumeTrip(intent);

            case 'TOLLS':
                return tolls(intent);

            case 'HELP':
                await say(HELP);
                return { status: 'done', intent };

            case 'COPILOT_OFF':
                a.copilotOff();
                return { status: 'off', intent };

            case 'CHAT':
                await say(intent.reply);
                return { status: 'done', intent };

            case 'NAVIGATE':
                return navigateTo(intent);

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

        /** «Necesito ir a…»: busca el lugar, lee las opciones (y las muestra) y lleva la guía a la elegida. */
        async function navigateTo(intent) {
            const a = deps.actions;
            if (!a.searchPlaces) {
                await say('La búsqueda de destinos no está disponible.');
                return { status: 'unavailable', intent };
            }
            let places;
            try {
                places = await a.searchPlaces(intent.place);
            } catch (error) {
                await say('No pude buscar ' + intent.place + ': ' + errorText(error) + '.');
                return { status: 'error', intent, error };
            }
            if (!places || !places.length) {
                await say('No encontré ' + intent.place + '. Diga el nombre de otra forma, o agregue la ciudad.');
                return { status: 'unavailable', intent };
            }
            const options = places.slice(0, 3);
            if (a.showPlaces) a.showPlaces(options, intent.place);
            // Con una carga en curso, ir a otro lugar es parar ahí: la carga y su destino no se abandonan.
            if (a.routeKind && a.routeKind() === 'load' && a.addStop) {
                return offerPlaces(options, (index) => addStopFlow(options[index], intent), { many: 'lugares',
                    question: '¿Cuál agrego como parada antes de su destino? Diga el número.' });
            }
            const go = (index) => run('calcular la ruta', async () => {
                const place = options[index];
                const result = await a.navigateTo(place);
                if (!result || !result.ok) {
                    await say(result && result.reason === 'no-position'
                        ? 'No tengo su posición GPS. Encienda la ubicación del teléfono para calcular la ruta.'
                        : 'No pude calcular la ruta a ' + place.title + '. Intente de nuevo en un momento.');
                    return { status: 'unavailable', intent };
                }
                const time = spokenDuration(result.durationS);
                await say('Ruta a ' + place.title + ': ' + spokenDistance(result.remainingM) + (time ? ', aproximadamente ' + time : '') + '.'
                    + (result.provider === 'HERE' ? ' Calculada para su camión.' : '')
                    + (result.restricted ? ' Atención: tiene restricciones de gálibo o peso para su vehículo.' : ''));
                return { status: 'done', intent, place };
            });
            return offerPlaces(options, go, { many: 'lugares' });
        }

        /** Lee hasta 3 opciones con su distancia y pregunta a cuál ir (por número). note va antes de la pregunta. */
        function offerPlaces(options, go, { many, note = '', question = null }) {
            const describe = (p) => p.title + (Number.isFinite(p.distanceMeters) ? ', a ' + spokenDistance(p.distanceMeters) : '');
            const extra = note ? ' ' + note : '';
            if (options.length === 1) {
                return askChoice('Encontré ' + describe(options[0]) + '.' + extra + ' '
                    + (question ? question.replace(/¿Cuál/, '¿Lo').replace(/ Diga el número\./, '') : '¿Voy para allá?') + ' Diga sí o cancelar.', 1, go, options);
            }
            return askChoice('Encontré ' + options.length + ' ' + many + '. ' + options.map((p, i) => STOP_WORDS[i] + ': ' + describe(p) + '.').join(' ')
                + extra + ' ' + (question || '¿A cuál lo llevo? Diga el número.'), options.length, go, options);
        }

        /**
         * Opción de parada sobre la ruta, en pocas palabras: nombre, a cuánto está por carretera y cuánto le suma al
         * viaje. «Aparece cerrado» solo si HERE lo sabe; «recibe camiones» cuando se buscó dónde descansar o parquear.
         */
        function describeStop(p, category) {
            const parts = [p.title];
            if (Number.isFinite(p.distanceMeters)) {
                parts.push('a ' + spokenDistance(p.distanceMeters));
            }
            if (Number.isFinite(p.detourSeconds)) {
                parts.push(p.detourSeconds < 90 ? 'casi sin desvío' : 'le suma ' + spokenDuration(p.detourSeconds));
            }
            if (p.openNow === false) parts.push('aparece cerrado ahora');
            if (p.truckFriendly && (category === 'rest' || category === 'truck_parking')) parts.push('recibe camiones');
            return parts.join(', ');
        }

        /** Agrega el lugar elegido como parada de la ruta guiada y dice cuánto falta y cuánto suma. */
        function addStopFlow(place, intent) {
            const a = deps.actions;
            return run('agregar la parada', async () => {
                const result = await a.addStop(place);
                if (!result || !result.ok) {
                    await say(result && result.reason === 'no-route'
                        ? 'No tiene una ruta activa. Le llevo directo a ' + place.title + ' si dice: llévame a ' + place.title + '.'
                        : result && result.reason === 'pickup'
                            ? 'Primero hay que recoger la carga: voy al ' + result.title + '. Cuando la recoja puede pedirme la parada.'
                            : 'No pude agregar la parada en ' + place.title + '. Sigo con la ruta como estaba.');
                    return { status: 'unavailable', intent };
                }
                const time = about(result.toStopS);
                let text = (result.replaced ? 'Cambié la parada: ahora es ' : 'Listo, parada en ') + result.title
                    + (Number.isFinite(result.toStopM) ? ', a ' + spokenDistance(result.toStopM) + (time ? ', ' + time : '') : '') + '.';
                if (Number.isFinite(result.extraS)) {
                    text += result.extraS < 90 ? ' Casi no le suma tiempo al viaje.' : ' Le suma ' + spokenDuration(result.extraS) + ' al viaje.';
                }
                text += ' Después de la parada sigo hacia ' + (a.destinationLabel ? a.destinationLabel() : 'el destino') + '.';
                if (result.restricted) text += ' Atención: la ruta tiene restricciones de gálibo o peso para su vehículo.';
                await say(text);
                return { status: 'done', intent, place };
            });
        }

        async function removeStop(intent) {
            const a = deps.actions;
            if (!a.removeStop) return notUnderstood({ ...intent, type: 'UNKNOWN' });
            const result = await a.removeStop();
            if (result.ok) {
                await say(result.rerouted ? 'Listo, quité la parada en ' + result.title + '. Sigo directo al destino.'
                    : 'Listo, sin parada. Sigo hacia el destino.');
                return { status: 'done', intent };
            }
            await say(result.reason === 'no-stop' ? 'No tiene ninguna parada en la ruta.'
                : result.reason === 'pickup' ? 'El ' + result.title + ' no se puede quitar: ahí se recoge la carga.'
                : 'No pude recalcular sin la parada. Sigo con la ruta actual; intente de nuevo en un momento.');
            return { status: result.reason === 'no-stop' || result.reason === 'pickup' ? 'unavailable' : 'error', intent };
        }

        async function stopInfo(intent) {
            const a = deps.actions;
            const info = a.stopInfo ? a.stopInfo() : null;
            if (!info) {
                await say('No tiene ninguna parada en la ruta. Puede decir, por ejemplo: quiero comer, o necesito descansar.');
                return { status: 'unavailable', intent };
            }
            if (info.reached) {
                await say('Ya está en su parada: ' + info.title + '. Cuando quiera seguir, diga «seguimos».');
                return { status: 'done', intent };
            }
            const time = about(info.toStopS);
            await say('Su parada es ' + info.title + (Number.isFinite(info.toStopM)
                ? ': faltan ' + spokenDistance(info.toStopM) + (time ? ', ' + time : '') : '') + '.');
            return { status: 'done', intent };
        }

        async function resumeTrip(intent) {
            const a = deps.actions;
            const result = a.resumeAfterStop ? a.resumeAfterStop() : { ok: false, reason: 'no-stop' };
            if (result.ok) {
                const time = about(result.durationS);
                await say('Seguimos hacia ' + (a.destinationLabel ? a.destinationLabel() : 'el destino')
                    + (Number.isFinite(result.remainingM) ? ': faltan ' + spokenDistance(result.remainingM) + (time ? ', ' + time : '') : '') + '.');
                return { status: 'done', intent };
            }
            if (result.reason === 'not-there') {
                await say('Todavía no llega a la parada ' + result.title
                    + (Number.isFinite(result.toStopM) ? '; faltan ' + spokenDistance(result.toStopM) : '')
                    + '. Si ya no quiere parar, diga «quita la parada».');
                return { status: 'unavailable', intent };
            }
            const text = a.hasRoute && a.hasRoute() ? a.instruction() : null;
            await say(text ? 'Siga la ruta. ' + text : 'No tiene una ruta activa.');
            return { status: text ? 'done' : 'unavailable', intent };
        }

        /**
         * «Quiero comer», «necesito descansar», «dónde tanqueo barato».
         *  - Con una ruta activa: lugares sobre lo que falta de la ruta, sin devolverse y con un desvío de máximo 5 km
         *    (Route-AI los valida con el motor de rutas para camión); el elegido queda como parada antes del destino.
         *  - Sin ruta: lugares cerca del camión, y el elegido es el destino.
         *  - Cansancio («tengo sueño», «estoy mamado»): primero pide parar por seguridad.
         */
        async function findPlaces(intent) {
            const a = deps.actions;
            const kind = PLACE_KINDS[intent.category];
            if (!kind || !a.searchPlaces) {
                await say('La búsqueda de lugares no está disponible.');
                return { status: 'unavailable', intent };
            }
            const safety = intent.fatigue ? 'Por su seguridad, pare apenas pueda en un sitio seguro. ' : '';
            const note = intent.cheap && kind.saving ? 'No tengo precios confirmados al día de hoy; ' + kind.saving + '.' : '';
            const onRoute = a.searchStops && a.hasRoute && a.hasRoute();
            if (onRoute) {
                let result;
                try {
                    result = await a.searchStops(intent.category);
                } catch (error) {
                    result = { status: 'error', error };
                }
                if (result && result.status === 'ok') {
                    const options = result.stops.slice(0, 3);
                    if (!options.length) {
                        await say(safety + 'No encontré ' + kind.many + ' en los próximos 60 kilómetros de la ruta sin desviarse más de 5 kilómetros.'
                            + (kind.alternative && !safety ? ' ' + kind.alternative : ''));
                        return { status: 'unavailable', intent };
                    }
                    if (a.showPlaces) a.showPlaces(options, kind.query, { asStop: true });
                    const prompt = safety + (options.length === 1
                        ? 'Sobre la ruta encontré ' + describeStop(options[0], intent.category) + '.' + (note ? ' ' + note : '')
                            + ' ¿La agrego como parada? Diga sí o cancelar.'
                        : 'Sobre la ruta encontré ' + options.length + ' ' + kind.many + '. '
                            + options.map((p, i) => STOP_WORDS[i] + ': ' + describeStop(p, intent.category) + '.').join(' ')
                            + (note ? ' ' + note : '') + ' ¿Cuál agrego como parada? Diga el número.');
                    return askChoice(prompt, options.length, (index) => addStopFlow(options[index], intent), options);
                }
                if (result && result.status !== 'no-route') {
                    await say(safety + 'No pude revisar la ruta en este momento; le digo lo que hay cerca de su posición.');
                }
            } else if (safety) {
                await say(safety.trim());
            }
            let places;
            try {
                places = await a.searchPlaces(kind.query);
            } catch (error) {
                await say('No pude buscar ' + kind.many + ': ' + errorText(error) + '.');
                return { status: 'error', intent, error };
            }
            const options = (places || []).slice()
                .sort((x, y) => (Number.isFinite(x.distanceMeters) ? x.distanceMeters : Infinity) - (Number.isFinite(y.distanceMeters) ? y.distanceMeters : Infinity))
                .slice(0, 3);
            if (!options.length) {
                await say('No encontré ' + kind.many + ' cerca de su posición.');
                return { status: 'unavailable', intent };
            }
            if (a.showPlaces) a.showPlaces(options, kind.query);
            // Con ruta (aunque la búsqueda sobre la ruta no respondió), el lugar elegido sigue siendo una parada.
            if (onRoute && a.addStop) {
                if (a.showPlaces) a.showPlaces(options, kind.query, { asStop: true });
                return offerPlaces(options, (index) => addStopFlow(options[index], intent), { many: kind.many + ' cerca', note,
                    question: '¿Cuál agrego como parada? Diga el número.' });
            }
            const go = (index) => run('calcular la ruta', async () => {
                const place = options[index];
                const result = await a.navigateTo(place);
                if (!result || !result.ok) {
                    await say(result && result.reason === 'no-position'
                        ? 'No tengo su posición GPS. Encienda la ubicación del teléfono para calcular la ruta.'
                        : 'No pude calcular la ruta a ' + place.title + '. Intente de nuevo en un momento.');
                    return { status: 'unavailable', intent };
                }
                const time = spokenDuration(result.durationS);
                await say('Ruta a ' + place.title + ': ' + spokenDistance(result.remainingM) + (time ? ', aproximadamente ' + time : '') + '.');
                return { status: 'done', intent, place };
            });
            return offerPlaces(options, go, { many: kind.many + ' cerca', note });
        }

        /** Próximo peaje de la ruta: distancia y tarifa de HERE para el camión, con la hora en que se consultó. */
        async function tolls(intent) {
            const a = deps.actions;
            const info = a.tollsAhead ? a.tollsAhead() : { status: 'no-route' };
            if (info.status === 'no-route') {
                await say('No tiene una ruta activa. Inicie la navegación y le digo los peajes del camino.');
                return { status: 'unavailable', intent };
            }
            if (info.status === 'no-data') {
                await say('Esta ruta no trae los peajes. Recalcule la ruta para consultarlos con su camión.');
                return { status: 'unavailable', intent };
            }
            if (!info.tolls.length) {
                await say('No hay peajes en lo que falta de la ruta.');
                return { status: 'done', intent };
            }
            const next = info.tolls[0];
            const at = info.computedAt ? spokenClock(new Date(info.computedAt)) : null;
            const fare = Number.isFinite(next.cost)
                ? ' ' + endSentence('Para su camión cuesta ' + pesos(next.cost, next.currency) + (at ? ', según la tarifa de HERE consultada a las ' + at : ''))
                : ' No tengo confirmada la tarifa de ese peaje al día de hoy; verifíquela en la taquilla.';
            const priced = info.tolls.filter(t => Number.isFinite(t.cost));
            const total = info.tolls.length > 1
                ? ' Quedan ' + info.tolls.length + ' peajes' + (priced.length === info.tolls.length
                    ? ' por ' + pesos(priced.reduce((sum, t) => sum + t.cost, 0), next.currency) + ' en total' : '') + '.'
                : '';
            await say('El próximo peaje es ' + next.name + ', a ' + spokenDistance(Math.max(0, next.aheadM)) + '.' + fare + total
                + (Number.isFinite(next.cost) ? ' Confirme el valor en la taquilla.' : ''));
            return { status: 'done', intent, tolls: info.tolls };
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
            /** 'load' si guía hacia el destino de una carga, 'free' si es navegación libre, null sin ruta. */
            routeKind() {
                const guidance = window.RouteGuidance;
                if (!guidance || !guidance.route) return null;
                return guidance.freeDestination ? 'free' : 'load';
            },
            destinationLabel() {
                const guidance = window.RouteGuidance;
                if (guidance && guidance.freeDestination) return guidance.freeDestination.title;
                return window.DriverApp && window.DriverApp.destinationLabel ? window.DriverApp.destinationLabel() : 'el destino';
            },
            searchStops: (category) => window.RouteGuidance.searchStops(category),
            async addStop(place) {
                const result = await window.RouteGuidance.addStop(place);
                if (window.DestinationSearch && window.DestinationSearch.close) window.DestinationSearch.close();
                window.store.setState({});
                return result;
            },
            async removeStop() {
                const result = await window.RouteGuidance.removeStop();
                window.store.setState({});
                return result;
            },
            markStopReached: () => window.RouteGuidance.markStopReached(),
            resumeAfterStop() {
                const result = window.RouteGuidance.resumeAfterStop();
                window.store.setState({});
                return result;
            },
            stopInfo: () => (window.RouteGuidance && window.RouteGuidance.stopInfo ? window.RouteGuidance.stopInfo() : null),
            planReroute: (options) => window.RouteGuidance.planReroute(options),
            searchPlaces: (query) => window.app.searchPlaces(query),
            showPlaces: (places, query, options) => { if (window.DestinationSearch) window.DestinationSearch.showResults(places, query, options); },
            navigateTo: (place) => window.app.goToPlace(place, { silent: true }),
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
            tollsAhead() {
                return window.RouteGuidance && window.RouteGuidance.tollsAhead
                    ? window.RouteGuidance.tollsAhead(window.app.currentPosition(5 * 60 * 1000)) : { status: 'no-route' };
            },
            /** Alertas y bloqueos a menos de 500 m de lo que falta de la ruta, en orden de paso; null sin ruta. */
            routeAlerts() {
                const guidance = window.RouteGuidance;
                const route = guidance && guidance.route;
                if (!route || !guidance.project) return null;
                const here = window.app.currentPosition(5 * 60 * 1000);
                const done = here ? guidance.project(route.geometry, route.cumulative, here).alongM : 0;
                const items = [
                    ...(data().communityAlerts || []).filter(alert => alert.coords).map(alert => ({ coords: alert.coords,
                        label: (alert.badge || alert.title || 'Alerta').toLowerCase(), timeAgo: alert.timeAgo })),
                    ...(data().roadBlockages || []).filter(b => Number.isFinite(b.latitude) && Number.isFinite(b.longitude))
                        .map(b => ({ coords: [b.latitude, b.longitude], label: 'bloqueo: ' + (b.description || b.title || 'vía bloqueada').toLowerCase() }))
                ];
                return items.map((item) => {
                    const at = guidance.project(route.geometry, route.cumulative, item.coords);
                    return at.offM > 500 || at.alongM < done - 100 ? null
                        : { label: item.label, timeAgo: item.timeAgo, distanceM: Math.max(0, at.alongM - done) };
                }).filter(Boolean).sort((x, y) => x.distanceM - y.distanceM);
            },
            nearbyAlerts() {
                const here = window.app.currentPosition(5 * 60 * 1000);
                if (!here) return null;
                const alerts = (data().communityAlerts || []).filter(alert => alert.coords)
                    .map(alert => ({ label: (alert.badge || alert.title || 'Alerta').toLowerCase(), distanceM: distanceM(here, alert.coords), timeAgo: alert.timeAgo }));
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
        const wakeCall = (method, options = {}) => cap.nativePromise('WakeWord', method, options);
        const hasVosk = () => typeof cap.isPluginAvailable === 'function' && cap.isPluginAvailable('WakeWord');
        let stopping = null;
        let wake = null;

        /**
         * Frase con Vosk (plugin WakeWord de la APK): un solo micrófono abierto mientras la app está al frente, sin
         * reiniciar sesiones ni pitidos. Vosk transcribe en el teléfono; al oír la frase se junta lo que sigue y, tras una
         * pausa, se entrega. Si el plugin o el modelo no están, onUnavailable() vuelve al reconocedor de Android.
         */
        function startVosk(onFinal, isWake, onUnavailable) {
            let active = true;
            let committed = '';
            let partial = '';
            let heardWake = false;
            let timer = null;
            let paused = false;
            const handles = [];
            const reset = () => { committed = ''; partial = ''; heardWake = false; clearTimeout(timer); };
            const deliver = () => {
                if (!active) return;
                const heard = (committed + ' ' + partial).trim();
                reset();
                if (heard) onFinal(heard);
            };
            const onText = (text, final) => {
                if (!active || !text) return;
                if (!heardWake) {
                    if (!isWake || !isWake(text)) return;
                    heardWake = true;
                }
                if (final) { committed = (committed + ' ' + text).trim(); partial = ''; } else partial = text;
                clearTimeout(timer);
                timer = setTimeout(deliver, final ? 900 : 1600);
            };
            const begin = () => wakeCall('start').then(() => { paused = false; }).catch((error) => {
                if (!active) return;
                const reason = String((error && error.message) || error || '');
                // El modelo se está copiando al teléfono (primera vez): se reintenta.
                if (/loading/.test(reason)) { setTimeout(() => { if (active) begin(); }, 2000); return; }
                stop();
                onUnavailable();
            });
            const onVisible = () => { if (active && paused && document.visibilityState === 'visible') begin(); };
            handles.push(cap.addListener('WakeWord', 'partial', (e) => onText(e && e.text, false)));
            handles.push(cap.addListener('WakeWord', 'result', (e) => onText(e && e.text, true)));
            handles.push(cap.addListener('WakeWord', 'stopped', () => { paused = true; reset(); }));
            handles.push(cap.addListener('WakeWord', 'error', () => { if (active) { stop(); onUnavailable(); } }));
            document.addEventListener('visibilitychange', onVisible);
            function stop() {
                if (!active) return Promise.resolve();
                active = false;
                reset();
                handles.forEach(h => h && h.remove && h.remove());
                document.removeEventListener('visibilitychange', onVisible);
                return wakeCall('stop').catch(() => {});
            }
            begin();
            return { stop, vosk: true };
        }
        return {
            kind: 'native',
            continuous: false,
            async available() {
                try { return Boolean((await call('available')).available); } catch (e) { return false; }
            },
            async ensurePermission({ request = true } = {}) {
                const granted = (s) => s && (s.speechRecognition === 'granted' || s.microphone === 'granted');
                try {
                    if (granted(await call('checkPermissions'))) return true;
                    return request ? granted(await call('requestPermissions')) : false;
                } catch (e) {
                    return false;
                }
            },
            /**
             * Una orden. El plugin de Android no responde a stop() y, si hay silencio, termina la sesión con un error que no
             * llega a la app: por eso el fin se decide aquí (silencio tras hablar, nada en 6 s o 12 s como máximo) y stop()
             * se llama sin esperarlo.
             *
             * Justo después de la frase de activación, la sesión que la oyó todavía manda su aviso de fin y su último
             * resultado: llegan cuando esta orden ya empezó. Por eso el aviso de fin solo cuenta si en esta sesión ya se
             * oyó voz, accept() descarta lo que no es la orden (la frase sola) y delay deja que Android cierre la sesión
             * anterior antes de abrir esta. Si el reconocedor muere sin avisar (isListening falso sin haber oído nada),
             * se abre otra sesión dentro de los mismos 6 s.
             */
            listenOnce({ onPartial, onReady, accept, delay = 0 } = {}) {
                return new Promise((resolve) => {
                    let last = '';
                    let done = false;
                    let spoke = false;
                    let restarts = 0;
                    const handles = [];
                    const timers = [];
                    const finish = () => {
                        if (done) return;
                        done = true;
                        timers.forEach(clearTimeout);
                        handles.forEach(h => h && h.remove && h.remove());
                        stopping = null;
                        call('stop').catch(() => {});
                        resolve(last);
                    };
                    let quiet = null;
                    const settle = (ms) => { clearTimeout(quiet); quiet = setTimeout(finish, ms); timers.push(quiet); };
                    const begin = () => {
                        if (done) return;
                        call('start', { language: 'es-CO', maxResults: 3, partialResults: true, popup: false })
                            .then(() => { if (!done && onReady && restarts === 0) onReady(); })
                            .catch(() => finish());
                    };
                    handles.push(cap.addListener('SpeechRecognition', 'partialResults', (event) => {
                        if (done) return;
                        const text = event && event.matches && event.matches.find(Boolean);
                        if (!text || (accept && !accept(text))) return;
                        spoke = true;
                        last = text;
                        if (onPartial) onPartial(text);
                        settle(2200);
                    }));
                    handles.push(cap.addListener('SpeechRecognition', 'listeningState', (event) => {
                        if (done || !event) return;
                        if (event.status === 'started') spoke = true;
                        // El fin de una sesión en la que no se habló es el de la anterior (la de la frase): no cuenta.
                        if (event.status === 'stopped' && last) settle(400);
                    }));
                    // Reconocedor muerto sin aviso (error de Android tras la sesión anterior): otra sesión, hasta 3 veces.
                    const watch = () => {
                        if (done) return;
                        call('isListening').then((state) => {
                            if (done || spoke || !state || state.listening !== false || restarts >= 3) return;
                            restarts++;
                            begin();
                        }).catch(() => {});
                        timers.push(setTimeout(watch, 1000));
                    };
                    timers.push(setTimeout(() => { if (!last) finish(); }, 6000 + delay));
                    timers.push(setTimeout(finish, 12000 + delay));
                    stopping = finish;
                    if (delay) timers.push(setTimeout(begin, delay)); else begin();
                    timers.push(setTimeout(watch, 1200 + delay));
                });
            },
            abort() { if (stopping) stopping(); },
            /**
             * Escucha continua («Activar con la voz»): sesiones cortas seguidas. Cada sesión termina por silencio sin avisar,
             * así que se reinicia sola cada pocos segundos (start() del plugin descarta la anterior); al oír la frase se
             * espera a que termine la orden y se entrega.
             */
            startWake(onFinal, isWake) {
                if (wake) return;
                if (hasVosk() && !this.voskFailed) {
                    wake = startVosk(onFinal, isWake, () => {
                        // Sin Vosk (modelo ausente o error): la frase sigue con el reconocedor de Android.
                        this.voskFailed = true;
                        wake = null;
                        this.startWake(onFinal, isWake);
                    });
                    return;
                }
                let active = true;
                let handles = [];
                let timers = [];
                let session = 0;
                let last = '';
                let heardWake = false;
                const clear = () => {
                    handles.forEach(h => h && h.remove && h.remove());
                    handles = [];
                    timers.forEach(clearTimeout);
                    timers = [];
                };
                const next = (delay) => { if (active) timers.push(setTimeout(loop, delay)); };
                const deliver = (id) => {
                    if (id !== session || !active) return;
                    const heard = last;
                    session++;
                    clear();
                    call('stop').catch(() => {});
                    if (heard) onFinal(heard);
                    // Si onFinal apagó la escucha (oyó la frase), no se reinicia.
                    if (active) next(400);
                };
                const loop = () => {
                    if (!active) return;
                    const id = ++session;
                    last = '';
                    heardWake = false;
                    clear();
                    let quiet = null;
                    handles.push(cap.addListener('SpeechRecognition', 'partialResults', (event) => {
                        if (id !== session) return;
                        const text = event && event.matches && event.matches.find(Boolean);
                        if (!text) return;
                        last = text;
                        if (!heardWake && isWake && isWake(text)) heardWake = true;
                        // Tras la frase, 1,6 s de silencio entregan la orden; sin frase, 1,2 s reinician la escucha.
                        clearTimeout(quiet);
                        quiet = setTimeout(() => deliver(id), heardWake ? 1600 : 1200);
                        timers.push(quiet);
                    }));
                    handles.push(cap.addListener('SpeechRecognition', 'listeningState', (event) => {
                        if (id === session && event && event.status === 'stopped') {
                            clearTimeout(quiet);
                            quiet = setTimeout(() => deliver(id), 300);
                            timers.push(quiet);
                        }
                    }));
                    // Sin voz en 6 s (la sesión ya terminó por silencio aunque no avise) o 12 s como máximo: otra sesión.
                    timers.push(setTimeout(() => { if (id === session && !last) { session++; clear(); next(0); } }, 6000));
                    timers.push(setTimeout(() => deliver(id), 12000));
                    call('start', { language: 'es-CO', maxResults: 3, partialResults: true, popup: false })
                        .catch(() => { if (id === session) { session++; clear(); next(1500); } });
                };
                wake = { stop() { active = false; session++; clear(); call('stop').catch(() => {}); } };
                loop();
            },
            stopWake() {
                if (!wake) return Promise.resolve();
                const released = wake.stop();
                wake = null;
                return released || Promise.resolve();
            }
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
                    const silence = setTimeout(() => { if (!finalText && !interim) { try { r.abort(); } catch (e) { } } }, 6000);
                    r.onend = () => { clearTimeout(silence); session = null; resolve((finalText || interim).trim()); };
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
        settings: loadSettings(),
        autoStarted: false,
        on: false,
        phase: 'idle',
        transcript: '',
        recognizer: null,
        controller: null,
        ui: null,
        media: null,
        bannerTimer: null,

        init() {
            intents.setWakePhrase(this.settings.wakePhrase);
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

        // Sesión: una conversación con el Copiloto. Empieza con el botón o la frase y termina al cumplir la orden, con
        // 6 s de silencio o al tocar otra vez el botón. Cada sesión tiene su número: lo que llega de una sesión
        // terminada se descarta.
        session: 0,
        processing: null,
        lastSpoken: '',
        spokeAt: 0,
        wakeTimer: null,

        async say(text) {
            // Una sesión cancelada con el botón ya no habla.
            if (this.processing != null && this.processing !== this.session) return;
            // La escucha de la frase se pausa mientras el Copiloto habla, para que no se oiga a sí mismo.
            clearTimeout(this.wakeTimer);
            if (this.recognizer && this.recognizer.stopWake) this.recognizer.stopWake();
            // Al terminar vuelve a la fase anterior: en medio de una respuesta sigue «processing» (el botón la apaga).
            const before = this.phase === 'speaking' ? 'idle' : this.phase;
            this.phase = 'speaking';
            this.lastSpoken = text;
            this.showBanner(text, 'speaking');
            try { await window.voiceEngine.say(text); } finally {
                this.spokeAt = Date.now();
                if (this.phase === 'speaking') this.phase = before === 'listening' ? 'idle' : before;
            }
        },

        /** Lo oído es el eco de lo que el Copiloto acaba de decir (el altavoz se cuela en el micrófono). */
        isEcho(heard) {
            if (!this.lastSpoken || Date.now() - this.spokeAt > 5000) return false;
            const spoken = new Set(intents.normalize(this.lastSpoken).split(' '));
            const words = intents.normalize(heard).split(' ').filter(w => w.length >= 3);
            if (!words.length) return false;
            return words.filter(w => spoken.has(w)).length / words.length >= 0.6;
        },

        /** Botón: si el Copiloto está quieto, abre una sesión y escucha; si está en una sesión, la termina. */
        async press() {
            this.init();
            window.voiceEngine.resumeAudio();
            if (!this.recognizer) {
                await window.voiceEngine.say('Este dispositivo no tiene reconocimiento de voz.');
                return;
            }
            if (this.phase !== 'idle') {
                this.endSession();
                return;
            }
            if (!(await this.ensureReady({ interactive: true }))) return;
            this.listenNow();
        },

        /**
         * Permiso del micrófono y teclas del volante, una vez. No escucha una orden.
         * interactive: el conductor tocó el botón (puede pedir el permiso y decir en voz alta si falta).
         * request: puede mostrar el diálogo de permiso (al guardar los ajustes). Sin ninguno de los dos (al entrar a la
         * app) solo consulta y nunca habla: el Copiloto no dice nada que el conductor no haya pedido.
         */
        async ensureReady({ interactive = false, request = interactive, notify = false } = {}) {
            this.init();
            if (this.on) return true;
            if (!this.recognizer) return false;
            const ok = await this.recognizer.available() && await this.recognizer.ensurePermission({ request });
            if (!ok) {
                const text = 'No tengo permiso para usar el micrófono. Actívelo en los ajustes del teléfono.';
                if (interactive) await window.voiceEngine.say(text);
                else if (notify && window.ui && window.ui.toast) window.ui.toast('Micrófono sin permiso', 'warning', { description: 'Actívelo en los ajustes del teléfono para usar el Copiloto con la voz.' });
                return false;
            }
            this.on = true;
            this.enableMediaKeys();
            this.render();
            return true;
        },

        /**
         * Deja el Copiloto listo sin hablar. listen=true además escucha una orden (como el botón); con listen=false y
         * «Activar con la voz» queda esperando la frase.
         */
        async activate({ listen = true, request = false, notify = false } = {}) {
            if (!(await this.ensureReady({ request, notify }))) return;
            if (listen) this.listenNow();
            else this.resumeWakeSoon(0);
        },

        /** Termina la sesión en curso (escucha, respuesta o pregunta pendiente) y vuelve a esperar la frase. */
        endSession() {
            this.session++;
            this.controller.cancelPending();
            this.wantsAnswer = false;
            if (this.recognizer) this.recognizer.abort();
            window.voiceEngine.cancel();
            window.voiceEngine.cue('end');
            this.phase = 'idle';
            this.hideBanner(0);
            this.render();
            this.resumeWakeSoon();
        },

        async deactivate() {
            if (!this.on) return;
            this.on = false;
            this.session++;
            clearTimeout(this.wakeTimer);
            this.controller.cancelPending();
            if (this.recognizer.stopWake) this.recognizer.stopWake();
            this.recognizer.abort();
            window.voiceEngine.cancel();
            this.disableMediaKeys();
            this.phase = 'idle';
            this.hideBanner();
            this.render();
        },

        /**
         * Escucha una orden. afterWake: viene de la frase de activación; en el teléfono se espera a que Android cierre la
         * sesión que la oyó, el tono suena cuando el micrófono ya escucha y la frase sola no cuenta como orden.
         */
        async listenNow({ afterWake = false } = {}) {
            if (!this.on || this.phase === 'listening' || this.phase === 'processing') return;
            const id = ++this.session;
            clearTimeout(this.wakeTimer);
            window.voiceEngine.cancel();
            this.phase = 'listening';
            this.transcript = '';
            this.showBanner('Escuchando…', 'listening');
            const released = this.recognizer.stopWake ? this.recognizer.stopWake() : null;
            if (released && released.then) await Promise.race([released, new Promise(r => setTimeout(r, 800))]);
            if (id !== this.session) return;
            const native = this.recognizer.kind === 'native';
            const cueOnReady = native && afterWake;
            if (!cueOnReady) window.voiceEngine.cue('start');
            const onlyWake = (text) => { const w = intents.stripWakeWord(text); return w.woke && !w.rest; };
            let text = await this.recognizer.listenOnce({
                onPartial: (partial) => { if (id === this.session) this.showBanner(partial, 'listening'); },
                onReady: cueOnReady ? () => { if (id === this.session) window.voiceEngine.cue('start'); } : undefined,
                accept: afterWake ? (partial) => !onlyWake(partial) : undefined,
                delay: cueOnReady ? 600 : 0
            });
            if (id !== this.session) return;
            window.voiceEngine.cue('end');
            // «Hey amigo, llévame a…» repetido dentro de la orden: se quita la frase.
            const woke = text ? intents.stripWakeWord(text) : null;
            if (woke && woke.woke) text = woke.rest;
            await this.process(text, id);
        },

        async process(text, id = ++this.session) {
            this.wantsAnswer = false;
            if (!text) {
                // 6 s sin oír nada: la sesión termina en silencio y no se vuelve a abrir sola.
                this.controller.cancelPending();
                this.phase = 'idle';
                this.hideBanner(0);
                this.render();
                this.resumeWakeSoon();
                return;
            }
            this.phase = 'processing';
            this.processing = id;
            this.showBanner('«' + text + '»', 'processing');
            try {
                await this.controller.handle(text);
            } finally {
                if (this.processing === id) this.processing = null;
                if (id === this.session) this.phase = 'idle';
            }
            if (id !== this.session) return;
            if (!this.on) { this.hideBanner(2500); return; }
            if (this.wantsAnswer && this.controller.awaitingAnswer) {
                this.listenNow();
                return;
            }
            this.hideBanner(2500);
            this.render();
            this.resumeWakeSoon();
        },

        /** Vuelve a esperar la frase tras una pausa, para no oír el final de la propia voz. */
        resumeWakeSoon(delay = 900) {
            clearTimeout(this.wakeTimer);
            this.wakeTimer = setTimeout(() => { if (this.phase === 'idle') this.resumeWake(); }, delay);
        },

        /** En el navegador siempre; en la APK solo con «Activar con la voz» (escucha continua). */
        wakeAvailable() {
            return Boolean(this.recognizer && this.recognizer.startWake && (this.recognizer.kind === 'web' || this.settings.wakeEnabled));
        },

        resumeWake() {
            if (!this.on || !this.wakeAvailable()) return;
            this.recognizer.startWake((heard) => {
                if (this.phase !== 'idle' || this.isEcho(heard)) return;
                const { woke, rest } = intents.stripWakeWord(heard);
                if (!woke) return;
                this.recognizer.stopWake();
                if (rest) {
                    window.voiceEngine.cue('start');
                    this.process(rest);
                } else {
                    this.listenNow({ afterWake: true });
                }
            }, (text) => !this.isEcho(text) && intents.stripWakeWord(text).woke);
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
            button.addEventListener('click', () => this.press());
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
            const active = this.phase !== 'idle';
            button.classList.toggle('is-on', active);
            button.classList.toggle('is-listening', this.phase === 'listening');
            button.setAttribute('aria-pressed', String(active));
            button.setAttribute('aria-label', active ? 'Copiloto activo: toque para apagarlo' : 'Activar el copiloto de voz');
            button.querySelector('.copilot-fab-label').textContent = this.phase === 'listening' ? 'Escuchando' : 'Copiloto';
        },

        showBanner(text, phase) {
            if (!this.ui) return;
            clearTimeout(this.bannerTimer);
            const { banner } = this.ui;
            banner.textContent = text;
            banner.dataset.phase = phase;
            banner.hidden = false;
            this.placeBanner();
            this.render();
        },

        /**
         * En Navegar, el texto va pegado debajo de la tarjeta de la maniobra y con su mismo ancho: abajo lo taparían el
         * micrófono, «Recentrar» y los botones del mapa. En las demás pantallas queda en su sitio (sobre el botón).
         */
        placeBanner() {
            if (!this.ui) return;
            const { banner } = this.ui;
            const card = document.querySelector('.nav-screen .hud-card');
            const host = banner.offsetParent || banner.parentElement;
            const visible = card && card.offsetParent !== null && host;
            banner.classList.toggle('is-docked', Boolean(visible));
            if (!visible) {
                banner.style.top = banner.style.left = banner.style.width = '';
                return;
            }
            const box = card.getBoundingClientRect();
            const frame = host.getBoundingClientRect();
            banner.style.top = Math.round(box.bottom - frame.top + 8) + 'px';
            banner.style.left = Math.round(box.left - frame.left) + 'px';
            banner.style.width = Math.round(box.width) + 'px';
        },

        hideBanner(delay = 0) {
            if (!this.ui) return;
            clearTimeout(this.bannerTimer);
            this.bannerTimer = setTimeout(() => { if (this.ui && this.phase !== 'listening') this.ui.banner.hidden = true; this.render(); }, delay);
        },

        /** Muestra el botón solo en la app del conductor; lo apaga al cerrar sesión o cambiar de vista. */
        /** Guarda los ajustes en este teléfono y los aplica de inmediato. */
        saveSettings(next) {
            const phrase = String(next.wakePhrase || '').trim().slice(0, 40);
            this.settings = { wakeEnabled: next.wakeEnabled === true, wakePhrase: phrase.length >= 3 ? phrase : DEFAULT_WAKE_PHRASE };
            try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(this.settings)); } catch (e) { }
            intents.setWakePhrase(this.settings.wakePhrase);
            if (this.settings.wakeEnabled) {
                this.activate({ listen: false, request: true, notify: true });
                if (window.ui && window.ui.toast) window.ui.toast('Ajustes guardados', 'success',
                    { description: 'Diga «' + this.settings.wakePhrase + '» y su orden para usar el Copiloto.' });
            } else if (this.recognizer && this.recognizer.kind !== 'web' && this.recognizer.stopWake) {
                this.recognizer.stopWake();
            }
            return this.settings;
        },

        /** Hoja «Ajustes del copiloto»: activar con la voz y la frase de activación. */
        openSettings() {
            const esc = window.ui.escape;
            const s = this.settings;
            const native = this.recognizer ? this.recognizer.kind !== 'web' : Boolean(nativeBridge());
            return window.Sheet.open({
                title: 'Ajustes del copiloto',
                subtitle: 'Se guardan en este teléfono.',
                body: `
                    <div class="availability">
                        <div class="availability-text">
                            <b>Activar con la voz</b>
                            <span>Diga la frase y luego su orden, sin tocar la pantalla.</span>
                        </div>
                        <button type="button" role="switch" aria-checked="${s.wakeEnabled ? 'true' : 'false'}" aria-label="Activar con la voz"
                                class="switch" data-wake-toggle></button>
                    </div>
                    <label class="field">
                        <span class="field-label">Frase de activación</span>
                        <input type="text" maxlength="40" value="${esc(s.wakePhrase)}" autocomplete="off" class="field-input" data-wake-phrase>
                        <span class="field-help">Por ejemplo «TruckCar», «Oye camión» o su nombre. Use al menos 3 letras; también responde a «Copiloto».</span>
                    </label>
                    ${native ? '<p class="sheet-note">En el teléfono, el micrófono queda escuchando la frase mientras la app está abierta, sin internet. Gasta algo más de batería.</p>' : ''}`,
                actions: [{ label: 'Guardar', tone: 'primary', value: 'save' }, { label: 'Cancelar', value: null }],
                onMount: (sheet) => {
                    const toggle = sheet.querySelector('[data-wake-toggle]');
                    toggle.addEventListener('click', () => toggle.setAttribute('aria-checked', String(toggle.getAttribute('aria-checked') !== 'true')));
                    sheet.addEventListener('click', (event) => {
                        const save = event.target.closest('[data-sheet-action="0"]');
                        if (!save) return;
                        this.saveSettings({ wakeEnabled: toggle.getAttribute('aria-checked') === 'true',
                            wakePhrase: sheet.querySelector('[data-wake-phrase]').value });
                        window.store.setState({});
                    }, true);
                }
            });
        },

        sync(state) {
            const visible = state.isAuthenticated && state.activeRole === 'driver';
            if (visible && this.settings.wakeEnabled && !this.on && !this.autoStarted) {
                // El conductor lo eligió en los ajustes: el Copiloto queda escuchando al entrar, una vez por sesión.
                this.autoStarted = true;
                setTimeout(() => this.activate({ listen: false }), 800);
            }
            if (!visible) {
                this.autoStarted = false;
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
        press: () => copilot.press(), sync: (state) => copilot.sync(state),
        get settings() { return copilot.settings; }, openSettings: () => copilot.openSettings() };
})();

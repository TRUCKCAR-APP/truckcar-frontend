// Parser de intenciones del copiloto de voz. Puro: recibe la transcripción y devuelve una intención; no toca el DOM
// ni la red. Tolerante a ruido del reconocimiento: minúsculas, sin tildes ni signos, palabras de relleno, la palabra de
// activación al inicio y variantes con que el reconocedor suele escribir "TruckCar" (truck car, trak car, trocar...).
window.VoiceIntents = (function () {
    /** minúsculas, sin tildes, solo letras/números y espacios simples. */
    function normalize(text) {
        return String(text || '')
            .toLowerCase()
            .normalize('NFD').replace(/[̀-ͯ]/g, '')
            .replace(/ñ/g, 'n')
            .replace(/[^a-z0-9]+/g, ' ')
            .trim()
            .replace(/\s+/g, ' ');
    }

    const TRUCKCAR = '(?:truck ?car|truc ?car|trak ?car|track ?car|tru ?car|troc ?car|trocar|trukar|truckcar)';
    const WAKE = new RegExp('^(?:(?:hola|oye|ok|okey|hey|ey)\\s+)?(?:' + TRUCKCAR + '|copiloto)\\b\\s*');
    const WAKE_ANYWHERE = new RegExp('(?:^|\\s)(?:(?:hola|oye|ok|okey|hey|ey)\\s+)?(?:' + TRUCKCAR + '|copiloto)(?:\\s|$)');
    const FILLER = /^(?:por favor|porfa|eh|este|pues|bueno|oiga|necesito|quiero|puedes|podrias|me puedes|me podrias)\s+/;

    /** Quita la palabra de activación del inicio: { woke, rest }. */
    function stripWakeWord(text) {
        const plain = normalize(text);
        const at = plain.search(WAKE_ANYWHERE);
        if (at === -1) return { woke: false, rest: plain };
        const fromWake = plain.slice(at).trim();
        return { woke: true, rest: fromWake.replace(WAKE, '').trim() };
    }

    function clean(text) {
        let plain = normalize(text);
        let previous;
        do {
            previous = plain;
            plain = plain.replace(WAKE, '').replace(FILLER, '').replace(/\s+por favor$/, '').trim();
        } while (plain !== previous);
        return plain;
    }

    // Tipos de reporte de Community-Alerts (enum AlertType) con el tipo de la interfaz (DriverActions.REPORTS).
    // "Vía cerrada" no tiene tipo propio en el backend: se reporta como obra/cierre con la frase en la descripción.
    const REPORT_TYPES = [
        { type: 'landslide', label: 'derrumbe', re: /\b(derrumbe|derrumbes|deslizamiento|alud|caida de (rocas|piedras|tierra)|piedras en la (via|carretera)|tierra en la (via|carretera))\b/ },
        { type: 'danger', label: 'accidente', re: /\b(accidente|choque|chocaron|volcamiento|volcado|volco|siniestro|colision|estrellado)\b/ },
        { type: 'workshop', label: 'vía cerrada', closure: true, re: /\b((via|carretera|paso|vuelta) (cerrada|cerrado|bloqueada|bloqueado)|cierre( de (la )?via)?|bloqueo|bloqueada|cerraron la via)\b/ },
        { type: 'workshop', label: 'obra en vía', re: /\b(obra|obras|trabajos en la via|mantenimiento de la via|reparacion de la via|maquinaria en la via)\b/ },
        { type: 'police', label: 'retén', re: /\b(reten|retenes|policia|control policial|puesto de control|transito|operativo)\b/ },
        { type: 'scale', label: 'báscula', re: /\b(bascula|basculas|pesaje)\b/ },
        { type: 'bridge', label: 'gálibo bajo', re: /\b(galibo|puente bajo|paso bajo|altura baja|altura limitada)\b/ },
        { type: 'rest', label: 'parador seguro', re: /\b(parador|paradero seguro|parqueadero seguro|zona de descanso)\b/ },
        { type: 'traffic', label: 'tráfico pesado', re: /\b(trafico|trancon|congestion|congestionado|embotellamiento|embotellado|atasco|atascado|tacos?|cola de carros)\b/ }
    ];
    // Pedir salir del tráfico es recalcular la ruta, no reportarlo ("sácame de este trancón", "evita el tráfico").
    const ESCAPE = /\b(sacame|sacarme|saquemos|sal de|salir de|salgamos de|evita|evitar|esquiva|esquivar|desviame|desvio|otra ruta|otro camino|ruta (alterna|alternativa))\b/;

    const LOAD_FIELDS = [
        { field: 'eta', re: /\b(cuanto (me )?falta|cuanto (tiempo|tiempo me) falta|a que hora llego|cuando llego|hora de llegada|tiempo de llegada|eta|distancia (restante|que falta)|cuantos kilometros (faltan|me faltan|quedan))\b/ },
        { field: 'destination', re: /\b(destino|direccion de (entrega|destino)|a donde (voy|llevo)|hacia donde voy|donde (entrego|descargo))\b/ },
        { field: 'weight', re: /\b(peso|cuanto pesa|toneladas|volumen)\b/ },
        { field: 'summary', re: /\b(que (llevo|cargo|transporto)|especificaciones|detalles? (de la carga|del viaje)|informacion de la carga|mercancia|la carga)\b/ }
    ];

    const RULES = [
        // Un robo o un atraco es SOS aunque mencione la carga ("me están robando la mercancía"): va antes que todo.
        { type: 'SOS', re: /\b(sos|s o s|auxilio|socorro|emergencia|boton de panico|alerta de panico|necesito ayuda urgente|(me|nos) (estan|quieren|van a) (robar|robando|atracar|atracando|asaltar|asaltando|secuestrar|secuestrando)|(me|nos) (roban|atracan|asaltan|robaron|atracaron|asaltaron)|robo|atraco|asalto|secuestro|extorsion|disparos|nos disparan|me disparan|piratas? (de la )?(via|carretera))\b/ },
        { type: 'COPILOT_OFF', re: /\b((apaga|apagar|desactiva|desactivar|cierra|cerrar|salir del?) (el )?(copiloto|asistente)|deja de escuchar|no escuches mas)\b/ },
        { type: 'HELP', re: /^(ayuda|ayudame|que puedo decir|que (sabes|puedes) hacer|comandos|opciones|que comandos hay)\b/ },
        { type: 'NEARBY_ALERTS', re: /\b((alertas|reportes|novedades|peligros) (cerca|cercanas|cercanos|adelante|en la ruta|en la via|en mi ruta)|que hay (adelante|en la via|en la ruta))\b/ },
        // Rechazar va antes que aceptar: "no acepto la carga" contiene "acepto la carga".
        { type: 'REJECT_LOAD', re: /\b((rechaza|rechazar|rechazo|declinar|declino) (la |el |esa |esta )?(carga|viaje|propuesta|oferta)|no (la |lo )?(acepto|puedo tomar)( la carga| el viaje)?)\b/ },
        { type: 'ACCEPT_LOAD', re: /\b((acepta|aceptar|acepto|tomar|tomo|recibo|recibir) (la |el |esa |esta )?(carga|viaje|propuesta|oferta)|^acepto$)\b/ },
        { type: 'CONFIRM_DELIVERY', re: /\b((confirma|confirmar|confirmo|registra|registrar|marca|marcar|reporta|reportar) (la )?entrega|ya entregue|carga entregada|entregue la carga|entregar (la )?carga|llegue al destino|ya llegue)\b/ },
        { type: 'START_TRIP', re: /\b((inicia|iniciar|inicio|empezar|empieza|empiezo|comenzar|comienza|arrancar|arranca|arranco) (el |la )?(viaje|ruta|navegacion|recorrido|trayecto)|vamonos|salgo ya)\b/ },
        { type: 'HOURS', re: /\b((cuantas|cuanto tiempo|cuantas horas) (llevo|he|tengo) (manejando|conduciendo|de conduccion|de manejo)|horas (de conduccion|de manejo|manejando|conduciendo)|jornada|descanso obligatorio|cuando (debo|tengo que) descansar|cuanto me falta para descansar|tiempo de conduccion)\b/ },
        { type: 'REPEAT', re: /\b(repite|repetir|repiteme|que dijiste|(siguiente|proxima) instruccion|por donde (voy|sigo)|que sigue|donde giro)\b/ },
        { type: 'REROUTE', re: /\b((cambia|cambiar|cambiame|otra|nueva|busca|buscar|buscame) (de |la |una )?ruta|recalcula|recalcular|recalculo|ruta (alterna|alternativa)|desvio|desviame|evita|evitar)\b/ }
    ];

    const AVOID = /\b(evita|evitar|ruta (alterna|alternativa)|desvio|desviame|otra ruta|cambia de ruta|cambiar de ruta|este tramo|esta via)\b/;
    const REPORT_VERB = /\b(reporta|reportar|reporto|reporte|alerta|avisa|avisar|aviso|hay|hubo|veo|adelante|registra|registrar)\b/;

    /**
     * Intención de una orden. Tipos: SOS, COPILOT_OFF, HELP, NEARBY_ALERTS, ACCEPT_LOAD, REJECT_LOAD, CONFIRM_DELIVERY,
     * START_TRIP, HOURS, REPEAT, REROUTE { avoidAhead }, REPORT { alertType, label, closure, description },
     * LOAD_INFO { field }, UNKNOWN.
     */
    function parse(text) {
        const plain = clean(text);
        if (!plain) return { type: 'EMPTY', text: plain };
        for (const rule of RULES.slice(0, 4)) {
            if (rule.re.test(plain)) return { type: rule.type, text: plain };
        }
        // Un peligro en la vía va antes que las órdenes de carga o ruta ("hay un derrumbe, evita este tramo" es reporte).
        const report = REPORT_TYPES.find(r => r.re.test(plain));
        if (report && report.type === 'traffic' && (ESCAPE.test(plain) || RULES.find(r => r.type === 'REROUTE').re.test(plain))) {
            return { type: 'REROUTE', avoidAhead: true, text: plain };
        }
        if (report && (REPORT_VERB.test(plain) || plain.split(' ').length <= 4)) {
            return { type: 'REPORT', alertType: report.type, label: report.label, closure: !!report.closure,
                description: report.closure ? 'Vía cerrada (reporte por voz)' : null, text: plain };
        }
        for (const rule of RULES.slice(4)) {
            if (rule.re.test(plain)) {
                return rule.type === 'REROUTE'
                    ? { type: 'REROUTE', avoidAhead: AVOID.test(plain), text: plain }
                    : { type: rule.type, text: plain };
            }
        }
        const load = LOAD_FIELDS.find(f => f.re.test(plain));
        if (load) return { type: 'LOAD_INFO', field: load.field, text: plain };
        if (report) {
            return { type: 'REPORT', alertType: report.type, label: report.label, closure: !!report.closure,
                description: report.closure ? 'Vía cerrada (reporte por voz)' : null, text: plain };
        }
        return { type: 'UNKNOWN', text: plain };
    }

    const YES = /^(si|sii|si senor|si senora|claro|dale|de una|confirmo|confirmar|confirmado|correcto|afirmativo|hazlo|adelante|ok|okey|listo|de acuerdo|envialo|enviar)\b/;
    const NO = /^(no|cancela|cancelar|cancelado|negativo|olvidalo|olvida|detente|para|espera|mejor no|todavia no)\b/;

    /** Respuesta a una confirmación: 'yes', 'no' o null si no es ninguna de las dos. */
    function parseAnswer(text) {
        const plain = clean(text);
        if (NO.test(plain)) return 'no';
        if (YES.test(plain)) return 'yes';
        return null;
    }

    return { normalize, stripWakeWord, parse, parseAnswer, REPORT_TYPES };
})();

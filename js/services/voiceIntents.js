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

    // Frase de activación propia del conductor (además de «TruckCar» y «Copiloto»), ya normalizada y en palabras.
    let customWake = null;
    let customTokens = [];

    // El reconocedor escribe «hey», «ey» o «ei» indistintamente: las interjecciones se comparan como una sola.
    const GREETINGS = new Set(['ey', 'ei', 'ay', 'oye', 'oe', 'ok', 'okey', 'ola']);
    const wakeToken = (word) => word.replace(/^h(?=[aeiou])/, '');

    function editDistance(a, b) {
        const row = Array.from({ length: b.length + 1 }, (_, j) => j);
        for (let i = 1; i <= a.length; i++) {
            let previous = row[0];
            row[0] = i;
            for (let j = 1; j <= b.length; j++) {
                const current = row[j];
                row[j] = Math.min(row[j] + 1, row[j - 1] + 1, previous + (a[i - 1] === b[j - 1] ? 0 : 1));
                previous = current;
            }
        }
        return row[b.length];
    }

    /** Dos palabras se parecen: iguales, ambas saludos, o con una letra de diferencia (desde 4 letras), o plural. */
    function sameWord(heard, expected) {
        if (heard === expected) return true;
        if (GREETINGS.has(heard) && GREETINGS.has(expected)) return true;
        if (Math.min(heard.length, expected.length) < 4) return false;
        return editDistance(heard, expected) <= 1 || (heard.startsWith(expected) && heard.length - expected.length <= 2);
    }

    /** Lo que sigue a la frase propia en lo oído, o null si no está. */
    function findCustomWake(plain) {
        if (!customTokens.length) return null;
        const words = plain.split(' ');
        const keys = words.map(wakeToken);
        for (let i = 0; i + customTokens.length <= keys.length; i++) {
            if (customTokens.every((t, k) => sameWord(keys[i + k], t))) {
                return words.slice(i + customTokens.length).join(' ').trim();
            }
        }
        return null;
    }

    /** Configura la frase de activación del conductor; vacía la quita. */
    function setWakePhrase(phrase) {
        const plain = normalize(phrase || '');
        customWake = plain.length >= 3 ? plain : null;
        customTokens = customWake ? customWake.split(' ').map(wakeToken) : [];
        return customWake;
    }

    /** Quita la palabra de activación del inicio: { woke, rest }. */
    function stripWakeWord(text) {
        const plain = normalize(text);
        const custom = findCustomWake(plain);
        if (custom !== null) return { woke: true, rest: custom };
        const at = plain.search(WAKE_ANYWHERE);
        if (at === -1) return { woke: false, rest: plain };
        const fromWake = plain.slice(at).trim();
        return { woke: true, rest: fromWake.replace(WAKE, '').trim() };
    }

    // «necesito ir a la Escuela Colombiana de Ingeniería», «llévame a Tunja», «cómo llego al peaje de Andes».
    // El relleno («necesito», «quiero») ya se quitó en clean(). Si lo que sigue es un verbo («voy a reportar…») no es un
    // lugar: lo resuelven las demás reglas o la IA.
    const NAVIGATE = /^(?:(?:tengo que|me toca|hay que)\s+)?(?:ir|irme|llegar|vamos|voy|llevame|lleveme|llevarme|guiame|navegar|navega|como llego|como llegar|ruta|buscar ruta|busca la ruta|buscame la ruta)\s+(?:a|al|hasta|hacia|para)\s+(.+)$/;
    const NOT_A_PLACE = /^(?:(?:el|la|los|las)\s+)?(?:destino|entrega|carga|siguiente|proxima)\b/;

    // Números dichos en palabras («portal de la ochenta», «calle setenta y dos») a cifras para buscar el lugar: el
    // reconocedor del teléfono (Vosk) los escribe en letras. De 1 a 199.
    const UNITS = { uno: 1, un: 1, una: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9 };
    const TEENS = { diez: 10, once: 11, doce: 12, trece: 13, catorce: 14, quince: 15, dieciseis: 16, diecisiete: 17,
        dieciocho: 18, diecinueve: 19, veinte: 20, veintiuno: 21, veintiun: 21, veintidos: 22, veintitres: 23,
        veinticuatro: 24, veinticinco: 25, veintiseis: 26, veintisiete: 27, veintiocho: 28, veintinueve: 29 };
    const TENS = { treinta: 30, cuarenta: 40, cincuenta: 50, sesenta: 60, setenta: 70, ochenta: 80, noventa: 90 };

    function numbersToDigits(text) {
        const words = text.split(' ');
        const out = [];
        for (let i = 0; i < words.length; i++) {
            let value = null;
            let j = i;
            let hundred = 0;
            if (words[j] === 'cien') { value = 100; j++; } else if (words[j] === 'ciento') { hundred = 100; j++; }
            const w = words[j];
            if (value === null && TENS[w] != null) {
                value = hundred + TENS[w];
                if (words[j + 1] === 'y' && UNITS[words[j + 2]] != null) { value += UNITS[words[j + 2]]; j += 2; }
                j++;
            } else if (value === null && TEENS[w] != null) {
                value = hundred + TEENS[w]; j++;
            } else if (value === null && hundred && UNITS[w] != null) {
                value = hundred + UNITS[w]; j++;
            } else if (value === null && hundred) {
                value = hundred;
            } else if (value === null && UNITS[w] != null && !['un', 'una', 'uno'].includes(w)) {
                value = UNITS[w]; j++;
            }
            if (value === null) { out.push(words[i]); continue; }
            out.push(String(value));
            i = j - 1;
        }
        return out.join(' ');
    }

    function navigateTarget(plain) {
        const match = plain.match(NAVIGATE);
        if (!match) return null;
        const place = numbersToDigits(match[1].replace(/^(?:(?:el|la|los|las|un|una)\s+)/, '').trim());
        const first = place.split(' ')[0];
        if (place.length < 2 || NOT_A_PLACE.test(place) || /(?:ar|er|ir)$/.test(first)) return null;
        return place;
    }

    const ORDINALS = [/^(?:la |el )?(?:primera|primero|uno|una|1)\b/, /^(?:la |el )?(?:segunda|segundo|dos|2)\b/,
        /^(?:la |el )?(?:tercera|tercero|tres|3)\b/, /^(?:la |el )?(?:cuarta|cuarto|cuatro|4)\b/, /^(?:la |el )?(?:quinta|quinto|cinco|5)\b/];

    /** «la segunda», «opción dos», «la última»: índice (desde 0) entre count opciones, o null. */
    function parseChoice(text, count) {
        const plain = clean(text).replace(/^(?:la opcion|opcion|numero|el numero|la numero)\s+/, '');
        if (/^(?:la |el )?(?:ultima|ultimo)\b/.test(plain)) return count > 0 ? count - 1 : null;
        const index = ORDINALS.findIndex(re => re.test(plain));
        return index >= 0 && index < count ? index : null;
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
     * LOAD_INFO { field }, NAVIGATE { place }, UNKNOWN.
     */
    function parse(text) {
        const plain = clean(text);
        if (!plain) return { type: 'EMPTY', text: plain };
        for (const rule of RULES.slice(0, 4)) {
            if (rule.re.test(plain)) return { type: rule.type, text: plain };
        }
        const place = navigateTarget(plain);
        if (place) return { type: 'NAVIGATE', place, text: plain };
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

    return { normalize, stripWakeWord, setWakePhrase, parse, parseAnswer, parseChoice, REPORT_TYPES };
})();

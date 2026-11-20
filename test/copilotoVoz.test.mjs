import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";

// Copiloto de voz: parser de intenciones (js/services/voiceIntents.js), controlador con confirmación verbal
// (js/services/voiceAssistant.js) y voz nativa en la APK (js/speechEngine.js).

function load(files, setup) {
  const w = new JSDOM("<!doctype html><body></body>", { runScripts: "outside-only" }).window;
  if (setup) setup(w);
  for (const file of files) w.eval(readFileSync(file, "utf8"));
  return w;
}

const intentsWindow = () => load(["js/services/voiceIntents.js"]);
const parse = (w, text) => JSON.parse(JSON.stringify(w.VoiceIntents.parse(text)));

test("las órdenes del conductor se reconocen aunque el reconocedor agregue tildes, mayúsculas o relleno", () => {
  const w = intentsWindow();
  const cases = [
    ["Reportar accidente", "REPORT", { alertType: "danger" }],
    ["Hay un derrumbe adelante", "REPORT", { alertType: "landslide" }],
    ["¡Vía cerrada!", "REPORT", { alertType: "workshop", closure: true }],
    ["oiga, por favor reporte un retén de policía", "REPORT", { alertType: "police" }],
    ["báscula abierta adelante", "REPORT", { alertType: "scale" }],
    ["Enviar alerta SOS", "SOS"],
    ["auxilio", "SOS"],
    ["Cambiar de ruta", "REROUTE", { avoidAhead: true }],
    ["Recalcular ruta", "REROUTE", { avoidAhead: false }],
    ["Buscar ruta alterna", "REROUTE", { avoidAhead: true }],
    ["Evitar este tramo", "REROUTE", { avoidAhead: true }],
    ["Especificaciones de la carga", "LOAD_INFO", { field: "summary" }],
    ["¿Qué llevo?", "LOAD_INFO", { field: "summary" }],
    ["¿Cuál es el peso?", "LOAD_INFO", { field: "weight" }],
    ["Dirección de destino", "LOAD_INFO", { field: "destination" }],
    ["¿Cuánto falta para llegar?", "LOAD_INFO", { field: "eta" }],
    ["¿Cuántas horas llevo manejando?", "HOURS"],
    ["cuánto me falta para descansar", "HOURS"],
    ["Aceptar carga", "ACCEPT_LOAD"],
    ["no acepto la carga", "REJECT_LOAD"],
    ["rechazar el viaje", "REJECT_LOAD"],
    ["Iniciar viaje", "START_TRIP"],
    ["Confirmar entrega", "CONFIRM_DELIVERY"],
    ["ya llegué al destino", "CONFIRM_DELIVERY"],
    ["repite la instrucción", "REPEAT"],
    ["alertas cercanas", "NEARBY_ALERTS"],
    ["qué hay adelante", "NEARBY_ALERTS"],
    ["ayuda", "HELP"],
    ["apagar copiloto", "COPILOT_OFF"],
    ["blablá la la", "UNKNOWN"],
    ["   ", "EMPTY"]
  ];
  for (const [text, type, extra] of cases) {
    const intent = parse(w, text);
    assert.equal(intent.type, type, text);
    for (const [key, value] of Object.entries(extra || {})) assert.equal(intent[key], value, text + " → " + key);
  }
});

test("el tráfico pesado se reporta; pedir salir del trancón recalcula la ruta", () => {
  const w = intentsWindow();
  for (const text of ["Tráfico pesado", "hay un trancón terrible", "reportar congestión", "esto está embotellado"]) {
    const intent = parse(w, text);
    assert.equal(intent.type, "REPORT", text);
    assert.equal(intent.alertType, "traffic", text);
    assert.equal(intent.label, "tráfico pesado", text);
  }
  for (const text of ["sácame de este trancón", "evita el tráfico", "busca otro camino, hay mucho tráfico", "salgamos de este atasco"]) {
    const intent = parse(w, text);
    assert.equal(intent.type, "REROUTE", text);
    assert.equal(intent.avoidAhead, true, text);
  }
  // Un peligro físico sigue siendo reporte aunque pida evitarlo.
  assert.equal(parse(w, "hay un derrumbe, evita este tramo").type, "REPORT");
  // "Vía cerrada" sí se reporta (como obra/cierre) y lleva la frase en la descripción.
  assert.equal(parse(w, "carretera cerrada").description, "Vía cerrada (reporte por voz)");
  // Los tipos de reporte son exactamente los de la pantalla Reportar (DriverActions.REPORTS).
  const ui = ["landslide", "danger", "workshop", "police", "scale", "bridge", "rest", "traffic"];
  const types = Array.from(w.VoiceIntents.REPORT_TYPES, r => r.type);
  for (const type of types) assert.ok(ui.includes(type), type);
  for (const type of ui) assert.ok(types.includes(type), "falta por voz: " + type);
  const screen = readFileSync("js/views/driverActions.js", "utf8");
  for (const type of ui) assert.match(screen, new RegExp("type: '" + type + "'"), "falta en la pantalla Reportar: " + type);
});

test("un robo o un atraco es SOS aunque mencione la carga", () => {
  const w = intentsWindow();
  for (const text of ["me están robando la mercancía", "nos están atracando", "me robaron la carga", "hay un asalto",
    "me quieren secuestrar", "nos están disparando, nos disparan", "piratas de la carretera"]) {
    assert.equal(parse(w, text).type, "SOS", text);
  }
  // Las consultas de la carga siguen funcionando.
  assert.deepEqual([parse(w, "qué mercancía llevo").type, parse(w, "qué mercancía llevo").field], ["LOAD_INFO", "summary"]);
});

test("la palabra de activación se quita y tolera cómo el reconocedor escribe TruckCar", () => {
  const w = intentsWindow();
  const strip = (text) => JSON.parse(JSON.stringify(w.VoiceIntents.stripWakeWord(text)));
  assert.deepEqual(strip("Hola TruckCar reportar derrumbe"), { woke: true, rest: "reportar derrumbe" });
  assert.deepEqual(strip("hola truck car, ¿qué llevo?"), { woke: true, rest: "que llevo" });
  assert.deepEqual(strip("oye trocar"), { woke: true, rest: "" });
  assert.deepEqual(strip("Copiloto, recalcular ruta"), { woke: true, rest: "recalcular ruta" });
  assert.deepEqual(strip("vamos a almorzar en Tunja"), { woke: false, rest: "vamos a almorzar en tunja" });
  assert.equal(parse(w, "Hola TruckCar, enviar alerta SOS").type, "SOS");
});

test("las respuestas a una confirmación: sí, cancelar o ninguna", () => {
  const w = intentsWindow();
  const answer = (text) => w.VoiceIntents.parseAnswer(text);
  for (const yes of ["Sí", "sí, confírmalo", "dale", "confirmo", "correcto"]) assert.equal(answer(yes), "yes", yes);
  for (const no of ["no", "Cancelar", "mejor no", "olvídalo"]) assert.equal(answer(no), "no", no);
  assert.equal(answer("el clima está bueno"), null);
});

// ── Controlador ──

function controller({ actions = {}, now = () => 1_000 } = {}) {
  const w = load(["js/services/voiceIntents.js", "js/services/voiceAssistant.js"]);
  const said = [];
  let listens = 0;
  const base = {
    report: async () => ({ pendingSync: false }),
    sos: () => Promise.resolve(),
    hasRoute: () => true,
    planReroute: async () => ({ ok: true, remainingM: 85200, durationS: 6000, restricted: false, needsConfirmation: false }),
    applyReroute: async (plan) => ({ ok: true, remainingM: plan.remainingM, durationS: plan.durationS, restricted: plan.restricted, provider: plan.provider }),
    remaining: () => ({ remainingM: 42000, durationS: 2700, arrived: false }),
    currentLoad: () => ({ id: "CARGA-7", cargoType: "Cemento", netWeight: 24, volumeM3: null,
      origin: { name: "Bogotá, Cundinamarca" }, destination: { name: "Tunja, Boyacá" } }),
    loadActions: () => ({ respond: true, navigate: true, startTrip: true, deliver: true }),
    driver: async () => ({ hoursDrivenToday: 2.5, remainingDrivingHours: 6.5, restRequired: false }),
    accept: async () => true,
    reject: async () => true,
    startTrip: async () => true,
    openDelivery: () => {},
    instruction: () => "En 300 m, gire a la derecha",
    nearbyAlerts: () => [{ label: "derrumbe", distanceM: 4200 }, { label: "puesto de control", distanceM: 12000 }],
    copilotOff: () => {}
  };
  const ctrl = w.VoiceAssistant.createController({
    say: async (text) => { said.push(text); },
    listen: () => { listens++; },
    actions: { ...base, ...actions },
    now
  });
  return { ctrl, said, listens: () => listens };
}

test("un reporte por voz usa la posición actual y confirma en voz alta; sin GPS lo dice y no envía nada", async () => {
  const sent = [];
  const { ctrl, said } = controller({ actions: { report: async (type, description) => { sent.push([type, description]); return { pendingSync: false }; } } });
  await ctrl.handle("hay un derrumbe adelante");
  assert.deepEqual(sent, [["landslide", null]]);
  assert.equal(said.at(-1), "Reporte de derrumbe registrado en su ubicación.");

  const offline = controller({ actions: { report: async () => ({ pendingSync: true }) } });
  await offline.ctrl.handle("reportar accidente");
  assert.match(offline.said.at(-1), /Sin señal: el reporte de accidente se guardó/);

  const noGps = controller({ actions: { report: async () => ({ noPosition: true }) } });
  const result = await noGps.ctrl.handle("vía cerrada");
  assert.equal(result.status, "error");
  assert.match(noGps.said.at(-1), /No tengo su posición GPS/);
});

test("aceptar una carga exige un sí explícito; cancelar o el silencio no cambian nada", async () => {
  let accepted = 0;
  const { ctrl, said, listens } = controller({ actions: { accept: async () => { accepted++; } } });

  const asking = await ctrl.handle("aceptar carga");
  assert.equal(asking.status, "confirming");
  assert.match(said.at(-1), /¿Acepta la carga de Cemento hacia Tunja, Boyacá\? Diga sí o cancelar\./);
  assert.equal(listens(), 1, "vuelve a escuchar para la respuesta");
  assert.equal(ctrl.awaitingAnswer, true);
  await ctrl.handle("sí");
  assert.equal(accepted, 1);
  assert.equal(ctrl.awaitingAnswer, false);

  await ctrl.handle("aceptar carga");
  await ctrl.handle("cancelar");
  assert.equal(accepted, 1);
  assert.equal(said.at(-1), "Cancelado.");

  await ctrl.handle("aceptar carga");
  const before = said.length;
  const quiet = await ctrl.handle("");
  assert.equal(accepted, 1);
  assert.equal(quiet.status, "silence", "el silencio termina la sesión");
  assert.equal(said.length, before, "sin hablar ni volver a preguntar");
  assert.equal(ctrl.awaitingAnswer, false);
});

test("una respuesta confusa pide repetir una vez y luego cancela; una confirmación vencida no se ejecuta", async () => {
  let delivered = 0;
  const { ctrl, said } = controller({ actions: { openDelivery: () => { delivered++; } } });
  await ctrl.handle("confirmar entrega");
  await ctrl.handle("el clima está bueno");
  assert.equal(said.at(-1), "Diga sí para confirmar, o cancelar.");
  await ctrl.handle("tal vez");
  assert.equal(said.at(-1), "No le entendí. Acción cancelada.");
  assert.equal(delivered, 0);

  let clock = 1_000;
  const late = controller({ actions: { startTrip: async () => { delivered += 10; } }, now: () => clock });
  await late.ctrl.handle("iniciar viaje");
  clock += 16_000;
  const result = await late.ctrl.handle("sí");
  assert.equal(delivered, 0, "el sí llegó después de 15 s: no inicia el viaje");
  assert.equal(result.status, "unknown");
});

test("confirmar la entrega abre el formulario de prueba de entrega y lo explica por voz", async () => {
  let opened = 0;
  const { ctrl, said } = controller({ actions: { openDelivery: () => { opened++; } } });
  await ctrl.handle("confirmar entrega");
  assert.match(said.at(-1), /¿Confirma que desea registrar la entrega de la carga\?/);
  await ctrl.handle("confirmo");
  assert.equal(opened, 1);
  assert.match(said.at(-1), /Abriendo el registro de entrega/);
});

test("el SOS pide confirmación y no deja al copiloto esperando a que se cierre el modal", async () => {
  let sos = 0;
  const { ctrl } = controller({ actions: { sos: () => { sos++; return new Promise(() => {}); } } });
  await ctrl.handle("enviar alerta SOS");
  assert.equal(sos, 0);
  const result = await ctrl.handle("sí");
  assert.equal(result.status, "done");
  assert.equal(sos, 1);
});

test("los errores del backend (RFC 7807) se leen en voz alta, sin el código de traza", async () => {
  const error = Object.assign(new Error("No puede aceptar cargas: su transportadora aún no aprueba su afiliación. [trace 9f3a1c2b]"), { status: 403 });
  const { ctrl, said } = controller({ actions: { accept: async () => { throw error; } } });
  await ctrl.handle("aceptar carga");
  const result = await ctrl.handle("sí");
  assert.equal(result.status, "error");
  assert.equal(said.at(-1), "No se pudo aceptar la carga: No puede aceptar cargas: su transportadora aún no aprueba su afiliación.");
});

test("consultas: carga, peso, destino, tiempo restante y jornada con datos reales", async () => {
  const { ctrl, said } = controller({ now: () => new Date("2026-11-20T14:00:00-05:00").getTime() });
  await ctrl.handle("qué llevo");
  assert.equal(said.at(-1), "Lleva Cemento, 24 toneladas, de Bogotá, Cundinamarca hacia Tunja, Boyacá.");
  await ctrl.handle("cuál es el peso");
  assert.equal(said.at(-1), "La carga pesa 24 toneladas.");
  await ctrl.handle("dirección de destino");
  assert.equal(said.at(-1), "El destino es Tunja, Boyacá.");
  await ctrl.handle("cuánto falta para llegar");
  assert.match(said.at(-1), /^Faltan 42 kilómetros, aproximadamente 45 minutos\. Llegada estimada a las /);
  await ctrl.handle("cuántas horas llevo manejando");
  assert.equal(said.at(-1), "Lleva 2 horas y 30 minutos de conducción hoy. Le quedan 6 horas y 30 minutos antes del descanso obligatorio.");

  const rest = controller({ actions: { driver: async () => ({ hoursDrivenToday: 9, remainingDrivingHours: 0, restRequired: true, mandatoryRestLocation: "Parador de Sutatausa" }) } });
  await rest.ctrl.handle("horas de conducción");
  assert.match(rest.said.at(-1), /Debe tomar el descanso obligatorio en Parador de Sutatausa\./);
});

test("recalcular lee la nueva distancia y tiempo; sin navegación activa explica qué hacer", async () => {
  const calls = [];
  const { ctrl, said } = controller({ actions: { planReroute: async (options) => { calls.push(options.avoidAhead); return { ok: true, remainingM: 85200, durationS: 6000, restricted: true, needsConfirmation: false }; } } });
  await ctrl.handle("buscar ruta alterna");
  assert.deepEqual(calls, [true]);
  assert.equal(said.at(-2), "Buscando una ruta que evite este tramo.");
  assert.equal(said.at(-1), "Nueva ruta: 85 kilómetros, aproximadamente 1 hora y 40 minutos. Atención: tiene restricciones de gálibo o peso para su vehículo.");

  const idle = controller({ actions: { hasRoute: () => false } });
  await idle.ctrl.handle("recalcular ruta");
  assert.match(idle.said.at(-1), /No hay una navegación activa/);

  const noDetour = controller({ actions: { planReroute: async () => ({ ok: false, reason: "no-detour" }) } });
  await noDetour.ctrl.handle("evitar este tramo");
  assert.match(noDetour.said.at(-1), /No encontré una ruta que evite ese tramo/);
});

test("sin carga o sin propuesta no se inventa nada; lo no reconocido responde con opciones breves", async () => {
  const empty = controller({ actions: { currentLoad: () => null } });
  await empty.ctrl.handle("qué llevo");
  assert.equal(empty.said.at(-1), "No tiene una carga asignada en este momento.");
  await empty.ctrl.handle("aceptar carga");
  assert.equal(empty.said.at(-1), "No tiene una propuesta de carga pendiente.");
  await empty.ctrl.handle("iniciar viaje");
  assert.equal(empty.said.at(-1), "Acepte una carga antes de iniciar el viaje.");

  const { ctrl, said } = controller();
  await ctrl.handle("necesito un café");
  assert.match(said.at(-1), /^No entendí\. Puede decir, por ejemplo:/);
  await ctrl.handle("alertas cercanas");
  assert.equal(said.at(-1), "Hay 2 alertas cerca de su posición: derrumbe a 4,2 kilómetros; puesto de control a 12 kilómetros.");
  await ctrl.handle("tráfico pesado");
  assert.equal(said.at(-1), "Reporte de tráfico pesado registrado en su ubicación.");
  await ctrl.handle("ayuda");
  assert.match(said.at(-1), /^Puede reportar derrumbe, .*parador seguro o tráfico pesado\. También puede decir: enviar SOS/);
});

test("sácame de este trancón recalcula evitando el tramo; me están robando pide confirmar el SOS", async () => {
  const reroutes = [];
  const { ctrl, said } = controller({ actions: { planReroute: async (options) => { reroutes.push(options.avoidAhead); return { ok: true, remainingM: 85200, durationS: 6000, needsConfirmation: false }; } } });
  await ctrl.handle("sácame de este trancón");
  assert.deepEqual(reroutes, [true]);
  assert.equal(said[0], "Buscando una ruta que evite este tramo.");

  const sos = controller();
  const result = await sos.ctrl.handle("me están robando la mercancía");
  assert.equal(result.status, "confirming");
  assert.match(sos.said.at(-1), /^¿Envío una alerta SOS/);
});

test("un viaje ya en tránsito se retoma sin pedir confirmación", async () => {
  let started = 0;
  const { ctrl } = controller({ actions: { loadActions: () => ({ navigate: true, startTrip: false }), startTrip: async () => { started++; } } });
  const result = await ctrl.handle("iniciar viaje");
  assert.equal(result.status, "done");
  assert.equal(started, 1);
});

// ── Voz nativa en la APK ──

test("en la APK la voz va por el plugin nativo TextToSpeech, en cola, y el copiloto habla aunque la guía esté apagada", async () => {
  const calls = [];
  const w = load(["js/speechEngine.js"], (win) => {
    win.store = { getState: () => ({ voiceEnabled: false }) };
    win.Capacitor = {
      isNativePlatform: () => true,
      nativePromise: (plugin, method, options) => { calls.push([plugin, method, options && options.text]); return Promise.resolve(); }
    };
  });
  assert.equal(await w.voiceEngine.speak("Gire a la derecha"), false, "la guía apagada no habla");
  await w.voiceEngine.say("Reporte de derrumbe registrado en su ubicación.");
  await Promise.all([w.voiceEngine.speak("uno", false, { force: true }), w.voiceEngine.speak("dos", false, { force: true })]);
  assert.deepEqual(calls, [
    ["TextToSpeech", "stop", undefined],
    ["TextToSpeech", "speak", "Reporte de derrumbe registrado en su ubicación."],
    ["TextToSpeech", "speak", "uno"],
    ["TextToSpeech", "speak", "dos"]
  ]);
});

test("el recálculo por voz está expuesto en la guía de ruta y sin ruta no hace nada", async () => {
  const w = load(["js/navigation.js"], (win) => { win.TruckCarData = {}; });
  assert.equal(typeof w.RouteGuidance.recalculate, "function");
  assert.deepEqual(JSON.parse(JSON.stringify(await w.RouteGuidance.recalculate({ avoidAhead: true }))), { ok: false, reason: "no-route" });
  assert.equal(w.RouteGuidance.remaining(), null);
});

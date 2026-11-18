import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";

// Copiloto + intérprete con IA (Voice-AI-Assistant): lo que las reglas del teléfono no entienden se consulta una vez al
// servicio y su respuesta se ejecuta con las mismas confirmaciones habladas; sin servicio, todo sigue igual.

function load(files, setup) {
  const w = new JSDOM("<!doctype html><body></body>", { runScripts: "outside-only" }).window;
  if (setup) setup(w);
  for (const file of files) w.eval(readFileSync(file, "utf8"));
  return w;
}

function controller({ interpret, actions = {} } = {}) {
  const w = load(["js/services/voiceIntents.js", "js/services/voiceAssistant.js"]);
  const said = [];
  const asked = [];
  const reports = [];
  const base = {
    report: async (type, description) => { reports.push([type, description]); return { pendingSync: false }; },
    sos: () => Promise.resolve(),
    hasRoute: () => true,
    reroute: async () => ({ ok: true, remainingM: 85200, durationS: 6000, restricted: false }),
    remaining: () => ({ remainingM: 42000, durationS: 2700, arrived: false }),
    currentLoad: () => ({ id: "CARGA-7", cargoType: "Cemento", netWeight: 24, status: "IN_TRANSIT",
      origin: { name: "Bogotá" }, destination: { name: "Tunja, Boyacá" } }),
    loadActions: () => ({ respond: true, navigate: true, startTrip: true, deliver: true }),
    driver: async () => ({ hoursDrivenToday: 2.5, remainingDrivingHours: 6.5, restRequired: false }),
    accept: async () => true,
    reject: async () => true,
    startTrip: async () => true,
    openDelivery: () => {},
    instruction: () => "En 300 m, gire a la derecha",
    nearbyAlerts: () => [],
    copilotOff: () => {}
  };
  const deps = {
    say: async (text) => { said.push(text); },
    listen: () => {},
    actions: { ...base, ...actions }
  };
  if (interpret) deps.interpret = async (text) => { asked.push(text); return interpret(text); };
  const ctrl = w.VoiceAssistant.createController(deps);
  return { w, ctrl, said, asked, reports };
}

test("lo que las reglas entienden nunca se envía a la IA", async () => {
  const { ctrl, asked, reports } = controller({ interpret: () => ({ intent: "SOS" }) });
  await ctrl.handle("hay un derrumbe adelante");
  await ctrl.handle("qué llevo");
  assert.deepEqual(asked, []);
  assert.deepEqual(reports, [["landslide", null]]);
});

test("un peligro que solo entendió la IA se confirma antes de publicarse", async () => {
  const { ctrl, said, asked, reports } = controller({
    interpret: () => ({ intent: "REPORT", alertType: "workshop", closure: true, source: "AZURE_OPENAI" })
  });
  const first = await ctrl.handle("se cayó un árbol y no se puede pasar");
  assert.deepEqual(asked, ["se cayo un arbol y no se puede pasar"]);
  assert.equal(first.status, "confirming");
  assert.equal(first.source, "assistant");
  assert.equal(said.at(-1), "¿Reporto vía cerrada en su ubicación? Diga sí o cancelar.");
  assert.deepEqual(reports, [], "nada se publica sin el sí");

  await ctrl.handle("sí");
  assert.deepEqual(reports, [["workshop", "Vía cerrada (reporte por voz)"]]);
  assert.equal(said.at(-1), "Reporte de vía cerrada registrado en su ubicación.");

  const cancel = controller({ interpret: () => ({ intent: "REPORT", alertType: "landslide" }) });
  await cancel.ctrl.handle("se vino la montaña");
  await cancel.ctrl.handle("cancelar");
  assert.deepEqual(cancel.reports, []);
});

test("las acciones de la IA pasan por las mismas confirmaciones y validaciones", async () => {
  const sos = controller({ interpret: () => ({ intent: "SOS" }) });
  const result = await sos.ctrl.handle("me están atracando");
  assert.equal(result.status, "confirming");
  assert.match(sos.said.at(-1), /^¿Envío una alerta SOS/);

  const noLoad = controller({ interpret: () => ({ intent: "ACCEPT_LOAD" }), actions: { currentLoad: () => null } });
  await noLoad.ctrl.handle("de una, me le mido a ese viaje");
  assert.equal(noLoad.said.at(-1), "No tiene una propuesta de carga pendiente.");

  const eta = controller({ interpret: () => ({ intent: "LOAD_INFO", field: "eta" }) });
  await eta.ctrl.handle("en cuánto rato estoy allá");
  assert.match(eta.said.at(-1), /42 kilómetros/);

  const reroute = controller({ interpret: () => ({ intent: "REROUTE", avoidAhead: true }) });
  await reroute.ctrl.handle("llévame por otro lado");
  assert.equal(reroute.said[0], "Buscando una ruta que evite este tramo.");
});

test("una pregunta general recibe la respuesta corta de la IA, sin acción", async () => {
  const { ctrl, said, reports } = controller({
    interpret: () => ({ intent: "CHAT", reply: "Reduzca la velocidad y aumente la distancia con el vehículo de adelante." })
  });
  const result = await ctrl.handle("cómo manejo con este aguacero");
  assert.equal(result.status, "done");
  assert.equal(said.at(-1), "Reduzca la velocidad y aumente la distancia con el vehículo de adelante.");
  assert.deepEqual(reports, []);
});

test("si la IA tampoco entiende, dice su aclaración; sin servicio, las opciones de siempre", async () => {
  const clarify = controller({ interpret: () => ({ intent: "UNKNOWN", reply: "¿Puede repetirlo con otras palabras?" }) });
  await clarify.ctrl.handle("eso del señor de ayer");
  assert.equal(clarify.said.at(-1), "¿Puede repetirlo con otras palabras?");

  for (const interpret of [() => null, () => { throw new Error("sin red"); }, () => ({ intent: "UNKNOWN" })]) {
    const { ctrl, said } = controller({ interpret });
    const result = await ctrl.handle("necesito un café");
    assert.equal(result.status, "unknown");
    assert.match(said.at(-1), /^No entendí\. Puede decir, por ejemplo:/);
  }

  const without = controller();
  await without.ctrl.handle("necesito un café");
  assert.match(without.said.at(-1), /^No entendí\./);
});

test("lo que la app no sabe ejecutar se descarta aunque venga de la IA", () => {
  const { w } = controller();
  const from = (response) => w.VoiceAssistant.fromAssistant(response, "texto");
  assert.equal(from({ intent: "DELETE_ACCOUNT" }), null);
  assert.equal(from({ intent: "COPILOT_OFF" }), null, "apagar el copiloto no se delega en la IA");
  assert.equal(from({ intent: "REPORT", alertType: "fire" }), null);
  assert.equal(from({ intent: "LOAD_INFO", field: "password" }), null);
  assert.equal(from({ intent: "CHAT", reply: "   " }), null);
  assert.equal(from(null), null);
  assert.equal(from("REPORT"), null);
  const obra = from({ intent: "REPORT", alertType: "workshop", closure: false });
  assert.equal(obra.label, "obra en vía");
  assert.equal(obra.description, null);
  assert.equal(from({ intent: "REPORT", alertType: "danger", closure: true }).label, "accidente");
  assert.equal(from({ intent: "REPORT", alertType: "traffic" }).label, "tráfico pesado");
  assert.equal(from({ intent: "CHAT", reply: "x".repeat(500) }).reply.length, 300);
});

test("al servicio solo viajan el texto y el estado del viaje; sin conexión no se llama", async () => {
  const calls = [];
  const w = load(["js/services/voiceIntents.js", "js/services/voiceAssistant.js"], (win) => {
    win.TruckCarApi = { assistant: { interpret: async (text, context) => { calls.push({ text, context }); return { intent: "HELP" }; } } };
  });
  const actions = { currentLoad: () => ({ id: "C-1", status: "IN_TRANSIT" }), hasRoute: () => true };
  const response = await w.VoiceAssistant.remoteInterpret("x".repeat(400), actions);
  assert.deepEqual(JSON.parse(JSON.stringify(response)), { intent: "HELP" });
  assert.equal(calls[0].text.length, 300);
  assert.deepEqual(JSON.parse(JSON.stringify(calls[0].context)), { hasLoad: true, navigating: true, loadStatus: "IN_TRANSIT" });

  w.TruckCarApi.assistant.interpret = async () => { throw new Error("429"); };
  assert.equal(await w.VoiceAssistant.remoteInterpret("hola", actions), null);

  Object.defineProperty(w.navigator, "onLine", { value: false, configurable: true });
  w.TruckCarApi.assistant.interpret = async () => { throw new Error("no debía llamarse"); };
  assert.equal(await w.VoiceAssistant.remoteInterpret("hola", actions), null);
});

test("la API llama a /api/v1/assistant/interpret con tiempo límite corto", () => {
  const api = readFileSync("js/api.js", "utf8");
  assert.match(api, /interpret: \(text, context\) => http\.post\('\/assistant\/interpret', \{ text, context \}, \{ timeoutMs: 6000 \}\)/);
});

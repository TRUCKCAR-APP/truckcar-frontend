import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";

// Herramientas del Copiloto para el conductor: lugares cerca (con enfoque en ahorro), peajes con la tarifa de HERE y
// estado de la vía con la vigencia de cada reporte. Nunca inventa precios ni incidentes.

function load(files) {
  const w = new JSDOM("<!doctype html><body></body>", { runScripts: "outside-only" }).window;
  for (const file of files) w.eval(readFileSync(file, "utf8"));
  return w;
}

function controller(actions = {}) {
  const w = load(["js/services/voiceIntents.js", "js/services/voiceAssistant.js"]);
  const said = [];
  let listens = 0;
  const ctrl = w.VoiceAssistant.createController({
    say: async (text) => { said.push(text); },
    listen: () => { listens++; },
    actions,
    now: () => 1_000
  });
  return { w, ctrl, said, listens: () => listens };
}

const parse = (w, text) => JSON.parse(JSON.stringify(w.VoiceIntents.parse(text)));

test("las preguntas de lugares, peajes y estado de la vía se reconocen en el teléfono", () => {
  const w = load(["js/services/voiceIntents.js"]);
  const cases = [
    ["dónde tanqueo ACPM barato", "FIND_PLACES", { category: "fuel", cheap: true }],
    ["necesito un hotel económico cerca", "FIND_PLACES", { category: "hotel", cheap: true }],
    ["dónde parqueo la mula esta noche", "FIND_PLACES", { category: "truck_parking", cheap: false }],
    ["dónde como algo barato", "FIND_PLACES", { category: "restaurant", cheap: true }],
    ["hay un montallantas por aquí", "FIND_PLACES", { category: "workshop" }],
    ["llévame a una gasolinera", "FIND_PLACES", { category: "fuel" }],
    ["llévame al hotel Tequendama", "NAVIGATE", { place: "hotel tequendama" }],
    ["reporta un parqueadero seguro", "REPORT", { alertType: "rest" }],
    ["cuánto falta para el próximo peaje", "TOLLS"],
    ["cuánto cuesta el peaje", "TOLLS"],
    ["cuántos peajes me quedan", "TOLLS"],
    ["hay accidentes en la ruta", "NEARBY_ALERTS", { scope: "route" }],
    ["cómo está la vía", "NEARBY_ALERTS", { scope: "around" }],
    ["qué alertas hay cerca", "NEARBY_ALERTS", { scope: "around" }],
    ["hay un accidente adelante", "REPORT", { alertType: "danger" }]
  ];
  for (const [text, type, extra] of cases) {
    const intent = parse(w, text);
    assert.equal(intent.type, type, text);
    for (const [key, value] of Object.entries(extra || {})) assert.equal(intent[key], value, text + " → " + key);
  }
});

test("estación barata: busca cerca, lee las 3 más cercanas, dice que no tiene precios confirmados y lleva a la elegida", async () => {
  const searched = [];
  let went = null;
  const { ctrl, said } = controller({
    searchPlaces: async (q) => { searched.push(q); return [
      { title: "Terpel La Caro", distanceMeters: 5200 },
      { title: "Primax Autopista", distanceMeters: 1800 },
      { title: "Texaco 170", distanceMeters: 3100 },
      { title: "Biomax Lejos", distanceMeters: 9000 }]; },
    showPlaces: () => {},
    navigateTo: async (place) => { went = place; return { ok: true, remainingM: 1800, durationS: 300 }; }
  });
  await ctrl.handle("dónde tanqueo ACPM barato");
  assert.deepEqual(searched, ["estación de servicio"]);
  const offer = said.at(-1);
  assert.match(offer, /^Encontré 3 estaciones de servicio cerca\. Uno: Primax Autopista, a 1[.,]8 kilómetros\. Dos: Texaco 170/);
  assert.match(offer, /No tengo precios confirmados al día de hoy; compare el precio del galón de ACPM/);
  assert.doesNotMatch(offer, /\$|\d+\.\d{3} pesos/, "sin precios inventados");
  await ctrl.handle("la dos");
  assert.equal(went.title, "Texaco 170");
});

test("peajes: el próximo con su distancia y la tarifa de HERE para el camión, la hora de consulta y el total", async () => {
  const computedAt = new Date(2026, 10, 19, 15, 10).getTime();
  const { ctrl, said } = controller({
    tollsAhead: () => ({ status: "ok", computedAt, tolls: [
      { name: "Peaje Andes", cost: 59900, currency: "COP", aheadM: 12400 },
      { name: "Peaje Albarracín", cost: 61500, currency: "COP", aheadM: 88000 }] })
  });
  await ctrl.handle("cuánto falta para el próximo peaje");
  const text = said.at(-1);
  assert.match(text, /^El próximo peaje es Peaje Andes, a 12 kilómetros\./);
  assert.match(text, /Para su camión cuesta 59\.900 pesos, según la tarifa de HERE consultada a las 3:10 p\. m\. Quedan/);
  assert.match(text, /Quedan 2 peajes por 121\.400 pesos en total\./);
  assert.doesNotMatch(text, /\.\./, "sin puntos dobles");
  assert.match(text, /Confirme el valor en la taquilla\./);
});

test("peajes sin tarifa o sin ruta: lo dice con claridad, sin cifras", async () => {
  const noFare = controller({ tollsAhead: () => ({ status: "ok", computedAt: null, tolls: [{ name: "Peaje Siberia", cost: null, aheadM: 3000 }] }) });
  await noFare.ctrl.handle("cuánto cuesta el peaje");
  assert.match(noFare.said.at(-1), /No tengo confirmada la tarifa de ese peaje al día de hoy; verifíquela en la taquilla\./);
  const noRoute = controller({ tollsAhead: () => ({ status: "no-route" }) });
  await noRoute.ctrl.handle("cuántos peajes me quedan");
  assert.match(noRoute.said.at(-1), /No tiene una ruta activa/);
  const osrm = controller({ tollsAhead: () => ({ status: "no-data" }) });
  await osrm.ctrl.handle("cuántos peajes me quedan");
  assert.match(osrm.said.at(-1), /Esta ruta no trae los peajes/);
});

test("estado de la vía en la ruta: alertas con su distancia y hace cuánto se reportaron; sin reportes no inventa", async () => {
  const { ctrl, said } = controller({
    routeAlerts: () => [{ label: "accidente", distanceM: 8000, timeAgo: "Hace 20 min" }, { label: "derrumbe", distanceM: 41000 }],
    nearbyAlerts: () => []
  });
  await ctrl.handle("hay accidentes en la ruta");
  assert.match(said.at(-1), /^Hay 2 alertas en lo que falta de la ruta: accidente a 8 kilómetros, reportado hace 20 min; derrumbe a 41 kilómetros\./);
  await ctrl.handle("cómo está la vía");
  assert.equal(said.at(-1), "No hay accidentes, cierres ni alertas reportados cerca de su posición.");
});

test("la IA puede pedir estas herramientas; una categoría que la app no conoce no se ejecuta", () => {
  const w = load(["js/services/voiceIntents.js", "js/services/voiceAssistant.js"]);
  const from = (r) => JSON.parse(JSON.stringify(w.VoiceAssistant.fromAssistant(r, "texto")));
  assert.deepEqual(from({ intent: "FIND_PLACES", category: "truck_parking", cheap: true }),
    { type: "FIND_PLACES", text: "texto", fromAssistant: true, category: "truck_parking", cheap: true });
  assert.equal(w.VoiceAssistant.fromAssistant({ intent: "FIND_PLACES", category: "casino" }, "x"), null);
  assert.equal(from({ intent: "TOLLS" }).type, "TOLLS");
  assert.equal(from({ intent: "NEARBY_ALERTS", scope: "route" }).scope, "route");
});

test("la ruta de HERE conserva sus peajes y tollsAhead dice los que faltan con la distancia sobre la ruta", async () => {
  const w = new JSDOM("<!doctype html><body></body>", { runScripts: "outside-only", url: "http://localhost:5500/" }).window;
  for (const file of ["js/ui.js", "js/navigation.js"]) w.eval(readFileSync(file, "utf8"));
  const G = w.RouteGuidance;
  const geometry = Array.from({ length: 11 }, (_, i) => [4.70 + i * 0.01, -74.05]);
  const route = { key: "x", geometry, cumulative: geometry.map((_, i) => i * 1112), steps: [{ startM: 0 }], totalM: 11120, provider: "HERE",
    tolls: [{ name: "Peaje Andes", latitude: 4.75, longitude: -74.05, cost: 59900, currency: "COP" },
      { name: "Peaje Atrás", latitude: 4.701, longitude: -74.05, cost: 1000, currency: "COP" }], computedAt: 5 };
  assert.equal(G.tollsAhead().status, "no-route", "sin ruta activa");
  assert.match(readFileSync("js/navigation.js", "utf8"), /tolls: \(Array\.isArray\(option\.tolls\)/, "fromHere toma los peajes de Route-AI");
  assert.match(readFileSync("js/routeStore.js", "utf8"), /tolls: plain\(route\.tolls \|\| \[\]\)/, "la ruta guardada sin señal conserva los peajes");
  // project() da la distancia sobre la ruta: Peaje Andes a ~5,5 km del inicio.
  assert.ok(Math.abs(G.project(route.geometry, route.cumulative, [4.75, -74.05]).alongM - 5560) < 50);
});

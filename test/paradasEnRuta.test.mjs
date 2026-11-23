import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";

// Paradas por voz: «quiero comer», «necesito descansar»… El Copiloto propone lugares sobre la ruta (sin devolverse y
// con desvío máximo de 5 km, validados por el motor de rutas del camión), el elegido queda como parada antes del
// destino y la guía sigue sola después. Nunca se abandona la carga por elegir un lugar.

// ── 1. Frases ──────────────────────────────────────────────────────────────────────────────────────────────────

function intents() {
  const w = new JSDOM("<!doctype html><body></body>", { runScripts: "outside-only" }).window;
  w.eval(readFileSync("js/services/voiceIntents.js", "utf8"));
  return w;
}

test("lo que dice el conductor para parar, con la jerga de carretera, se entiende sin depender del servidor", () => {
  const w = intents();
  const cases = [
    ["quiero descansar", "FIND_PLACES", { category: "rest" }],
    ["necesito parar", "FIND_PLACES", { category: "rest" }],
    ["paremos un rato", "FIND_PLACES", { category: "rest" }],
    ["hagamos una parada", "FIND_PLACES", { category: "rest" }],
    ["quiero estirar las piernas", "FIND_PLACES", { category: "rest" }],
    ["tengo sueño", "FIND_PLACES", { category: "rest", fatigue: true }],
    ["estoy mamado", "FIND_PLACES", { category: "rest", fatigue: true }],
    ["me estoy quedando dormido", "FIND_PLACES", { category: "rest", fatigue: true }],
    ["quiero dormir un rato", "FIND_PLACES", { category: "rest" }],
    ["tengo hambre", "FIND_PLACES", { category: "restaurant" }],
    ["quiero comer", "FIND_PLACES", { category: "restaurant" }],
    ["parar a comer", "FIND_PLACES", { category: "restaurant" }],
    ["vamos a almorzar", "FIND_PLACES", { category: "restaurant" }],
    ["un corrientazo", "FIND_PLACES", { category: "restaurant", cheap: true }],
    ["me tomo un tinto", "FIND_PLACES", { category: "coffee" }],
    ["dónde puedo dormir", "FIND_PLACES", { category: "hotel" }],
    ["un hotel para descansar", "FIND_PLACES", { category: "hotel" }],
    ["necesito ir al baño", "FIND_PLACES", { category: "toilet" }],
    ["me estoy orinando", "FIND_PLACES", { category: "toilet" }],
    ["estoy en reserva", "FIND_PLACES", { category: "fuel" }],
    ["hay que echar ACPM", "FIND_PLACES", { category: "fuel" }],
    ["dónde dejo la mula esta noche", "FIND_PLACES", { category: "truck_parking" }],
    ["se me pinchó una llanta", "FIND_PLACES", { category: "workshop" }],
    ["necesito sacar plata", "FIND_PLACES", { category: "atm" }],
    ["una droguería", "FIND_PLACES", { category: "pharmacy" }],
    ["llévame a un restaurante barato por aquí", "FIND_PLACES", { category: "restaurant", cheap: true }],
    // Lo que NO es pedir una parada:
    ["llévame al hotel Tequendama", "NAVIGATE", { place: "hotel tequendama" }],
    ["cuándo debo descansar", "HOURS"],
    ["cuánto me falta para descansar", "HOURS"],
    ["reporta un parador seguro", "REPORT", { alertType: "rest" }],
    // Manejar la parada:
    ["quita la parada", "STOP_REMOVE"],
    ["ya no quiero parar", "STOP_REMOVE"],
    ["mejor no paremos", "STOP_REMOVE"],
    ["sigamos derecho", "STOP_REMOVE"],
    ["cuánto falta para la parada", "STOP_INFO"],
    ["dónde queda la parada", "STOP_INFO"],
    ["seguimos", "RESUME_TRIP"],
    ["listo sigamos", "RESUME_TRIP"],
    ["ya comí", "RESUME_TRIP"],
    ["ya llegué", "CONFIRM_DELIVERY", { arrivedOnly: true }],
    ["confirma la entrega", "CONFIRM_DELIVERY"]
  ];
  for (const [text, type, extra] of cases) {
    const intent = JSON.parse(JSON.stringify(w.VoiceIntents.parse(text)));
    assert.equal(intent.type, type, text);
    for (const [key, value] of Object.entries(extra || {})) assert.equal(intent[key], value, text + " → " + key);
  }
  assert.equal(w.VoiceIntents.parse("confirma la entrega").arrivedOnly, undefined, "entregar no es llegar a la parada");
});

test("se elige por número, por «la más cercana», por «la que menos me desvíe» o por el nombre", () => {
  const w = intents();
  const options = [
    { title: "Parador El Camionero", detourSeconds: 300 },
    { title: "Terpel La Caro", detourSeconds: 40 },
    { title: "Asadero Doña Rosa", detourSeconds: 120 }];
  const pick = (text) => w.VoiceIntents.parseChoice(text, 3, options);
  assert.equal(pick("la dos"), 1);
  assert.equal(pick("la más cercana"), 0);
  assert.equal(pick("la que menos me desvíe"), 1);
  assert.equal(pick("la de Terpel"), 1);
  assert.equal(pick("vamos al asadero de doña Rosa"), 2);
  assert.equal(pick("el camionero"), 0);
  assert.equal(pick("cualquier cosa"), null);
  assert.equal(w.VoiceIntents.parseAnswer("ninguna"), "no");
});

// ── 2. Lo que responde el Copiloto ─────────────────────────────────────────────────────────────────────────────

const STOPS = [
  { title: "Asadero La Vía", latitude: 4.65, longitude: -74.0, distanceMeters: 5600, secondsToStop: 420, detourMeters: 100, detourSeconds: 20 },
  { title: "Comidas El Peaje", latitude: 4.69, longitude: -74.0, distanceMeters: 22300, secondsToStop: 1500, detourMeters: 600, detourSeconds: 240, openNow: true },
  { title: "Restaurante Las Ollitas", latitude: 4.70, longitude: -74.0, distanceMeters: 30000, secondsToStop: 2000, detourMeters: 900, detourSeconds: 300, openNow: false }];

function copilot(actions = {}, { route = true } = {}) {
  const w = new JSDOM("<!doctype html><body></body>", { runScripts: "outside-only" }).window;
  for (const file of ["js/services/voiceIntents.js", "js/services/voiceAssistant.js"]) w.eval(readFileSync(file, "utf8"));
  const said = [];
  const calls = { added: [], navigated: [], searched: [], places: [] };
  let stop = null;
  const ctrl = w.VoiceAssistant.createController({
    say: async (text) => { said.push(text); },
    listen: () => {},
    now: () => 1_000,
    actions: {
      hasRoute: () => route,
      routeKind: () => (route ? "load" : null),
      destinationLabel: () => "Medellín",
      instruction: () => "En 300 m, gire a la derecha",
      searchStops: async (category) => { calls.searched.push(category); return { status: "ok", stops: STOPS }; },
      searchPlaces: async (q) => { calls.places.push(q); return [{ title: "Estación Cerca", latitude: 4.6, longitude: -74.0, distanceMeters: 800 }]; },
      showPlaces: () => {},
      addStop: async (place) => {
        calls.added.push(place);
        stop = { title: place.title, reached: false };
        return { ok: true, title: place.title, replaced: null, toStopM: place.distanceMeters, toStopS: place.secondsToStop,
          extraM: place.detourMeters, extraS: place.detourSeconds, remainingM: 90000, durationS: 6000, restricted: false };
      },
      navigateTo: async (place) => { calls.navigated.push(place); return { ok: true, remainingM: 800, durationS: 120 }; },
      stopInfo: () => (stop ? { ...stop, toStopM: 5600, toStopS: 420 } : null),
      markStopReached: () => { stop.reached = true; return { ok: true, title: stop.title }; },
      resumeAfterStop: () => {
        if (!stop) return { ok: false, reason: "no-stop" };
        if (!stop.reached) return { ok: false, reason: "not-there", title: stop.title, toStopM: 5600 };
        const title = stop.title; stop = null;
        return { ok: true, title, remainingM: 84000, durationS: 5400 };
      },
      removeStop: async () => {
        if (!stop) return { ok: false, reason: "no-stop" };
        const title = stop.title; stop = null;
        return { ok: true, title, rerouted: true };
      },
      currentLoad: () => ({ id: "C-1", destination: { name: "Medellín" } }),
      loadActions: () => ({ deliver: true, navigate: true }),
      openDelivery: () => { calls.delivery = true; },
      ...actions
    }
  });
  return { ctrl, said, calls, setStop: (s) => { stop = s; } };
}

test("«quiero comer» con ruta: 3 lugares sobre la ruta con distancia y desvío; el elegido queda como parada", async () => {
  const { ctrl, said, calls } = copilot();
  await ctrl.handle("quiero comer");
  assert.deepEqual(calls.searched, ["restaurant"]);
  const offer = said.at(-1);
  assert.match(offer, /^Sobre la ruta encontré 3 restaurantes\. Uno: Asadero La Vía, a 5[.,]6 kilómetros, casi sin desvío\./);
  assert.match(offer, /Dos: Comidas El Peaje, a 22 kilómetros, le suma 4 minutos\./);
  assert.match(offer, /Tres: Restaurante Las Ollitas, a 30 kilómetros, le suma 5 minutos, aparece cerrado ahora\./);
  assert.match(offer, /¿Cuál agrego como parada\? Diga el número\.$/);
  await ctrl.handle("la dos");
  assert.equal(calls.added[0].title, "Comidas El Peaje");
  assert.equal(calls.navigated.length, 0, "no se abandona la ruta de la carga");
  assert.equal(said.at(-1), "Listo, parada en Comidas El Peaje, a 22 kilómetros, unos 25 minutos. Le suma 4 minutos al viaje. "
    + "Después de la parada sigo hacia Medellín.");
});

test("también se elige diciendo el nombre o «la que menos me desvíe»", async () => {
  const byName = copilot();
  await byName.ctrl.handle("tengo hambre");
  await byName.ctrl.handle("la del peaje");
  assert.equal(byName.calls.added[0].title, "Comidas El Peaje");
  const fastest = copilot();
  await fastest.ctrl.handle("tengo hambre");
  await fastest.ctrl.handle("la que menos me desvíe");
  assert.equal(fastest.calls.added[0].title, "Asadero La Vía");
});

test("sin nada sobre la ruta lo dice con los límites claros; con cansancio pide parar primero", async () => {
  const none = copilot({ searchStops: async () => ({ status: "ok", stops: [] }) });
  await none.ctrl.handle("quiero comer");
  assert.equal(none.said.at(-1), "No encontré restaurantes en los próximos 60 kilómetros de la ruta sin desviarse más de 5 kilómetros.");
  const tired = copilot();
  await tired.ctrl.handle("tengo sueño");
  assert.deepEqual(tired.calls.searched, ["rest"]);
  assert.match(tired.said.at(-1), /^Por su seguridad, pare apenas pueda en un sitio seguro\. Sobre la ruta encontré 3 sitios para descansar\./);
});

test("si la búsqueda en la ruta falla, ofrece lo cercano y aun así lo agrega como parada", async () => {
  const { ctrl, said, calls } = copilot({ searchStops: async () => { throw new Error("503"); } });
  await ctrl.handle("dónde tanqueo");
  assert.equal(said[0], "No pude revisar la ruta en este momento; le digo lo que hay cerca de su posición.");
  assert.deepEqual(calls.places, ["estación de servicio"]);
  assert.match(said.at(-1), /¿Lo agrego como parada antes de su destino\?|¿Lo agrego como parada\?/);
  await ctrl.handle("sí");
  assert.equal(calls.added[0].title, "Estación Cerca");
});

test("sin ruta activa, busca cerca y lleva al lugar como antes", async () => {
  const { ctrl, calls } = copilot({}, { route: false });
  await ctrl.handle("dónde tanqueo");
  assert.deepEqual(calls.searched, []);
  await ctrl.handle("sí");
  assert.equal(calls.navigated[0].title, "Estación Cerca");
  assert.equal(calls.added.length, 0);
});

test("con una carga en curso, «llévame a…» un lugar por nombre también es una parada", async () => {
  const { ctrl, said, calls } = copilot({ searchPlaces: async () => [{ title: "Hotel Tequendama", latitude: 4.61, longitude: -74.07, distanceMeters: 3000 }] });
  await ctrl.handle("llévame al hotel Tequendama");
  assert.match(said.at(-1), /¿Lo agrego como parada antes de su destino\? Diga sí o cancelar\./);
  await ctrl.handle("sí");
  assert.equal(calls.added[0].title, "Hotel Tequendama");
  assert.equal(calls.navigated.length, 0);
});

test("«ya llegué» con parada pendiente es llegar a la parada, no entregar la carga; «seguimos» continúa", async () => {
  const { ctrl, said, calls, setStop } = copilot();
  setStop({ title: "Asadero La Vía", reached: false });
  await ctrl.handle("seguimos");
  assert.match(said.at(-1), /^Todavía no llega a la parada Asadero La Vía; faltan 5[.,]6 kilómetros\. Si ya no quiere parar, diga «quita la parada»\.$/);
  await ctrl.handle("ya llegué");
  assert.equal(said.at(-1), "Listo, está en su parada: Asadero La Vía. Cuando quiera seguir, diga «seguimos»; la ruta continúa al destino.");
  assert.equal(calls.delivery, undefined, "no abre la entrega");
  await ctrl.handle("cuánto falta para la parada");
  assert.equal(said.at(-1), "Ya está en su parada: Asadero La Vía. Cuando quiera seguir, diga «seguimos».");
  await ctrl.handle("vámonos");
  assert.equal(said.at(-1), "Seguimos hacia Medellín: faltan 84 kilómetros, unos 1 hora y 30 minutos.");
  // Sin parada, «ya llegué» vuelve a ser la entrega (con confirmación).
  await ctrl.handle("ya llegué");
  assert.match(said.at(-1), /^¿Confirma que desea registrar la entrega de la carga\?/);
});

test("«quita la parada» recalcula directo al destino; sin parada lo dice", async () => {
  const { ctrl, said, setStop } = copilot();
  await ctrl.handle("quita la parada");
  assert.equal(said.at(-1), "No tiene ninguna parada en la ruta.");
  setStop({ title: "Asadero La Vía", reached: false });
  await ctrl.handle("cuánto falta para la parada");
  assert.equal(said.at(-1), "Su parada es Asadero La Vía: faltan 5,6 kilómetros, unos 7 minutos.");
  await ctrl.handle("ya no quiero parar");
  assert.equal(said.at(-1), "Listo, quité la parada en Asadero La Vía. Sigo directo al destino.");
});

test("la IA también puede pedir estas acciones; una categoría desconocida no se ejecuta", () => {
  const w = new JSDOM("<!doctype html><body></body>", { runScripts: "outside-only" }).window;
  for (const file of ["js/services/voiceIntents.js", "js/services/voiceAssistant.js"]) w.eval(readFileSync(file, "utf8"));
  const from = (r) => w.VoiceAssistant.fromAssistant(r, "texto");
  assert.equal(from({ intent: "FIND_PLACES", category: "rest", fatigue: true }).fatigue, true);
  assert.equal(from({ intent: "FIND_PLACES", category: "toilet" }).category, "toilet");
  assert.equal(from({ intent: "STOP_REMOVE" }).type, "STOP_REMOVE");
  assert.equal(from({ intent: "RESUME_TRIP" }).type, "RESUME_TRIP");
  assert.equal(from({ intent: "FIND_PLACES", category: "casino" }), null);
});

// ── 3. La guía con la parada ───────────────────────────────────────────────────────────────────────────────────

// Ruta recta hacia el norte: de (4,60; -74,00) a (4,70; -74,00), unos 11 km.
const LINE = Array.from({ length: 11 }, (_, i) => [4.60 + i * 0.01, -74.0]);
const OSRM = { routes: [{ duration: 900, geometry: { coordinates: LINE.map(([lat, lng]) => [lng, lat]) },
  legs: [{ steps: [
    { distance: 11120, name: "Autopista Norte", ref: "", maneuver: { type: "depart", location: [-74.0, 4.6] } },
    { distance: 0, name: "", ref: "", maneuver: { type: "arrive", location: [-74.0, 4.7] } }] }] }] };
const HERE_OPTION = { distanceMeters: 11220, durationSeconds: 920, geometry: LINE, violations: [], tolls: [], steps: [
  { action: "depart", instruction: "Siga por Autopista Norte", distanceMeters: 5560, durationSeconds: 460, latitude: 4.6, longitude: -74.0 },
  { action: "arrive", instruction: "Llegó a su parada", distanceMeters: 0, durationSeconds: 0, latitude: 4.65, longitude: -74.0 },
  { action: "depart", instruction: "Siga por Autopista Norte", distanceMeters: 5560, durationSeconds: 460, latitude: 4.65, longitude: -74.0 },
  { action: "arrive", instruction: "Llegó a su destino", distanceMeters: 0, durationSeconds: 0, latitude: 4.7, longitude: -74.0 }] };
const LOAD = { backendId: 30, status: "IN_TRANSIT", origin: { coords: [4.6, -74.0] }, destination: { coords: [4.7, -74.0] } };

function guidance() {
  const w = new JSDOM(`<!doctype html><html><body><div data-nav-stop hidden><span data-nav-stop-text></span><span data-nav-stop-sub></span></div></body></html>`,
    { runScripts: "outside-only", pretendToBeVisual: true, url: "http://localhost:5500/" }).window;
  const spoken = [];
  const reroutes = [];
  const stopRequests = [];
  const markers = [];
  let clock = Date.now();
  w.fetch = async () => ({ ok: true, json: async () => OSRM });
  w.eval(readFileSync("js/ui.js", "utf8"));
  w.voiceEngine = { speak: (text) => spoken.push(text) };
  w.TruckCarData = { routes: null, currentDriver: { vehicle: { plate: "TDK-410", height: 4.2, grossWeight: 32, category: "TRACTOMULA_3S3" } } };
  w.TruckCarConfig = { gatewayUrl: "http://localhost:8000", apiBaseUrl: "http://localhost:8000/api/v1", requestTimeoutMs: 5000,
    routingUrl: "https://router.project-osrm.org/route/v1/driving/", storageKeys: { session: "truckcar.session" } };
  w.eval(readFileSync("js/api.js", "utf8"));
  w.TruckCarApi = { routing: w.TruckCarApi.routing,
    restrictions: { validateRoute: async () => ({ passable: true, restrictionsEvaluated: 0, blocking: [], warnings: [] }) },
    routes: {
      reroute: async (request) => { reroutes.push(request); return { provider: "HERE", routes: [HERE_OPTION] }; },
      stops: async (request) => { stopRequests.push(request); return { stops: STOPS, sources: ["HERE", "OSM"] }; }
    } };
  w.mapCtrl = { showStopMarker: (stop) => markers.push(stop) };
  w.eval(readFileSync("js/navigation.js", "utf8"));
  w.Date.now = () => clock;
  return { w, g: w.RouteGuidance, spoken, reroutes, stopRequests, markers, advance: (ms) => { clock += ms; } };
}

test("la búsqueda manda solo lo que falta de la ruta, el destino real, el camión y los límites (60 km, 5 km)", async () => {
  const { g, stopRequests } = guidance();
  await g.prepare(LOAD);
  g.update({ coords: [4.63, -74.0] });
  const result = await g.searchStops("restaurant");
  assert.equal(result.status, "ok");
  assert.equal(result.stops.length, 3);
  const req = stopRequests[0];
  assert.equal(req.category, "restaurant");
  assert.deepEqual([req.latitude, req.longitude], [4.63, -74.0]);
  assert.ok(Math.abs(req.destinationLatitude - 4.7) < 1e-9 && req.destinationLongitude === -74.0);
  assert.ok(req.ahead.every(([lat]) => lat >= 4.63), "nada de lo que quedó atrás");
  assert.equal(req.maxDetourMeters, 5000);
  assert.equal(req.aheadMeters, 60000);
  assert.equal(req.heightMeters, 4.2);
  assert.equal(req.truckType, "TRACTOMULA_3S3");
});

test("agregar la parada recalcula aquí → parada → destino para el camión, sin perder el destino de la carga", async () => {
  const { g, reroutes, markers, w } = guidance();
  await g.prepare(LOAD);
  g.update({ coords: [4.60, -74.0] });
  const added = await g.addStop(STOPS[0]);
  assert.equal(added.ok, true);
  assert.equal(added.title, "Asadero La Vía");
  assert.ok(Math.abs(added.toStopM - 5560) < 60, "a ~5,6 km por la ruta");
  assert.equal(added.extraS, 20, "lo que suma lo da la búsqueda (HERE con el camión)");
  const req = reroutes.at(-1);
  assert.deepEqual(JSON.parse(JSON.stringify(req.via)), [{ latitude: 4.65, longitude: -74.0 }]);
  assert.ok(Math.abs(req.destinationLatitude - 4.7) < 1e-9 && req.destinationLongitude === -74.0);
  assert.deepEqual(JSON.parse(JSON.stringify(markers.at(-1).coords)), [4.65, -74.0]);
  assert.equal(g.snapshot().stop.title, "Asadero La Vía");
  g.renderHud();
  assert.equal(w.document.querySelector("[data-nav-stop]").hidden, false);
  assert.equal(w.document.querySelector("[data-nav-stop-text]").textContent, "Parada: Asadero La Vía");

  // Fuera de ruta antes de la parada: el recálculo sigue pasando por ella.
  g.update({ coords: [4.61, -73.99] });
  await new Promise((r) => setTimeout(r, 20));
  const stopInfo = g.stopInfo();
  assert.equal(stopInfo.title, "Asadero La Vía");
});

test("al llegar se anuncia; al salir de la parada la guía sigue sola al destino", async () => {
  const { g, spoken, advance, markers } = guidance();
  await g.prepare(LOAD);
  g.update({ coords: [4.60, -74.0] });
  await g.addStop(STOPS[0]);
  advance(20000);
  g.update({ coords: [4.6497, -74.0] });
  assert.match(spoken.at(-1), /^Llegó a su parada: Asadero La Vía\. Cuando quiera seguir, diga «seguimos» o arranque/);
  assert.equal(g.stopInfo().reached, true);
  assert.equal(markers.at(-1), null, "el pin se quita al llegar");
  g.update({ coords: [4.656, -74.0] });
  assert.equal(spoken.at(-1), "Seguimos hacia el destino.");
  assert.equal(g.stopInfo(), null);
  assert.equal(g.remaining().remainingM < 5000, true, "la ruta ya continuaba al destino");
});

test("si pasa de largo sin parar, la parada se suelta y no lo hace devolverse", async () => {
  const { g, spoken, reroutes } = guidance();
  await g.prepare(LOAD);
  g.update({ coords: [4.60, -74.0] });
  await g.addStop(STOPS[0]);
  const before = reroutes.length;
  g.update({ coords: [4.66, -74.0] });
  assert.equal(spoken.at(-1), "Dejó atrás la parada Asadero La Vía. Sigo hacia el destino.");
  assert.equal(g.stopInfo(), null);
  assert.equal(reroutes.length, before, "no recalcula para volver");
});

test("quitar la parada antes de llegar recalcula directo; «seguimos» antes de llegar no la suelta", async () => {
  const { g, reroutes } = guidance();
  await g.prepare(LOAD);
  g.update({ coords: [4.60, -74.0] });
  await g.addStop(STOPS[0]);
  assert.equal(g.resumeAfterStop().reason, "not-there");
  const removed = await g.removeStop();
  assert.equal(removed.ok, true);
  assert.equal(removed.rerouted, true);
  assert.equal(reroutes.at(-1).via, undefined, "sin parada");
  assert.ok(Math.abs(reroutes.at(-1).destinationLatitude - 4.7) < 1e-9);
  assert.equal(g.stopInfo(), null);
  assert.equal((await g.removeStop()).reason, "no-stop");
});

test("elegir otra parada cambia la anterior (una sola parada a la vez)", async () => {
  const { g } = guidance();
  await g.prepare(LOAD);
  g.update({ coords: [4.60, -74.0] });
  await g.addStop(STOPS[0]);
  const second = await g.addStop(STOPS[1]);
  assert.equal(second.replaced, "Asadero La Vía");
  assert.equal(g.stopInfo().title, "Comidas El Peaje");
});

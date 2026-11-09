// Fase 1: un bloqueo que la IA detecta en una alerta (route-ai-agent → fleets-drivers → /topic/road-blockages) se
// anuncia en el HUD y en voz, y la guía se desvía de inmediato validando el desvío contra gálibo y peso.
// Fase 2: la ruta del viaje queda en IndexedDB y la guía se restaura sin señal, con los avisos a 3 km y, fuera de
// ruta, los de las restricciones vecinas del corredor ampliado.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";
import { IDBFactory, IDBKeyRange } from "fake-indexeddb";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const step = (lng, lat, type = "depart", name = "Vía") => ({ distance: 1000, name, ref: "", maneuver: { type, location: [lng, lat] } });
const ROUTE = (via, distance) => ({
  distance, duration: distance / 15,
  geometry: { coordinates: [[-74.0, 4.6], via, [-73.99, 4.61]] },
  legs: [{ steps: [step(-74.0, 4.6), step(via[0], via[1], "turn"), step(-73.99, 4.61, "arrive")] }]
});
// La principal sube por la Calle 13 (lng -74.0) hasta 4.61; la alterna corta en diagonal por 4.605,-73.995.
const PRINCIPAL = ROUTE([-74.0, 4.61], 2200);
const ALTERNA = ROUTE([-73.995, 4.605], 2600);
const LOAD = { backendId: 30, status: "IN_TRANSIT", raw: { id: 30, status: "IN_TRANSIT", originCity: "Bogotá" },
  origin: { coords: [4.6, -74.0] }, destination: { coords: [4.61, -73.99] } };
const DRIVER = { id: "driver-ana", vehicle: { plate: "TDK-410", height: 4.1, grossWeight: 40 } };
// Derrumbe sobre la Calle 13, a ~550 m del inicio: está sobre la principal y lejos de la alterna.
const BLOCKAGE = { eventId: "e-1", alertId: 21, latitude: 4.605, longitude: -74.0, alertType: "DERRUMBE",
  description: "Derrumbe tapa la vía en el km 40", confidence: 0.9, source: "AZURE_OPENAI" };
const BRIDGE = { kind: "GALIBO_ALTURA", alongRouteMeters: 1100, distanceFromRouteMeters: 5,
  restriction: { id: 7, title: "Puente", maxClearanceMeters: 3.8, latitude: 4.61, longitude: -74.0 } };
// Puente bajo del corredor ampliado (a ~330 m al occidente de la Calle 13): solo sale con corridorMeters=500.
const NEARBY_BRIDGE = { kind: "GALIBO_ALTURA", alongRouteMeters: 500, distanceFromRouteMeters: 330,
  restriction: { id: 9, title: "Puente bajo", maxClearanceMeters: 3.5, latitude: 4.6045, longitude: -74.003 } };

/** routesFor(url) → rutas de OSRM; offline: fetch falla como sin señal. */
function browser({ idb = new IDBFactory(), routesFor = () => [PRINCIPAL, ALTERNA], offline = false,
  validate = () => ({ blocking: [], warnings: [] }) } = {}) {
  const dom = new JSDOM(`<!doctype html><body>
      <div data-nav-ai-alert hidden><span data-nav-ai-alert-text></span><span data-nav-ai-alert-sub></span></div>
      <div data-nav-clearance hidden><span data-nav-clearance-text></span><span data-nav-clearance-sub></span></div>
    </body>`, { runScripts: "outside-only", url: "http://localhost:5500/" });
  const w = dom.window;
  w.indexedDB = idb;
  w.IDBKeyRange = IDBKeyRange;
  const fetches = [];
  const spoken = [];
  const validated = [];
  let chimes = 0;
  w.fetch = async (url) => {
    fetches.push(String(url));
    if (offline) throw new TypeError("Failed to fetch");
    return { ok: true, json: async () => ({ routes: routesFor(String(url)) }) };
  };
  w.voiceEngine = { speak: (text) => spoken.push(text), alert: () => { chimes++; } };
  w.mapCtrl = { drawGuidanceLine() {} };
  w.TruckCarData = { currentDriver: DRIVER };
  w.TruckCarApi = { restrictions: { validateRoute: async (request) => { validated.push(request); return validate(request); } } };
  ["js/routeStore.js", "js/navigation.js"].forEach((file) => w.eval(readFileSync(file, "utf8")));
  const hud = (name) => ({
    hidden: w.document.querySelector(`[data-nav-${name}]`).hidden,
    text: w.document.querySelector(`[data-nav-${name}-text]`).textContent,
    sub: w.document.querySelector(`[data-nav-${name}-sub]`).textContent
  });
  return { w, idb, fetches, spoken, validated, hud, chimes: () => chimes };
}
const via = (w) => JSON.stringify(w.RouteGuidance.route.geometry[1]);

test("un bloqueo de la IA sobre lo que falta de ruta se anuncia y la guía se desvía de inmediato", async () => {
  const { w, spoken, hud, chimes, fetches, validated } = browser();
  await w.RouteGuidance.prepare(LOAD);
  w.RouteGuidance.update({ coords: [4.6, -74.0] });
  assert.equal(via(w), "[4.61,-74]", "sin bloqueos, la principal");
  const before = fetches.length;

  const affected = await w.RouteGuidance.handleBlockage(BLOCKAGE);

  assert.equal(affected, true);
  assert.equal(chimes(), 1, "suena el tono de alerta");
  assert.ok(spoken.includes("Alerta en ruta procesada por IA: Derrumbe tapa la vía en el km 40. Recalculando trayectoria..."));
  assert.ok(fetches.length > before, "recalcula sin esperar el enfriamiento de 30 s del fuera de ruta");
  assert.equal(via(w), "[4.605,-73.995]", "el desvío no pasa por el derrumbe");
  assert.ok(validated.at(-1).path.some((p) => p[1] === -73.995), "el desvío se valida contra gálibo y peso");
  const alert = hud("ai-alert");
  assert.equal(alert.hidden, false);
  assert.equal(alert.text, "Alerta en ruta procesada por IA: Derrumbe tapa la vía en el km 40.");
  assert.equal(alert.sub, "· desvío calculado sin restricciones de gálibo ni peso");
  assert.equal(w.RouteGuidance.avoidPoints.length, 1);

  assert.equal(await w.RouteGuidance.handleBlockage(BLOCKAGE), false, "el mismo evento no se procesa dos veces");
});

test("un bloqueo lejos de la ruta o ya superado no interrumpe la guía", async () => {
  const { w, spoken, hud, fetches } = browser();
  await w.RouteGuidance.prepare(LOAD);
  w.RouteGuidance.update({ coords: [4.609, -74.0] });   // ya pasó el km 0,5 de la Calle 13
  const before = fetches.length;

  assert.equal(await w.RouteGuidance.handleBlockage({ ...BLOCKAGE, eventId: "lejos", latitude: 4.7, longitude: -74.2 }), false);
  assert.equal(await w.RouteGuidance.handleBlockage({ ...BLOCKAGE, eventId: "atras" }), false);
  assert.equal(await w.RouteGuidance.handleBlockage({ eventId: "sin-posicion", description: "x" }), false);

  assert.equal(fetches.length, before);
  assert.ok(!spoken.some((t) => /procesada por IA/.test(t)));
  assert.equal(hud("ai-alert").hidden, true);
});

test("si ninguna ruta evita el bloqueo, lo dice y conserva la guía actual", async () => {
  const { w, spoken, hud } = browser({ routesFor: () => [PRINCIPAL] });
  await w.RouteGuidance.prepare(LOAD);
  w.RouteGuidance.update({ coords: [4.6, -74.0] });

  await w.RouteGuidance.handleBlockage(BLOCKAGE);

  assert.equal(via(w), "[4.61,-74]");
  assert.equal(hud("ai-alert").sub, "· no hay un desvío que evite el bloqueo: avance con precaución");
  assert.ok(spoken.includes("No se encontró un desvío que evite el bloqueo. Avance con precaución."));
});

test("la ruta queda guardada y, al reabrir sin señal, la guía sigue con el aviso del gálibo a 3 km", async () => {
  const validate = (request) => request.corridorMeters === 500
    ? { blocking: [BRIDGE, NEARBY_BRIDGE], warnings: [] }
    : { blocking: [BRIDGE], warnings: [] };
  const online = browser({ routesFor: () => [PRINCIPAL], validate });
  await online.w.RouteGuidance.prepare(LOAD);
  await sleep(50);   // guardado y restricciones vecinas en segundo plano
  assert.equal(online.validated.at(-1).corridorMeters, 500, "pide las restricciones del corredor ampliado");

  const saved = await online.w.RouteStore.latest("driver-ana");
  assert.equal(saved.loadId, 30);
  assert.equal(saved.load.status, "IN_TRANSIT", "guarda la carga para reabrir el viaje sin /loads/mine");
  assert.equal(saved.driver.vehicle.plate, "TDK-410");
  assert.equal(saved.clearance.items[0].text, "Gálibo de 3,80 m");
  assert.equal(saved.nearby.length, 2);

  // Misma IndexedDB, app recargada y sin red.
  const offline = browser({ idb: online.idb, offline: true, validate });
  await offline.w.RouteGuidance.prepare(LOAD);
  const s = offline.w.RouteGuidance.snapshot();
  assert.equal(s.status, "ready");
  assert.equal(s.restored, true);
  assert.equal(s.source, "guardada");
  assert.equal(s.stepCount, 3, "las maniobras guardadas (salida, giro y llegada)");

  offline.w.RouteGuidance.update({ coords: [4.6, -74.0] });
  assert.ok(offline.spoken.some((t) => /^Atención: En 1,1 kilómetros, gálibo de 3,80 metros; su vehículo mide 4,10\.$/.test(t)),
    offline.spoken.join(" | "));
  assert.match(offline.hud("clearance").text, /Gálibo de 3,80 m en 1,1 km/);
  assert.equal(offline.w.RouteGuidance.hudText(offline.w.RouteGuidance.snapshot()).street,
    "Sin señal: guía con la ruta guardada en el teléfono");
});

test("fuera de ruta y sin señal, avisa de los puentes bajos cercanos del corredor guardado", async () => {
  const validate = (request) => request.corridorMeters === 500
    ? { blocking: [NEARBY_BRIDGE], warnings: [] }
    : { blocking: [], warnings: [] };
  const online = browser({ routesFor: () => [PRINCIPAL], validate });
  await online.w.RouteGuidance.prepare(LOAD);
  await sleep(50);

  const offline = browser({ idb: online.idb, offline: true, validate });
  await offline.w.RouteGuidance.prepare(LOAD);
  // ~440 m al occidente de la Calle 13 (fuera de ruta) y a ~150 m del puente bajo.
  offline.w.RouteGuidance.update({ coords: [4.6045, -74.004] });

  assert.equal(offline.w.RouteGuidance.snapshot().offRoute, true);
  assert.ok(offline.spoken.some((t) => /^Atención, fuera de ruta: gálibo de 3,50 metros; su vehículo mide 4,10, a 100 metros de su posición\.$/.test(t)),
    offline.spoken.join(" | "));
  const clearance = offline.hud("clearance");
  assert.equal(clearance.hidden, false);
  assert.match(clearance.text, /^Gálibo de 3,50 m a \d+ m$/);
  assert.match(clearance.sub, /\(cerca de su posición\)/);
});

test("al entregar, la ruta guardada se borra del dispositivo", async () => {
  const { w } = browser({ routesFor: () => [PRINCIPAL] });
  await w.RouteGuidance.prepare(LOAD);
  await sleep(50);
  assert.ok(await w.RouteStore.load(30));

  await w.RouteGuidance.forget(30);

  assert.equal(await w.RouteStore.load(30), null);
  assert.equal(await w.RouteStore.latest("driver-ana"), null);
  assert.equal(w.RouteGuidance.route, null);
});

test("una ruta guardada hace más de 3 días no se restaura", async () => {
  const { w } = browser({ routesFor: () => [PRINCIPAL] });
  await w.RouteGuidance.prepare(LOAD);
  await sleep(50);
  const later = Date.now() + w.RouteStore.MAX_AGE_MS + 1000;
  assert.equal(await w.RouteStore.load(30, later), null);
  assert.equal(await w.RouteStore.latest("driver-ana", later), null);
});

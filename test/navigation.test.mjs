import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const OSRM = {
  routes: [{
    duration: 240,
    geometry: { coordinates: [[-74.0, 4.6], [-74.0, 4.61], [-73.99, 4.61]] },
    legs: [{ steps: [
      { distance: 1112, name: "Calle 13", ref: "", maneuver: { type: "depart", location: [-74.0, 4.6] } },
      { distance: 1109, name: "Avenida Boyacá", ref: "", maneuver: { type: "turn", modifier: "right", location: [-74.0, 4.61] } },
      { distance: 0, name: "", ref: "", maneuver: { type: "arrive", location: [-73.99, 4.61] } }
    ] }]
  }]
};

function browser({ gps = null } = {}) {
  const dom = new JSDOM(`<!doctype html><html><body>
      <i data-nav-icon></i><b data-nav-distance></b><p data-nav-instruction></p><span data-nav-street></span>
      <b data-nav-speed></b><b data-nav-remaining></b><div data-nav-offroute hidden></div>
      <div id="driver-telemetry-badge"></div></body></html>`,
    { runScripts: "outside-only", pretendToBeVisual: true, url: "http://localhost:5500/" });
  const w = dom.window;
  const fetches = [];
  const spoken = [];
  const queued = [];
  const watchers = [];
  w.fetch = async (url) => { fetches.push(String(url)); return { ok: true, json: async () => OSRM }; };
  Object.defineProperty(w.navigator, "geolocation", { configurable: true, value: {
    getCurrentPosition(ok, fail) { setTimeout(() => gps ? ok({ coords: gps, timestamp: Date.now() }) : fail({ code: 2 }), 1); },
    watchPosition(ok) { watchers.push(ok); return watchers.length; },
    clearWatch() {}
  } });
  w.ui = { escape: (v) => String(v ?? ""), toast() {} };
  w.store = { state: { driverScreen: "navigation" } };
  w.voiceEngine = { speak: (text) => spoken.push(text) };
  w.TruckCarData = {
    routes: { planForLoadId: 30, optimal: { id: "PLAN-9", waypoints: [{ coords: [4.6, -74.0] }, { coords: [4.61, -73.99] }] } }
  };
  w.TruckCarConfig = { gatewayUrl: "http://localhost:8000" };
  w.TruckCarApi = { session: { get: () => ({ accessToken: "t" }) }, ensureFreshSession: async () => ({}),
    http: { post: async () => ({ ticket: "00000000-0000-4000-8000-000000000000", expiresInSeconds: 30 }) } };
  w.WebSocket = class { constructor() { this.readyState = 0; } close() {} };
  w.WebSocket.OPEN = 1;
  w.OfflineQueue = { isOffline: () => false, enqueue: async (kind, payload) => { queued.push({ kind, payload }); } };
  ["js/geolocation.js", "js/telemetry.js", "js/navigation.js"].forEach((file) => w.eval(readFileSync(file, "utf8")));
  const emit = (latitude, longitude, extra = {}) =>
    watchers.forEach((cb) => cb({ coords: { latitude, longitude, accuracy: 6, speed: 15, heading: 0, ...extra }, timestamp: Date.now() }));
  return { w, fetches, spoken, queued, emit };
}

const LOAD = { backendId: 30, status: "IN_TRANSIT", origin: { coords: [4.6, -74.0] }, destination: { coords: [4.61, -73.99] } };

test("las maniobras de OSRM se traducen a instrucciones en español", () => {
  const { w } = browser();
  const g = w.RouteGuidance;
  assert.equal(g.instruction({ name: "Avenida Boyacá", maneuver: { type: "turn", modifier: "right" } }), "Gire a la derecha por Avenida Boyacá");
  assert.equal(g.instruction({ name: "Autopista Sur", maneuver: { type: "roundabout", exit: 2 } }), "En la glorieta, tome la 2.ª salida hacia Autopista Sur");
  assert.equal(g.instruction({ name: "", ref: "Ruta 40", maneuver: { type: "fork", modifier: "slight left" } }), "En la bifurcación, manténgase ligeramente a la izquierda por Ruta 40");
  assert.equal(g.instruction({ maneuver: { type: "arrive" } }, true), "Llegó al destino de la carga");
  assert.equal(g.instruction({ name: "Calle 127", maneuver: { type: "continue", modifier: "uturn" } }), "Haga un giro en U por Calle 127");
  assert.equal(g.formatDistance(560), "560 m");
});

test("la guía usa los puntos del plan de Route-AI y avanza con la posición real", async () => {
  const { w, fetches, spoken } = browser();
  await w.RouteGuidance.prepare(LOAD);

  assert.equal(fetches.length, 1);
  assert.match(fetches[0], /-74,4\.6;-73\.99,4\.61/);
  assert.match(fetches[0], /steps=true/);
  assert.equal(w.RouteGuidance.snapshot().source, "Route-AI");

  w.RouteGuidance.update({ coords: [4.605, -74.0], speed: 52, source: "gps" });
  const doc = w.document;
  assert.equal(doc.querySelector("[data-nav-instruction]").textContent, "Gire a la derecha por Avenida Boyacá");
  assert.match(doc.querySelector("[data-nav-distance]").textContent, /^5\d0 m$/);
  assert.equal(doc.querySelector("[data-nav-street]").textContent, "Calle 13");
  assert.equal(doc.querySelector("[data-nav-speed]").textContent, "52");
  assert.match(spoken.at(-1), /gire a la derecha por avenida boyacá/);

  w.RouteGuidance.update({ coords: [4.61, -73.995], speed: 40, source: "gps" });
  assert.equal(doc.querySelector("[data-nav-instruction]").textContent, "Llegó al destino de la carga");
  assert.equal(doc.querySelector("[data-nav-street]").textContent, "Avenida Boyacá");
  assert.equal(w.RouteGuidance.snapshot().offRoute, false);
});

test("fuera de la ruta avisa y recalcula desde la posición actual hasta el destino", async () => {
  const { w, fetches } = browser();
  await w.RouteGuidance.prepare(LOAD);

  w.RouteGuidance.update({ coords: [4.65, -74.05], speed: 30, source: "gps" });
  await sleep(10);

  assert.equal(w.document.querySelector("[data-nav-offroute]").hidden, false);
  assert.equal(fetches.length, 2);
  assert.match(fetches[1], /-74\.05,4\.65;-73\.99,4\.61/);
});

test("el HUD usa un ícono por tipo de maniobra (giro, giro leve, retorno, glorieta, llegada)", () => {
  const { w } = browser();
  const g = (type, modifier) => w.RouteGuidance.glyph({ maneuver: { type, modifier } });
  assert.equal(g("turn", "left"), "arrow-bend-up-left");
  assert.equal(g("turn", "slight right"), "arrow-up-right");
  assert.equal(g("continue", "uturn"), "arrow-u-up-left");
  assert.equal(g("roundabout", "right"), "arrows-counter-clockwise");
  assert.equal(g("arrive"), "flag-checkered-fill");
  assert.equal(g("new name", "straight"), "arrow-up");
  assert.equal(w.RouteGuidance.formatDuration(8160), "2 h 16 min");
});

test("la línea gris del HUD muestra la calle actual solo si no repite la de la instrucción", () => {
  const { w } = browser();
  const street = (instruction, current, extra = {}) => w.RouteGuidance.hudText({
    status: "ready", hasPosition: true, offRoute: false, distance: "830 m", instruction, street: current, ...extra
  }).street;
  assert.equal(street("En la glorieta, tome la 3.ª salida hacia Avenida Calle 59 Sur", "Avenida Calle 59 Sur"), "");
  assert.equal(street("Gire a la derecha por Avenida Boyacá", "Calle 13"), "Calle 13");
  assert.equal(street("Continúe por la Autopista Sur", "autopista sur"), "", "sin distinguir mayúsculas ni tildes");
  assert.equal(street("Gire a la izquierda", ""), "");
  assert.equal(street("Gire a la izquierda", "Calle 13", { offRoute: true }), "", "fuera de ruta el aviso va en la tarjeta");
});

test("el gálibo y el peso de la ruta real llegan de Routing-Restrictions y se avisan antes de llegar", async () => {
  const { w, spoken } = browser();
  const requests = [];
  w.TruckCarData.currentDriver = { vehicle: { plate: "TDK-410", height: 4.1, grossWeight: 40 } };
  w.TruckCarApi.restrictions = { validateRoute: async (request) => {
    requests.push(request);
    return { passable: false, blocking: [{ kind: "GALIBO_ALTURA", alongRouteMeters: 1400,
      restriction: { id: 7, title: "Puente de la Calle 26", maxClearanceMeters: 3.8 } }], warnings: [] };
  } };
  w.document.body.insertAdjacentHTML("beforeend",
    "<div data-nav-clearance hidden><span data-nav-clearance-text></span><span data-nav-clearance-sub></span></div>");

  await w.RouteGuidance.prepare(LOAD);
  await sleep(5);

  assert.equal(requests.length, 1);
  assert.equal(JSON.stringify(requests[0].path), "[[4.6,-74],[4.61,-74],[4.61,-73.99]]", "la geometría de OSRM, no texto del corredor");
  assert.equal(requests[0].heightMeters, 4.1);
  assert.equal(requests[0].grossWeightTons, 40);

  w.RouteGuidance.update({ coords: [4.6, -74.0], speed: 50, source: "gps" });
  const doc = w.document;
  assert.equal(doc.querySelector("[data-nav-clearance]").hidden, false);
  assert.equal(doc.querySelector("[data-nav-clearance-text]").textContent, "Gálibo de 3,80 m en 1,4 km");
  assert.equal(doc.querySelector("[data-nav-clearance-sub]").textContent, "· su vehículo mide 4,10 m");
  assert.ok(spoken.some((t) => /Atención: .*gálibo de 3,80 metros; su vehículo mide 4,10/.test(t)), "se anuncia una vez a 3 km o menos");

  w.RouteGuidance.update({ coords: [4.61, -73.995], speed: 40, source: "gps" });
  assert.equal(doc.querySelector("[data-nav-clearance]").hidden, true);
});

test("sin vehículo registrado o sin respuesta de Routing-Restrictions no se inventa ningún aviso", async () => {
  const { w } = browser();
  w.document.body.insertAdjacentHTML("beforeend", "<div data-nav-clearance hidden><span data-nav-clearance-text></span></div>");
  w.TruckCarApi.restrictions = { validateRoute: async () => { throw new Error("503"); } };
  w.TruckCarData.currentDriver = { vehicle: { plate: "TDK-410", height: 4.1, grossWeight: 40 } };
  await w.RouteGuidance.prepare(LOAD);
  await sleep(5);
  w.RouteGuidance.update({ coords: [4.6, -74.0], speed: 50, source: "gps" });
  assert.equal(w.RouteGuidance.clearance.status, "unavailable");
  assert.equal(w.document.querySelector("[data-nav-clearance]").hidden, true);

  const second = browser();
  second.w.TruckCarApi.restrictions = { validateRoute: async () => assert.fail("sin vehículo no se consulta") };
  await second.w.RouteGuidance.prepare(LOAD);
  assert.equal(second.w.RouteGuidance.clearance.status, "no-vehicle");

  const long = Array.from({ length: 1001 }, (_, i) => [4 + i / 1000, -74]);
  const sampled = w.RouteGuidance.samplePath(long);
  assert.equal(sampled.length, 400);
  assert.equal(JSON.stringify(sampled[0]), JSON.stringify(long[0]));
  assert.equal(JSON.stringify(sampled.at(-1)), JSON.stringify(long.at(-1)));
});

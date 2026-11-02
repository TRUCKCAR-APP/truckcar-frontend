// Navegación paso a paso sobre la ruta real (Route-AI + OSRM) y telemetría con el GPS del dispositivo por defecto.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Ruta de prueba: 1,1 km al norte por la Calle 13, giro a la derecha y 1,1 km al oriente por la Avenida Boyacá.
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
  w.TruckCarApi = { session: { get: () => ({ accessToken: "t" }) }, ensureFreshSession: async () => ({}) };
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

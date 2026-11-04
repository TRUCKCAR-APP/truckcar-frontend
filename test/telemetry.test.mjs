// Telemetría del conductor: GPS real del dispositivo por defecto; la simulación solo como herramienta de prueba.
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
    getCurrentPosition(ok, fail) { w.gpsRequests = (w.gpsRequests || 0) + 1; setTimeout(() => gps ? ok({ coords: gps, timestamp: Date.now() }) : fail({ code: 2 }), 1); },
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
  ["js/geolocation.js", "js/telemetry.js"].forEach((file) => w.eval(readFileSync(file, "utf8")));
  const emit = (latitude, longitude, extra = {}, ageMs = 0) =>
    watchers.forEach((cb) => cb({ coords: { latitude, longitude, accuracy: 6, speed: 15, heading: 0, ...extra }, timestamp: Date.now() - ageMs }));
  return { w, fetches, spoken, queued, emit };
}

const LOAD = { backendId: 30, status: "IN_TRANSIT", origin: { coords: [4.6, -74.0] }, destination: { coords: [4.61, -73.99] } };

test("la telemetría usa el GPS real por defecto: sin señal no transmite posiciones inventadas", async () => {
  const { w, queued, emit } = browser();
  assert.equal(w.DriverTelemetry.simulating, false);

  await w.DriverTelemetry.start(LOAD, "driver-ana");
  assert.equal(queued.length, 0, "sin lectura GPS no se envía nada");
  assert.match(w.document.getElementById("driver-telemetry-badge").textContent, /Sin posición/);

  emit(4.6012, -74.0001);
  await sleep(3100);   // siguiente envío (cada 3 s)
  w.DriverTelemetry.stop();

  assert.equal(queued.length, 1);
  assert.equal(queued[0].payload.latitude, 4.6012);
  assert.equal(queued[0].payload.longitude, -74.0001);
  assert.equal(queued[0].payload.speedKmH, 54);
  assert.equal(w.DeviceLocation.last().coords[0], 4.6012);
});

test("la simulación solo existe si se activa en las herramientas de prueba y nunca llega a la ubicación del dispositivo", async () => {
  const { w, queued } = browser();
  await w.DriverTelemetry.toggleSimulation();
  assert.equal(w.DriverTelemetry.simulating, true);

  await w.DriverTelemetry.start(LOAD, "driver-ana");
  w.DriverTelemetry.stop();

  assert.equal(queued.length, 1);
  assert.match(w.document.getElementById("driver-telemetry-badge").textContent, /Simulación de prueba/);
  assert.equal(w.DeviceLocation.last(), null, "la posición simulada no se guarda como GPS real");

  await w.DriverTelemetry.toggleSimulation();
  assert.equal(w.DriverTelemetry.simulating, false);
});

test("con el camión detenido la última lectura sigue siendo la posición: velocidad 0 y se pide confirmarla", async () => {
  const { w, queued, emit } = browser();
  await w.DriverTelemetry.start(LOAD, "driver-ana");
  emit(4.6012, -74.0001, { speed: 0 }, 40 * 1000);    // el GPS la midió detenida y no repite lecturas sin movimiento
  await sleep(3100);
  w.DriverTelemetry.stop();

  assert.equal(queued.length, 1, "se transmite la posición aunque la lectura tenga 40 s");
  assert.equal(queued[0].payload.latitude, 4.6012);
  assert.equal(queued[0].payload.speedKmH, 0, "detenido: la velocidad de la última lectura ya no aplica");
  assert.match(w.document.getElementById("driver-telemetry-badge").textContent, /detenido/);
  assert.ok(w.gpsRequests >= 1, "se pide una lectura nueva para confirmar la posición");
});

test("sin lecturas en más de 2 minutos ya no se usa la última posición", async () => {
  const { w, queued, emit } = browser();
  await w.DriverTelemetry.start(LOAD, "driver-ana");
  emit(4.6012, -74.0001, {}, 3 * 60 * 1000);
  await sleep(3100);
  w.DriverTelemetry.stop();

  assert.equal(queued.length, 0);
  assert.match(w.document.getElementById("driver-telemetry-badge").textContent, /Sin posición/);
});

test("una lectura vieja tomada en movimiento, o sin velocidad informada, no se usa: Sin posición", async () => {
  for (const speed of [15, null]) {
    const { w, queued, emit } = browser();
    await w.DriverTelemetry.start(LOAD, "driver-ana");
    emit(4.6012, -74.0001, { speed }, 40 * 1000);
    await sleep(3100);
    w.DriverTelemetry.stop();
    assert.equal(queued.length, 0, "velocidad " + speed + ": no se transmite una posición que ya no es la del camión");
    assert.match(w.document.getElementById("driver-telemetry-badge").textContent, /Sin posición/);
    assert.ok(w.gpsRequests >= 1, "se pide una lectura nueva");
  }
});

test("la torre aplica el arreglo agregado de /topic/fleet-locations y sigue aceptando una sola posición", () => {
  const { w } = browser();
  let handler = null;
  w.TruckCarTelemetry.subscribe = (destination, onMessage) => {
    assert.equal(destination, "/topic/fleet-locations");
    handler = onMessage;
    return () => {};
  };
  const updated = [];
  w.LiveTracking.followFleet((truck) => updated.push(truck.driverId));

  handler([
    { driverId: "ana", vehiclePlate: "TDK-410", latitude: 4.61, longitude: -74.08, speedKmH: 62, loadId: 30, loadStatus: "IN_TRANSIT" },
    { driverId: "carlos", vehiclePlate: "SNT-221", latitude: 4.7, longitude: -74.1, speedKmH: 0 }
  ]);
  handler({ driverId: "ana", latitude: 4.62, longitude: -74.09, speedKmH: 40 });
  handler([null, {}]);

  assert.deepEqual(updated, ["ana", "carlos", "ana"]);
  const fleet = w.TruckCarData.fleetVehicles;
  assert.equal(fleet.length, 2);
  const ana = fleet.find((t) => t.driverId === "ana");
  assert.equal(JSON.stringify(ana.coords), JSON.stringify([4.62, -74.09]));
  assert.equal(ana.status, "EN_TRANSITO");
  assert.equal(fleet.find((t) => t.driverId === "carlos").plate, "SNT-221");
  w.LiveTracking.unfollowFleet();
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";

const ANA = { driverId: "driver-ana", driverName: "Ana Ruiz", vehiclePlate: "TDK-410", vehicleModel: "Kenworth T800",
  vehicleType: "TRACTOMULA_3S3", maxPayloadTons: 34, status: "ACTIVO", rating: 4.7 };
const LUIS = { driverId: "driver-luis", driverName: "Luis Paz", vehiclePlate: "SNT-221", vehicleType: "TURBO", maxPayloadTons: 4.5 };
const SIN_PLACA = { driverId: "driver-eva", driverName: "Eva Mora", vehiclePlate: null };
const SIN_NOMBRE = { driverId: "driver-x", driverName: "", vehiclePlate: "AAA-111" };

const rawLoad = (over = {}) => ({ id: 30, status: "AVAILABLE", assignmentStatus: null, generatorCompanyName: "Cementos del Valle",
  originCity: "Bogotá", destinationCity: "Ibagué", cargoDescription: "Cemento", weightTons: 24, discardedDriverIds: [], ...over });

function tower(api = {}) {
  const w = new JSDOM("<!doctype html><body></body>", { runScripts: "outside-only" }).window;
  const state = { activeRole: "coordinator", sessionRole: "COORDINADOR", dataStatus: { loading: false, errors: {}, lastSync: null },
    selectedLoadId: null, coordinatorTab: "fleet" };
  w.store = { get state() { return state; }, getState: () => state, setState: (patch) => Object.assign(state, patch) };
  w.eval(readFileSync("js/ui.js", "utf8"));
  w.TruckCarData = {};
  w.TruckCarApi = { session: { get: () => ({ userId: "coord-1" }) }, allocation: { history: async () => [] }, ...api };
  w.eval(readFileSync("js/dataService.js", "utf8"));
  return { w, state, data: w.TruckCarData, service: w.TruckCarService };
}

const text = (html) => new JSDOM(html).window.document.body.textContent.replace(/\s+/g, " ");

test("la API llama a los endpoints reales de asignar, notificar y conductores disponibles", async () => {
  const w = new JSDOM("<!doctype html><body></body>", { runScripts: "outside-only", url: "http://localhost:5500/" }).window;
  const calls = [];
  w.TruckCarConfig = { apiBaseUrl: "http://localhost:8000/api/v1", gatewayUrl: "http://localhost:8000", requestTimeoutMs: 5000,
    storageKeys: { session: "truckcar.session" } };
  w.fetch = async (url, options) => {
    calls.push({ url: String(url), method: options.method, body: options.body ? JSON.parse(options.body) : null });
    return { ok: true, status: 200, headers: { get: (name) => (name === "Content-Type" ? "application/json" : null) }, text: async () => "[]" };
  };
  w.eval(readFileSync("js/api.js", "utf8"));
  const api = w.TruckCarApi;
  await api.fleet.listAvailable();
  await api.loads.assign(30, { driverId: "driver-ana", driverName: "Ana Ruiz", vehiclePlate: "TDK-410" });
  await api.loads.notifyAssignment(30);
  assert.deepEqual(calls.map((c) => c.method + " " + c.url.replace("http://localhost:8000/api/v1", "")), [
    "GET /fleets-drivers/available", "PATCH /loads/30/assign", "PATCH /loads/30/assignment/notify"]);
  assert.deepEqual(calls[1].body, { driverId: "driver-ana", driverName: "Ana Ruiz", vehiclePlate: "TDK-410" });
  assert.equal(calls[2].body, null, "notificar no lleva cuerpo");
});

test("asignar manualmente solo se ofrece sin propuesta o sin conductores; notificar solo en PROPOSED", () => {
  const { service: s } = tower();
  const actions = (status, assignmentStatus) => s.loadActions({ status, assignmentStatus });
  assert.equal(actions("AVAILABLE", null).assignManually, true);
  assert.equal(actions("AVAILABLE", "UNASSIGNED_NO_DRIVERS").assignManually, true);
  for (const assignment of ["PROPOSED", "NOTIFIED", "REJECTED", "TIMEOUT"]) {
    assert.equal(actions("AVAILABLE", assignment).assignManually, false, assignment + " no admite una asignación nueva");
  }
  assert.equal(actions("ASSIGNED", "ACCEPTED").assignManually, false);
  assert.equal(actions("CANCELLED", null).assignManually, false);
  assert.equal(actions("AVAILABLE", "PROPOSED").notifyDriver, true);
  assert.equal(actions("AVAILABLE", "NOTIFIED").notifyDriver, false);
  assert.equal(actions("AVAILABLE", null).notifyDriver, false);
  assert.equal(actions("ASSIGNED", "ACCEPTED").notifyDriver, false);
});

test("los candidatos salen de fleets-drivers: el descartado, el que no tiene placa y el que no tiene nombre no se pueden elegir", async () => {
  const { service: s } = tower({ fleet: { listAvailable: async () => [ANA, LUIS, SIN_PLACA, SIN_NOMBRE] } });
  const load = s.mapLoad(rawLoad({ discardedDriverIds: ["driver-luis"] }));
  const [ana, luis, eva, x] = await s.listAssignableDrivers(load);
  assert.deepEqual({ ...ana }, { driverId: "driver-ana", driverName: "Ana Ruiz", vehiclePlate: "TDK-410",
    vehicleType: "Kenworth T800 · TRACTOMULA_3S3", maxPayloadTons: 34, assignable: true, blockedReason: null });
  assert.equal(luis.assignable, false);
  assert.equal(luis.blockedReason, "Ya rechazó o dejó vencer esta carga");
  assert.equal(eva.assignable, false);
  assert.equal(eva.blockedReason, "Sin vehículo registrado");
  assert.equal(x.assignable, false);
  assert.equal(x.blockedReason, "Sin nombre registrado");
  const empty = tower({ fleet: { listAvailable: async () => null } });
  assert.equal((await empty.service.listAssignableDrivers(load)).length, 0);
});

test("asignar envía solo driverId, driverName y vehiclePlate del backend y vuelve a leer la carga", async () => {
  const sent = [];
  let listed = 0;
  const { service: s, data } = tower({
    fleet: { listAvailable: async () => [ANA] },
    loads: {
      assign: async (loadId, body) => { sent.push({ loadId, body }); return rawLoad({ assignmentStatus: "PROPOSED", assignedDriverId: body.driverId, assignedDriverName: body.driverName }); },
      listAvailable: async () => { listed++; return [rawLoad({ assignmentStatus: "PROPOSED", assignedDriverId: "driver-ana", assignedDriverName: "Ana Ruiz" })]; }
    }
  });
  const [ana] = await s.listAssignableDrivers(s.mapLoad(rawLoad()));
  const updated = await s.assignDriver(30, ana);
  assert.deepEqual(JSON.parse(JSON.stringify(sent)), [{ loadId: 30, body: { driverId: "driver-ana", driverName: "Ana Ruiz", vehiclePlate: "TDK-410" } }]);
  assert.equal(updated.assignmentStatus, "PROPOSED", "la propuesta manual queda en PROPOSED");
  assert.equal(listed, 1);
  assert.equal(data.activeLoadOrder.assignmentStatus, "PROPOSED");
  assert.equal(s.loadActions(data.activeLoadOrder).notifyDriver, true);
});

test("un 409 al asignar llega tal cual, con el motivo del backend", async () => {
  const conflict = Object.assign(new Error("El conductor driver-ana está ocupado con la carga #12 (propuesta NOTIFIED); no puede recibir la carga #30"), { status: 409 });
  const { service: s } = tower({ loads: { assign: async () => { throw conflict; }, listAvailable: async () => [] } });
  await assert.rejects(() => s.assignDriver(30, { driverId: "driver-ana", driverName: "Ana Ruiz", vehiclePlate: "TDK-410" }),
    (error) => error.status === 409 && /está ocupado con la carga #12/.test(error.message));
});

test("notificar al conductor vive en una sola función del servicio", async () => {
  const notified = [];
  const { service: s, data } = tower({ loads: {
    notifyAssignment: async (loadId) => { notified.push(loadId); return rawLoad({ assignmentStatus: "NOTIFIED", assignedDriverId: "driver-ana" }); },
    listAvailable: async () => [rawLoad({ assignmentStatus: "NOTIFIED", assignedDriverId: "driver-ana" })]
  } });
  const updated = await s.notifyProposedDriver(30);
  assert.deepEqual(notified, [30]);
  assert.equal(updated.assignmentStatus, "NOTIFIED");
  assert.equal(s.loadActions(data.activeLoadOrder).notifyDriver, false);
  const callers = ["js/app.js", "js/views/coordinatorPanel.js", "js/views/towerLoads.js", "js/views/driverApp.js"]
    .filter((file) => /notifyAssignment/.test(readFileSync(file, "utf8")));
  assert.deepEqual(callers, [], "las vistas no llaman al endpoint directamente");
  assert.equal(readFileSync("js/dataService.js", "utf8").match(/notifyAssignment\(/g).length, 1);
});

test("la tarjeta de despacho ofrece asignar a mano o notificar según el estado de la carga", () => {
  const { w, service: s, data, state } = tower();
  w.eval(readFileSync("js/views/coordinatorPanel.js", "utf8"));
  w.TruckCarTelemetry = { isOnline: true };
  w.PodUI = { formatDate: (value) => String(value) };
  const render = (raw) => {
    const load = s.mapLoad(raw);
    Object.assign(data, { activeLoadOrder: load, availableLoads: [load], fleetVehicles: [], communityAlerts: [], deliveredLoads: [],
      dispatchEvaluation: { candidates: [] } });
    return text(w.CoordinatorPanel.render(state));
  };
  const free = render(rawLoad());
  assert.match(free, /Asignar manualmente/);
  assert.match(free, /Generador: Cementos del Valle/);
  assert.doesNotMatch(free, /Notificar al conductor/);
  const proposed = render(rawLoad({ assignmentStatus: "PROPOSED", assignedDriverId: "driver-ana", assignedDriverName: "Ana Ruiz" }));
  assert.match(proposed, /Notificar al conductor/);
  assert.doesNotMatch(proposed, /Asignar manualmente/);
  const notified = render(rawLoad({ assignmentStatus: "NOTIFIED", assignedDriverId: "driver-ana" }));
  assert.doesNotMatch(notified, /Notificar al conductor|Asignar manualmente/);
  assert.match(render(rawLoad({ assignmentStatus: "UNASSIGNED_NO_DRIVERS" })), /Asignar manualmente/);
  state.sessionRole = "ADMIN";
  assert.match(render(rawLoad()), /Asignar manualmente/);
  assert.match(render(rawLoad({ assignmentStatus: "PROPOSED" })), /Notificar al conductor/);
  for (const role of ["CONDUCTOR", "GENERADOR", null]) {
    state.sessionRole = role;
    assert.doesNotMatch(render(rawLoad()), /Asignar manualmente/, "solo la torre asigna: " + role);
    assert.doesNotMatch(render(rawLoad({ assignmentStatus: "PROPOSED" })), /Notificar al conductor/, "solo la torre notifica: " + role);
  }
});

test("la lista de candidatos deshabilita a quien no se puede elegir y muestra el motivo", async () => {
  const { w, service: s } = tower({ fleet: { listAvailable: async () => [ANA, LUIS, SIN_PLACA] } });
  w.eval(readFileSync("js/views/coordinatorPanel.js", "utf8"));
  const candidates = await s.listAssignableDrivers(s.mapLoad(rawLoad({ discardedDriverIds: ["driver-luis"] })));
  const doc = new JSDOM(w.coordinatorCtrl.assignmentCandidatesHtml(candidates)).window.document;
  const buttons = [...doc.querySelectorAll("[data-candidate]")];
  assert.deepEqual(buttons.map((b) => b.disabled), [false, true, true]);
  assert.match(buttons[0].textContent, /Ana Ruiz/);
  assert.match(buttons[0].textContent, /TDK-410 · Kenworth T800 · TRACTOMULA_3S3 · 34/);
  assert.match(buttons[1].textContent, /Ya rechazó o dejó vencer esta carga/);
  assert.match(buttons[2].textContent, /Sin vehículo registrado/);
  assert.match(text(w.coordinatorCtrl.assignmentCandidatesHtml([])), /No hay conductores disponibles/);
});

test("la torre lista las cargas de todos los generadores con GET /loads y filtra por estado en el backend", async () => {
  const asked = [];
  const all = [
    rawLoad({ id: 31, status: "IN_TRANSIT", assignmentStatus: "ACCEPTED", assignedDriverName: "Ana Ruiz", assignedVehiclePlate: "TDK-410" }),
    rawLoad({ id: 30, assignmentStatus: "UNASSIGNED_NO_DRIVERS", generatorCompanyName: "Aceros Andinos" })
  ];
  const { w, data, state } = tower({ loads: {
    list: async (statuses) => { asked.push(statuses); return statuses ? all.filter((l) => statuses.includes(l.status)) : all; },
    listAvailable: async () => all.filter((l) => l.status === "AVAILABLE")
  } });
  w.eval(readFileSync("js/views/coordinatorPanel.js", "utf8"));
  w.eval(readFileSync("js/views/towerLoads.js", "utf8"));
  w.CoordinatorPanel.renderHeader = () => "";
  w.ui.toast = () => {};

  await w.TowerLoads.refresh();
  assert.equal(asked[0], null, "sin filtro pide todas");
  assert.equal(state.towerLoadsStatus, "ready");
  const doc = new JSDOM(w.TowerLoads.render(state)).window.document;
  const rows = [...doc.querySelectorAll("[data-tower-load]")];
  assert.equal(rows.length, 2);
  assert.match(rows[0].textContent.replace(/\s+/g, " "), /CARGA-31.*Bogotá → Ibagué.*En tránsito.*Generadors*Cementos del Valle.*Conductors*Ana Ruiz \(TDK-410\)/);
  assert.match(rows[1].textContent.replace(/\s+/g, " "), /Disponible · Sin conductores disponibles.*Generadors*Aceros Andinos.*Conductors*Sin conductor/);
  assert.equal(rows[0].querySelector("button"), null, "una carga en tránsito no se abre en despacho");
  assert.match(rows[1].querySelector("button").textContent, /Abrir en evaluación de despacho/);
  assert.deepEqual([...doc.querySelectorAll("[aria-pressed]")].map((b) => b.textContent.trim()),
    ["Todas", "Disponibles", "Aceptadas", "En tránsito", "Entregadas", "Canceladas"]);

  await w.TowerLoads.setFilter("IN_TRANSIT");
  assert.deepEqual([...asked[1]], ["IN_TRANSIT"]);
  assert.deepEqual(data.towerLoads.map((l) => l.backendId), [31]);

  await w.TowerLoads.openInDispatch(30);
  assert.equal(state.coordinatorTab, "fleet");
  assert.equal(data.activeLoadOrder.backendId, 30);
});

test("si GET /loads falla la torre lo dice y deja reintentar, sin cargas inventadas", async () => {
  const { w, data, state } = tower({ loads: { list: async () => { throw Object.assign(new Error("Sin conexión"), { status: 0 }); } } });
  w.eval(readFileSync("js/views/coordinatorPanel.js", "utf8"));
  w.eval(readFileSync("js/views/towerLoads.js", "utf8"));
  w.CoordinatorPanel.renderHeader = () => "";
  w.ui.toast = () => {};
  await w.TowerLoads.refresh();
  assert.equal(state.towerLoadsStatus, "error");
  assert.deepEqual([...data.towerLoads], []);
  const html = w.TowerLoads.render(state);
  assert.match(text(html), /No se pudieron cargar las cargas/);
  assert.match(html, /window\.TowerLoads\.refresh\(\)/);
});

test("Cargas es una pestaña de la torre para COORDINADOR y ADMIN", () => {
  const { w } = tower();
  w.eval(readFileSync("js/views/coordinatorPanel.js", "utf8"));
  assert.equal(w.CoordinatorPanel.activeTab({ coordinatorTab: "loads", sessionRole: "COORDINADOR" }), "loads");
  assert.equal(w.CoordinatorPanel.activeTab({ coordinatorTab: "loads", sessionRole: "ADMIN" }), "loads");
  assert.match(readFileSync("js/surfaces/panel.js", "utf8"), /tab === 'loads'\) return window\.TowerLoads\.render\(state\)/);
});

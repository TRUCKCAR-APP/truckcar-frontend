import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";

const raw = (id, status, assignmentStatus, over = {}) => ({ id, status, assignmentStatus, assignedDriverId: "driver-ana",
  originCity: "Bogotá", destinationCity: "Ibagué", weightTons: 24, cargoDescription: "Cemento", offeredBudget: 3200000, ...over });

function driver({ mine = [], getById, currentLoadId = null } = {}) {
  const w = new JSDOM('<!doctype html><body><div id="phone-mockup-frame"><div id="app-mount"></div></div></body>',
    { runScripts: "outside-only", pretendToBeVisual: true, url: "http://localhost:5500/" }).window;
  const state = { isAuthenticated: true, activeRole: "driver", sessionRole: "CONDUCTOR", driverScreen: "route_overview", busyAction: null,
    currentUser: { id: "driver-ana", status: "ACTIVE" }, dataStatus: { loading: false, errors: {}, lastSync: null }, alertSoundEnabled: true };
  const log = { toasts: [], failures: [], spoken: [], alerts: 0, forgotten: [], lookups: [], telemetryStops: 0, mineCalls: 0, patches: [] };
  w.store = { get state() { return state; }, getState: () => state, subscribe() {},
    setState: (patch) => { Object.assign(state, patch); log.patches.push({ ...patch }); } };
  w.eval(readFileSync("js/ui.js", "utf8"));
  w.ui.toast = (title, type, options = {}) => log.toasts.push({ title, type, ...options });
  w.ui.failure = (title) => log.failures.push(title);
  w.TruckCarConfig = { assignmentResponseMinutes: 5, driverPollingMs: 10000 };
  w.TruckCarData = { currentDriver: { id: "driver-ana", currentLoadId } };
  w.DriverTelemetry = { isRunning: false, start() { this.isRunning = true; }, stop() { this.isRunning = false; log.telemetryStops++; } };
  w.RouteGuidance = { prepare() {}, reset() {}, prefetch() {}, forget: async (id) => { log.forgotten.push(id); } };
  w.voiceEngine = { speak: (text) => log.spoken.push(text), proposalAlert: () => { log.alerts++; return true; } };
  const source = { mine };
  w.TruckCarApi = { session: { get: () => ({ userId: "driver-ana" }) }, loads: {
    mine: async () => { log.mineCalls++; if (source.mine instanceof Error) throw source.mine; return source.mine; },
    getById: async (id) => { log.lookups.push(id); if (!getById) throw Object.assign(new Error("Sin conexión"), { status: 0 }); return getById(id); }
  } };
  w.eval(readFileSync("js/dataService.js", "utf8"));
  w.TruckCarService.loadRoutePlan = async () => {};
  w.eval(readFileSync("js/views/driverApp.js", "utf8"));
  w.eval(readFileSync("js/app.js", "utf8"));
  w.app.init = () => {};
  return { w, state, log, source, data: w.TruckCarData, service: w.TruckCarService };
}

const screen = (w, state) => new JSDOM(w.DriverApp.renderAssignedLoadScreen(state)).window.document;

test("una carga CANCELLED o DELIVERED que llegue en /loads/mine no es la carga actual del conductor", async () => {
  for (const status of ["CANCELLED", "DELIVERED"]) {
    const { service: s, data } = driver({ mine: [raw(12, status, "ACCEPTED")], currentLoadId: 12 });
    assert.equal(await s.loadDriverAssignment(), null);
    assert.equal(data.activeLoadOrder, null, status + " no se muestra aunque currentLoadId apunte a ella");
  }
  const mixed = driver({ mine: [raw(12, "CANCELLED", "ACCEPTED"), raw(13, "AVAILABLE", "NOTIFIED")], currentLoadId: 12 });
  await mixed.service.loadDriverAssignment();
  assert.equal(mixed.data.activeLoadOrder.backendId, 13, "se elige la propuesta vigente, no la cancelada");
});

test("la carga actual sale de loadActions: solo propuesta, aceptada o en tránsito", () => {
  const { service: s } = driver();
  const current = (status, assignmentStatus) => s.isDriverCurrentLoad({ status, assignmentStatus });
  assert.equal(current("AVAILABLE", "PROPOSED"), true);
  assert.equal(current("AVAILABLE", "NOTIFIED"), true);
  assert.equal(current("ASSIGNED", "ACCEPTED"), true);
  assert.equal(current("IN_TRANSIT", "ACCEPTED"), true);
  assert.equal(current("CANCELLED", "ACCEPTED"), false);
  assert.equal(current("DELIVERED", "ACCEPTED"), false);
  assert.equal(current("AVAILABLE", "REJECTED"), false);
  assert.equal(current("AVAILABLE", null), false);
  assert.equal(s.isDriverCurrentLoad(null), false);
});

test("una carga cancelada forzada en pantalla no muestra Iniciar viaje, Aceptar ni Rechazar", () => {
  for (const [status, assignment] of [["CANCELLED", "ACCEPTED"], ["CANCELLED", "NOTIFIED"], ["DELIVERED", "ACCEPTED"]]) {
    const { w, state, data, service: s } = driver();
    data.activeLoadOrder = s.mapLoad(raw(12, status, assignment));
    const doc = screen(w, state);
    assert.doesNotMatch(doc.body.innerHTML, /startNavigation|handleAcceptTrip|handleRejectTrip/, status + "/" + assignment);
    assert.doesNotMatch(doc.body.textContent, /Iniciar viaje|Salir hacia el punto de cargue|Aceptar carga|Rechazar|Cancelada/);
    assert.match(doc.body.textContent, /Sin carga asignada/);
  }
  const accepted = driver();
  accepted.data.activeLoadOrder = accepted.service.mapLoad(raw(12, "ASSIGNED", "ACCEPTED"));
  assert.match(screen(accepted.w, accepted.state).body.textContent, /Salir hacia el punto de cargue/, "la aceptada sí lo conserva");
});

test("si la carga aceptada se cancela, el conductor recibe «La carga CARGA-N fue cancelada.» y vuelve a la vista sin carga", async () => {
  const { w, state, log, source, data, service: s } = driver({ mine: [raw(12, "ASSIGNED", "ACCEPTED")], currentLoadId: 12,
    getById: (id) => raw(id, "CANCELLED", "ACCEPTED", { cancellationReason: "El generador retiró la carga" }) });
  await s.loadDriverAssignment();
  data.routes = { optimal: {} };
  assert.equal(data.activeLoadOrder.backendId, 12);

  source.mine = [];
  await w.app.pollDriverProposals();
  assert.equal(log.mineCalls, 2, "con la carga aceptada la consulta automática sigue activa");
  assert.deepEqual(log.lookups, [12], "el estado real se pregunta al backend");
  assert.equal(data.activeLoadOrder, null);
  assert.equal(data.routes, null);
  assert.deepEqual(log.forgotten, [12], "se borra el viaje guardado en el teléfono");
  assert.equal(state.driverScreen, "assigned_load");
  assert.equal(log.toasts.length, 1);
  assert.equal(log.toasts[0].title, "La carga CARGA-12 fue cancelada.");
  assert.equal(log.toasts[0].type, "warning");
  assert.equal(log.toasts[0].description, undefined, "sin motivo");
  assert.equal(log.alerts, 1, "suena y vibra como una propuesta, por el interruptor de avisos");
  assert.deepEqual(log.spoken, ["La carga CARGA-12 fue cancelada."]);

  const doc = screen(w, state);
  const line = doc.querySelector("[data-lost-load='12']");
  assert.equal(line.getAttribute("role"), "status");
  assert.match(line.textContent, /La carga CARGA-12 fue cancelada\./);
  assert.doesNotMatch(doc.body.textContent, /El generador retiró la carga/, "el motivo no se muestra al conductor");
  assert.match(doc.body.textContent, /Sin carga asignada/);
  assert.doesNotMatch(doc.body.innerHTML, /startNavigation/);

  await w.app.pollDriverProposals();
  assert.equal(log.toasts.length, 1, "no se repite el aviso");
  assert.ok(screen(w, state).querySelector("[data-lost-load]"), "la línea sigue hasta que el conductor consulte o llegue otra carga");

  await w.app.refreshAssignment();
  assert.equal(screen(w, state).querySelector("[data-lost-load]"), null, "al consultar de nuevo desaparece");
});

test("la línea de carga cancelada se quita cuando llega otra carga", async () => {
  const { w, state, source, data, service: s } = driver({ mine: [raw(12, "ASSIGNED", "ACCEPTED")], getById: (id) => raw(id, "CANCELLED", "ACCEPTED") });
  await s.loadDriverAssignment();
  source.mine = [];
  await w.app.pollDriverProposals();
  assert.ok(data.lostLoad);
  source.mine = [raw(13, "AVAILABLE", "NOTIFIED", { assignmentStatusChangedAt: new Date().toISOString() })];
  await w.app.pollDriverProposals();
  assert.equal(data.lostLoad, null);
  assert.equal(data.activeLoadOrder.backendId, 13);
  assert.equal(screen(w, state).querySelector("[data-lost-load]"), null);
});

test("si no se puede saber qué pasó, no se afirma que fue cancelada", async () => {
  const offline = driver({ mine: [raw(12, "ASSIGNED", "ACCEPTED")] });
  await offline.service.loadDriverAssignment();
  offline.source.mine = [];
  await offline.w.app.pollDriverProposals();
  assert.equal(offline.log.toasts[0].title, "La carga CARGA-12 ya no está asignada a usted.");
  assert.equal(offline.data.lostLoad.cancelled, false);

  const reassigned = driver({ mine: [raw(12, "ASSIGNED", "ACCEPTED")], getById: (id) => raw(id, "AVAILABLE", "PROPOSED", { assignedDriverId: "driver-luis" }) });
  await reassigned.service.loadDriverAssignment();
  reassigned.source.mine = [];
  await reassigned.w.app.pollDriverProposals();
  assert.equal(reassigned.log.toasts[0].title, "La carga CARGA-12 ya no está asignada a usted.");
});

test("una propuesta que vence conserva su aviso discreto; si fue cancelada, se dice", async () => {
  const expired = driver({ mine: [raw(9, "AVAILABLE", "NOTIFIED")], getById: (id) => raw(id, "AVAILABLE", "TIMEOUT") });
  await expired.service.loadDriverAssignment();
  expired.source.mine = [];
  await expired.w.app.pollDriverProposals();
  assert.equal(expired.log.toasts[0].title, "La propuesta ya no está disponible");
  assert.equal(expired.log.toasts[0].type, "info");
  assert.equal(expired.log.alerts, 0, "sin sonido");
  assert.deepEqual(expired.log.spoken, []);

  const cancelled = driver({ mine: [raw(9, "AVAILABLE", "NOTIFIED")], getById: (id) => raw(id, "CANCELLED", "NOTIFIED") });
  await cancelled.service.loadDriverAssignment();
  cancelled.source.mine = [];
  await cancelled.w.app.pollDriverProposals();
  assert.equal(cancelled.log.toasts[0].title, "La carga CARGA-9 fue cancelada.");
  assert.equal(cancelled.log.alerts, 1);
});

test("en tránsito la consulta automática sigue suspendida; aceptada y sin iniciar, no", async () => {
  const transit = driver({ mine: [raw(12, "IN_TRANSIT", "ACCEPTED")] });
  await transit.service.loadDriverAssignment();
  await transit.w.app.pollDriverProposals();
  assert.equal(transit.log.mineCalls, 1, "el backend no deja cancelar una carga en tránsito");

  const assigned = driver({ mine: [raw(12, "ASSIGNED", "ACCEPTED")] });
  await assigned.service.loadDriverAssignment();
  await assigned.w.app.pollDriverProposals();
  assert.equal(assigned.log.mineCalls, 2);
  assert.deepEqual(assigned.log.toasts, [], "sin cambios no hay avisos");
  assert.equal(assigned.state.driverScreen, "route_overview", "ni se saca al conductor de su pantalla");
});

test("un fallo de red al consultar no borra la carga ni inventa una cancelación", async () => {
  const { w, log, source, data, service: s } = driver({ mine: [raw(12, "ASSIGNED", "ACCEPTED")] });
  await s.loadDriverAssignment();
  source.mine = Object.assign(new Error("Sin conexión"), { status: 0, isNetworkError: true });
  await w.app.pollDriverProposals();
  assert.equal(data.activeLoadOrder.backendId, 12);
  assert.deepEqual(log.lookups, []);
  assert.deepEqual(log.toasts, []);
  assert.equal(data.lostLoad == null, true);
});

test("si «Iniciar viaje» recibe un 409 porque la carga se canceló, se avisa y no queda la carga en pantalla", async () => {
  const { w, state, log, source, data, service: s } = driver({ mine: [raw(12, "ASSIGNED", "ACCEPTED")], getById: (id) => raw(id, "CANCELLED", "ACCEPTED") });
  await s.loadDriverAssignment();
  s.startTrip = async () => { throw Object.assign(new Error("No se puede iniciar el viaje de la carga #12: se esperaba status ASSIGNED pero es CANCELLED"), { status: 409 }); };
  source.mine = [];
  await w.app.startNavigation();
  assert.equal(data.activeLoadOrder, null);
  assert.equal(log.toasts[0].title, "La carga CARGA-12 fue cancelada.");
  assert.deepEqual(log.failures, [], "no se muestra el diálogo genérico de conflicto");
  assert.equal(state.driverScreen, "assigned_load");
  assert.equal(state.busyAction, null);

  const other = driver({ mine: [raw(12, "ASSIGNED", "ACCEPTED")] });
  await other.service.loadDriverAssignment();
  other.service.startTrip = async () => { throw Object.assign(new Error("Conflicto"), { status: 409 }); };
  await other.w.app.startNavigation();
  assert.deepEqual(other.log.failures, ["No se pudo iniciar el viaje"], "si la carga sigue siendo suya, el error se muestra como antes");
  assert.equal(other.data.activeLoadOrder.backendId, 12);
});

test("el texto de la cancelación vive en un solo lugar y no incluye el motivo", () => {
  const { service: s } = driver();
  const notice = s.lostLoadNotice({ loadId: 12, label: "CARGA-12", cancelled: true, wasProposal: false, status: "CANCELLED" });
  assert.deepEqual({ ...notice }, { title: "La carga CARGA-12 fue cancelada.", description: "", tone: "warning", alert: true });
  for (const file of ["js/app.js", "js/views/driverApp.js"]) {
    assert.doesNotMatch(readFileSync(file, "utf8"), /fue cancelada|cancellationReason/, file);
  }
  assert.equal(readFileSync("js/dataService.js", "utf8").match(/fue cancelada/g).length, 1);
});

test("en ruta el conductor primero llega al cargue y registra la recogida; solo después puede entregar", () => {
  const text = (over) => {
    const d = driver();
    d.data.activeLoadOrder = d.service.mapLoad(raw(12, "IN_TRANSIT", "ACCEPTED", { tripStartedAt: "2026-11-24T07:00:00", ...over }));
    return screen(d.w, d.state).body.textContent.replace(/\s+/g, " ");
  };
  const going = text({});
  assert.match(going, /Camino al punto de cargue/);
  assert.match(going, /Navegar al punto de cargue/);
  assert.match(going, /Llegué al punto de cargue/);
  assert.doesNotMatch(going, /registrar entrega/);

  const there = text({ arrivedAtPickupAt: "2026-11-24T08:00:00" });
  assert.match(there, /En el punto de cargue/);
  assert.match(there, /Carga recogida: salir al destino/);
  assert.doesNotMatch(there, /registrar entrega|Llegué al punto de cargue/);

  const loaded = text({ arrivedAtPickupAt: "2026-11-24T08:00:00", pickedUpAt: "2026-11-24T08:40:00" });
  assert.match(loaded, /Llegué: registrar entrega/);
  assert.match(loaded, /recogida/);
  assert.doesNotMatch(loaded, /Carga recogida: salir al destino/);
});

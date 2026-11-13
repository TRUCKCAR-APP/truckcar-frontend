// "Mis envíos" (HU2.1): búsqueda, orden, páginas, errores, validación, cancelación y estado en vivo (KAN-47).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";

/** Panel y controlador del generador con dependencias mínimas simuladas. */
function setup({ loads = [], errors = {}, sheetAnswer = null, cancelError = null } = {}) {
  const w = new JSDOM("<!doctype html><body><div data-shipment-results></div></body>", { runScripts: "outside-only" }).window;
  const toasts = [];
  const calls = { cancel: [], refresh: 0, published: 0, prompt: [] };
  w.ui = {
    escape: (v) => String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"),
    toast: (message, type, opts) => toasts.push({ message, type, description: opts && opts.description }),
    failure: (title, error) => toasts.push({ message: title, type: "error", description: error.message }),
    errorMessage: (e) => e.message,
    syncBanner: () => ""
  };
  w.PodUI = { formatDate: (d) => String(d) };
  w.Native = { haptic() {} };
  w.TruckCarConfig = { assignmentMaxAttempts: 5 };
  w.TruckCarData = { publishedLoads: loads };
  w.store = {
    state: { isAuthenticated: true, shipmentFilter: "ALL", selectedShipmentId: null, dataStatus: { errors, loading: false } },
    setState(partial) { this.state = { ...this.state, ...partial }; }
  };
  w.Sheet = { prompt: async (opts) => { calls.prompt.push(opts); return sheetAnswer; } };
  w.TruckCarService = {
    refreshShipments: async () => { calls.refresh++; },
    loadPublishedLoads: async () => { calls.published++; },
    cancelLoad: async (id, reason) => { calls.cancel.push({ id, reason }); if (cancelError) throw cancelError; },
    publishLoad: async () => { throw w.publishError; }
  };
  w.eval(readFileSync("js/views/generatorPanel.js", "utf8"));
  const text = (html) => new JSDOM(`<div>${html}</div>`).window.document.body.textContent.replace(/\s+/g, " ").trim();
  return { w, panel: w.GeneratorPanel, ctrl: w.generatorCtrl, toasts, calls, text };
}

let seq = 0;
const load = (fields = {}) => {
  const id = fields.backendId ?? ++seq;
  return {
    backendId: id, id: "CARGA-" + id, cargoType: "Cemento", status: "AVAILABLE", assignmentStatus: null,
    origin: { city: "Bogotá" }, destination: { city: "Cali" }, netWeight: 10,
    publishedAt: "2026-11-0" + ((id % 9) + 1) + "T10:00:00", raw: {}, ...fields
  };
};

test("ordena por publicación, la más reciente primero, sin depender del backend", () => {
  const { panel } = setup();
  const sorted = panel.sortLoads([
    load({ backendId: 1, publishedAt: "2026-11-01T10:00:00" }),
    load({ backendId: 3, publishedAt: "2026-11-03T10:00:00" }),
    load({ backendId: 2, publishedAt: "2026-11-03T10:00:00" })
  ]);
  assert.deepEqual(Array.from(sorted, l => l.backendId), [3, 2, 1]);
});

test("busca por número, descripción o ciudad, sin importar tildes ni mayúsculas", () => {
  const { panel } = setup();
  const l = load({ backendId: 42, cargoType: "Café en grano", destination: { city: "Medellín" } });
  for (const q of ["42", "carga-42", "CAFE", "medellin", "bogotá", ""]) assert.ok(panel.matchesQuery(l, q), q);
  assert.ok(!panel.matchesQuery(l, "tunja"));
});

test("la búsqueda repinta solo los resultados y anuncia cuántos coinciden", () => {
  const loads = [load({ cargoType: "Arroz" }), load({ cargoType: "Cemento gris" }), load({ cargoType: "Cemento blanco" })];
  const { w, ctrl, text } = setup({ loads });
  ctrl.setQuery("cemento");
  const results = w.document.querySelector("[data-shipment-results]");
  assert.match(text(results.innerHTML), /^2 de 3 envíos/);
  assert.equal(results.querySelectorAll('[role="listitem"]').length, 2);
  assert.equal(results.querySelector("[data-shipments-summary]").getAttribute("aria-live"), "polite");
  ctrl.setQuery("zzz");
  assert.match(text(results.innerHTML), /Ningún envío coincide con «zzz»/);
});

test("con más de 50 envíos muestra páginas de 50", () => {
  const loads = Array.from({ length: 120 }, (_, i) => load({ backendId: 1000 + i }));
  const { panel, ctrl, w } = setup({ loads });
  const count = () => new JSDOM(panel.renderResults(w.store.state, loads)).window.document.querySelectorAll('[role="listitem"]').length;
  assert.equal(count(), 50);
  assert.match(panel.renderResults(w.store.state, loads), /Mostrar 50 más/);
  ctrl.showMore();
  ctrl.showMore();
  assert.equal(count(), 120);
  assert.doesNotMatch(panel.renderResults(w.store.state, loads), /Mostrar/);
});

test("un error de red sin envíos muestra el estado de error con Reintentar", async () => {
  const { panel, w, text, calls } = setup({ errors: { shipments: "No hay conexión con el API Gateway" } });
  const html = panel.renderResults(w.store.state, []);
  assert.match(text(html), /No se pudieron cargar sus envíos.*No hay conexión.*Reintentar/);
  assert.match(html, /role="alert"/);
  await w.generatorCtrl.refresh(true);
  assert.equal(calls.refresh, 1);
  // Con envíos ya cargados el error no los oculta: aviso y Reintentar sobre la lista.
  const stale = panel.renderResults(w.store.state, [load()]);
  assert.match(text(stale), /No se pudo actualizar la lista\. Reintentar/);
  assert.match(stale, /role="listitem"/);
});

test("valida como el backend: descripción hasta 255, peso hasta 60 t, origen distinto del destino", () => {
  const { panel } = setup();
  const base = { cargoDescription: "x", weightTons: 10, originCity: "Bogotá", destinationCity: "Cali", offeredBudget: 2000 };
  assert.equal(Object.keys(panel.validate(base)).length, 0);
  assert.match(panel.validate({ ...base, cargoDescription: "a".repeat(256) }).cargoDescription, /255/);
  assert.match(panel.validate({ ...base, weightTons: 61 }).weightTons, /60 t/);
  assert.match(panel.validate({ ...base, destinationCity: "bogota" }).destinationCity, /distinto del origen/);
  assert.match(panel.validate({ ...base, offeredBudget: 0 }).offeredBudget, /1\.000/);
});

test("un 400 del backend se muestra en su campo y lleva al paso que lo contiene", async () => {
  const { w, ctrl } = setup();
  ctrl.draft();
  Object.assign(ctrl.draft(), { cargoDescription: "Cemento", weightTons: "10", originCity: "Bogotá", destinationCity: "Cali", offeredBudget: "2000" });
  w.publishError = Object.assign(new Error("Datos inválidos"), {
    status: 400, details: { details: { destinationLatitude: "La latitud de destino es obligatoria", weightTons: "El peso debe ser mayor a 0" } }
  });
  await ctrl.publish();
  assert.deepEqual({ ...ctrl.serverErrors() }, {
    destinationCity: "La latitud de destino es obligatoria", weightTons: "El peso debe ser mayor a 0"
  });
  assert.equal(ctrl.step(), 0, "el primer paso con errores es el de la carga");
  assert.equal(w.store.state.generatorFormError, "Revise los campos marcados.");
  ctrl.updateDraft({ target: { name: "weightTons", value: "12", form: null }, type: "input" });
  assert.equal(ctrl.serverErrors().weightTons, undefined, "corregir el campo quita su error del backend");
});

test("cancelar pide el motivo en una hoja y lo envía", async () => {
  const l = load({ backendId: 7 });
  const { ctrl, calls, toasts } = setup({ loads: [l], sheetAnswer: "  El cliente canceló el pedido  " });
  await ctrl.cancel(7);
  assert.equal(calls.prompt.length, 1);
  assert.match(calls.prompt[0].title, /CARGA-7/);
  assert.deepEqual(calls.cancel, [{ id: 7, reason: "El cliente canceló el pedido" }]);
  assert.match(toasts.at(-1).message, /cancelado/);
});

test("cerrar la hoja no cancela; un 409 avisa que ya no se puede y refresca", async () => {
  const closed = setup({ sheetAnswer: null });
  await closed.ctrl.cancel(7);
  assert.equal(closed.calls.cancel.length, 0);

  const conflict = Object.assign(new Error("No puede cancelarse en IN_TRANSIT"), { status: 409 });
  const { ctrl, calls, toasts } = setup({ sheetAnswer: "Motivo", cancelError: conflict });
  await ctrl.cancel(7);
  assert.equal(toasts.at(-1).type, "warning");
  assert.match(toasts.at(-1).message, /ya no se puede cancelar/);
  assert.equal(calls.refresh, 1, "la lista se refresca para mostrar el estado real");
});

test("el botón de cancelar solo aparece en AVAILABLE o ASSIGNED", () => {
  for (const [status, visible] of [["AVAILABLE", true], ["ASSIGNED", true], ["IN_TRANSIT", false], ["DELIVERED", false], ["CANCELLED", false]]) {
    const l = load({ status, assignmentStatus: status === "AVAILABLE" ? null : "ACCEPTED" });
    const { panel, w } = setup({ loads: [l] });
    w.store.state.selectedShipmentId = l.backendId;
    w.store.state.currentUser = { firstName: "G", lastName: "H" };
    w.CoordinatorPanel = { renderTabs: () => "" };
    w.document.body.innerHTML = panel.render(w.store.state);
    assert.equal(/Cancelar envío/.test(w.document.body.textContent), visible, status);
  }
});

test("estado en vivo: la aceptación actualiza la línea de tiempo al instante y avisa al generador", () => {
  const l = load({ backendId: 21, assignmentStatus: "NOTIFIED", assignedDriverName: "Carlos" });
  const { w, ctrl, panel, toasts } = setup({ loads: [l] });
  ctrl.applyLiveStatus({ loadId: 21, eventType: "assignment.accepted", loadStatus: "ASSIGNED", assignmentStatus: "ACCEPTED",
    assignedDriverName: "Carlos Conductor", assignedVehiclePlate: "TDK-410", occurredAt: "2026-11-13T22:00:00Z" });

  assert.equal(l.status, "ASSIGNED");
  assert.equal(l.assignmentStatus, "ACCEPTED");
  assert.equal(l.assignedAt, "2026-11-13T22:00:00Z");
  assert.ok(w.store.state.shipmentsVersion, "se repinta sin esperar al polling");
  assert.equal(toasts.at(-1).message, "Su carga CARGA-21 fue aceptada por Carlos Conductor (TDK-410).");
  assert.equal(ctrl.highlightFor(21), "accepted", "el paso recién completado se anima");

  w.store.state.selectedShipmentId = 21;
  w.store.state.currentUser = { firstName: "G", lastName: "H" };
  w.CoordinatorPanel = { renderTabs: () => "" };
  w.document.body.innerHTML = panel.render(w.store.state);
  const timeline = w.document.querySelector('ol[aria-label="Seguimiento del envío"]');
  assert.equal(timeline.getAttribute("aria-live"), "polite");
  assert.ok(timeline.querySelector(".animate-pulse"));

  // El mismo evento otra vez (o ya traído por el polling) no repite el aviso.
  ctrl.applyLiveStatus({ loadId: 21, eventType: "assignment.accepted", loadStatus: "ASSIGNED", assignmentStatus: "ACCEPTED" });
  assert.equal(toasts.length, 1);
});

test("estado en vivo: rechazo con intento n/5 y sin conductores como advertencia", () => {
  const l = load({ backendId: 30, assignmentStatus: "NOTIFIED", assignedDriverName: "Ana" });
  const { ctrl, panel, toasts, text } = setup({ loads: [l] });
  ctrl.applyLiveStatus({ loadId: 30, eventType: "assignment.rejected", loadStatus: "AVAILABLE", assignmentStatus: "REJECTED",
    assignedDriverName: "Ana", assignmentAttempts: 2 });
  assert.equal(toasts.at(-1).message, "Ana rechazó CARGA-30; se busca otro conductor (intento 2/5).");
  assert.match(text(panel.matchingStep(l)), /Buscando otro conductor \(intento 2\/5\).*Ana la rechazó/);

  ctrl.applyLiveStatus({ loadId: 30, eventType: "assignment.unassigned", loadStatus: "AVAILABLE", assignmentStatus: "UNASSIGNED_NO_DRIVERS" });
  assert.equal(toasts.at(-1).type, "warning");
  assert.match(text(panel.matchingStep(l)), /Sin conductores disponibles/);
});

test("estado en vivo: la entrega o la cancelación recargan para traer quién recibió o el motivo", () => {
  const delivered = load({ backendId: 40, status: "IN_TRANSIT", assignmentStatus: "ACCEPTED" });
  const { ctrl, calls } = setup({ loads: [delivered] });
  ctrl.applyLiveStatus({ loadId: 40, eventType: "trip.delivered", loadStatus: "DELIVERED", assignmentStatus: "ACCEPTED" });
  assert.equal(delivered.status, "DELIVERED");
  assert.equal(calls.refresh, 1);
  // Una carga que el panel aún no tiene (recién publicada en otra pestaña) se trae completa.
  ctrl.applyLiveStatus({ loadId: 999, eventType: "assignment.proposed", loadStatus: "AVAILABLE", assignmentStatus: "PROPOSED" });
  assert.equal(calls.refresh, 2);
});

test("sigue en vivo hasta 20 envíos abiertos, más el que está abierto", () => {
  const open = Array.from({ length: 25 }, (_, i) => load({ backendId: 100 + i, publishedAt: "2026-11-01T10:" + String(i).padStart(2, "0") + ":00" }));
  const closed = [load({ backendId: 1, status: "DELIVERED" }), load({ backendId: 2, status: "CANCELLED" })];
  const { panel, w } = setup({ loads: [...open, ...closed] });
  const ids = panel.liveStatusLoadIds(w.store.state);
  assert.equal(ids.length, 20);
  assert.ok(ids.includes(124) && !ids.includes(100), "los más recientes");
  assert.ok(!ids.includes(1) && !ids.includes(2), "entregadas y canceladas ya no cambian");
  w.store.state.selectedShipmentId = 100;
  assert.ok(panel.liveStatusLoadIds(w.store.state).includes(100), "el envío abierto siempre se sigue");
});

test("telemetry.js suscribe /topic/trip.{id}.status y suelta las que ya no hacen falta", () => {
  const w = new JSDOM("<!doctype html><body></body>", { runScripts: "outside-only" }).window;
  w.TruckCarConfig = { gatewayUrl: "http://localhost:8000", apiBaseUrl: "http://localhost:8000/api/v1" };
  w.eval(readFileSync("js/telemetry.js", "utf8"));
  const subscribed = [];
  const released = [];
  w.TruckCarTelemetry.subscribe = (destination, handler) => {
    subscribed.push({ destination, handler });
    return () => released.push(destination);
  };
  const received = [];
  w.LiveTracking.followStatuses([21, 22], (msg) => received.push(msg.eventType));
  assert.deepEqual(subscribed.map(s => s.destination), ["/topic/trip.21.status", "/topic/trip.22.status"]);
  subscribed[0].handler({ loadId: 21, eventType: "assignment.accepted" });
  assert.deepEqual(received, ["assignment.accepted"]);

  w.LiveTracking.followStatuses([22], (msg) => received.push(msg.eventType));
  assert.deepEqual(released, ["/topic/trip.21.status"]);
  assert.equal(subscribed.length, 2, "la de la carga 22 no se duplica");
  w.LiveTracking.stopAll();
  assert.ok(released.includes("/topic/trip.22.status"));
});

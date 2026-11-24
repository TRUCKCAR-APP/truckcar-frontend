import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";

// «Cargas» de la transportadora: las de su flota con su avance y las propias, que publica para sus conductores.

function browser() {
  const w = new JSDOM("<!doctype html><body></body>", { runScripts: "outside-only", url: "http://localhost:5500/" }).window;
  const state = { isAuthenticated: true, activeRole: "company", companyTab: "loads", busyAction: null,
    dataStatus: { loading: false, errors: {}, lastSync: null }, currentUser: { firstName: "Andrea", lastName: "Salazar" } };
  w.store = { get state() { return state; }, setState: (patch) => Object.assign(state, patch) };
  w.eval(readFileSync("js/ui.js", "utf8"));
  const toasts = [];
  w.ui.toast = (title, type, options = {}) => toasts.push({ title, type, ...options });
  w.ui.failure = (title, error) => toasts.push({ title, type: "error", description: error.message });
  w.TruckCarConfig = { assignmentMaxAttempts: 5 };
  w.TruckCarData = {};
  w.eval(readFileSync("js/dataService.js", "utf8"));
  w.PodUI = { formatDate: (d) => String(d) };
  w.eval(readFileSync("js/views/generatorPanel.js", "utf8"));
  w.eval(readFileSync("js/views/companyLoads.js", "utf8"));
  const raw = (over) => ({ id: 1, status: "IN_TRANSIT", assignmentStatus: "ACCEPTED", originCity: "Funza", destinationCity: "Ibagué",
    weightTons: 20, cargoDescription: "Cemento", assignedDriverName: "Andrés Rojas", assignedVehiclePlate: "DEM-410",
    assignedAt: "2026-11-24T06:14:00", tripStartedAt: "2026-11-24T06:20:00", ...over });
  w.TruckCarData.company = { name: "Transportes Andinos S.A.S." };
  return { w, state, toasts, raw };
}

test("la empresa ve las cargas de su flota con su avance, y distingue las propias", () => {
  const { w, state, raw } = browser();
  w.TruckCarData.companyLoads = [
    w.TruckCarService.mapLoad(raw({ id: 4, arrivedAtPickupAt: "2026-11-24T07:05:00", generatorCompanyName: "Cementos del Centro" })),
    w.TruckCarService.mapLoad(raw({ id: 5, status: "AVAILABLE", assignmentStatus: "NOTIFIED", ownerCompanyId: "c-andinos", tripStartedAt: null })),
    w.TruckCarService.mapLoad(raw({ id: 3, status: "DELIVERED", pickedUpAt: "2026-11-24T07:40:00", deliveredAt: "2026-11-24T11:00:00",
      podReceiverName: "Bodega Ibagué", podHasSignature: true }))];
  w.document.body.innerHTML = w.CompanyLoads.render(state);
  const card = (id) => w.document.querySelector(`[data-company-load="${id}"]`).textContent.replace(/\s+/g, " ");
  assert.match(card(4), /CARGA-4 · Funza → Ibagué/);
  assert.match(card(4), /Cementos del Centro/);
  assert.match(card(4), /En el punto de cargue/);
  assert.match(card(4), /Conductor: Andrés Rojas · DEM-410/);
  assert.match(card(5), /Carga propia/);
  assert.match(card(5), /Propuesta a Andrés Rojas/);
  assert.match(card(5), /Cancelar/, "la empresa cancela su carga propia antes de que salga");
  assert.match(card(3), /Entregada · recibió Bodega Ibagué/);
  assert.match(card(3), /Prueba de entrega/);
  assert.match(w.document.body.textContent, /En curso \(2\)[\s\S]*Terminadas \(1\)/);
});

test("publicar una carga propia valida el formulario y envía las coordenadas de las ciudades del catálogo", async () => {
  const { w, state, toasts } = browser();
  w.TruckCarData.companyLoads = [];
  const sent = [];
  w.TruckCarService.publishOwnLoad = async (request) => { sent.push(request); return { id: "CARGA-9" }; };
  w.CompanyLoads.toggleForm(true);
  w.document.body.innerHTML = w.CompanyLoads.render(state);
  assert.ok(w.document.querySelector("[data-own-load-form]"));

  await w.CompanyLoads.publish();
  assert.equal(sent.length, 0, "sin datos no se envía");
  w.document.body.innerHTML = w.CompanyLoads.render(state);
  assert.match(w.document.body.textContent, /Describa la carga\.[\s\S]*Elija una ciudad de la lista\./);

  const set = (name, value) => w.CompanyLoads.input({ target: Object.assign(w.document.createElement("input"), { name, value }) });
  set("cargoDescription", "Cemento ensacado");
  set("weightTons", "20");
  set("requiredTruckType", "TRACTOMULA_3S3");
  set("originCity", "Bogotá");
  set("destinationCity", "Medellín");
  set("offeredBudget", "2500000");
  await w.CompanyLoads.publish();
  assert.equal(sent.length, 1);
  assert.equal(sent[0].generatorCompanyName, "Transportes Andinos S.A.S.");
  assert.equal(sent[0].originCity, "Bogotá");
  assert.equal(sent[0].originLatitude, 4.6097);
  assert.equal(sent[0].destinationDepartment, "Antioquia");
  assert.equal(sent[0].offeredBudget, 2500000);
  assert.match(toasts.at(-1).title, /CARGA-9 publicada para su flota/);
  assert.equal(w.document.querySelector("[data-own-load-form]") && w.CompanyLoads.render(state).includes("data-own-load-form"), false);
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";

// Transportadoras y afiliación: tipos de cuenta del registro, vista de la transportadora y avisos del conductor.

function env(state = {}) {
  const w = new JSDOM("<!doctype html><body></body>", { runScripts: "outside-only" }).window;
  const store = { dataStatus: { loading: false, errors: {}, lastSync: null }, ...state };
  w.store = { get state() { return store; }, getState: () => store, setState: (patch) => Object.assign(store, patch) };
  w.eval(readFileSync("js/ui.js", "utf8"));
  w.TruckCarData = {};
  w.TruckCarApi = { session: { get: () => null } };
  w.eval(readFileSync("js/dataService.js", "utf8"));
  w.eval(readFileSync("js/views/loginView.js", "utf8"));
  w.eval(readFileSync("js/views/companyPanel.js", "utf8"));
  return { w, store };
}

const form = (w, values) => {
  const data = new w.FormData();
  for (const [k, v] of Object.entries(values)) data.append(k, v);
  return data;
};

const BASE = { email: " diego@truckcar.co ", password: "Segura123!", firstName: "Diego ", lastName: "Montes", phoneNumber: "" };

test("el registro envía rol, tipo de conductor y empresa según el tipo de cuenta elegido", () => {
  const { w } = env();
  const payload = (extra) => JSON.parse(JSON.stringify(w.LoginView.registrationPayload(form(w, { ...BASE, ...extra }))));

  assert.deepEqual(payload({ accountType: "CONDUCTOR_INDEPENDIENTE" }), {
    email: "diego@truckcar.co", password: "Segura123!", firstName: "Diego", lastName: "Montes", phoneNumber: null,
    role: "CONDUCTOR", driverType: "INDEPENDIENTE" });
  const company = payload({ accountType: "CONDUCTOR_EMPRESA", companyId: "c-1" });
  assert.equal(company.role, "CONDUCTOR");
  assert.equal(company.driverType, "EMPRESA");
  assert.equal(company.companyId, "c-1");
  const carrier = payload({ accountType: "TRANSPORTADORA", companyName: " Transportes Andinos ", companyNit: "900123456-7" });
  assert.equal(carrier.role, "TRANSPORTADORA");
  assert.equal(carrier.companyName, "Transportes Andinos");
  assert.equal(carrier.companyNit, "900123456-7");
  assert.equal(carrier.driverType, undefined);
  assert.deepEqual(Object.keys(payload({ accountType: "GENERADOR" })).includes("driverType"), false);
});

test("el formulario de registro muestra los cuatro tipos y solo habilita los campos del tipo elegido", () => {
  const { w } = env({ authMode: "register" });
  w.TruckCarConfig = { gatewayUrl: "https://api", demoTools: false };
  w.document.body.innerHTML = w.LoginView.render(w.store.state);
  const select = w.document.querySelector('select[name="accountType"]');
  assert.deepEqual([...select.options].map(o => o.value),
    ["CONDUCTOR_INDEPENDIENTE", "CONDUCTOR_EMPRESA", "TRANSPORTADORA", "GENERADOR"]);
  const companyName = w.document.querySelector('input[name="companyName"]');
  assert.equal(companyName.disabled, true, "oculto: no se valida ni se envía");

  w.TruckCarService.loadCompanyCatalog = async () => [];
  select.value = "TRANSPORTADORA";
  w.LoginView.onAccountType(select);
  assert.equal(companyName.disabled, false);
  assert.equal(w.document.querySelector('[data-account-group="TRANSPORTADORA"]').hidden, false);
  assert.equal(w.document.querySelector('select[name="companyId"]').disabled, true);
  assert.match(w.document.querySelector("[data-account-help]").textContent, /Registra a sus conductores/);
});

test("la transportadora tiene su propia vista y no entra a la torre ni a la app del conductor", () => {
  const { w } = env();
  const access = w.TruckCarService.roleAccess("TRANSPORTADORA");
  assert.equal(access.home, "company");
  assert.equal(access.singleView, true);
  assert.equal(access.controlTower, false);
  assert.equal(access.driver, false);
  assert.equal(w.TruckCarService.roleAccess("GENERADOR").singleView, true);
  assert.equal(w.TruckCarService.roleAccess("COORDINADOR").singleView, false);
});

test("Mis conductores: solicitudes pendientes primero con Aprobar y Rechazar, y los afiliados con Desvincular", () => {
  const { w, store } = env({ currentUser: { firstName: "Laura", lastName: "Gómez", status: "ACTIVE" } });
  w.TruckCarData.company = { id: "c-1", name: "Transportes Andinos", nit: "900123456", activeDrivers: 1, pendingRequests: 1 };
  w.TruckCarData.companyDrivers = [
    { id: "d-1", firstName: "Jorge", lastName: "Pardo", email: "j@t.co", status: "ACTIVE", affiliationStatus: "ACTIVA" },
    { id: "d-2", firstName: "Diego", lastName: "Montes", email: "d@t.co", status: "PENDING_VERIFICATION", affiliationStatus: "PENDIENTE" }
  ];
  w.ui.syncBanner = () => "";
  w.document.body.innerHTML = w.CompanyPanel.render(store);
  const cards = [...w.document.querySelectorAll("[data-company-driver]")].map(c => c.dataset.companyDriver);
  assert.deepEqual(cards, ["d-2", "d-1"], "la solicitud pendiente va primero");
  const pending = w.document.querySelector('[data-company-driver="d-2"]');
  assert.match(pending.textContent, /Aprobar/);
  assert.match(pending.textContent, /Rechazar/);
  assert.match(pending.textContent, /Cuenta sin verificar/);
  assert.match(w.document.querySelector('[data-company-driver="d-1"]').textContent, /Desvincular/);
  assert.match(w.document.body.textContent, /Transportes Andinos · NIT 900123456/);
});

test("sin conductores la vista invita a registrarlos, y un error de red ofrece reintentar", () => {
  const { w, store } = env({ currentUser: null });
  w.ui.syncBanner = () => "";
  w.TruckCarData.company = { id: "c-1", name: "Rutas", nit: "901", activeDrivers: 0, pendingRequests: 0 };
  w.TruckCarData.companyDrivers = [];
  w.document.body.innerHTML = w.CompanyPanel.render(store);
  assert.match(w.document.body.textContent, /No hay solicitudes pendientes/);
  assert.match(w.document.body.textContent, /Aún no tiene conductores/);

  w.TruckCarData.company = null;
  store.dataStatus.errors = { company: { message: "Sin conexión" } };
  w.document.body.innerHTML = w.CompanyPanel.render(store);
  assert.match(w.document.body.textContent, /No se pudo cargar su empresa/);
  assert.match(w.document.body.textContent, /Reintentar/);
});

test("el conductor sabe por qué no recibe cargas según su afiliación", () => {
  const { w } = env();
  const reason = (u) => w.DriverAffiliation.loadsBlockedReason({ role: "CONDUCTOR", ...u });
  assert.match(reason({ driverType: "INDEPENDIENTE" }), /independiente/);
  assert.match(reason({ driverType: "EMPRESA", companyName: "Andinos", affiliationStatus: "PENDIENTE" }), /Andinos aún no aprueba/);
  assert.match(reason({ driverType: "EMPRESA", companyName: "Andinos", affiliationStatus: "RECHAZADA" }), /rechazó/);
  assert.equal(reason({ driverType: "EMPRESA", affiliationStatus: "ACTIVA" }), null);
  assert.equal(reason({}), null, "cuenta anterior a la afiliación: sin aviso");
  assert.equal(w.DriverAffiliation.noticeHtml({ role: "CONDUCTOR" }), "");
  assert.match(w.DriverAffiliation.noticeHtml({ role: "CONDUCTOR", driverType: "INDEPENDIENTE" }), /Cambiar tipo de conductor/);
  assert.equal(w.DriverAffiliation.summary({ driverType: "EMPRESA", companyName: "Andinos", affiliationStatus: "ACTIVA" }),
    "Andinos · afiliación activa");
});

test("registrar un conductor propio valida nombre, correo y contraseña antes de enviar", () => {
  const { w } = env();
  const bad = w.companyCtrl.validateDriver({ firstName: "", lastName: "P", email: "no-es-correo", password: "123" });
  assert.equal(bad.driver, null);
  assert.deepEqual(Object.keys(bad.errors).sort(), ["email", "firstName", "password"]);
  const ok = w.companyCtrl.validateDriver({ firstName: " Jorge ", lastName: "Pardo", email: "j@t.co", password: "Inicial123", phoneNumber: "" });
  assert.deepEqual(JSON.parse(JSON.stringify(ok.driver)),
    { firstName: "Jorge", lastName: "Pardo", email: "j@t.co", phoneNumber: null, password: "Inicial123" });
});

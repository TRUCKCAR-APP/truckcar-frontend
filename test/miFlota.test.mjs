import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";

// «Mi flota» de la transportadora: sus conductores en el mapa con su estado. Los datos los filtra el servidor
// (fleets-drivers /company/fleet: solo afiliados ACTIVA de su empresa); aquí se comprueba lo que ve la empresa.

function browser() {
  const w = new JSDOM("<!doctype html><body></body>", { runScripts: "outside-only", url: "http://localhost:5500/" }).window;
  w.eval(readFileSync("js/ui.js", "utf8"));
  w.TruckCarData = {
    company: { name: "Transportes Andinos", nit: "900123456", activeDrivers: 3, pendingRequests: 0 },
    companyDrivers: [
      { id: "ana", firstName: "Ana", lastName: "Ruiz", email: "ana@x.co", affiliationStatus: "ACTIVA", status: "ACTIVE" },
      { id: "luis", firstName: "Luis", lastName: "Gil", email: "luis@x.co", affiliationStatus: "ACTIVA", status: "ACTIVE" },
      { id: "sara", firstName: "Sara", lastName: "Paz", email: "sara@x.co", affiliationStatus: "ACTIVA", status: "ACTIVE" }],
    companyFleet: [
      { driverId: "ana", driverName: "Ana Ruiz", plate: "DEM-410", vehicleType: "TRACTOMULA_3S3", model: "Kenworth T800", rawType: "TRACTOMULA_3S3", status: "EN_TRANSITO",
        coords: [4.7, -74.1], lastCheckin: "Hace 1 min", speed: 62, hoursActive: "3.5 h", remainingDrivingHours: 4.5, currentLoadId: 12 },
      { driverId: "luis", driverName: "Luis Gil", plate: "DEM-238", vehicleType: "TRACTOMULA_3S3", status: "DESCANSO",
        coords: [6.2, -75.5], lastCheckin: "Hace 5 min", speed: 0, hoursActive: "8 h", remainingDrivingHours: 0 }]
  };
  w.TruckCarService = { roleAccess: () => ({}), truckTypeLabel: (c) => (c === "TRACTOMULA_3S3" ? "Tractomula 3S3" : null) };
  w.TwoFactorUI = {};
  for (const file of ["js/views/companyPanel.js", "js/views/companyFleet.js"]) w.eval(readFileSync(file, "utf8"));
  return w;
}

const STATE = { dataStatus: { loading: false, errors: {}, lastSync: null }, currentUser: { firstName: "Dueño", lastName: "Andinos" } };

test("Mi flota es la pestaña por defecto: resumen por estado, sus conductores y quién no ha registrado camión", () => {
  const w = browser();
  w.document.body.innerHTML = w.CompanyPanel.render(STATE);
  const doc = w.document;
  assert.equal(doc.querySelector("h1").textContent, "Mi flota");
  assert.equal(doc.querySelector('[aria-current="page"]').textContent.trim(), "Mi flota");
  const summary = doc.querySelector("[data-company-fleet-summary]").textContent.replace(/\s+/g, " ");
  assert.match(summary, /En ruta 1/);
  assert.match(summary, /Descanso obligatorio 1/);
  assert.match(summary, /Disponibles 0/);
  const rows = [...doc.querySelectorAll("[data-company-fleet-driver]")].map((li) => li.textContent.replace(/\s+/g, " ").trim());
  assert.equal(rows.length, 2);
  assert.match(rows[0], /Ana Ruiz DEM-410 · Kenworth T800 · Tractomula 3S3 En ruta Carga #12 · 3\.5 h hoy · le quedan 4,5 h Última señal hace 1 min · 62 km\/h/);
  assert.match(rows[1], /Luis Gil .*Descanso obligatorio/);
  assert.match(doc.body.textContent, /Sin camión registrado: Sara Paz\./);
  assert.ok(doc.querySelector("[data-company-fleet-map-slot]"), "hay lugar para el mapa");
});

test("la pestaña Conductores sigue mostrando las afiliaciones; un error de la flota ofrece reintentar", () => {
  const w = browser();
  w.document.body.innerHTML = w.CompanyPanel.render({ ...STATE, companyTab: "drivers" });
  assert.equal(w.document.querySelector("h1").textContent, "Mis conductores");
  assert.equal(w.document.querySelectorAll("[data-company-driver]").length, 3);
  w.TruckCarData.companyFleet = null;
  w.document.body.innerHTML = w.CompanyPanel.render({ ...STATE, dataStatus: { errors: { companyFleet: "No pudimos conectar con TruckCar." } } });
  assert.match(w.document.body.textContent, /No se pudo cargar su flota[\s\S]*No pudimos conectar con TruckCar\.[\s\S]*Reintentar/);
});

test("la flota se pide a la ruta de la empresa (el servidor filtra por afiliación), nunca a la flota completa", () => {
  const api = readFileSync("js/api.js", "utf8");
  assert.match(api, /companyFleet: \(\) => http\.get\('\/fleets-drivers\/company\/fleet'\)/);
  const data = readFileSync("js/dataService.js", "utf8");
  assert.match(data, /async loadCompanyFleet\(\) \{\s*try \{\s*const states = await api\.fleet\.companyFleet\(\);/);
  const surface = readFileSync("js/surfaces/company.js", "utf8");
  assert.match(surface, /registerLoader\('company', \(\) => Promise\.all\(\[service\.loadCompany\(\), service\.loadCompanyFleet\(\)\]\)\)/);
  assert.doesNotMatch(readFileSync("js/views/companyFleet.js", "utf8"), /listActive/);
});

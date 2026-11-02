// Pantallas del conductor: textos que dependen de los datos del backend.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";

function driverApp() {
  const w = new JSDOM("<!doctype html><body></body>", { runScripts: "outside-only" }).window;
  w.eval(readFileSync("js/views/driverApp.js", "utf8"));
  return w.DriverApp;
}

test("los estados del backend se muestran en español, nunca como código", () => {
  const app = driverApp();
  assert.equal(app.statusLabel("IN_TRANSIT"), "En tránsito");
  assert.equal(app.statusLabel("ASSIGNED"), "Aceptada");
  assert.equal(app.statusLabel("PROPOSED"), "Propuesta");
  assert.equal(app.statusLabel("SIN_VEHICULO"), "Sin vehículo");
  assert.equal(app.statusLabel(null), "Sin estado");
  assert.equal(app.statusLabel("EN_REVISION"), "En revision", "un estado nuevo se lee como texto, no como código");
});

test("el perfil rotula el peso bruto como el actual (tara + carga a bordo), no como una capacidad máxima", () => {
  const w = new JSDOM("<!doctype html><body></body>", { runScripts: "outside-only" }).window;
  w.ui = { escape: (v) => String(v ?? "") };
  w.TruckCarData = { currentDriver: {
    name: "Carlos Conductor", status: "DISPONIBLE", hoursDrivenToday: 0, maxDailyHours: 9, rating: 4.8, tripsCompleted: 126,
    hasVehicle: true, badges: [],
    vehicle: { plate: "TDK-410", brand: "Kenworth T800", category: "TURBO", height: 3.9, grossWeight: 8.5, tareWeight: 8.5, netCargoWeight: 0, badges: [] }
  } };
  w.eval(readFileSync("js/views/driverApp.js", "utf8"));
  const text = new JSDOM(w.DriverApp.renderProfileScreen({ dataStatus: {} })).window.document.body.textContent.replace(/\s+/g, " ");

  assert.match(text, /Peso bruto actual \(tara \+ carga\)\s*8,5 t/);
  assert.match(text, /Tara\s*8,5 t/);
  assert.match(text, /Carga a bordo\s*0,0 t/);
  assert.doesNotMatch(text, /Peso Bruto Máx|Carga Útil/);
});

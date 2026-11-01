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

// Seguimiento del envío ("Mis envíos"): entre publicar y aceptar se ve qué está haciendo el motor de asignación.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";

function panel() {
  const w = new JSDOM("<!doctype html><body></body>", { runScripts: "outside-only" }).window;
  w.ui = { escape: (v) => String(v ?? "") };
  w.PodUI = { formatDate: (d) => String(d) };
  w.eval(readFileSync("js/views/generatorPanel.js", "utf8"));
  return w.GeneratorPanel;
}
const step = (load) => new JSDOM(`<ol>${panel().matchingStep(load)}</ol>`).window.document.body.textContent.replace(/\s+/g, " ").trim();
const load = (assignmentStatus, extra = {}) => ({
  status: "AVAILABLE", assignmentStatus, assignedDriverName: "Andrés Rojas",
  raw: { assignmentStatusChangedAt: "2026-11-07T16:00:00", assignmentAttempts: 1 }, ...extra
});

test("muestra a quién se le propuso la carga y que se espera su respuesta", () => {
  assert.match(step(load("NOTIFIED")), /Propuesta a Andrés Rojas.*esperando su respuesta/);
  assert.match(step(load("PROPOSED", { raw: { assignmentAttempts: 2 } })), /Propuesta a Andrés Rojas \(intento 2\)/);
});

test("explica por qué se busca otro conductor o por qué no hay ninguno", () => {
  assert.match(step(load("REJECTED")), /Buscando otro conductor.*la rechazó/);
  assert.match(step(load("TIMEOUT")), /Buscando otro conductor.*no respondió a tiempo/);
  assert.match(step(load("UNASSIGNED_NO_DRIVERS")), /Sin conductores disponibles.*cada 2 minutos/);
  assert.match(step(load(null)), /Buscando conductor/);
});

test("aceptada, en ruta, entregada o cancelada ya no muestran el paso del motor", () => {
  for (const status of ["ASSIGNED", "IN_TRANSIT", "DELIVERED", "CANCELLED"]) {
    assert.equal(panel().matchingStep(load("ACCEPTED", { status })), "", status);
  }
});

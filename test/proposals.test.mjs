// Propuesta en vivo al conductor: cuándo avisar y cuánto le queda para responder.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";

function driverApp() {
  const w = new JSDOM("<!doctype html><body></body>", { runScripts: "outside-only" }).window;
  w.ui = { escape: (v) => String(v ?? "") };
  w.TruckCarConfig = { assignmentResponseMinutes: 5 };
  w.eval(readFileSync("js/views/driverApp.js", "utf8"));
  return w.DriverApp;
}

const load = (id, status, assignmentStatus, changedAt) =>
  ({ backendId: id, status, assignmentStatus, raw: { assignmentStatusChangedAt: changedAt } });

test("avisa una propuesta nueva una sola vez y avisa cuando desaparece", () => {
  const app = driverApp();
  const notified = load(9, "AVAILABLE", "NOTIFIED");
  assert.equal(app.proposalChange(null, notified), "new");
  assert.equal(app.proposalChange(load(9, "AVAILABLE", "PROPOSED"), notified), "new", "PROPOSED aún no se puede responder");
  assert.equal(app.proposalChange(notified, notified), null, "la misma propuesta no se vuelve a anunciar");
  assert.equal(app.proposalChange(notified, null), "gone", "venció o la tomó otro conductor");
  assert.equal(app.proposalChange(notified, load(10, "AVAILABLE", "NOTIFIED")), "new", "otra carga es otra propuesta");
  assert.equal(app.proposalChange(notified, load(9, "ASSIGNED", "ACCEPTED")), null, "aceptarla no es perderla");
  assert.equal(app.proposalChange(null, load(9, "IN_TRANSIT", "ACCEPTED")), null);
});

test("la cuenta regresiva parte de cuando la propuesta quedó NOTIFIED y dura el plazo del servidor", () => {
  const app = driverApp();
  const changed = "2026-11-07T16:00:00";
  const deadline = app.proposalDeadline(load(9, "AVAILABLE", "NOTIFIED", changed), 5);
  assert.equal(deadline, new Date(changed).getTime() + 5 * 60 * 1000);
  assert.equal(app.countdownText(deadline, deadline - 4 * 60 * 1000 - 5000), "4:05");
  assert.equal(app.countdownText(deadline, deadline - 500), "0:01");
  assert.equal(app.countdownText(deadline, deadline), null, "a los 5 min ya venció");
  assert.equal(app.proposalDeadline(load(9, "AVAILABLE", "NOTIFIED", null), 5), null, "sin hora no se inventa un plazo");
});

test("la pantalla de la propuesta muestra el plazo junto a aceptar y rechazar", () => {
  const app = driverApp();
  const html = app.renderCountdown(load(9, "AVAILABLE", "NOTIFIED", new Date(Date.now() - 60 * 1000).toISOString()));
  const doc = new JSDOM(html).window.document;
  const box = doc.querySelector("[data-deadline]");
  assert.ok(box, "lleva la hora límite para actualizarla cada segundo");
  assert.match(box.textContent, /Responda en \d:\d\d/);
  const expired = app.renderCountdown(load(9, "AVAILABLE", "NOTIFIED", new Date(Date.now() - 6 * 60 * 1000).toISOString()));
  assert.match(new JSDOM(expired).window.document.body.textContent, /El plazo venció/);
});

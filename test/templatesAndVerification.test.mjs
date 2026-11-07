// Plantillas de notificación (torre, solo ADMIN) y cuenta pendiente de verificación (app del conductor).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";

function windowWith(files, setup = () => {}) {
  const w = new JSDOM("<!doctype html><body></body>", { runScripts: "outside-only" }).window;
  w.ui = { escape: (v) => String(v ?? "").replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`), syncBanner: () => "" };
  setup(w);
  for (const file of files) w.eval(readFileSync(file, "utf8"));
  return w;
}
const same = (actual, expected) => assert.deepEqual(JSON.parse(JSON.stringify(actual)), expected);

test("las variables de una plantilla se leen en orden y sin repetir", () => {
  const w = windowWith(["js/views/towerAdmin.js"]);
  same(w.TowerAdmin.templateVariables("Carga {{loadId}} ({{ruta}}): {{reason}}. Ver {{ loadId }}"), ["loadId", "ruta", "reason"]);
  same(w.TowerAdmin.templateVariables("Sin variables"), []);
});

test("Plantillas es una pestaña solo del ADMIN y lista cada plantilla con su canal y su texto", () => {
  const templates = [
    { id: "t1", category: "REASIGNACION_CARGA", channel: "PUSH", language: "es-CO", templateText: "Carga {{loadId}} ({{ruta}}): {{reason}}." },
    { id: "t2", category: "ALERTA_RUTA", channel: "VOICE", language: "es-CO", templateText: "Atención conductor." }
  ];
  const w = windowWith(["js/views/driverApp.js", "js/views/coordinatorPanel.js", "js/views/towerAdmin.js"], (win) => {
    win.TruckCarData = { templates, fleetVehicles: [], communityAlerts: [] };
  });
  const P = w.CoordinatorPanel;
  assert.equal(P.activeTab({ coordinatorTab: "templates", sessionRole: "ADMIN" }), "templates");
  assert.equal(P.activeTab({ coordinatorTab: "templates", sessionRole: "COORDINADOR" }), "fleet");
  const tabs = (role) => [...new JSDOM(P.renderTabs({ coordinatorTab: "fleet", sessionRole: role })).window.document
    .querySelectorAll('[role="tab"]')].map((b) => b.getAttribute("aria-label"));
  assert.ok(tabs("ADMIN").includes("Plantillas"));
  assert.ok(!tabs("COORDINADOR").includes("Plantillas"));

  const doc = new JSDOM(w.TowerAdmin.render({
    coordinatorTab: "templates", sessionRole: "ADMIN", currentUser: { id: "a" }, dataStatus: { errors: {} },
    adminStatus: { templates: "ready" }
  }, "templates")).window.document;
  const cards = [...doc.querySelectorAll("article")];
  assert.equal(cards.length, 2);
  assert.match(cards[0].textContent, /Push · es-CO/);
  assert.match(cards[0].textContent, /Propuesta, asignación o reasignación de carga/);
  assert.match(cards[0].textContent, /Carga \{\{loadId\}\}/);
  assert.match(cards[1].textContent, /Voz · es-CO/);
});

test("el conductor con la cuenta pendiente sabe por qué no recibe cargas", () => {
  const w = windowWith(["js/views/driverApp.js"], (win) => {
    win.TruckCarData = { currentDriver: { name: "Laura", status: "SIN_VEHICULO", hoursDrivenToday: 0, maxDailyHours: 9, rating: "—",
      tripsCompleted: 0, vehicle: null, state: null } };
  });
  const pending = { currentUser: { status: "PENDING_VERIFICATION" }, dataStatus: {} };
  const verified = { currentUser: { status: "ACTIVE" }, dataStatus: {} };
  const text = (html) => new JSDOM(html).window.document.body.textContent.replace(/\s+/g, " ");

  assert.match(text(w.DriverApp.renderProfileScreen(pending)), /Cuenta pendiente de verificación/);
  assert.doesNotMatch(text(w.DriverApp.renderProfileScreen(verified)), /pendiente de verificación/);
  assert.match(text(w.DriverApp.renderAssignedLoadScreen(pending)), /recibirá cargas cuando un administrador la verifique/);
  assert.match(text(w.DriverApp.renderAssignedLoadScreen(verified)), /Cuando el sistema le proponga una carga/);
});

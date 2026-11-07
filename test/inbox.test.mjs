// Bandeja "Para usted" del conductor: qué cuenta como nuevo y cómo se muestra cada notificación.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";

function windowWith(notifications) {
  const w = new JSDOM("<!doctype html><body></body>", { runScripts: "outside-only", url: "https://truckcar.test/" }).window;
  w.ui = { escape: (v) => String(v ?? "").replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`) };
  w.store = { state: { currentUser: { id: "u-1" }, dataStatus: { errors: {} } }, setState() {} };
  w.TruckCarData = {};
  w.TruckCarApi = { notifications: { forUser: async () => ({ content: notifications }) } };
  w.eval(readFileSync("js/dataService.js", "utf8"));
  w.eval(readFileSync("js/views/driverApp.js", "utf8"));
  return w;
}

const N = (id, minutesAgo, extra = {}) => ({
  id, category: "REASIGNACION_CARGA", channel: "PUSH", status: "SENT", audioUrl: null,
  payload: `Carga ${id} (Bogotá → Tunja): se la propone el motor de asignación.`,
  createdAt: new Date(Date.now() - minutesAgo * 60000).toISOString(), ...extra
});

test("lo nuevo se cuenta hasta que el conductor abre la bandeja, y se recuerda por usuario", async () => {
  const w = windowWith([N("a", 1), N("b", 5)]);
  const s = w.TruckCarService;
  await s.loadNotifications();
  assert.equal(s.unreadNotifications(), 2);
  assert.match(w.DriverApp.inboxBadgeHtml(), /driver-tab-count[^>]*>2</);

  s.markNotificationsSeen();
  assert.equal(s.unreadNotifications(), 0);
  assert.equal(w.DriverApp.inboxBadgeHtml(), "", "sin nuevas no hay número sobre la pestaña");
  assert.equal(w.localStorage.getItem("truckcar.inbox.seen.u-1") !== null, true);

  w.store.state.currentUser = { id: "u-2" };
  assert.equal(s.unreadNotifications(), 2, "otro usuario del mismo teléfono no hereda lo leído");
});

test("cada notificación muestra su tipo y texto; un envío fallido lo dice y el audio solo si es https", async () => {
  const w = windowWith([
    N("a", 2),
    N("b", 3, { status: "FAILED", category: "ALERTA_RUTA", payload: "Derrumbe en el km 40" }),
    N("c", 4, { audioUrl: "https://bucket.s3.amazonaws.com/voz.mp3?firma=1" }),
    N("d", 5, { audioUrl: "javascript:alert(1)" })
  ]);
  await w.TruckCarService.loadNotifications();
  const doc = new JSDOM(w.DriverApp.renderInbox({})).window.document;
  const items = [...doc.querySelectorAll("article")];
  assert.equal(items.length, 4);
  assert.match(items[0].textContent, /Carga ·/);
  assert.match(items[0].textContent, /Bogotá → Tunja/);
  assert.match(items[1].textContent, /Alerta en la ruta/);
  assert.match(items[1].textContent, /No se pudo enviar al teléfono/);
  assert.equal(doc.querySelectorAll("audio").length, 1, "solo la URL https se reproduce");
});

test("sin notificaciones, la bandeja explica qué llegará aquí", () => {
  const w = windowWith([]);
  const text = new JSDOM(w.DriverApp.renderInbox({})).window.document.body.textContent;
  assert.match(text, /Sin notificaciones/);
  assert.match(text, /cargas que le propongan/);
});

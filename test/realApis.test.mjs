// SOS del conductor, SOS en la torre, enlace de seguimiento del generador y vista pública: sin simulaciones, contra
// un TruckCarService / TruckCarApi falsos que registran lo que la interfaz pide al backend.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";

const SCRIPTS = ["js/ui/toaster.js", "js/ui/sheet.js", "js/ui/native.js", "js/views/driverActions.js",
  "js/views/generatorPanel.js", "js/views/sosMonitor.js", "js/views/publicTracking.js"];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function browser({ url = "http://localhost:5500/", service = {}, api = {}, state = {} } = {}) {
  const dom = new JSDOM(`<!doctype html><html><body><div id="phone-mockup-frame"><div id="app-mount"></div></div></body></html>`,
    { runScripts: "outside-only", pretendToBeVisual: true, url });
  const w = dom.window;
  w.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  const toasts = [];
  w.ui = {
    escape: (v) => String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"),
    toast: (title, type, options) => toasts.push({ title, type, ...options }),
    failure: (title, error) => toasts.push({ title, type: "error", description: error.message }),
    errorMessage: (e) => (e && e.message) || String(e)
  };
  w.store = { state: { isAuthenticated: true, activeRole: "driver", sessionRole: "CONDUCTOR", ...state }, setState() {}, subscribe() {} };
  w.OfflineQueue = { status: () => ({ pending: 0 }), onChange() {} };
  w.TruckCarTelemetry = { status: "online", onStatusChange() {} };
  w.voiceEngine = { speak() {} };
  w.app = { currentPosition: () => [4.60971, -74.08175] };
  w.TruckCarData = { activeLoadOrder: { id: "CARGA-30", backendId: 30 }, currentDriver: { name: "Ana Ruiz", vehicle: { plate: "TDK-410" } } };
  w.TruckCarService = service;
  w.TruckCarApi = { loads: api };
  SCRIPTS.forEach((file) => w.eval(readFileSync(file, "utf8")));
  return { w, toasts };
}

test("el SOS envía la posición actual y muestra el id y la hora que confirma el servidor", async () => {
  const calls = [];
  const { w } = browser({ service: {
    triggerSos: async (coords, accuracy) => {
      calls.push({ coords, accuracy });
      return { id: 41, status: "ACTIVE", receivedAt: "2026-10-31T15:04:00Z" };
    }
  } });
  const done = w.DriverActions.activate();
  await sleep(30);

  assert.deepEqual(calls.map((c) => Array.from(c.coords)), [[4.60971, -74.08175]]);
  const status = w.document.querySelector("[data-sos-status]").textContent;
  assert.match(status, /Torre de control avisada/);
  assert.match(status, /SOS #41/);
  assert.doesNotMatch(w.document.body.textContent, /demostración/i);
  assert.ok(w.document.querySelector("[data-sheet-action='0']").textContent.includes("Llamar al 123"));

  w.document.querySelector("[data-sheet-action='1']").click();
  await done;
});

test("sin señal el SOS queda guardado y la hoja lo dice; un error del servidor también se muestra", async () => {
  const { w } = browser({ service: { triggerSos: async () => ({ id: null, pendingSync: true }) } });
  const done = w.DriverActions.activate();
  await sleep(30);
  assert.match(w.document.querySelector("[data-sos-status]").textContent, /guardado sin señal/);
  w.document.querySelector("[data-sheet-action='1']").click();
  await done;

  const failing = browser({ service: { triggerSos: async () => { throw new Error("Error HTTP 500"); } } });
  const again = failing.w.DriverActions.activate();
  await sleep(30);
  assert.match(failing.w.document.querySelector("[data-sos-status]").textContent, /No se pudo enviar el SOS.*Error HTTP 500/s);
  failing.w.document.querySelector("[data-sheet-action='1']").click();
  await again;
});

test("el enlace de seguimiento muestra la URL firmada que devuelve el backend y su vencimiento", async () => {
  const requested = [];
  const url = "https://truckcar.example.com/?track=djF8MzB8.c2lnbmF0dXJl";
  const { w } = browser({ state: { activeRole: "generator", sessionRole: "GENERADOR" }, service: {
    createTrackingLink: async (loadId) => { requested.push(loadId); return { token: "djF8MzB8.c2lnbmF0dXJl", url, expiresAt: "2026-11-02T15:00:00Z" }; }
  } });

  await w.generatorCtrl.shareTracking(30);
  await sleep(20);

  assert.deepEqual(requested, [30]);
  assert.equal(w.document.querySelector("[data-tracking-url]").value, url);
  assert.doesNotMatch(w.document.body.textContent, /sig=|Vista previa/);
  assert.match(w.document.querySelector(".sheet").textContent, /Vence el/);
});

test("la torre ve cada SOS activo, recibe un aviso al llegar uno nuevo y lo marca como atendido", async () => {
  let active = [{ id: 41, driverId: "driver-ana", driverName: "Ana Ruiz", vehiclePlate: "TDK-410", loadId: 30,
    latitude: 4.6097, longitude: -74.0817, status: "ACTIVE", triggeredAt: new Date().toISOString() }];
  const acknowledged = [];
  const { w, toasts } = browser({ state: { activeRole: "coordinator", sessionRole: "COORDINADOR" }, service: {
    loadActiveSos: async () => active,
    acknowledgeSos: async (id) => { acknowledged.push(id); active = active.filter((s) => s.id !== id); }
  } });

  w.SosMonitor.sync(w.store.state);
  await sleep(20);

  const banner = w.document.querySelector(".sos-alert");
  assert.ok(banner, "franja de SOS visible");
  assert.match(banner.textContent, /Ana Ruiz/);
  assert.match(banner.textContent, /CARGA-30/);
  assert.ok(toasts.some((t) => t.type === "error" && /SOS · Ana Ruiz/.test(t.title)));

  // La siguiente consulta no vuelve a avisar del mismo SOS.
  await w.SosMonitor.poll();
  assert.equal(toasts.filter((t) => /SOS ·/.test(t.title)).length, 1);

  w.document.querySelector("[data-sos-ack='41']").click();
  await sleep(20);
  assert.deepEqual(acknowledged, [41]);
  assert.equal(w.document.querySelector(".sos-alert"), null);
  w.SosMonitor.stop();
});

test("un conductor o un generador nunca consulta los SOS de la torre", async () => {
  let polled = 0;
  const { w } = browser({ state: { activeRole: "coordinator", sessionRole: "GENERADOR" }, service: { loadActiveSos: async () => { polled++; return []; } } });
  w.SosMonitor.sync(w.store.state);
  w.SosMonitor.sync({ isAuthenticated: true, activeRole: "driver", sessionRole: "CONDUCTOR" });
  await sleep(20);
  assert.equal(polled, 0);
});

test("la vista pública muestra estado y posición sin sesión, y explica un enlace vencido", async () => {
  const tokens = [];
  const view = { reference: "CARGA-30", status: "IN_TRANSIT", statusLabel: "En ruta", cargoDescription: "Café verde", weightTons: 28,
    origin: { city: "Bogotá", department: "Cundinamarca" }, destination: { city: "Cali", department: "Valle" },
    publishedAt: "2026-10-31T10:00:00Z", assignedAt: "2026-10-31T11:00:00Z", tripStartedAt: "2026-10-31T12:00:00Z", deliveredAt: null,
    vehiclePlate: "TDK-•••", position: { latitude: 4.5, longitude: -75.2, speedKmH: 62, heading: 210, updatedAt: "2026-10-31T14:59:00" },
    expiresAt: "2026-11-02T15:00:00Z" };
  const { w } = browser({ url: "http://localhost:5500/?track=djF8MzB8.c2lnbmF0dXJl", state: { isAuthenticated: false },
    api: { publicTracking: async (token) => { tokens.push(token); return view; } } });

  assert.equal(w.PublicTracking.maybeStart(), true);
  await sleep(20);
  w.PublicTracking.stopPolling();

  assert.deepEqual(tokens, ["djF8MzB8.c2lnbmF0dXJl"]);
  const text = w.document.getElementById("app-mount").textContent;
  assert.match(text, /CARGA-30/);
  assert.match(text, /En ruta/);
  assert.match(text, /Posición en vivo/);
  assert.match(text, /TDK-•••/);
  assert.equal(w.document.body.dataset.mode, "public-tracking");

  const expired = browser({ url: "http://localhost:5500/?track=djF8MzB8.c2lnbmF0dXJl",
    api: { publicTracking: async () => { throw Object.assign(new Error("El enlace de seguimiento no es válido o ya venció"), { status: 410 }); } } });
  expired.w.PublicTracking.maybeStart();
  await sleep(20);
  assert.match(expired.w.document.getElementById("app-mount").textContent, /Seguimiento no disponible.*ya venció/s);

  const malformed = browser({ url: "http://localhost:5500/?track=../../loads/30" });
  assert.equal(malformed.w.PublicTracking.maybeStart(), true);
  assert.match(malformed.w.document.getElementById("app-mount").textContent, /incompleto/);
  assert.equal(browser().w.PublicTracking.maybeStart(), false);
});

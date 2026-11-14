import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";

const SCRIPTS = ["js/ui/toaster.js", "js/ui/sheet.js", "js/ui/native.js", "js/geolocation.js", "js/views/driverActions.js",
  "js/views/generatorPanel.js", "js/views/sosMonitor.js", "js/views/publicTracking.js"];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function browser({ url = "http://localhost:5500/", service = {}, api = {}, state = {}, gps = { latitude: 4.60971, longitude: -74.08175, accuracy: 8 }, stored = null } = {}) {
  const dom = new JSDOM(`<!doctype html><html><body><div id="phone-mockup-frame"><div id="app-mount"></div></div></body></html>`,
    { runScripts: "outside-only", pretendToBeVisual: true, url });
  const w = dom.window;
  w.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  if (stored) w.localStorage.setItem("truckcar.lastGpsFix", JSON.stringify(stored));
  Object.defineProperty(w.navigator, "geolocation", { configurable: true, value: {
    getCurrentPosition(ok, fail) {
      setTimeout(() => gps ? ok({ coords: { ...gps, speed: null, heading: null }, timestamp: Date.now() }) : fail({ code: 2 }), 5);
    },
    watchPosition() { return 1; },
    clearWatch() {}
  } });
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
  w.app = { currentPosition: () => [9.99, -79.99] };
  w.TruckCarData = { activeLoadOrder: { id: "CARGA-30", backendId: 30 }, currentDriver: { name: "Ana Ruiz", vehicle: { plate: "TDK-410" } } };
  w.TruckCarApi = { loads: api };
  w.eval(readFileSync("js/dataService.js", "utf8"));
  Object.assign(w.TruckCarService, service);
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
  assert.ok(w.document.querySelector("[data-sos-action='call']").textContent.includes("Llamar al 123"));
  assert.match(w.document.querySelector(".sos-modal dl").textContent, /Lectura GPS\s*hace \d+ s/);

  w.document.querySelector("[data-sos-action='close']").click();
  await done;
  assert.equal(w.document.querySelector(".sos-modal"), null, "Cerrar quita el modal");
});

test("sin acuse del servidor el SOS no dice que avisó a la torre: sin señal queda guardado y pide llamar al 123", async () => {
  const { w } = browser({ service: { triggerSos: async () => ({ id: null, pendingSync: true }) } });
  const done = w.DriverActions.activate();
  await sleep(30);
  const queued = w.document.querySelector("[data-sos-status]").textContent;
  assert.match(queued, /Sin señal: el aviso se enviará al recuperar la señal\. Llame al 123 ahora\./);
  assert.doesNotMatch(queued, /Torre de control avisada/);
  w.document.querySelector("[data-sos-action='close']").click();
  await done;

  const failing = browser({ service: { triggerSos: async () => { throw Object.assign(new Error("Datos inválidos"), { status: 400 }); } } });
  const again = failing.w.DriverActions.activate();
  await sleep(30);
  const failed = failing.w.document.querySelector("[data-sos-status]").textContent;
  assert.match(failed, /La alerta NO se envió: Datos inválidos.*Llame al 123 ahora/s);
  assert.doesNotMatch(failed, /Torre de control avisada|guardada/);
  assert.equal(failing.w.document.getElementById("sos-modal-title").textContent, "SOS no enviado");
  failing.w.document.querySelector("[data-sos-action='close']").click();
  await again;

  const unsaved = browser({ service: { triggerSos: async () => { throw new Error("IndexedDB no disponible"); } } });
  const third = unsaved.w.DriverActions.activate();
  await sleep(30);
  assert.match(unsaved.w.document.querySelector("[data-sos-status]").textContent, /La alerta NO se envió ni quedó guardada: IndexedDB no disponible.*Llame al 123 ahora/s);
  assert.equal(unsaved.w.document.getElementById("sos-modal-title").textContent, "SOS no enviado");
  unsaved.w.document.querySelector("[data-sos-action='close']").click();
  await third;
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
  assert.match(w.document.querySelector(".public-track-when").textContent, /^Actualizada el .* · 62 km\/h$/);
  assert.equal(w.document.querySelectorAll(".track-step.is-done").length, 3);

  const source = readFileSync("js/views/publicTracking.js", "utf8");
  assert.match(source, /TruckCarConfig\.map/);
  assert.doesNotMatch(source, /tile\.openstreetmap\.org|uppercase|fa-|text-\[1[0-3]|rounded-full|emerald|brand-|rose-|amber-/);

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

test("el SOS envía la lectura del GPS del teléfono, nunca la posición de navegación o simulación", async () => {
  const calls = [];
  const { w } = browser({ gps: { latitude: 6.2442, longitude: -75.5812, accuracy: 12 }, service: {
    triggerSos: async (coords, accuracy) => { calls.push({ coords: Array.from(coords), accuracy }); return { id: 7, receivedAt: new Date().toISOString() }; }
  } });
  const done = w.DriverActions.activate();
  await sleep(40);
  assert.deepEqual(calls, [{ coords: [6.2442, -75.5812], accuracy: 12 }]);
  assert.match(w.document.querySelector("[data-sos-position]").textContent, /6,24420, -75,58120 ±12 m/);
  w.document.querySelector("[data-sos-action='close']").click();
  await done;
});

test("sin señal GPS el SOS usa la última posición real confirmada y dice su antigüedad; sin ninguna, no envía", async () => {
  const calls = [];
  const stored = { coords: [4.4389, -75.2322], accuracy: 20, time: Date.now() - 5 * 60 * 1000 };
  const { w } = browser({ gps: null, stored, service: { triggerSos: async (coords) => { calls.push(Array.from(coords)); return { id: 8 }; } } });
  const done = w.DriverActions.activate();
  await sleep(60);
  assert.deepEqual(calls, [[4.4389, -75.2322]]);
  assert.match(w.document.querySelector("[data-sos-reading]").textContent, /última confirmada hace 5 min/);
  assert.match(w.document.querySelector("[data-sos-status]").textContent,
    /Torre de control avisada.*La posición enviada es la última confirmada hace 5 min: puede no ser exacta\. Llame al 123 ahora\./s);
  w.document.querySelector("[data-sos-action='close']").click();
  await done;

  const none = browser({ gps: null, service: { triggerSos: async () => { calls.push("no debería"); return {}; } } });
  const again = none.w.DriverActions.activate();
  await sleep(60);
  assert.equal(calls.length, 1);
  const status = none.w.document.querySelector("[data-sos-status]").textContent;
  assert.match(status, /La alerta NO se envió: no hay posición GPS.*Llame al 123 ahora\./s);
  assert.doesNotMatch(status, /se enviará|avisada/);
  assert.equal(none.w.document.getElementById("sos-modal-title").textContent, "SOS no enviado");
  await sleep(1100);
  assert.ok(none.w.document.querySelector(".sos-modal"), "el aviso sigue visible hasta que el conductor lo cierre");
  none.w.document.querySelector("[data-sos-action='close']").click();
  await again;
});

test("la hoja de reportar muestra los 7 tipos en una cuadrícula, con íconos neutros y sin colores", async () => {
  const { w } = browser();
  w.DriverActions.openReportSheet();
  await sleep(10);
  const tiles = [...w.document.querySelectorAll(".report-grid .report-tile")];
  assert.deepEqual(tiles.map((t) => t.textContent.trim()),
    ["Derrumbe", "Accidente", "Obra en vía", "Retén", "Báscula", "Gálibo bajo", "Parador seguro"]);
  assert.ok(tiles.every((t) => !t.disabled), "con posición GPS, los tipos se pueden tocar");
  assert.ok(tiles.every((t) => t.querySelector("svg use").getAttribute("href").startsWith("assets/icons.svg#")));
  assert.doesNotMatch(w.document.querySelector(".sheet").innerHTML, /text-(rose|amber|sky|emerald)-/);
  assert.match(w.document.querySelector(".sheet-title").textContent, /Reportar en la vía/);
});

function sosFab(w) {
  w.DriverActions.syncSos({ isAuthenticated: true, activeRole: "driver" });
  const fab = w.document.querySelector(".sos-fab");
  fab.setPointerCapture = () => {};
  return fab;
}

test("un clic en SOS no envía: abre una confirmación accesible que atrapa el foco y se cancela sin enviar", async () => {
  const calls = [];
  const { w } = browser({ service: { triggerSos: async (coords) => { calls.push(coords); return { id: 9 }; } } });
  const fab = sosFab(w);
  fab.click();
  await sleep(20);
  const dialog = w.document.querySelector(".sos-confirm");
  assert.ok(dialog, "abre la confirmación");
  assert.equal(calls.length, 0);
  assert.equal(dialog.getAttribute("role"), "alertdialog");
  assert.equal(dialog.getAttribute("aria-labelledby"), "sos-confirm-title");
  assert.equal(w.document.activeElement.id, "sos-confirm-title");
  assert.equal(w.document.activeElement.getAttribute("tabindex"), "-1");
  const [yes, no] = dialog.querySelectorAll("button");
  assert.match(yes.textContent, /Sí, enviar SOS/);
  assert.equal(no.textContent.trim(), "Cancelar");

  const tab = (shiftKey) => w.document.dispatchEvent(new w.KeyboardEvent("keydown", { key: "Tab", shiftKey, bubbles: true }));
  tab(false); assert.equal(w.document.activeElement, yes);
  tab(false); assert.equal(w.document.activeElement, no);
  tab(false); assert.equal(w.document.activeElement, yes);
  tab(true); assert.equal(w.document.activeElement, no);

  fab.click();
  assert.equal(w.document.querySelectorAll(".sos-confirm").length, 1, "un segundo clic no abre otra");
  no.click();
  assert.equal(w.document.querySelector(".sos-confirm"), null);
  assert.equal(w.document.activeElement, fab, "el foco vuelve al botón SOS");

  fab.click();
  w.document.dispatchEvent(new w.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  assert.equal(w.document.querySelector(".sos-confirm"), null, "Escape cancela");
  await sleep(30);
  assert.equal(calls.length, 0);
  assert.equal(w.document.querySelector(".sos-modal"), null);
});

test("confirmar envía el SOS una sola vez aunque se toque dos veces", async () => {
  const calls = [];
  const { w } = browser({ service: { triggerSos: async (coords) => { calls.push(coords); return { id: 10, receivedAt: new Date().toISOString() }; } } });
  const fab = sosFab(w);
  fab.click();
  const yes = w.document.querySelector("[data-sos-confirm='send']");
  const no = w.document.querySelector("[data-sos-confirm='cancel']");
  yes.click();
  assert.ok(yes.disabled && no.disabled, "ambos botones quedan desactivados");
  yes.click();
  await sleep(40);
  assert.equal(calls.length, 1);
  assert.equal(w.document.querySelectorAll(".sos-modal:not(.sos-confirm)").length, 1);
  assert.match(w.document.querySelector("[data-sos-status]").textContent, /Torre de control avisada/);
  w.document.querySelector("[data-sos-action='close']").click();
  await sleep(10);
});

test("un toque corto con teclado abre la confirmación; el clic que sigue a mantener pulsado no la abre", async () => {
  const calls = [];
  const { w } = browser({ service: { triggerSos: async (coords) => { calls.push(coords); return { id: 11 }; } } });
  const fab = sosFab(w);
  fab.dispatchEvent(new w.KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  fab.dispatchEvent(new w.KeyboardEvent("keyup", { key: "Enter", bubbles: true }));
  assert.ok(w.document.querySelector(".sos-confirm"), "Enter breve abre la confirmación");
  w.document.querySelector("[data-sos-confirm='cancel']").click();

  fab.dispatchEvent(new w.Event("pointerdown", { bubbles: true }));
  await sleep(1700);
  fab.dispatchEvent(new w.Event("pointerup", { bubbles: true }));
  fab.click();
  assert.equal(w.document.querySelector(".sos-confirm"), null, "el clic de la pulsación larga se ignora");
  await sleep(30);
  assert.equal(calls.length, 1, "mantener pulsado envía directo");
  w.document.querySelector("[data-sos-action='close']").click();
  await sleep(10);
});

test("cancelar antes del envío no manda nada; después avisa que ya salió y pide llamar al 123", async () => {
  const calls = [];
  const early = browser({ service: { triggerSos: async (coords) => { calls.push(coords); return { id: 12 }; } } });
  const done = early.w.DriverActions.activate();
  early.w.document.querySelector("[data-sos-action='cancel']").click();
  await done;
  await sleep(30);
  assert.equal(calls.length, 0, "cancelado mientras se obtenía el GPS");
  assert.equal(early.w.document.querySelector(".sos-modal"), null);
  assert.ok(early.toasts.some((t) => t.title === "SOS cancelado" && /No se envió ninguna alerta/.test(t.description)));

  let answer;
  const flying = browser({ service: { triggerSos: () => new Promise((r) => { answer = r; }) } });
  const flight = flying.w.DriverActions.activate();
  await sleep(30);
  flying.w.document.querySelector("[data-sos-action='cancel']").click();
  assert.match(flying.w.document.querySelector("[data-sos-status]").textContent,
    /ya se está enviando y no se puede cancelar desde la app\. Llame al 123 para avisar del error\./);
  answer({ id: 13, receivedAt: new Date().toISOString() });
  await sleep(10);
  assert.match(flying.w.document.querySelector("[data-sos-status]").textContent,
    /Torre de control avisada.*La alerta ya se envió y no se puede cancelar desde la app\. Llame al 123 para avisar del error\./s);
  assert.ok(flying.w.document.querySelector(".sos-modal"), "el modal sigue abierto");
  flying.w.document.querySelector("[data-sos-action='close']").click();
  await flight;

  const queued = browser({ service: { triggerSos: async () => ({ id: null, pendingSync: true }) } });
  const later = queued.w.DriverActions.activate();
  await sleep(30);
  queued.w.document.querySelector("[data-sos-action='cancel']").click();
  assert.match(queued.w.document.querySelector("[data-sos-status]").textContent,
    /ya quedó guardada y se enviará al recuperar la señal; no se puede cancelar desde la app\. Llame al 123 para avisar del error\./);
  queued.w.document.querySelector("[data-sos-action='close']").click();
  await later;

  const none = browser({ gps: null, service: { triggerSos: async () => ({}) } });
  const nothing = none.w.DriverActions.activate();
  await sleep(60);
  assert.equal(none.w.document.querySelector("[data-sos-action='cancel']").hidden, true, "sin envío no se ofrece cancelar");
  none.w.document.querySelector("[data-sos-action='close']").click();
  await nothing;
});

function logoutHarness(status) {
  const { w } = browser();
  let logouts = 0;
  w.app.logout = () => { logouts++; };
  if (status === undefined) delete w.OfflineQueue;
  else w.OfflineQueue.status = status;
  const trigger = w.document.createElement("button");
  w.document.body.appendChild(trigger);
  return { w, trigger, logouts: () => logouts };
}

test("cerrar sesión pide confirmación accesible: Escape y «Seguir conectado» no cierran, confirmar cierra una sola vez", async () => {
  const { w, trigger, logouts } = logoutHarness(() => ({ pending: 0, byKind: {} }));
  w.DriverActions.confirmLogout(trigger);
  const dialog = w.document.querySelector(".sos-confirm.is-neutral");
  assert.ok(dialog);
  assert.equal(dialog.getAttribute("role"), "alertdialog");
  assert.equal(dialog.getAttribute("aria-describedby"), "sos-confirm-desc");
  assert.equal(w.document.activeElement.id, "sos-confirm-title");
  assert.equal(w.document.activeElement.textContent, "¿Cerrar sesión?");
  assert.equal(dialog.querySelector(".sos-confirm-warning"), null);
  const [yes, no] = dialog.querySelectorAll("button");
  assert.equal(yes.textContent.trim(), "Cerrar sesión");
  assert.equal(no.textContent.trim(), "Seguir conectado");
  const tab = (shiftKey) => w.document.dispatchEvent(new w.KeyboardEvent("keydown", { key: "Tab", shiftKey, bubbles: true }));
  tab(false); assert.equal(w.document.activeElement, yes);
  tab(false); assert.equal(w.document.activeElement, no);
  tab(false); assert.equal(w.document.activeElement, yes);

  w.document.dispatchEvent(new w.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  assert.equal(w.document.querySelector(".sos-confirm"), null);
  assert.equal(w.document.activeElement, trigger);
  w.DriverActions.confirmLogout(trigger);
  w.document.querySelector("[data-sos-confirm='cancel']").click();
  assert.equal(logouts(), 0);

  w.DriverActions.confirmLogout(trigger);
  const send = w.document.querySelector("[data-sos-confirm='send']");
  const cancel = w.document.querySelector("[data-sos-confirm='cancel']");
  send.click();
  assert.ok(send.disabled && cancel.disabled);
  send.click();
  assert.equal(logouts(), 1);
});

test("con un SOS en cola, cerrar sesión lo avisa antes de confirmar", async () => {
  const { w, trigger, logouts } = logoutHarness(() => ({ pending: 2, byKind: { "alert.sos": 1, position: 1 } }));
  w.DriverActions.confirmLogout(trigger);
  const dialog = w.document.querySelector(".sos-confirm");
  assert.equal(dialog.getAttribute("aria-describedby"), "sos-confirm-desc sos-confirm-warning");
  assert.equal(w.document.getElementById("sos-confirm-warning").textContent.trim(),
    "Tiene una alerta SOS pendiente de enviarse. Si cierra sesión, no se enviará hasta que vuelva a iniciar sesión en este teléfono. Si es una emergencia, llame al 123.");
  assert.equal(dialog.querySelector("[data-sos-confirm='send']").textContent.trim(), "Cerrar sesión de todos modos");
  assert.equal(logouts(), 0, "no cierra sin que el conductor confirme");
  dialog.querySelector("[data-sos-confirm='send']").click();
  assert.equal(logouts(), 1);
});

test("si no se puede leer la cola, cerrar sesión muestra la confirmación normal y no se bloquea", async () => {
  for (const status of [() => { throw new Error("IndexedDB no disponible"); }, undefined]) {
    const { w, trigger, logouts } = logoutHarness(status);
    w.DriverActions.confirmLogout(trigger);
    const dialog = w.document.querySelector(".sos-confirm");
    assert.ok(dialog);
    assert.equal(dialog.querySelector(".sos-confirm-warning"), null);
    dialog.querySelector("[data-sos-confirm='send']").click();
    assert.equal(logouts(), 1);
  }
});

test("la cabecera del conductor separa el SOS de «Cerrar sesión» y el botón pide confirmación", () => {
  const css = readFileSync("css/main.css", "utf8");
  assert.match(css, /\.app-header \.header-icon-btn \{ width: 48px; height: 48px; \}/);
  const fab = css.match(/\.sos-fab \{[^}]*\}/)[0];
  assert.match(fab, /right: calc\(64px \+ var\(--safe-right\)\)/);
  assert.match(fab, /height: 48px/);
  const header = readFileSync("js/views/driverApp.js", "utf8");
  assert.match(header, /onclick="window\.DriverActions\.confirmLogout\(this\)"[^>]*aria-label="Cerrar sesión"/);
  assert.doesNotMatch(header, /window\.app\.logout\(\)/);
});

function tower(loadActiveSos) {
  const spoken = [];
  const { w, toasts } = browser({ state: { activeRole: "coordinator", sessionRole: "COORDINADOR" }, service: { loadActiveSos, acknowledgeSos: async () => {} } });
  w.voiceEngine = { speak: (text) => spoken.push(text) };
  return { w, toasts, spoken };
}
const minutesAgo = (m) => new Date(Date.now() - m * 60000).toISOString();
const sosItem = (id, m = 3) => ({ id, driverName: "Ana Ruiz", vehiclePlate: "TDK-410", latitude: 4.6, longitude: -74.08, status: "ACTIVE", triggeredAt: minutesAgo(m) });

test("monitoreo SOS: un fallo aislado no muestra el banner; el segundo sí, una vez y con sonido; conserva la lista y se quita al recuperarse", async () => {
  let mode = "ok";
  const { w, spoken } = tower(async () => {
    if (mode === "ok") return [sosItem(41)];
    throw Object.assign(new Error("Sin conexión"), { status: 0 });
  });
  w.SosMonitor.sync(w.store.state);
  await sleep(10);
  assert.ok(w.document.querySelector("[data-sos-id='41']"));

  mode = "fail";
  await w.SosMonitor.poll();
  assert.equal(w.document.querySelector(".sos-monitor-down"), null, "un solo fallo no muestra el banner");
  await w.SosMonitor.poll();
  const banner = w.document.querySelector(".sos-monitor-down");
  assert.ok(banner, "el segundo fallo seguido muestra el banner");
  assert.equal(banner.getAttribute("role"), "alert");
  assert.equal(banner.dataset.sosMonitorDown, "network");
  assert.ok(banner.querySelector("i[aria-hidden='true']"), "lleva ícono además del texto");
  assert.match(banner.textContent, /Monitoreo SOS caído.*sin conexión o servidor no disponible.*Los SOS nuevos no aparecerán hasta que se recupere\./s);
  assert.match(banner.textContent, /Lista desactualizada · última consulta correcta: \d/);
  assert.ok(w.document.querySelector("[data-sos-id='41']"), "la lista previa sigue visible");
  assert.deepEqual(spoken.filter((t) => /caído/.test(t)), ["Monitoreo SOS caído."]);

  await w.SosMonitor.poll();
  assert.equal(w.document.querySelector(".sos-monitor-down"), banner, "no se recrea mientras la causa no cambie");
  assert.equal(spoken.filter((t) => /caído/.test(t)).length, 1, "el sonido suena una sola vez");

  mode = "ok";
  await w.SosMonitor.poll();
  assert.equal(w.document.querySelector(".sos-monitor-down"), null, "se quita al recuperarse");
  w.SosMonitor.stop();
});

test("monitoreo SOS: una sesión sin acceso muestra otro texto desde el primer fallo; si el audio falla el banner igual aparece", async () => {
  const { w } = tower(async () => { throw Object.assign(new Error("Prohibido"), { status: 403 }); });
  w.voiceEngine = { speak: () => { throw new Error("audio bloqueado"); } };
  w.SosMonitor.sync(w.store.state);
  await sleep(10);
  const banner = w.document.querySelector(".sos-monitor-down");
  assert.ok(banner, "aparece al primer fallo");
  assert.equal(banner.dataset.sosMonitorDown, "auth");
  assert.match(banner.textContent, /Monitoreo SOS detenido.*Su sesión no tiene acceso a las alertas SOS\. Vuelva a iniciar sesión\./s);
  assert.doesNotMatch(banner.textContent, /servidor no disponible/);
  assert.match(banner.textContent, /Aún no se ha podido consultar la torre\./);
  assert.equal(w.document.querySelector(".sos-alerts").hidden, false);
  w.SosMonitor.stop();
});

test("monitoreo SOS: las tarjetas no se recrean si la lista no cambia, el «hace X min» se actualiza y solo un SOS nuevo se anuncia", async () => {
  let items = [sosItem(41, 3)];
  const { w, toasts } = tower(async () => items.map((s) => ({ ...s })));
  w.SosMonitor.sync(w.store.state);
  await sleep(10);
  const first = w.document.querySelector("[data-sos-id='41']");
  assert.equal(first.getAttribute("role"), "alert", "el SOS nuevo se anuncia");
  assert.equal(w.document.querySelector(".sos-alerts").getAttribute("aria-live"), null, "el contenedor no anuncia cada cambio");
  assert.match(first.querySelector("[data-sos-ago]").textContent, /hace 3 min/);

  items = [sosItem(41, 7)];
  await w.SosMonitor.poll();
  const same = w.document.querySelector("[data-sos-id='41']");
  assert.equal(same, first, "la tarjeta no se recrea");
  assert.equal(same.getAttribute("role"), null, "ya no se vuelve a anunciar");
  assert.match(same.querySelector("[data-sos-ago]").textContent, /hace 7 min/);
  assert.equal(toasts.filter((t) => /SOS ·/.test(t.title)).length, 1);

  items = [sosItem(42, 0), sosItem(41, 7)];
  await w.SosMonitor.poll();
  assert.equal(w.document.querySelector("[data-sos-id='42']").getAttribute("role"), "alert");
  assert.equal(w.document.querySelector("[data-sos-id='41']").getAttribute("role"), null);
  assert.equal(toasts.filter((t) => /SOS ·/.test(t.title)).length, 2);
  w.SosMonitor.stop();
});

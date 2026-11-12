import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";

const SCRIPTS = ["js/ui/toaster.js", "js/ui/sheet.js", "js/ui/native.js", "js/views/driverActions.js", "js/views/generatorPanel.js"];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function browser({ online = true, pending = 0, telemetry = "online", isOffline = false } = {}) {
  const dom = new JSDOM("<!doctype html><html><body></body></html>", { runScripts: "outside-only", pretendToBeVisual: true, url: "http://localhost:5500/" });
  const w = dom.window;
  Object.defineProperty(w.navigator, "onLine", { get: () => online, configurable: true });
  w.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  w.ui = {
    escape: (v) => String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"),
    toast() {},
    errorMessage: (e) => (e && e.message) || String(e)
  };
  w.store = { state: { isAuthenticated: true, isOffline }, subscribe() {} };
  w.OfflineQueue = { status: () => ({ pending, lastError: null, nextRetryAt: null, lastSyncAt: null }), onChange() {} };
  w.TruckCarTelemetry = { status: telemetry, onStatusChange() {} };
  SCRIPTS.forEach((file) => w.eval(readFileSync(file, "utf8")));
  return w;
}

test("los toasts se apilan con un máximo y ejecutan su acción", async () => {
  const w = browser();
  let clicked = 0;
  for (let i = 0; i < 8; i++) w.Toaster.show({ title: "Aviso " + i, type: i === 7 ? "error" : "info" });
  w.Toaster.show({ title: "Con acción", type: "success", action: { label: "Deshacer", onClick: () => { clicked++; } } });
  await sleep(350);
  const toasts = w.document.querySelectorAll(".toast");
  assert.ok(toasts.length <= 6, `quedan ${toasts.length} toasts`);
  assert.equal(w.document.querySelector('.toast[data-type="error"]').getAttribute("role"), "alert");
  w.document.querySelector(".toast-action").click();
  assert.equal(clicked, 1);
});

test("la hoja del motivo no se envía vacía y acepta una sugerencia", async () => {
  const w = browser();
  const answer = w.Sheet.prompt({ title: "Rechazar", suggestions: ["Falla mecánica"] });
  await sleep(50);
  w.document.querySelector("[data-sheet-action='0']").click();
  await sleep(20);
  assert.equal(w.document.querySelector(".field-hint").textContent, "Este campo es obligatorio.");
  assert.ok(w.document.querySelector(".sheet-backdrop"), "la hoja sigue abierta");
  w.document.querySelector("[data-suggestion='0']").click();
  w.document.querySelector("[data-sheet-action='0']").click();
  assert.equal(await answer, "Falla mecánica");
});

test("el click fantasma al soltar el dedo no cierra la hoja; un toque en el fondo sí", async () => {
  const w = browser();
  const result = w.Sheet.open({ title: "SOS activado", actions: [{ label: "Cancelar", tone: "secondary" }] });
  await sleep(50);
  const backdrop = w.document.querySelector(".sheet-backdrop");
  backdrop.dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
  assert.ok(w.document.body.contains(backdrop), "sin pointerdown previo en el fondo la hoja sigue abierta");
  backdrop.dispatchEvent(new w.Event("pointerdown", { bubbles: true }));
  backdrop.dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
  assert.equal(await result, null);
});

test("401, 403 y 409 se explican en un diálogo; un 500 queda para el toast", async () => {
  const w = browser();
  for (const status of [401, 403, 409]) assert.equal(w.Sheet.explainError({ status, message: "x" }, "aceptar la carga"), true);
  assert.equal(w.Sheet.explainError({ status: 500, message: "x" }), false);
  const titles = [...w.document.querySelectorAll(".sheet h2")].map((h) => h.textContent);
  assert.deepEqual(titles, ["Su sesión terminó", "Sin permiso para esta acción", "Alguien llegó primero"]);
});

test("el indicador de red distingue sin señal, sincronizando, reconectando y en línea", () => {
  assert.deepEqual(pick(browser({ online: false, pending: 3 })), ["offline", "Sin señal · 3 guardados"]);
  assert.deepEqual(pick(browser({ isOffline: true })), ["offline", "Sin señal"]);
  assert.deepEqual(pick(browser({ pending: 1 })), ["syncing", "Sincronizando 1 pendiente…"]);
  assert.deepEqual(pick(browser({ telemetry: "reconnecting" })), ["reconnecting", "Reconectando telemática…"]);
  assert.deepEqual(pick(browser({ telemetry: "online" })), ["online", "En línea"]);

  const w = browser({ pending: 2 });
  w.document.body.innerHTML = "<span data-network-status></span>";
  w.Native.NetworkStatus.render();
  assert.equal(w.document.querySelector(".net-status").dataset.state, "syncing");

  const off = browser({ online: false });
  off.document.body.innerHTML = "<span data-network-status></span>";
  off.Native.NetworkStatus.render();
  assert.ok(off.document.querySelector(".net-status svg use").getAttribute("href").endsWith("#warning-fill"));
  assert.match(off.document.querySelector(".net-status").textContent, /Sin señal/);

  function pick(win) {
    const s = win.Native.NetworkStatus.snapshot();
    return [s.state, s.label];
  }
});

test("el progreso del viaje marca la etapa según el estado de la carga", () => {
  const w = browser();
  const current = (load) => {
    w.document.body.innerHTML = w.DriverActions.tripProgressHtml(load);
    return [...w.document.querySelectorAll(".stepper-dot")].findIndex((d) => d.classList.contains("is-current"));
  };
  assert.equal(current({ status: "AVAILABLE" }), 0);
  assert.equal(current({ status: "ASSIGNED" }), 1);
  assert.equal(current({ status: "IN_TRANSIT" }), 2);
  assert.equal(current({ status: "DELIVERED" }), 3);
});

test("el formulario del generador valida en vivo y reconoce ciudades sin tildes", () => {
  const w = browser();
  const { validate, findCity } = w.GeneratorPanel;
  assert.equal(findCity("bogota").city, "Bogotá");
  assert.equal(findCity("  MEDELLIN ").city, "Medellín");
  assert.equal(findCity("Gotham"), null);
  const ok = { cargoDescription: "Café", weightTons: "28", volumeM3: "", originCity: "Bogotá", destinationCity: "cali", offeredBudget: "3000000" };
  assert.deepEqual(Object.keys(validate(ok)), []);
  const bad = validate({ ...ok, cargoDescription: " ", weightTons: "75", destinationCity: "bogota", offeredBudget: "10" });
  assert.deepEqual(Object.keys(bad).sort(), ["cargoDescription", "destinationCity", "offeredBudget", "weightTons"]);
});

test("el formulario de entrega tiene un solo botón fijo «Confirmar entrega» y la X cierra sin registrar", async () => {
  const w = browser();
  w.PodEvidence = { sha256Hex: async () => "0".repeat(64), dataUrlToBlob: async () => new w.Blob(["x"]) };
  w.HTMLCanvasElement.prototype.getContext = () => new Proxy({}, { get: () => () => {}, set: () => true });
  w.eval(readFileSync("js/views/podModals.js", "utf8"));
  const result = w.PodUI.openDeliveryForm({ id: "CARGA-88", destination: { name: "Ibagué, Tolima" } }, async () => {});
  const form = w.document.getElementById("pod-form");
  const buttons = [...form.querySelectorAll("button")];
  assert.equal(buttons.filter((b) => b.type === "submit").length, 1);
  assert.match(form.querySelector(".pod-footer").textContent, /Confirmar entrega/);
  assert.equal(buttons.filter((b) => /Cancelar/.test(b.textContent)).length, 0, "sin el botón «Cancelar»");
  form.querySelector('[data-action="cancel"]').click();
  assert.equal(await result, false);
});

test("inicio de sesión: sin degradado ni halo, «Entrar» en ámbar y la URL de la API solo con ?demo=1", () => {
  const render = (demoTools) => {
    const w = new JSDOM("<!doctype html><body></body>", { runScripts: "outside-only" }).window;
    w.ui = { escape: (v) => String(v ?? "") };
    w.TruckCarConfig = { demoTools, apiBaseUrl: "http://localhost:8000/api/v1" };
    w.eval(readFileSync("js/views/loginView.js", "utf8"));
    return w.LoginView.render({ authMode: "login" });
  };
  const html = render(false);
  assert.doesNotMatch(html, /gradient|shadow-brand|shadow-2xl/);
  assert.match(html, /class="btn-accent login-submit"/);
  assert.match(html, /Inicie sesión en TruckCar/);
  assert.doesNotMatch(html, /API: /);
  assert.match(render(true), /API: http:\/\/localhost:8000\/api\/v1/);
});

test("sin ?demo=1 ninguna herramienta de simulación se ve: todas llevan demo-only", () => {
  const index = readFileSync("index.html", "utf8");
  for (const id of ["rotate-device-btn", "sim-toggle-btn"]) {
    assert.match(index, new RegExp(`id="${id}"[^>]*class="demo-only`), id);
  }
  assert.match(readFileSync("js/views/podModals.js", "utf8"), /data-action="simulate-photo" class="[^"]*demo-only/);
  assert.match(readFileSync("css/main.css", "utf8"), /html:not\(\[data-demo="1"\]\) \.demo-only \{ display: none !important; \}/);
});

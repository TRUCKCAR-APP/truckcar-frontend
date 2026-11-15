import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";

function driverApp() {
  const w = new JSDOM("<!doctype html><body></body>", { runScripts: "outside-only" }).window;
  w.ui = { escape: (v) => String(v ?? "") };
  w.TruckCarConfig = { assignmentResponseMinutes: 5 };
  if (!w.TruckCarService) {
    w.store = w.store || { state: { dataStatus: { errors: {} } }, setState() {} };
    w.TruckCarData = w.TruckCarData || {};
    w.TruckCarApi = w.TruckCarApi || {};
    w.eval(readFileSync("js/dataService.js", "utf8"));
  }
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

function driverWindow(raw, stateOver = {}) {
  const w = new JSDOM("<!doctype html><body></body>", { runScripts: "outside-only" }).window;
  const state = { dataStatus: { loading: false, errors: {} }, busyAction: null, currentUser: { status: "ACTIVE" }, ...stateOver };
  w.store = { get state() { return state; }, getState: () => state, setState: (patch) => Object.assign(state, patch) };
  w.eval(readFileSync("js/ui.js", "utf8"));
  w.TruckCarConfig = { assignmentResponseMinutes: 5 };
  w.TruckCarData = {};
  w.TruckCarApi = {};
  w.eval(readFileSync("js/dataService.js", "utf8"));
  w.eval(readFileSync("js/views/driverApp.js", "utf8"));
  w.TruckCarData.activeLoadOrder = raw ? w.TruckCarService.mapLoad(raw) : null;
  return { w, state };
}

const proposal = (assignmentStatus) => ({ id: 9, status: "AVAILABLE", assignmentStatus, assignedDriverId: "driver-ana",
  originCity: "Cali", destinationCity: "Pasto", weightTons: 12, cargoDescription: "Café", offeredBudget: 2500000,
  assignmentStatusChangedAt: new Date(Date.now() - 30 * 1000).toISOString() });

test("en PROPOSED la propuesta dice «Esperando aviso» y no tiene ningún botón de respuesta ni de consulta", () => {
  const { w, state } = driverWindow(proposal("PROPOSED"));
  const doc = new JSDOM(w.DriverApp.renderAssignedLoadScreen(state)).window.document;
  assert.match(doc.querySelector(".status-line").textContent, /Esperando aviso/);
  assert.match(doc.querySelector(".notice").textContent, /Esperando aviso/);
  assert.equal(doc.querySelector(".screen-actions"), null, "sin acciones mientras no esté notificada");
  assert.equal(doc.querySelector("[data-deadline]"), null, "el plazo corre desde que se puede responder");
  const html = doc.body.innerHTML;
  assert.doesNotMatch(html, /handleAcceptTrip|handleRejectTrip|refreshAssignment/);
  assert.deepEqual([...doc.querySelectorAll("button")].map((b) => b.getAttribute("role")), ["switch"], "solo queda el interruptor de sonido");
});

test("en NOTIFIED aparecen aceptar, rechazar y el plazo", () => {
  const { w, state } = driverWindow(proposal("NOTIFIED"));
  const doc = new JSDOM(w.DriverApp.renderAssignedLoadScreen(state)).window.document;
  assert.match(doc.querySelector(".status-line").textContent, /Propuesta/);
  assert.doesNotMatch(doc.body.textContent, /Esperando aviso/);
  assert.ok(doc.querySelector("[data-deadline]"));
  const handlers = [...doc.querySelectorAll(".screen-actions button")].map((b) => b.getAttribute("onclick"));
  assert.deepEqual(handlers, ["window.app.handleAcceptTrip()", "window.app.handleRejectTrip()"]);
});

test("el interruptor «Sonido de avisos» está donde llegan las propuestas y refleja la preferencia", () => {
  const off = driverWindow(null, { alertSoundEnabled: false });
  const empty = new JSDOM(off.w.DriverApp.renderAssignedLoadScreen(off.state)).window.document;
  const quiet = empty.querySelector('[role="switch"]');
  assert.equal(quiet.getAttribute("aria-checked"), "false");
  assert.equal(quiet.getAttribute("onclick"), "window.app.toggleAlertSound()");
  assert.match(empty.body.textContent, /Sonido de avisos.*Silenciado/s);
  const on = driverWindow(proposal("NOTIFIED"), { alertSoundEnabled: true });
  const pending = new JSDOM(on.w.DriverApp.renderAssignedLoadScreen(on.state)).window.document;
  assert.equal(pending.querySelector('[role="switch"]').getAttribute("aria-checked"), "true");
  const trip = driverWindow({ ...proposal("ACCEPTED"), status: "IN_TRANSIT" });
  assert.equal(new JSDOM(trip.w.DriverApp.renderAssignedLoadScreen(trip.state)).window.document.querySelector('[role="switch"]'), null);
});

function speech({ enabled = true, audioState = "suspended", withAudio = true } = {}) {
  const w = new JSDOM("<!doctype html><body></body>", { runScripts: "outside-only" }).window;
  const state = { alertSoundEnabled: enabled, voiceEnabled: true };
  const log = { vibrations: [], tones: 0, resumed: 0 };
  w.store = { getState: () => state };
  Object.defineProperty(w.navigator, "vibrate", { value: (pattern) => { log.vibrations.push(pattern); return true; }, configurable: true });
  if (withAudio) {
    w.AudioContext = class {
      constructor() { this.state = audioState; this.currentTime = 0; this.destination = {}; }
      resume() { log.resumed++; this.state = "running"; return Promise.resolve(); }
      createOscillator() { log.tones++; return { frequency: {}, connect: (node) => node, start() {}, stop() {} }; }
      createGain() { return { gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect: (node) => node }; }
    };
  }
  w.eval(readFileSync("js/speechEngine.js", "utf8"));
  return { w, state, log, engine: w.voiceEngine };
}

test("antes del primer gesto la propuesta vibra pero no intenta sonar; después del gesto suena", () => {
  const { w, log, engine } = speech();
  assert.equal(engine.proposalAlert(), false, "sin gesto no hay contexto de audio");
  assert.equal(log.tones, 0);
  assert.equal(log.vibrations.length, 1);
  w.document.dispatchEvent(new w.Event("click"));
  assert.equal(log.resumed, 1, "el gesto reanuda el audio");
  assert.equal(engine.proposalAlert(), true);
  assert.equal(log.tones, 2, "tono corto de dos notas");
});

test("silenciado no suena ni vibra, y un navegador sin Web Audio no falla", () => {
  const muted = speech({ enabled: false, audioState: "running" });
  muted.w.document.dispatchEvent(new muted.w.Event("click"));
  assert.equal(muted.engine.proposalAlert(), false);
  assert.equal(muted.log.tones, 0);
  assert.deepEqual(muted.log.vibrations, []);
  const bare = speech({ withAudio: false });
  bare.w.document.dispatchEvent(new bare.w.Event("click"));
  assert.equal(bare.engine.proposalAlert(), false);
  assert.equal(bare.log.vibrations.length, 1);
});

test("la preferencia de sonido se guarda en el dispositivo y arranca activada", () => {
  const w = new JSDOM("<!doctype html><body></body>", { runScripts: "outside-only", url: "http://localhost:5500/" }).window;
  w.eval(readFileSync("js/state.js", "utf8"));
  assert.equal(w.store.state.alertSoundEnabled, true);
  assert.equal(w.TruckCarStore.saveAlertSound(false), true);
  assert.equal(w.localStorage.getItem("truckcar.alertSound"), "off");
  assert.equal(w.TruckCarStore.readAlertSound(), false);
  w.TruckCarStore.saveAlertSound(true);
  assert.equal(w.TruckCarStore.readAlertSound(), true);
});

test("el aviso de propuesta usa el sonido silenciable y no registra notificaciones push", () => {
  const app = readFileSync("js/app.js", "utf8");
  const announce = app.slice(app.indexOf("announceProposal(load) {"), app.indexOf("    tickCountdowns() {"));
  assert.match(announce, /window\.voiceEngine\.proposalAlert\(\)/);
  assert.doesNotMatch(announce, /navigator\.vibrate/, "la vibración pasa por el interruptor");
  for (const file of ["js/app.js", "js/speechEngine.js", "js/views/driverApp.js", "sw.js"]) {
    assert.doesNotMatch(readFileSync(file, "utf8"), /new Notification\(|showNotification\(|pushManager/, file);
  }
});

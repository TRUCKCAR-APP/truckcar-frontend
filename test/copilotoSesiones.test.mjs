import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";

// Reglas del Copiloto: solo el botón o la frase abren una sesión; 6 s de silencio la terminan sin hablar; tocar el
// botón en una sesión la apaga; el Copiloto no se activa con el eco de su propia voz. Y la vista de conducción gira el
// mapa para dejar el rumbo hacia arriba.

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function copilotWindow() {
  const w = new JSDOM("<!doctype html><body></body>", { runScripts: "outside-only", url: "http://localhost:5500/" }).window;
  const listeners = {};
  w.Capacitor = {
    isNativePlatform: () => true,
    nativePromise: (plugin, method) => {
      if (method === "stop") return new Promise(() => {});
      if (method === "available") return Promise.resolve({ available: true });
      if (/Permissions$/.test(method)) return Promise.resolve({ speechRecognition: "granted" });
      return Promise.resolve({});
    },
    addListener: (plugin, event, cb) => { listeners[event] = cb; return { remove() { if (listeners[event] === cb) delete listeners[event]; } }; }
  };
  for (const file of ["js/services/voiceIntents.js", "js/services/voiceAssistant.js"]) w.eval(readFileSync(file, "utf8"));
  const said = [];
  w.voiceEngine = { say: async (t) => { said.push(t); }, cancel() {}, cue() {}, resumeAudio() {} };
  const copilot = w.VoiceAssistant.copilot;
  copilot.init();
  copilot.ui = { banner: w.document.createElement("div"), button: w.document.createElement("button") };
  copilot.ui.button.innerHTML = '<span class="copilot-fab-label"></span>';
  copilot.enableMediaKeys = () => {};
  return { w, copilot, said, listeners };
}

test("6 s de silencio terminan la sesión sin hablar ni volver a escuchar", async () => {
  const { copilot, said } = copilotWindow();
  let listens = 0;
  let handled = 0;
  copilot.recognizer.listenOnce = async () => { listens++; return ""; };
  copilot.controller = { handle: async () => { handled++; }, cancelPending() {}, awaitingAnswer: false };
  await copilot.press();
  await wait(20);
  assert.equal(listens, 1);
  assert.equal(handled, 0, "el silencio no se manda al asistente");
  assert.deepEqual(said, [], "no dice «no le entendí»");
  assert.equal(copilot.phase, "idle");
  await wait(1200);
  assert.equal(listens, 1, "no se vuelve a abrir sola");
  copilot.recognizer.stopWake();
});

test("la escucha nativa de una orden se cierra a los 6 s si no se dijo nada", async () => {
  const { copilot } = copilotWindow();
  const t0 = Date.now();
  const heard = await copilot.recognizer.listenOnce({});
  assert.equal(heard, "");
  const took = Date.now() - t0;
  assert.ok(took >= 5900 && took < 6600, "6 s: " + took);
});

test("el botón alterna: tocar en una sesión la apaga y lo que se oiga después se descarta; tocar otra vez la abre", async () => {
  const { copilot } = copilotWindow();
  let release;
  let listens = 0;
  copilot.recognizer.listenOnce = () => { listens++; return new Promise((r) => { release = r; }); };
  let handled = 0;
  copilot.controller = { handle: async () => { handled++; }, cancelPending() {}, awaitingAnswer: false };
  await copilot.press();
  assert.equal(copilot.phase, "listening");
  assert.equal(copilot.ui.button.getAttribute("aria-pressed"), "true");
  await copilot.press();
  assert.equal(copilot.phase, "idle", "segundo toque: apagado");
  assert.equal(copilot.ui.button.getAttribute("aria-pressed"), "false");
  release("qué llevo");
  await wait(10);
  assert.equal(handled, 0, "lo oído tras apagarlo no se ejecuta");
  await copilot.press();
  assert.equal(listens, 2, "tercer toque: se vuelve a activar");
  assert.equal(copilot.phase, "listening");
  copilot.endSession();
  copilot.recognizer.stopWake();
});

test("apagar con el botón mientras el Copiloto responde lo calla y no sigue hablando", async () => {
  const { copilot, said } = copilotWindow();
  copilot.recognizer.listenOnce = async () => "llévame a la escuela";
  let finish;
  copilot.controller = {
    handle: async () => { await copilot.say("Encontré 3 lugares."); await new Promise((r) => { finish = r; }); await copilot.say("Uno: la escuela."); },
    cancelPending() {}, awaitingAnswer: false
  };
  const running = copilot.press();
  await wait(10);
  assert.equal(copilot.phase, "processing");
  await copilot.press();
  finish();
  await running;
  await wait(10);
  assert.deepEqual(said, ["Encontré 3 lugares."], "después de apagarlo no dice nada más");
  copilot.recognizer.stopWake();
});

test("guardar los ajustes no abre una sesión ni habla; el eco de su propia voz no lo activa", async () => {
  const { copilot, said, listeners } = copilotWindow();
  let listens = 0;
  copilot.recognizer.listenOnce = async () => { listens++; return ""; };
  try {
    copilot.saveSettings({ wakeEnabled: true, wakePhrase: "ey amigo" });
    await wait(60);
    assert.deepEqual(said, []);
    assert.equal(listens, 0);
    assert.ok(listeners.partialResults, "queda esperando la frase");

    // El Copiloto acaba de decir algo con la frase: si el micrófono lo oye, no es el conductor.
    copilot.lastSpoken = "Diga ey amigo para hablarme.";
    copilot.spokeAt = Date.now();
    assert.equal(copilot.isEcho("ey amigo para hablarme"), true);
    assert.equal(copilot.isEcho("ey amigo llévame a Tunja"), false, "una orden real sí pasa");
    listeners.partialResults({ matches: ["ey amigo para hablarme"] });
    await wait(1800);
    assert.equal(listens, 0, "el eco no abre una sesión");
    assert.equal(copilot.phase, "idle");
  } finally {
    copilot.recognizer.stopWake();
  }
});

test("las opciones de destino por voz se muestran sin abrir el teclado", async () => {
  const w = new JSDOM("<!doctype html><body></body>", { runScripts: "outside-only", pretendToBeVisual: true, url: "http://localhost:5500/" }).window;
  for (const file of ["js/ui.js", "js/ui/sheet.js", "js/views/destinationSearch.js"]) w.eval(readFileSync(file, "utf8"));
  w.DestinationSearch.showResults([
    { title: "Escuela Colombiana de Ingeniería", address: "AK 45 #205-59", distanceMeters: 8100 },
    { title: "Escuela de Carreras", address: "Calle 72", distanceMeters: 6300 }], "escuela");
  await wait(80);
  assert.equal(w.document.querySelectorAll("[data-dest-index]").length, 2, "se ven los lugares numerados");
  assert.notEqual(w.document.activeElement.tagName, "INPUT", "el campo de texto no se enfoca (no sale el teclado)");
  assert.equal(w.document.activeElement.dataset.destIndex, "0", "queda enfocada la primera opción");
});

// ── Vista de conducción ──

function navWindow({ heading = null, speed = 0 } = {}) {
  const w = new JSDOM(`<!doctype html><body><div class="nav-screen"><div class="nav-map-area">
      <div id="live-nav-map-container" class="route-map"></div><button data-recenter hidden>Recentrar</button>
      <section class="hud-card"></section></div></div></body>`,
  { runScripts: "outside-only", pretendToBeVisual: true, url: "http://localhost:5500/" }).window;
  const area = w.document.querySelector(".nav-map-area");
  Object.defineProperty(area, "clientWidth", { get: () => 390 });
  Object.defineProperty(area, "clientHeight", { get: () => 700 });
  Object.defineProperty(w.document.querySelector(".hud-card"), "offsetHeight", { get: () => 84 });
  const el = w.document.getElementById("live-nav-map-container");
  Object.defineProperty(el, "clientWidth", { get: () => parseFloat(el.style.width) || 390 });
  Object.defineProperty(el, "clientHeight", { get: () => parseFloat(el.style.height) || 700 });
  w.SVGSVGElement.prototype.createSVGRect = () => ({});
  w.eval(readFileSync("assets/vendor/leaflet/leaflet.js", "utf8"));
  w.TruckCarConfig = { map: { tileUrl: "https://tiles.example.test/{z}/{x}/{y}.png", lightTileUrl: "https://tiles.example.test/{z}/{x}/{y}.png",
    attribution: "© OpenStreetMap", maxZoom: 19 } };
  w.TruckCarData = {};
  w.DriverTelemetry = { lastPoint: { coords: [4.6583, -74.0602], speed, heading } };
  w.RouteGuidance = { route: null, snapshot: () => ({}) };
  w.eval(readFileSync("js/ui.js", "utf8"));
  w.eval(readFileSync("js/mapController.js", "utf8"));
  w.mapCtrl.initMap("live-nav-map-container", [4.6583, -74.0602], 8);
  w.mapCtrl.renderRoutes = () => {};
  w.mapCtrl.renderAlerts = () => {};
  return w;
}

const rotation = (w) => Number((w.document.getElementById("live-nav-map-container").style.transform.match(/rotate\((-?[\d.]+)deg\)/) || [])[1]);

test("conduciendo, el mapa gira para que la dirección de la ruta quede hacia arriba, con la flecha de posición", () => {
  const w = navWindow();
  // Ruta hacia el noreste (~45°) desde la posición.
  const route = Array.from({ length: 20 }, (_, i) => [4.6583 + i * 0.0003, -74.0602 + i * 0.0003]);
  w.mapCtrl.drawLiveNavigation([4.6583, -74.0602]);
  w.mapCtrl.drawGuidanceLine(route);
  w.mapCtrl.followTruck([4.6583, -74.0602], { animate: false });
  const el = w.document.getElementById("live-nav-map-container");
  assert.ok(parseFloat(el.style.width) > 700, "el contenedor es más grande que la pantalla, para girar sin esquinas vacías");
  assert.ok(Math.abs(rotation(w) + 45) < 2, "gira -45°: la ruta queda hacia arriba (" + rotation(w) + ")");
  assert.ok(w.document.querySelector(".nav-map-area .truck-arrow"), "flecha de posición, no un punto");
  assert.ok(w.document.querySelector(".nav-attribution"), "los créditos del mapa siguen visibles");
  const top = parseFloat(el.style.top) + parseFloat(el.style.height) / 2;
  assert.ok(top > 420 && top < 520, "el camión va en la parte baja de la pantalla: y=" + top);
});

test("andando, usa el rumbo del GPS; al mover el mapa vuelve al norte y «Recentrar» retoma el giro", () => {
  const w = navWindow({ heading: 270, speed: 30 });
  w.mapCtrl.drawLiveNavigation([4.6583, -74.0602]);
  assert.ok(Math.abs(rotation(w) - 90) < 1, "rumbo oeste: el mapa gira 90° (" + rotation(w) + ")");
  w.mapCtrl.map.fire("dragstart");
  assert.equal(rotation(w), 0, "mapa libre con el norte arriba");
  w.mapCtrl.centerOnPosition();
  assert.ok(Math.abs(rotation(w) - 90) < 1);
});

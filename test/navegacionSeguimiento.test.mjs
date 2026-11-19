import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";

// Navegar: el mapa sigue al camión con zoom de calle, el conductor puede moverlo libremente y «Recentrar» vuelve a
// seguirlo. Copiloto: el reconocedor de Android no se congela aunque stop() del plugin nunca responda.

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function navMap({ speed = 0 } = {}) {
  const w = new JSDOM(`<!doctype html><body><div class="nav-screen"><div class="hud-card" style="height:90px"></div>
      <div id="live-nav-map-container"></div><button data-recenter hidden>Recentrar</button></div></body>`,
    { runScripts: "outside-only", pretendToBeVisual: true, url: "http://localhost:5500/" }).window;
  const el = w.document.getElementById("live-nav-map-container");
  Object.defineProperty(el, "clientWidth", { get: () => 390 });
  Object.defineProperty(el, "clientHeight", { get: () => 700 });
  w.eval(readFileSync("assets/vendor/leaflet/leaflet.js", "utf8"));
  w.TruckCarConfig = { map: { tileUrl: "https://tiles.example.test/{z}/{x}/{y}.png", lightTileUrl: "https://tiles.example.test/{z}/{x}/{y}.png",
    attribution: "", maxZoom: 19 } };
  w.TruckCarData = {};
  w.DriverTelemetry = { lastPoint: { coords: [4.65, -74.06], speed } };
  w.RouteGuidance = { route: null, snapshot: () => ({}) };
  w.eval(readFileSync("js/ui.js", "utf8"));
  w.eval(readFileSync("js/mapController.js", "utf8"));
  w.mapCtrl.initMap("live-nav-map-container", [4.65, -74.06], 8);
  w.mapCtrl.renderRoutes = () => {};
  w.mapCtrl.renderAlerts = () => {};
  return w;
}

test("al navegar el mapa sigue al camión con zoom de calle y el camión debajo del centro", () => {
  const w = navMap();
  w.mapCtrl.drawLiveNavigation([4.65, -74.06]);
  const map = w.mapCtrl.map;
  assert.equal(map.getZoom(), 17, "zoom de calle, no la vista amplia");
  const truck = map.latLngToContainerPoint([4.65, -74.06]);
  assert.ok(truck.y > 350 + 60, "el camión queda abajo del centro, con la vía por delante: y=" + truck.y);
  assert.ok(Math.abs(truck.x - 195) < 2, "centrado a lo ancho");

  const fast = navMap({ speed: 90 });
  fast.mapCtrl.drawLiveNavigation([4.65, -74.06]);
  assert.equal(fast.mapCtrl.map.getZoom(), 15, "en carretera, un poco más lejos");
});

test("al mover el mapa con el dedo deja de seguir al camión; «Recentrar» lo vuelve a seguir", async () => {
  const w = navMap();
  w.mapCtrl.drawLiveNavigation([4.65, -74.06]);
  const map = w.mapCtrl.map;
  map.fire("dragstart");
  assert.equal(w.mapCtrl.navFollow, false);
  assert.equal(w.document.querySelector("[data-recenter]").hidden, false, "aparece «Recentrar»");

  map.setView([4.70, -74.10], 14, { animate: false });
  w.mapCtrl.updateTruckPosition([4.651, -74.061]);
  const center = map.getCenter();
  assert.ok(Math.abs(center.lat - 4.70) < 0.0001, "una posición nueva no lo devuelve al camión");
  assert.equal(map.getZoom(), 14);

  w.mapCtrl.centerOnPosition();
  assert.equal(w.mapCtrl.navFollow, true);
  assert.equal(w.document.querySelector("[data-recenter]").hidden, true);
  assert.equal(map.getZoom(), 17);
  w.mapCtrl.updateTruckPosition([4.652, -74.062]);
  await wait(900);
  const truck = map.latLngToContainerPoint([4.652, -74.062]);
  assert.ok(truck.y > 410 && Math.abs(truck.x - 195) < 2, "vuelve a seguirlo con cada posición");
});

test("el mapa de Navegar se conserva entre actualizaciones de la pantalla", () => {
  const surface = readFileSync("js/surfaces/driver.js", "utf8");
  assert.match(surface, /keepAliveMaps: \['live-nav-map-container'\]/);
  const app = readFileSync("js/app.js", "utf8");
  assert.match(app, /isMountedOn\('live-nav-map-container'\)\) \{\s*window\.mapCtrl\.refreshLiveNavigation\(\);/);
});

// ── Copiloto en la APK ──

function nativeCopilot() {
  const w = new JSDOM("<!doctype html><body></body>", { runScripts: "outside-only", url: "http://localhost:5500/" }).window;
  const calls = [];
  const listeners = {};
  w.Capacitor = {
    isNativePlatform: () => true,
    // Como el plugin real: stop() nunca responde.
    nativePromise: (plugin, method) => {
      calls.push(method);
      if (method === "stop") return new Promise(() => {});
      if (method === "available") return Promise.resolve({ available: true });
      if (/Permissions$/.test(method)) return Promise.resolve({ speechRecognition: "granted" });
      return Promise.resolve({});
    },
    addListener: (plugin, event, cb) => { listeners[event] = cb; return { remove() { if (listeners[event] === cb) delete listeners[event]; } }; }
  };
  for (const file of ["js/services/voiceIntents.js", "js/services/voiceAssistant.js"]) w.eval(readFileSync(file, "utf8"));
  const copilot = w.VoiceAssistant.copilot;
  copilot.init();
  return { w, copilot, calls, listeners, starts: () => calls.filter((m) => m === "start").length };
}

test("una orden termina por el silencio después de hablar aunque stop() del plugin nunca responda", async () => {
  const { copilot, listeners } = nativeCopilot();
  const t0 = Date.now();
  const heard = copilot.recognizer.listenOnce({});
  listeners.partialResults({ matches: ["qué llevo"] });
  assert.equal(await heard, "qué llevo");
  assert.ok(Date.now() - t0 < 3500, "termina a los ~2 s de silencio, no se queda «Escuchando…»");
});

test("la escucha de la frase se reinicia sola tras el silencio sin aviso de fin ni respuesta de stop()", async () => {
  const { copilot, starts } = nativeCopilot();
  try {
    copilot.recognizer.startWake(() => {}, () => false);
    assert.equal(starts(), 1);
    await wait(6400);
    assert.equal(starts(), 2, "a los 6 s sin voz abre otra sesión");
  } finally {
    copilot.recognizer.stopWake();
  }
});

test("tras hablar, el Copiloto vuelve a reposo y el aviso se oculta aunque el Copiloto se haya apagado", async () => {
  const { w, copilot } = nativeCopilot();
  const banner = w.document.createElement("div");
  copilot.ui = { banner, button: w.document.createElement("button") };
  copilot.render = () => {};
  w.voiceEngine = { say: async () => {}, cancel() {}, cue() {}, resumeAudio() {} };
  await copilot.say("Copiloto listo.");
  assert.equal(copilot.phase, "idle", "antes quedaba en «speaking» y el aviso nunca se ocultaba");
  copilot.hideBanner(10);
  await wait(30);
  assert.equal(banner.hidden, true);

  copilot.on = false;
  copilot.controller = { handle: async () => ({}) };
  await copilot.process("qué llevo");
  assert.equal(banner.hidden, false, "muestra lo que entendió");
  await wait(2600);
  assert.equal(banner.hidden, true, "y luego desaparece");
});

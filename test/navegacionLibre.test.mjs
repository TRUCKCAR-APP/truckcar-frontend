import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";
import { IDBFactory, IDBKeyRange } from "fake-indexeddb";

// Navegación libre: buscar un destino (HERE) y elegirlo en pantalla o por voz («necesito ir a…», «la segunda»), y
// activar el Copiloto con una frase propia.

const plain = (value) => JSON.parse(JSON.stringify(value));

function intents() {
  const w = new JSDOM("<!doctype html><body></body>", { runScripts: "outside-only" }).window;
  w.eval(readFileSync("js/services/voiceIntents.js", "utf8"));
  return w.VoiceIntents;
}

test("«necesito ir a…» y otras formas de pedir un destino se entienden como NAVIGATE con el lugar", () => {
  const vi = intents();
  const cases = [
    ["Necesito ir a la Escuela Colombiana de Ingeniería Julio Garavito", "escuela colombiana de ingenieria julio garavito"],
    ["llévame a Tunja", "tunja"],
    ["quiero ir al peaje de Andes", "peaje de andes"],
    ["¿Cómo llego a la bodega del Éxito en Funza?", "bodega del exito en funza"],
    ["Hola TruckCar, vamos para Sogamoso", "sogamoso"]
  ];
  for (const [text, place] of cases) {
    const intent = plain(vi.parse(text));
    assert.equal(intent.type, "NAVIGATE", text);
    assert.equal(intent.place, place, text);
  }
  // No son destinos: un verbo después, el destino de la carga o una consulta.
  assert.notEqual(vi.parse("voy a reportar un derrumbe").type, "NAVIGATE");
  assert.notEqual(vi.parse("llévame al destino").type, "NAVIGATE");
  assert.equal(vi.parse("a dónde voy").type, "LOAD_INFO");
  assert.equal(vi.parse("auxilio, me están atracando").type, "SOS", "el SOS va antes que todo");
});

test("elegir una opción: la primera, opción dos, la tercera, la última; fuera de rango no", () => {
  const vi = intents();
  assert.equal(vi.parseChoice("la primera", 3), 0);
  assert.equal(vi.parseChoice("opción dos", 3), 1);
  assert.equal(vi.parseChoice("la segunda opción por favor", 3), 1);
  assert.equal(vi.parseChoice("tres", 3), 2);
  assert.equal(vi.parseChoice("la última", 3), 2);
  assert.equal(vi.parseChoice("la cuarta", 3), null);
  assert.equal(vi.parseChoice("no sé", 3), null);
});

test("la frase de activación se puede configurar y «TruckCar» sigue funcionando", () => {
  const vi = intents();
  assert.deepEqual(plain(vi.stripWakeWord("TruckCar llévame a Tunja")), { woke: true, rest: "llevame a tunja" });
  vi.setWakePhrase("Oye Camión");
  assert.deepEqual(plain(vi.stripWakeWord("oye camión, qué llevo")), { woke: true, rest: "que llevo" });
  assert.deepEqual(plain(vi.stripWakeWord("Copiloto recalcular ruta")), { woke: true, rest: "recalcular ruta" });
  assert.equal(vi.stripWakeWord("el camión está bien").woke, false);
  assert.equal(vi.setWakePhrase("ab"), null, "menos de 3 letras no se acepta");
});

// ── Copiloto ──

function copilot({ places, navigate, interpret } = {}) {
  const w = new JSDOM("<!doctype html><body></body>", { runScripts: "outside-only" }).window;
  for (const file of ["js/services/voiceIntents.js", "js/services/voiceAssistant.js"]) w.eval(readFileSync(file, "utf8"));
  const said = [];
  const shown = [];
  const went = [];
  const searched = [];
  const deps = {
    say: async (text) => { said.push(text); },
    listen: () => {},
    actions: {
      hasRoute: () => false,
      searchPlaces: async (q) => { searched.push(q); return places ? places(q) : []; },
      showPlaces: (list, q) => shown.push([list.length, q]),
      navigateTo: async (place) => { went.push(place.title); return navigate ? navigate(place) : { ok: true, remainingM: 21300, durationS: 2400, provider: "HERE" }; }
    }
  };
  if (interpret) deps.interpret = interpret;
  return { ctrl: w.VoiceAssistant.createController(deps), said, shown, went, searched };
}

const ECI = { title: "Escuela Colombiana de Ingeniería Julio Garavito", latitude: 4.783, longitude: -74.042, distanceMeters: 14230 };
const CARRERAS = { title: "Escuela Colombiana de Carreras Industriales", latitude: 4.656, longitude: -74.061, distanceMeters: 2100 };
const REHAB = { title: "Escuela Colombiana de Rehabilitación", latitude: 4.70, longitude: -74.05, distanceMeters: 5000 };

test("con varias opciones las lee, las muestra en pantalla y va a la que el conductor dice", async () => {
  const { ctrl, said, shown, went, searched } = copilot({ places: () => [ECI, CARRERAS, REHAB] });
  const first = await ctrl.handle("Necesito ir a la Escuela Colombiana de Ingeniería");
  assert.equal(first.status, "choosing");
  assert.deepEqual(searched, ["escuela colombiana de ingenieria"]);
  assert.deepEqual(shown, [[3, "escuela colombiana de ingenieria"]]);
  assert.equal(said.at(-1), "Encontré 3 lugares. Uno: Escuela Colombiana de Ingeniería Julio Garavito, a 14 kilómetros. "
    + "Dos: Escuela Colombiana de Carreras Industriales, a 2,1 kilómetros. Tres: Escuela Colombiana de Rehabilitación, a 5 kilómetros. ¿A cuál voy? Diga el número.");
  assert.deepEqual(went, [], "nada cambia antes de elegir");

  const done = await ctrl.handle("la primera");
  assert.equal(done.status, "done");
  assert.deepEqual(went, ["Escuela Colombiana de Ingeniería Julio Garavito"]);
  assert.equal(said.at(-1), "Ruta a Escuela Colombiana de Ingeniería Julio Garavito: 21 kilómetros, aproximadamente 40 minutos. Calculada para su camión.");
});

test("con una sola opción pregunta sí o no; sin resultados lo dice; cancelar no cambia la ruta", async () => {
  const one = copilot({ places: () => [ECI] });
  await one.ctrl.handle("llévame a la Escuela Colombiana de Ingeniería");
  assert.match(one.said.at(-1), /^Encontré Escuela Colombiana de Ingeniería Julio Garavito, a 14 kilómetros\. ¿Voy para allá\?/);
  await one.ctrl.handle("sí");
  assert.equal(one.went.length, 1);

  const none = copilot({ places: () => [] });
  await none.ctrl.handle("llévame a Narnia");
  assert.equal(none.said.at(-1), "No encontré narnia. Diga el nombre de otra forma, o agregue la ciudad.");

  const cancel = copilot({ places: () => [ECI, CARRERAS] });
  await cancel.ctrl.handle("vamos a la escuela colombiana");
  await cancel.ctrl.handle("cancelar");
  assert.deepEqual(cancel.went, []);
  assert.equal(cancel.said.at(-1), "Sigo como estaba.");

  const confused = copilot({ places: () => [ECI, CARRERAS] });
  await confused.ctrl.handle("vamos a la escuela colombiana");
  await confused.ctrl.handle("eh la de allá");
  assert.match(confused.said.at(-1), /Diga el número de la opción/);
});

test("sin GPS lo explica; si la IA entiende el destino, sigue el mismo flujo", async () => {
  const noGps = copilot({ places: () => [ECI], navigate: () => ({ ok: false, reason: "no-position" }) });
  await noGps.ctrl.handle("llévame a la escuela");
  await noGps.ctrl.handle("sí");
  assert.match(noGps.said.at(-1), /No tengo su posición GPS/);

  const ai = copilot({ places: () => [ECI], interpret: async () => ({ intent: "NAVIGATE", place: "Escuela Colombiana de Ingeniería" }) });
  const result = await ai.ctrl.handle("me toca estar en la universidad de la autopista en una hora");
  assert.equal(result.status, "choosing");
  assert.deepEqual(ai.searched, ["Escuela Colombiana de Ingeniería"]);
});

// ── Guía: destino libre ──

const step = (lng, lat, type = "depart") => ({ distance: 1000, name: "Vía", ref: "", maneuver: { type, location: [lng, lat] } });
const OSRM = { distance: 2200, duration: 300, geometry: { coordinates: [[-74.0, 4.6], [-74.0, 4.61], [-73.99, 4.61]] },
  legs: [{ steps: [step(-74.0, 4.6), step(-74.0, 4.61, "turn"), step(-73.99, 4.61, "arrive")] }] };

function guide({ fix = { coords: [4.6, -74.0], time: Date.now() } } = {}) {
  const w = new JSDOM("<!doctype html><body></body>", { runScripts: "outside-only", url: "http://localhost:5500/" }).window;
  w.indexedDB = new IDBFactory();
  w.IDBKeyRange = IDBKeyRange;
  w.fetch = async () => ({ ok: true, json: async () => ({ routes: [OSRM] }) });
  w.voiceEngine = { speak: () => {} };
  w.mapCtrl = { drawGuidanceLine() {} };
  w.TruckCarData = { currentDriver: { id: "d-1" } };
  w.DeviceLocation = { last: () => fix };
  w.TruckCarConfig = { apiBaseUrl: "http://localhost:8000/api/v1", gatewayUrl: "http://localhost:8000", requestTimeoutMs: 5000,
    routingUrl: "https://rutas.example.test/route/v1/driving/", storageKeys: { session: "truckcar.session" } };
  ["js/ui.js", "js/api.js", "js/routeStore.js", "js/navigation.js"].forEach((file) => w.eval(readFileSync(file, "utf8")));
  return w;
}

test("la guía va a un destino libre desde la posición del teléfono y termina cuando el conductor quiere", async () => {
  const w = guide();
  const result = plain(await w.RouteGuidance.navigateTo({ title: "Bodega Funza", latitude: 4.61, longitude: -73.99 }));
  assert.equal(result.ok, true);
  assert.equal(w.RouteGuidance.freeDestination.title, "Bodega Funza");
  assert.equal(w.RouteGuidance.snapshot().status, "ready");
  assert.equal(w.RouteGuidance.route.steps.at(-1).text, "Llegó a Bodega Funza");
  // Mientras dura, la carga no le quita la guía.
  await w.RouteGuidance.prepare({ backendId: 9, origin: { coords: [4.6, -74.0] }, destination: { coords: [5.5, -73.3] } });
  assert.equal(w.RouteGuidance.freeDestination.title, "Bodega Funza");
  assert.equal(w.RouteGuidance.endFreeNavigation(), true);
  assert.equal(w.RouteGuidance.freeDestination, null);
  assert.equal(w.RouteGuidance.route, null);
});

test("sin posición GPS no calcula la ruta libre", async () => {
  const w = guide({ fix: null });
  const result = plain(await w.RouteGuidance.navigateTo({ title: "Tunja", latitude: 5.53, longitude: -73.36 }));
  assert.deepEqual(result, { ok: false, reason: "no-position" });
  assert.equal(w.RouteGuidance.freeDestination, null);
});

test("la búsqueda llama a /routes/places con la posición y la hoja muestra las opciones numeradas", async () => {
  const w = new JSDOM("<!doctype html><body></body>", { runScripts: "outside-only", url: "http://localhost:5500/" }).window;
  const requests = [];
  w.TruckCarConfig = { apiBaseUrl: "https://api.truckcar.test/api/v1", gatewayUrl: "https://api.truckcar.test", requestTimeoutMs: 5000,
    storageKeys: { session: "truckcar.session" } };
  w.fetch = async (url) => { requests.push(String(url)); return { ok: true, status: 200, headers: { get: () => "application/json" }, text: async () => "[]" }; };
  w.eval(readFileSync("js/api.js", "utf8"));
  await w.TruckCarApi.routes.places("escuela colombiana", 4.7, -74.05);
  const url = new URL(requests[0]);
  assert.equal(url.pathname, "/api/v1/routes/places");
  assert.equal(url.searchParams.get("q"), "escuela colombiana");
  assert.equal(url.searchParams.get("lat"), "4.7");

  w.eval(readFileSync("js/ui.js", "utf8"));
  w.eval(readFileSync("js/views/destinationSearch.js", "utf8"));
  const div = w.document.createElement("div");
  div.innerHTML = w.DestinationSearch.resultsHtml([{ ...ECI, category: "Universidad", address: "AK 45 #205-59" }, { ...CARRERAS, title: "<b>x</b>" }]);
  const items = [...div.querySelectorAll("[data-dest-index]")];
  assert.equal(items.length, 2);
  assert.equal(items[0].querySelector(".dest-number").textContent, "1");
  assert.match(items[0].textContent, /Universidad · AK 45 #205-59 · 14 km/);
  assert.ok(!div.innerHTML.includes("<b>x</b>"), "el nombre se escapa");
  assert.match(w.DestinationSearch.resultsHtml([]), /No se encontraron lugares/);
});

function nativeWindow() {
  const w = new JSDOM("<!doctype html><body></body>", { runScripts: "outside-only", url: "http://localhost:5500/" }).window;
  const calls = [];
  const listeners = {};
  w.Capacitor = {
    isNativePlatform: () => true,
    nativePromise: async (plugin, method) => { calls.push(method); return method === "available" ? { available: true } : /Permissions$/.test(method) ? { speechRecognition: "granted" } : {}; },
    addListener: (plugin, event, cb) => { listeners[event] = cb; return { remove() { if (listeners[event] === cb) delete listeners[event]; } }; }
  };
  for (const file of ["js/services/voiceIntents.js", "js/services/voiceAssistant.js"]) w.eval(readFileSync(file, "utf8"));
  const starts = () => calls.filter((m) => m === "start").length;
  return { w, calls, listeners, starts };
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

test("en la APK la escucha continua reinicia el reconocedor y entrega cada frase; se detiene al apagarla", async () => {
  const { w, calls, listeners, starts } = nativeWindow();
  const copilot = w.VoiceAssistant.copilot;
  copilot.init();
  assert.equal(copilot.recognizer.kind, "native");
  assert.equal(copilot.wakeAvailable(), false, "en la APK es opcional: apagado por defecto");

  const heard = [];
  try {
    copilot.recognizer.startWake((text) => heard.push(text));
    assert.equal(starts(), 1);
    listeners.partialResults({ matches: ["qué llevo"] });
    listeners.listeningState({ status: "stopped" });
    await wait(300);
    assert.deepEqual(heard, ["qué llevo"]);
    await wait(600);
    assert.equal(starts(), 2, "se reinicia sola tras el silencio");
  } finally {
    copilot.recognizer.stopWake();
  }
  assert.ok(calls.includes("stop"));
  await wait(900);
  assert.equal(starts(), 2, "apagada ya no se reinicia");
});

test("en cuanto oye la frase entrega la orden sin esperar a que Android cierre la sesión", async () => {
  const { w, listeners } = nativeWindow();
  const copilot = w.VoiceAssistant.copilot;
  copilot.init();
  w.VoiceIntents.setWakePhrase("ey amigo");
  const heard = [];
  try {
    copilot.recognizer.startWake((text) => heard.push(text), (text) => w.VoiceIntents.stripWakeWord(text).woke);
    listeners.partialResults({ matches: ["Hey amigo"] });
    listeners.partialResults({ matches: ["Hey amigo llévame a Tunja"] });
    await wait(2200);
    assert.deepEqual(heard, ["Hey amigo llévame a Tunja"], "sin evento de fin, igual se entrega");
  } finally {
    copilot.recognizer.stopWake();
  }
});

test("la frase propia tolera cómo la escribe el reconocedor (hey/ey, comas, plural) sin activarse con cualquier cosa", () => {
  const vi = intents();
  vi.setWakePhrase("ey amigo");
  for (const text of ["Hey amigo", "Ey, amigo", "hei amigos", "oye amigo"]) assert.equal(vi.stripWakeWord(text).woke, true, text);
  assert.equal(vi.stripWakeWord("Hey amigo, llévame a Tunja").rest, "llevame a tunja");
  for (const text of ["el amigo de mi primo", "amigo", "ey", "hola"]) assert.equal(vi.stripWakeWord(text).woke, false, text);
});

test("guardar «Activar con la voz» deja el Copiloto esperando la frase, sin abrir el micrófono para una orden", async () => {
  const { w, starts, listeners } = nativeWindow();
  const copilot = w.VoiceAssistant.copilot;
  const said = [];
  w.voiceEngine = { say: async (t) => { said.push(t); }, resumeAudio() {}, cancel() {}, cue() {} };
  copilot.build = () => ({ button: w.document.createElement("button"), banner: w.document.createElement("div") });
  copilot.render = () => {};
  copilot.showBanner = () => {};
  copilot.hideBanner = () => {};
  copilot.enableMediaKeys = () => {};
  let listened = 0;
  copilot.init();
  copilot.recognizer.listenOnce = async () => { listened++; return ""; };
  try {
    copilot.saveSettings({ wakeEnabled: true, wakePhrase: "ey amigo" });
    await wait(50);
    assert.equal(copilot.on, true);
    assert.equal(listened, 0, "no abre una sesión para una orden");
    assert.match(said.at(-1), /Diga ey amigo para hablarme/);
    assert.equal(starts(), 1, "queda la escucha de la frase");
    assert.ok(listeners.partialResults, "escuchando la frase");
  } finally {
    copilot.recognizer.stopWake();
  }
});

test("los ajustes del copiloto se guardan en el teléfono y aplican la frase de activación", () => {
  const w = new JSDOM("<!doctype html><body></body>", { runScripts: "outside-only", url: "http://localhost:5500/" }).window;
  for (const file of ["js/services/voiceIntents.js", "js/services/voiceAssistant.js"]) w.eval(readFileSync(file, "utf8"));
  const copilot = w.VoiceAssistant.copilot;
  copilot.activate = () => {};
  assert.deepEqual(plain(w.VoiceAssistant.settings), { wakeEnabled: false, wakePhrase: "TruckCar" });
  copilot.saveSettings({ wakeEnabled: true, wakePhrase: "  Oye Camión " });
  assert.deepEqual(JSON.parse(w.localStorage.getItem("truckcar.copilot")), { wakeEnabled: true, wakePhrase: "Oye Camión" });
  assert.equal(w.VoiceIntents.stripWakeWord("oye camión llévame a Tunja").rest, "llevame a tunja");
  copilot.saveSettings({ wakeEnabled: false, wakePhrase: "x" });
  assert.equal(w.VoiceAssistant.settings.wakePhrase, "TruckCar", "una frase muy corta vuelve a TruckCar");
});

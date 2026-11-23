import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";

// La frase de activación en la APK se oye con Vosk (plugin WakeWord): un solo micrófono abierto, sin reiniciar
// sesiones cada pocos segundos. Y el Copiloto nunca habla ni pide permisos si el conductor no lo pidió.

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function apk({ vosk = true, voskStart = () => Promise.resolve({}), permission = "granted" } = {}) {
  const w = new JSDOM("<!doctype html><body></body>", { runScripts: "outside-only", url: "http://localhost:5500/" }).window;
  const calls = [];
  const listeners = {};
  w.Capacitor = {
    isNativePlatform: () => true,
    isPluginAvailable: (name) => name === "WakeWord" ? vosk : true,
    nativePromise: (plugin, method) => {
      calls.push(plugin + "." + method);
      if (plugin === "WakeWord") return method === "start" ? voskStart() : Promise.resolve({});
      if (method === "stop") return new Promise(() => {});
      if (method === "available") return Promise.resolve({ available: true });
      if (method === "checkPermissions") return Promise.resolve({ speechRecognition: permission });
      if (method === "requestPermissions") return Promise.resolve({ speechRecognition: "granted" });
      return Promise.resolve({});
    },
    addListener: (plugin, event, cb) => {
      const key = plugin + "." + event;
      (listeners[key] = listeners[key] || new Set()).add(cb);
      return { remove() { listeners[key].delete(cb); } };
    }
  };
  for (const file of ["js/services/voiceIntents.js", "js/services/voiceAssistant.js"]) w.eval(readFileSync(file, "utf8"));
  const emit = (key, data) => [...(listeners[key] || [])].forEach((cb) => cb(data));
  const said = [];
  w.voiceEngine = { say: async (t) => { said.push(t); }, cancel() {}, cue() {}, resumeAudio() {} };
  w.ui = { toast() {} };
  const copilot = w.VoiceAssistant.copilot;
  copilot.init();
  copilot.ui = { banner: w.document.createElement("div"), button: w.document.createElement("button") };
  copilot.ui.button.innerHTML = '<span class="copilot-fab-label"></span>';
  copilot.enableMediaKeys = () => {};
  const count = (name) => calls.filter((c) => c === name).length;
  return { w, copilot, emit, calls, said, count };
}

test("con Vosk la frase se escucha con un solo micrófono abierto: no se reinicia cada pocos segundos", async () => {
  const { copilot, count } = apk();
  copilot.saveSettings({ wakeEnabled: true, wakePhrase: "hey amigo" });
  try {
    await wait(6600);
    assert.equal(count("WakeWord.start"), 1, "una sola sesión de Vosk");
    assert.equal(count("SpeechRecognition.start"), 0, "el reconocedor de Android no se abre y cierra solo");
  } finally {
    await copilot.deactivate();
  }
});

test("«hey amigo, quiero ir al portal de la 80» con Vosk: suelta el micrófono y ejecuta la orden", async () => {
  const { copilot, emit, count } = apk();
  const handled = [];
  copilot.saveSettings({ wakeEnabled: true, wakePhrase: "hey amigo" });
  await wait(30);
  copilot.controller = { handle: async (t) => { handled.push(t); }, cancelPending() {}, awaitingAnswer: false };
  try {
    emit("WakeWord.partial", { text: "el clima" });
    emit("WakeWord.result", { text: "el clima está bueno" });
    await wait(1000);
    assert.deepEqual(handled, [], "sin la frase no pasa nada");
    emit("WakeWord.partial", { text: "ey amigo" });
    emit("WakeWord.result", { text: "ey amigo" });
    emit("WakeWord.partial", { text: "quiero ir al portal" });
    emit("WakeWord.result", { text: "quiero ir al portal de la ochenta" });
    await wait(1100);
    assert.equal(count("WakeWord.stop") >= 1, true, "Vosk suelta el micrófono");
    assert.deepEqual(handled, ["quiero ir al portal de la ochenta"]);
  } finally {
    await copilot.deactivate();
  }
});

test("solo la frase con Vosk: abre la escucha de la orden con el reconocedor de Android", async () => {
  const { copilot, emit, count } = apk();
  copilot.saveSettings({ wakeEnabled: true, wakePhrase: "hey amigo" });
  await wait(30);
  try {
    emit("WakeWord.result", { text: "hey amigo" });
    await wait(1700);
    assert.equal(copilot.phase, "listening");
    assert.equal(count("SpeechRecognition.start"), 1, "la orden con el reconocedor de Android");
  } finally {
    await copilot.deactivate();
  }
});

test("sin el modelo de Vosk la frase sigue con el reconocedor de Android", async () => {
  const { copilot, count } = apk({ voskStart: () => Promise.reject(new Error("model: missing")) });
  copilot.saveSettings({ wakeEnabled: true, wakePhrase: "hey amigo" });
  try {
    await wait(100);
    assert.equal(count("SpeechRecognition.start"), 1);
  } finally {
    await copilot.deactivate();
  }
});

test("al entrar a la app sin permiso del micrófono el Copiloto no habla ni muestra el diálogo de permiso", async () => {
  const { copilot, said, count } = apk({ permission: "prompt" });
  await copilot.activate({ listen: false });
  assert.deepEqual(said, [], "no dice «no tengo permiso» si nadie lo llamó");
  assert.equal(count("SpeechRecognition.requestPermissions"), 0);
  assert.equal(copilot.on, false);
  await copilot.press();
  assert.equal(count("SpeechRecognition.requestPermissions"), 1, "con el botón sí pide el permiso");
  copilot.endSession();
  await copilot.deactivate();
});

test("los números dichos en palabras pasan a cifras para buscar el lugar", () => {
  const w = new JSDOM("", { runScripts: "outside-only" }).window;
  w.eval(readFileSync("js/services/voiceIntents.js", "utf8"));
  const place = (t) => w.VoiceIntents.parse(t).place;
  assert.equal(place("quiero ir al portal de la ochenta"), "portal de la 80");
  assert.equal(place("llévame a la calle setenta y dos con carrera quince"), "calle 72 con carrera 15");
  assert.equal(place("voy a la avenida ciento cuarenta"), "avenida 140");
  assert.equal(place("llévame a un colegio"), "colegio", "«un» no es un número");
});

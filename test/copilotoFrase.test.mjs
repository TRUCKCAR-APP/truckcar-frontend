import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";

// «Hey amigo» (pausa) «quiero ir al portal de la 80»: la orden dicha después de la frase llega al Copiloto. En el teléfono,
// la sesión que oyó la frase manda su aviso de fin cuando la de la orden ya empezó; antes eso la cerraba vacía.

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function nativeWindow({ listening = () => true } = {}) {
  const w = new JSDOM("<!doctype html><body></body>", { runScripts: "outside-only", url: "http://localhost:5500/" }).window;
  const calls = [];
  const listeners = {};
  w.Capacitor = {
    isNativePlatform: () => true,
    nativePromise: (plugin, method) => {
      calls.push(method);
      if (method === "stop") return new Promise(() => {});
      if (method === "available") return Promise.resolve({ available: true });
      if (method === "isListening") return Promise.resolve({ listening: listening() });
      if (/Permissions$/.test(method)) return Promise.resolve({ speechRecognition: "granted" });
      return Promise.resolve({});
    },
    addListener: (plugin, event, cb) => {
      (listeners[event] = listeners[event] || new Set()).add(cb);
      return { remove() { listeners[event].delete(cb); } };
    }
  };
  for (const file of ["js/services/voiceIntents.js", "js/services/voiceAssistant.js"]) w.eval(readFileSync(file, "utf8"));
  const emit = (event, data) => [...(listeners[event] || [])].forEach((cb) => cb(data));
  const said = [];
  const cues = [];
  w.voiceEngine = { say: async (t) => { said.push(t); }, cancel() {}, cue: (c) => cues.push(c), resumeAudio() {} };
  const copilot = w.VoiceAssistant.copilot;
  copilot.init();
  copilot.ui = { banner: w.document.createElement("div"), button: w.document.createElement("button") };
  copilot.ui.button.innerHTML = '<span class="copilot-fab-label"></span>';
  copilot.enableMediaKeys = () => {};
  return { w, copilot, emit, calls, said, cues, starts: () => calls.filter((m) => m === "start").length };
}

test("el aviso de fin atrasado de la sesión de la frase no cierra la orden; la frase sola no cuenta como orden", async () => {
  const { copilot, emit } = nativeWindow();
  const heard = copilot.recognizer.listenOnce({ accept: (t) => !/^hey amigo$/.test(t), delay: 100 });
  emit("listeningState", { status: "stopped" });
  emit("partialResults", { matches: ["hey amigo"] });
  await wait(700);
  emit("partialResults", { matches: ["quiero ir al portal de la 80"] });
  assert.equal(await heard, "quiero ir al portal de la 80");
});

test("«hey amigo», pausa y la orden: el Copiloto la muestra y la ejecuta", async () => {
  const { copilot, emit, cues, starts } = nativeWindow();
  const handled = [];
  copilot.saveSettings({ wakeEnabled: true, wakePhrase: "hey amigo" });
  await wait(30);
  copilot.controller = { handle: async (t) => { handled.push(t); }, cancelPending() {}, awaitingAnswer: false };
  try {
    // Escucha de la frase: oye solo la frase y la sesión termina.
    emit("partialResults", { matches: ["hey amigo"] });
    emit("listeningState", { status: "stopped" });
    await wait(400);
    assert.equal(copilot.phase, "listening", "la frase abre la sesión de la orden");
    // Llegan tarde el fin y el resultado de la sesión de la frase.
    emit("listeningState", { status: "stopped" });
    emit("partialResults", { matches: ["hey amigo"] });
    await wait(700);
    assert.equal(copilot.phase, "listening", "sigue escuchando la orden");
    assert.ok(cues.includes("start"), "suena el tono cuando el micrófono ya escucha");
    assert.ok(starts() >= 2);
    emit("partialResults", { matches: ["quiero ir al portal de la 80"] });
    assert.equal(copilot.ui.banner.textContent, "quiero ir al portal de la 80", "se ve en pantalla lo que captó");
    emit("listeningState", { status: "stopped" });
    await wait(600);
    assert.deepEqual(handled, ["quiero ir al portal de la 80"], "y se ejecuta");
  } finally {
    await copilot.deactivate();
  }
});

test("si el reconocedor muere sin avisar antes de oír algo, se abre otra sesión dentro de los 6 s", async () => {
  let alive = false;
  const { copilot, emit, starts } = nativeWindow({ listening: () => alive });
  const heard = copilot.recognizer.listenOnce({});
  assert.equal(starts(), 1);
  await wait(1400);
  assert.equal(starts(), 2, "isListening falso sin haber oído nada: otra sesión");
  alive = true;
  emit("partialResults", { matches: ["qué llevo"] });
  assert.equal(await heard, "qué llevo");
});

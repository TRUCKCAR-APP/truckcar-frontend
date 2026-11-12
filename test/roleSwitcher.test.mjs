import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";

const HEADER = `<div id="role-switcher" class="hidden"><button id="role-btn-driver"></button><button id="role-btn-coordinator"></button></div>
  <button id="rotate-device-btn"></button><button id="sim-toggle-btn"></button>`;

function app({ phone, sessionRole, activeRole }) {
  const w = new JSDOM(`<!doctype html><body>${HEADER}</body>`, { runScripts: "outside-only" }).window;
  const listeners = [];
  w.matchMedia = (query) => ({
    get matches() { return query === "(min-width: 768px)" ? !w.__phone : false; },
    addEventListener: (_, fn) => listeners.push(fn)
  });
  w.__phone = phone;
  const state = { isAuthenticated: true, sessionRole, activeRole };
  w.store = { get state() { return state; }, setState: (patch) => Object.assign(state, patch) };
  w.TruckCarService = { loadAll: async () => {} };
  w.eval(readFileSync("js/app.js", "utf8"));
  return { w, state, resize(toPhone) { w.__phone = toPhone; listeners.forEach(fn => fn()); } };
}

const switcherVisible = (w) => !w.document.getElementById("role-switcher").classList.contains("hidden");

test("en el teléfono ADMIN y COORDINADOR no ven el selector y no pueden abrir la app del conductor", async () => {
  for (const sessionRole of ["ADMIN", "COORDINADOR"]) {
    const { w, state } = app({ phone: true, sessionRole, activeRole: "coordinator" });
    w.app.updateHeader(state);
    assert.equal(switcherVisible(w), false, sessionRole);
    await w.app.setRole("driver");
    assert.equal(state.activeRole, "coordinator", sessionRole + " sigue en la torre");
  }
});

test("en escritorio la torre conserva el selector y la vista previa del conductor", async () => {
  const { w, state } = app({ phone: false, sessionRole: "ADMIN", activeRole: "coordinator" });
  w.app.updateHeader(state);
  assert.equal(switcherVisible(w), true);
  await w.app.setRole("driver");
  assert.equal(state.activeRole, "driver");
});

test("el conductor no tiene selector y sigue en su app en el teléfono", async () => {
  const { w, state } = app({ phone: true, sessionRole: "CONDUCTOR", activeRole: "driver" });
  w.app.updateHeader(state);
  assert.equal(switcherVisible(w), false);
  assert.equal(w.app.canUseDriverView("CONDUCTOR"), true);
});

test("si la ventana pasa a tamaño teléfono con la vista previa abierta, vuelve a la torre", async () => {
  const { w, state, resize } = app({ phone: false, sessionRole: "COORDINADOR", activeRole: "driver" });
  w.app.watchPhoneLayout();
  resize(true);
  await Promise.resolve();
  assert.equal(state.activeRole, "coordinator");
  w.app.updateHeader(state);
  assert.equal(switcherVisible(w), false);
});

test("el encabezado de la torre se apila en 390 px: columna encogible y textos sin cortes internos", () => {
  const src = readFileSync("js/views/coordinatorPanel.js", "utf8");
  assert.match(src, /<div class="min-w-0 flex-1">\s*<h1/, "la columna del título puede encogerse");
  assert.match(src, /whitespace-nowrap"><span class="dot ok"><\/span> En línea/, "En línea no se parte ni se monta");
  assert.match(src, /<span class="whitespace-nowrap">Última sincronización:/, "la hora de sincronización no se parte");
  assert.match(src, /<p class="[^"]*flex-wrap[^"]*"><span data-network-status class="tower-net/, "el estado de red y la hora se apilan");
  const css = readFileSync("css/main.css", "utf8");
  assert.ok(css.includes('.tower-net:has(.net-status[data-state="online"]) { display: none; }'), "no repite En línea: el título ya lo dice");
});

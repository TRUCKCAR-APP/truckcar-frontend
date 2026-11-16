import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { JSDOM } from "jsdom";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const NATIVE_CALL = /(?<![.\w$])(?<!function\s)(?:prompt|confirm|alert)\s*\((?![^)]*\)\s*\{)|window\.(?:prompt|confirm|alert)\s*\(/;

function sourceFiles(dir) {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry).replace(/\\/g, "/");
    return statSync(path).isDirectory() ? sourceFiles(path) : path.endsWith(".js") ? [path] : [];
  });
}

test("el detector reconoce un diálogo nativo y no confunde los componentes propios", () => {
  for (const native of ["const r = prompt('Motivo');", "if (confirm('¿Seguro?')) {", "alert('Listo');", "window.confirm('x')",
    "onclick=\"alert('x')\"", "x = window.prompt ('y')"]) {
    assert.match(native, NATIVE_CALL, native);
  }
  for (const own of ["await window.Sheet.prompt({ title })", "window.Sheet.confirm({ title })", "function prompt({ title }) {",
    "    alert() {", "window.voiceEngine.alert();", "api.alerts.confirm(alertId)", "prompt.prompt();", "function confirm({ title, message }) {"]) {
    assert.doesNotMatch(own, NATIVE_CALL, own);
  }
});

test("no queda ningún prompt(, confirm( ni alert( nativo en js/ ni en index.html", () => {
  const found = [];
  for (const file of [...sourceFiles("js"), "index.html"]) {
    readFileSync(file, "utf8").split(/\r?\n/).forEach((line, index) => {
      if (NATIVE_CALL.test(line)) found.push(file + ":" + (index + 1) + " " + line.trim().slice(0, 80));
    });
  }
  assert.deepEqual(found, []);
});

test("tampoco hay avisos de salida, ventanas emergentes ni notificaciones del navegador", () => {
  const banned = /beforeunload|onunload|window\.open\(|new Notification\(|Notification\.requestPermission|\.print\(/;
  const found = [...sourceFiles("js"), "index.html", "sw.js"].filter((file) => banned.test(readFileSync(file, "utf8")));
  assert.deepEqual(found, []);
});

test("los formularios con campos obligatorios no usan los globos de validación del navegador", () => {
  const withNative = sourceFiles("js").flatMap((file) =>
    [...readFileSync(file, "utf8").matchAll(/<form\b[^>]*>/g)].filter((m) => !/\bnovalidate\b/.test(m[0])).map((m) => file + " " + m[0].slice(0, 60)));
  assert.deepEqual(withNative, []);
});

function panel({ cancelLoad }) {
  const dom = new JSDOM("<!doctype html><html><body><button id='origen'>Cancelar</button></body></html>",
    { runScripts: "outside-only", pretendToBeVisual: true, url: "http://localhost:5500/" });
  const w = dom.window;
  const calls = { cancel: [], toasts: [], failures: [], native: 0, states: [] };
  w.prompt = () => { calls.native++; return "nativo"; };
  w.confirm = () => { calls.native++; return true; };
  w.alert = () => { calls.native++; };
  w.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  const state = { dataStatus: { loading: false, errors: {} }, busyAction: null, activeRole: "coordinator", sessionRole: "COORDINADOR" };
  w.store = { get state() { return state; }, getState: () => state, subscribe() {},
    setState: (patch) => { Object.assign(state, patch); calls.states.push({ ...patch }); } };
  w.eval(readFileSync("js/ui.js", "utf8"));
  w.ui.toast = (title, type) => calls.toasts.push([title, type]);
  w.ui.failure = (title) => calls.failures.push(title);
  w.TruckCarData = {};
  w.TruckCarApi = {};
  w.eval(readFileSync("js/dataService.js", "utf8"));
  w.TruckCarService.cancelLoad = async (loadId, reason) => { calls.cancel.push([loadId, reason]); return cancelLoad ? cancelLoad() : {}; };
  w.TruckCarService.loadPublishedLoads = async () => {};
  ["js/ui/sheet.js", "js/views/coordinatorPanel.js", "js/views/generatorPanel.js"].forEach((file) => w.eval(readFileSync(file, "utf8")));
  return { w, calls, state };
}

const key = (w, name, extra = {}) => w.document.dispatchEvent(new w.KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true, ...extra }));

const CASES = [
  { name: "la torre", open: (w) => w.coordinatorCtrl.cancelLoad(1), title: "Cancelar la carga #1", confirm: "Cancelar carga", done: /Carga #1 cancelada/ },
  { name: "el generador", open: (w) => w.generatorCtrl.cancel(1), title: "Cancelar el envío CARGA-1", confirm: "Cancelar envío", done: /Envío CARGA-1 cancelado/ }
];

for (const flow of CASES) {
  test(`cancelar desde ${flow.name} pide el motivo en una hoja propia, accesible y con el campo enfocado`, async () => {
    const { w, calls } = panel({});
    const pending = flow.open(w);
    await sleep(60);
    const sheet = w.document.querySelector(".sheet");
    assert.ok(sheet, "se abre la hoja");
    assert.equal(calls.native, 0, "sin diálogos del navegador");
    assert.equal(sheet.getAttribute("role"), "dialog");
    assert.equal(sheet.getAttribute("aria-modal"), "true");
    assert.equal(w.document.getElementById(sheet.getAttribute("aria-labelledby")).textContent, flow.title);
    const field = sheet.querySelector("textarea");
    assert.equal(w.document.activeElement, field, "el foco arranca en el motivo");
    assert.equal(field.getAttribute("aria-label"), "Motivo de la cancelación");
    assert.equal(field.getAttribute("aria-required"), "true");
    assert.equal(field.maxLength, 500);
    const hint = w.document.getElementById(field.getAttribute("aria-describedby"));
    assert.equal(hint.getAttribute("role"), "alert");
    const [confirm, back] = [...sheet.querySelectorAll("[data-sheet-action]")];
    assert.equal(confirm.textContent.trim(), flow.confirm);
    assert.match(confirm.className, /btn-secondary is-danger/, "secundario con tono de peligro");
    assert.equal(back.textContent.trim(), "Volver");
    assert.doesNotMatch(back.className, /is-danger/);

    field.value = "   ";
    confirm.click();
    await sleep(20);
    assert.equal(hint.textContent, "Indique el motivo de la cancelación.");
    assert.equal(field.getAttribute("aria-invalid"), "true");
    assert.equal(w.document.activeElement, field, "el foco vuelve al campo");
    assert.ok(w.document.querySelector(".sheet-backdrop"), "la hoja sigue abierta");
    assert.deepEqual(calls.cancel, []);

    field.value = "  El generador retiró la carga  ";
    field.dispatchEvent(new w.Event("input", { bubbles: true }));
    assert.equal(hint.textContent, "", "el error se limpia al escribir");
    assert.equal(field.getAttribute("aria-invalid"), null);
    confirm.click();
    await pending;
    assert.deepEqual(calls.cancel, [[1, "El generador retiró la carga"]]);
    assert.match(calls.toasts[0][0], flow.done);
    assert.deepEqual(calls.states.map((s) => s.busyAction), ["cancel", null]);
  });

  test(`en ${flow.name}, Escape y «Volver» cierran sin cancelar nada`, async () => {
    const { w, calls } = panel({});
    const origin = w.document.getElementById("origen");
    origin.focus();
    const byEscape = flow.open(w);
    await sleep(60);
    w.document.querySelector(".sheet textarea").value = "Motivo a medias";
    key(w, "Escape");
    await byEscape;
    assert.equal(w.document.activeElement, origin, "el foco regresa a donde estaba");

    const byBack = flow.open(w);
    await sleep(60);
    [...w.document.querySelectorAll(".sheet-backdrop.is-open [data-sheet-action], .sheet-backdrop [data-sheet-action]")].pop().click();
    await byBack;
    assert.deepEqual(calls.cancel, []);
    assert.deepEqual(calls.states, [], "no se marca ninguna acción en curso");
    assert.equal(calls.native, 0);
  });
}

test("el Tab no se sale de la hoja: da la vuelta entre el primer y el último control", async () => {
  const { w } = panel({});
  const pending = w.coordinatorCtrl.cancelLoad(7);
  await sleep(60);
  const sheet = w.document.querySelector(".sheet");
  const controls = [...sheet.querySelectorAll("button, textarea")];
  const first = controls[0];
  const last = controls[controls.length - 1];
  last.focus();
  key(w, "Tab");
  assert.equal(w.document.activeElement, first);
  key(w, "Tab", { shiftKey: true });
  assert.equal(w.document.activeElement, last);
  sheet.querySelector("textarea").focus();
  const middle = new w.KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true });
  w.document.dispatchEvent(middle);
  assert.equal(middle.defaultPrevented, false, "entre controles el Tab sigue su curso normal");
  key(w, "Escape");
  await pending;
});

test("si el backend rechaza la cancelación se informa y la interfaz queda libre", async () => {
  const { w, calls, state } = panel({ cancelLoad: () => { throw Object.assign(new Error("La carga #1 no puede cancelarse en status IN_TRANSIT"), { status: 409 }); } });
  const pending = w.coordinatorCtrl.cancelLoad(1);
  await sleep(60);
  w.document.querySelector(".sheet textarea").value = "Ya no se requiere";
  w.document.querySelector("[data-sheet-action='0']").click();
  await pending;
  assert.deepEqual(calls.failures, ["No se pudo cancelar la carga"]);
  assert.equal(state.busyAction, null);
});

function form(html) {
  const w = new JSDOM(`<!doctype html><body><form novalidate>${html}</form></body>`, { runScripts: "outside-only" }).window;
  w.eval(readFileSync("js/ui.js", "utf8"));
  return { w, form: w.document.querySelector("form") };
}

test("un campo obligatorio vacío se explica en pantalla, junto al campo y con el foco en él", () => {
  const { w, form: f } = form(`
    <label class="field"><span class="field-label">Correo</span><input name="email" type="email" required></label>
    <label class="field"><span class="field-label">Contraseña <span class="field-req">· mínimo 8 caracteres</span></span><input name="password" type="password" required></label>`);
  assert.equal(w.ui.reportFormProblem(f), true);
  const email = f.elements.email;
  const hint = f.querySelector("[data-form-problem]");
  assert.equal(hint.textContent, "Complete el campo «Correo».");
  assert.equal(hint.getAttribute("role"), "alert");
  assert.equal(hint.previousElementSibling, email.closest("label"), "queda justo después del campo");
  assert.equal(email.getAttribute("aria-invalid"), "true");
  assert.equal(email.getAttribute("aria-describedby"), hint.id);
  assert.equal(w.document.activeElement, email);

  email.value = "correo-sin-arroba";
  assert.equal(w.ui.reportFormProblem(f), true);
  assert.equal(f.querySelectorAll("[data-form-problem]").length, 1, "un solo mensaje a la vez");
  assert.match(f.querySelector("[data-form-problem]").textContent, /Escriba un correo válido en «Correo»/);

  email.value = "ana@empresa.com";
  assert.equal(w.ui.reportFormProblem(f), true);
  assert.equal(f.querySelector("[data-form-problem]").textContent, "Complete el campo «Contraseña».", "la etiqueta no arrastra la nota del campo");
  assert.equal(email.getAttribute("aria-invalid"), null, "el campo corregido queda limpio");

  f.elements.password.value = "secreta123";
  assert.equal(w.ui.reportFormProblem(f), false);
  assert.equal(f.querySelector("[data-form-problem]"), null);
});

test("los límites numéricos del formulario de vehículo se explican con su etiqueta", () => {
  const { w, form: f } = form(`
    <div><label for="veh-plate">Placa del vehículo</label><input id="veh-plate" type="text" required></div>
    <div><label for="veh-payload">Capacidad (t)</label><input id="veh-payload" type="number" min="0.1" step="0.1" required></div>`);
  assert.equal(w.ui.reportFormProblem(f), true);
  assert.equal(f.querySelector("[data-form-problem]").textContent, "Complete el campo «Placa del vehículo».");
  w.document.getElementById("veh-plate").value = "TDK-410";
  w.document.getElementById("veh-payload").value = "0";
  assert.equal(w.ui.reportFormProblem(f), true);
  assert.equal(f.querySelector("[data-form-problem]").textContent, "El valor de «Capacidad (t)» debe ser 0.1 o más.");
  w.document.getElementById("veh-payload").value = "34";
  assert.equal(w.ui.reportFormProblem(f), false);
});

test("el login y el formulario de vehículo de la torre validan con el componente propio", () => {
  assert.match(readFileSync("js/views/loginView.js", "utf8"), /class="login-form" novalidate>/);
  const app = readFileSync("js/app.js", "utf8");
  for (const handler of ["async submitLogin(event) {", "async submitRegister(event) {"]) {
    const body = app.slice(app.indexOf(handler), app.indexOf(handler) + 200);
    assert.match(body, /if \(window\.ui\.reportFormProblem\(event\.target\)\) return;/, handler);
  }
  const tower = readFileSync("js/views/coordinatorPanel.js", "utf8");
  assert.match(tower, /id="vehicle-registration-form"[^>]*novalidate>/);
  for (const id of ["veh-driver-id", "veh-plate", "veh-type", "veh-model", "veh-height", "veh-tare", "veh-payload"]) {
    assert.match(tower, new RegExp(`<label for="${id}"`), "la etiqueta está enlazada a " + id);
  }
});

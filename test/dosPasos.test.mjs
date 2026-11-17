import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";

// Verificación en dos pasos (TOTP): API del login en dos pasos, transición al paso 2, pantalla del código y la hoja de
// Seguridad de la cuenta.

const TOKEN = (claims) => "h." + Buffer.from(JSON.stringify(claims)).toString("base64url") + ".s";

function apiWindow(responses) {
  const w = new JSDOM("<!doctype html><body></body>", { runScripts: "outside-only", url: "http://localhost:5500/" }).window;
  const requests = [];
  w.TruckCarConfig = { apiBaseUrl: "https://api.truckcar.test/api/v1", gatewayUrl: "https://api.truckcar.test", requestTimeoutMs: 5000,
    storageKeys: { session: "truckcar.session" } };
  w.fetch = async (url, options) => {
    requests.push({ url: String(url), method: options.method, headers: options.headers, body: options.body ? JSON.parse(options.body) : null });
    const { status = 200, body } = responses.shift();
    return { ok: status < 400, status, headers: { get: (h) => (h.toLowerCase() === "content-type" ? "application/json" : null) },
      text: async () => JSON.stringify(body) };
  };
  w.eval(readFileSync("js/api.js", "utf8"));
  return { w, requests, stored: () => w.localStorage.getItem("truckcar.session") };
}

test("con 2FA el primer paso no guarda ninguna sesión y devuelve el token temporal", async () => {
  const { w, stored } = apiWindow([{ body: { requiresTwoFactor: true, tempToken: "temp-123", expiresIn: 300 } }]);
  const result = await w.TruckCarApi.auth.login("ana@truckcar.co", "Segura123!");
  assert.equal(result.requiresTwoFactor, true);
  assert.equal(result.tempToken, "temp-123");
  assert.ok(result.expiresAt > Date.now() + 290_000);
  assert.equal(stored(), null, "el token temporal no se persiste");
});

test("sin 2FA el login guarda la sesión como siempre", async () => {
  const access = TOKEN({ sub: "u-1", role: "CONDUCTOR", email: "a@b.co", exp: Math.floor(Date.now() / 1000) + 900 });
  const { w, stored } = apiWindow([{ body: { accessToken: access, refreshToken: "r", tokenType: "Bearer", expiresIn: 900 } }]);
  const session = await w.TruckCarApi.auth.login("a@b.co", "x");
  assert.equal(session.role, "CONDUCTOR");
  assert.equal(JSON.parse(stored()).userId, "u-1");
});

test("el segundo paso va a /auth/2fa/verify-login sin Authorization y guarda la sesión completa", async () => {
  const access = TOKEN({ sub: "u-2", role: "TRANSPORTADORA", email: "e@b.co", exp: Math.floor(Date.now() / 1000) + 900 });
  const { w, requests, stored } = apiWindow([{ body: { accessToken: access, refreshToken: "r2", expiresIn: 900 } }]);
  const session = await w.TruckCarApi.auth.verifyTwoFactor("temp-123", "287082");
  assert.equal(requests[0].url, "https://api.truckcar.test/api/v1/auth/2fa/verify-login");
  assert.deepEqual(requests[0].body, { tempToken: "temp-123", code: "287082" });
  assert.equal(requests[0].headers.Authorization, undefined);
  assert.equal(session.role, "TRANSPORTADORA");
  assert.equal(JSON.parse(stored()).refreshToken, "r2");
});

test("un código inválido es un error del formulario, no una sesión vencida (no cierra nada)", async () => {
  const { w } = apiWindow([{ status: 401, body: { type: "https://truckcar.co/errors/invalid-2fa-code", title: "Código de verificación inválido",
    status: 401, detail: "El código no es válido o ya se usó", message: "El código no es válido o ya se usó" } }]);
  let unauthorized = false;
  w.addEventListener("truckcar:unauthorized", () => { unauthorized = true; });
  await assert.rejects(w.TruckCarApi.auth.verifyTwoFactor("temp", "000000"), (error) => error.status === 401);
  assert.equal(unauthorized, false);
});

// ── Flujo en app.js ──

function appWindow() {
  const w = new JSDOM("<!doctype html><body><div id='app-mount'></div></body>", { runScripts: "outside-only" }).window;
  const state = { isAuthenticated: false, authMode: "login" };
  w.matchMedia = () => ({ matches: true, addEventListener() {} });
  w.store = { get state() { return state; }, getState: () => state, setState: (patch) => Object.assign(state, patch) };
  w.eval(readFileSync("js/dataService.js", "utf8"));
  w.TruckCarConfig = { demoTools: false };
  w.eval(readFileSync("js/ui.js", "utf8"));
  w.eval(readFileSync("js/app.js", "utf8"));
  const sessions = [];
  w.app.startSession = async (session) => { sessions.push(session); };
  return { w, state, sessions };
}

function form(w, fields) {
  const el = w.document.createElement("form");
  for (const [name, value] of Object.entries(fields)) {
    const input = w.document.createElement("input");
    input.name = name;
    input.value = value;
    el.appendChild(input);
  }
  w.document.body.appendChild(el);
  return { preventDefault() {}, target: el };
}

test("si el login pide 2FA la app pasa al paso 2 y solo abre la sesión con un código válido", async () => {
  const { w, state, sessions } = appWindow();
  const calls = [];
  w.TruckCarApi = { auth: {
    login: async () => ({ requiresTwoFactor: true, tempToken: "temp-9", expiresAt: Date.now() + 300_000 }),
    verifyTwoFactor: async (temp, code) => { calls.push([temp, code]); return { role: "CONDUCTOR" }; }
  } };

  await w.app.submitLogin(form(w, { email: " ana@truckcar.co ", password: "Segura123!" }));
  assert.equal(state.authMode, "2fa");
  assert.equal(state.twoFactor.tempToken, "temp-9");
  assert.equal(state.twoFactor.email, "ana@truckcar.co");
  assert.deepEqual(sessions, [], "sin sesión tras la contraseña");

  await w.app.submitTwoFactor(form(w, { code: "12ab" }));
  assert.match(state.authError, /6 dígitos/);
  assert.deepEqual(calls, []);

  await w.app.submitTwoFactor(form(w, { code: "287082" }));
  assert.deepEqual(calls, [["temp-9", "287082"]]);
  assert.equal(sessions.length, 1);
  assert.equal(state.twoFactor, null, "el token temporal se descarta");
  assert.equal(state.authMode, "login");
});

test("el código de respaldo, el botón Volver y un token temporal vencido", async () => {
  const { w, state } = appWindow();
  const codes = [];
  w.TruckCarApi = { auth: { verifyTwoFactor: async (temp, code) => { codes.push(code); return {}; } } };
  state.authMode = "2fa";
  state.twoFactor = { tempToken: "t", expiresAt: Date.now() + 60_000, email: "a@b.co", backup: false };

  w.app.toggleBackupCode();
  assert.equal(state.twoFactor.backup, true);
  await w.app.submitTwoFactor(form(w, { code: "ABCD-2345" }));
  assert.deepEqual(codes, ["ABCD-2345"]);

  state.authMode = "2fa";
  state.twoFactor = { tempToken: "t", expiresAt: Date.now() - 1, email: "a@b.co", backup: false };
  await w.app.submitTwoFactor(form(w, { code: "123456" }));
  assert.equal(state.authMode, "login");
  assert.match(state.authError, /venció/);
  assert.deepEqual(codes, ["ABCD-2345"], "un token vencido no se envía");

  state.authMode = "2fa";
  state.twoFactor = { tempToken: "t", expiresAt: Date.now() + 60_000 };
  w.app.cancelTwoFactor();
  assert.equal(state.authMode, "login");
  assert.equal(state.twoFactor, null);
});

test("si el servidor dice que el token temporal ya no sirve, vuelve al primer paso con el mensaje", async () => {
  const { w, state } = appWindow();
  w.TruckCarApi = { auth: { verifyTwoFactor: async () => {
    throw Object.assign(new Error("La verificación en dos pasos venció o no es válida; inicie sesión de nuevo"),
      { status: 401, details: { type: "https://truckcar.co/errors/invalid-2fa-token" } });
  } } };
  state.authMode = "2fa";
  state.twoFactor = { tempToken: "t", expiresAt: Date.now() + 60_000, backup: false };
  await w.app.submitTwoFactor(form(w, { code: "123456" }));
  assert.equal(state.authMode, "login");
  assert.match(state.authError, /venció o no es válida/);
});

// ── Pantallas ──

function viewWindow(files) {
  const w = new JSDOM("<!doctype html><body></body>", { runScripts: "outside-only" }).window;
  w.store = { state: {}, getState: () => ({}), setState() {} };
  w.eval(readFileSync("js/ui.js", "utf8"));
  for (const file of files) w.eval(readFileSync(file, "utf8"));
  return w;
}

test("el paso 2 del login está hecho para el teléfono: teclado numérico y autocompletar del código", () => {
  const w = viewWindow(["js/views/loginView.js"]);
  w.TruckCarConfig = { gatewayUrl: "https://api" };
  const render = (backup) => {
    w.document.body.innerHTML = w.LoginView.render({ authMode: "2fa", twoFactor: { email: "ana@truckcar.co", backup } });
    return w.document.querySelector("#two-factor-code");
  };
  const totp = render(false);
  assert.equal(totp.getAttribute("inputmode"), "numeric");
  assert.equal(totp.getAttribute("autocomplete"), "one-time-code");
  assert.equal(totp.getAttribute("maxlength"), "6");
  assert.match(w.document.body.textContent, /Verificación en dos pasos/);
  assert.match(w.document.body.textContent, /Usar un código de respaldo/);
  assert.match(w.document.body.textContent, /Volver al inicio de sesión/);
  assert.match(w.document.body.textContent, /ana@truckcar\.co/);

  const backup = render(true);
  assert.equal(backup.getAttribute("inputmode"), null);
  assert.equal(backup.getAttribute("autocapitalize"), "characters");
  assert.match(w.document.body.textContent, /Usar el código de la app/);
});

test("Seguridad de la cuenta: estado, QR con clave manual y códigos de respaldo descargables", () => {
  const w = viewWindow(["js/views/securitySettings.js"]);
  const ui = w.TwoFactorUI;
  assert.equal(ui.statusLabel({ twoFactorEnabled: true }), "Activa");
  assert.equal(ui.statusLabel({}), "Desactivada");
  assert.equal(ui.groupSecret("JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP"), "JBSW Y3DP EHPK 3PXP JBSW Y3DP EHPK 3PXP");

  w.document.body.innerHTML = ui.statusHtml({ twoFactorEnabled: false });
  assert.ok(w.document.querySelector('[data-2fa-action="setup"]'));
  w.document.body.innerHTML = ui.statusHtml({ twoFactorEnabled: true });
  assert.ok(w.document.querySelector('[data-2fa-action="disable"]'));
  assert.equal(w.document.querySelector("[data-2fa-password]").getAttribute("autocomplete"), "current-password");

  w.document.body.innerHTML = ui.setupHtml({ secret: "JBSWY3DPEHPK3PXP", qrImage: "data:image/svg+xml;base64,PHN2Zz4=\" onerror=\"x" });
  const img = w.document.querySelector(".two-factor-qr");
  assert.equal(img.getAttribute("onerror"), null, "la imagen se escapa");
  assert.match(w.document.querySelector("[data-2fa-secret]").textContent, /JBSW Y3DP EHPK 3PXP/);
  assert.equal(w.document.querySelector("[data-2fa-code]").getAttribute("autocomplete"), "one-time-code");

  const codes = ["ABCD-2345", "EFGH-6789"];
  w.document.body.innerHTML = ui.backupHtml(codes);
  assert.deepEqual([...w.document.querySelectorAll("[data-2fa-codes] code")].map(c => c.textContent), codes);
  const text = ui.backupCodesText(codes, "ana@truckcar.co");
  assert.match(text, /Cuenta: ana@truckcar\.co/);
  assert.match(text, /1\. ABCD-2345\n2\. EFGH-6789/);
});

test("todos los roles llegan a Seguridad: el conductor desde Vehículo y los paneles desde el encabezado", () => {
  for (const file of ["js/views/coordinatorPanel.js", "js/views/generatorPanel.js", "js/views/companyPanel.js", "js/views/driverApp.js"]) {
    const source = readFileSync(file, "utf8");
    assert.match(source, /onclick="window\.TwoFactorUI\.open\(\)"[^>]*data-security-button/, file);
  }
});

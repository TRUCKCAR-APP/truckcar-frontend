import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";

// "¿Olvidó su contraseña?": código de 6 dígitos al correo, verificación y contraseña nueva.

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
  return { w, requests };
}

test("las tres llamadas van sin sesión a /auth/password/{forgot,verify,reset}", async () => {
  const { w, requests } = apiWindow([
    { status: 202, body: { message: "ok", expiresInSeconds: 600, resendAfterSeconds: 60 } },
    { body: { resetToken: "tok-1", expiresInSeconds: 600 } },
    { body: { message: "Contraseña actualizada" } }
  ]);
  await w.TruckCarApi.auth.password.forgot("ana@truckcar.co");
  await w.TruckCarApi.auth.password.verify("ana@truckcar.co", "482913");
  await w.TruckCarApi.auth.password.reset("tok-1", "Nueva-clave-2026");
  assert.deepEqual(requests.map(r => r.url.replace("https://api.truckcar.test/api/v1", "")),
    ["/auth/password/forgot", "/auth/password/verify", "/auth/password/reset"]);
  assert.deepEqual(requests[1].body, { email: "ana@truckcar.co", code: "482913" });
  assert.deepEqual(requests[2].body, { resetToken: "tok-1", newPassword: "Nueva-clave-2026" });
  assert.ok(requests.every(r => !r.headers.Authorization), "quien olvidó la contraseña no tiene token");
  assert.equal(w.localStorage.getItem("truckcar.session"), null, "nada se guarda");
});

// ── Flujo en la app ──

function appWindow(api) {
  const w = new JSDOM("<!doctype html><body><div id='app-mount'></div></body>", { runScripts: "outside-only" }).window;
  const state = { isAuthenticated: false, authMode: "login" };
  w.matchMedia = () => ({ matches: true, addEventListener() {} });
  w.store = { get state() { return state; }, getState: () => state, setState: (patch) => Object.assign(state, patch) };
  w.eval(readFileSync("js/dataService.js", "utf8"));
  w.TruckCarConfig = { demoTools: false, gatewayUrl: "https://api.truckcar.test" };
  w.eval(readFileSync("js/ui.js", "utf8"));
  w.eval(readFileSync("js/views/loginView.js", "utf8"));
  w.eval(readFileSync("js/app.js", "utf8"));
  w.TruckCarApi = { RATE_LIMITED_MESSAGE: "Demasiados intentos", auth: { password: api } };
  return { w, state };
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

const problem = (type, detail, status = 400) => Object.assign(new Error(detail), { status, detail,
  details: { type: "https://truckcar.co/errors/" + type, detail } });

test("el flujo completo: correo → código → contraseña nueva → vuelve al login con el correo y un aviso", async () => {
  const calls = [];
  const { w, state } = appWindow({
    forgot: async (email) => { calls.push(["forgot", email]); return { resendAfterSeconds: 60 }; },
    verify: async (email, code) => { calls.push(["verify", email, code]); return { resetToken: "tok-1" }; },
    reset: async (token, password) => { calls.push(["reset", token, password]); return {}; }
  });
  w.app.startPasswordReset();
  assert.equal(state.authMode, "forgot");
  assert.equal(state.passwordReset.step, "email");

  await w.app.submitResetEmail(form(w, { email: " ana@truckcar.co " }));
  assert.equal(state.passwordReset.step, "code");
  assert.ok(state.passwordReset.resendAt > Date.now() + 55_000, "espera un minuto para reenviar");

  await w.app.submitResetCode(form(w, { code: "482 913" }));
  assert.equal(state.passwordReset.step, "password");
  assert.equal(state.passwordReset.resetToken, "tok-1");

  await w.app.submitNewPassword(form(w, { newPassword: "Nueva-clave-2026", confirmPassword: "Nueva-clave-2026" }));
  assert.deepEqual(calls, [["forgot", "ana@truckcar.co"], ["verify", "ana@truckcar.co", "482913"], ["reset", "tok-1", "Nueva-clave-2026"]]);
  assert.equal(state.authMode, "login");
  assert.equal(state.passwordReset, null, "el token se descarta");
  assert.equal(state.loginEmail, "ana@truckcar.co");
  assert.match(state.authNotice, /Contraseña actualizada/);
  clearTimeout(w.app.resetTimer);
});

test("validaciones locales: código de 6 dígitos y contraseñas iguales de 8 a 72 caracteres", async () => {
  const { w, state } = appWindow({ verify: async () => { throw new Error("no debía llamarse"); }, reset: async () => { throw new Error("no"); } });
  state.authMode = "forgot";
  state.passwordReset = { step: "code", email: "ana@truckcar.co", resendAt: 0 };
  await w.app.submitResetCode(form(w, { code: "48291" }));
  assert.match(state.authError, /6 dígitos/);
  state.passwordReset = { step: "password", email: "ana@truckcar.co", resetToken: "tok" };
  await w.app.submitNewPassword(form(w, { newPassword: "corta", confirmPassword: "corta" }));
  assert.match(state.authError, /entre 8 y 72/);
  await w.app.submitNewPassword(form(w, { newPassword: "Nueva-clave-2026", confirmPassword: "Otra-clave-2026" }));
  assert.match(state.authError, /no coinciden/);
});

test("un código equivocado se queda en el paso del código; uno bloqueado pide otro", async () => {
  const errors = [problem("invalid-reset-code", "El código no es válido o ya venció"),
    problem("reset-code-locked", "Se superó el número de intentos con este código. Pida un código nuevo", 429)];
  const { w, state } = appWindow({ verify: async () => { throw errors.shift(); } });
  state.authMode = "forgot";
  state.passwordReset = { step: "code", email: "ana@truckcar.co", resendAt: 0 };
  await w.app.submitResetCode(form(w, { code: "111111" }));
  assert.equal(state.passwordReset.step, "code");
  assert.match(state.authError, /no es válido/);
  await w.app.submitResetCode(form(w, { code: "222222" }));
  assert.match(state.authError, /Pida un código nuevo/);
});

test("si la verificación venció al guardar, vuelve al primer paso con el correo", async () => {
  const { w, state } = appWindow({ reset: async () => { throw problem("invalid-reset-token", "La verificación venció o ya se usó"); } });
  state.authMode = "forgot";
  state.passwordReset = { step: "password", email: "ana@truckcar.co", resetToken: "tok" };
  await w.app.submitNewPassword(form(w, { newPassword: "Nueva-clave-2026", confirmPassword: "Nueva-clave-2026" }));
  assert.equal(state.passwordReset.step, "email");
  assert.equal(state.passwordReset.email, "ana@truckcar.co");
  assert.equal(state.passwordReset.resetToken, null);
  assert.match(state.authError, /venció/);
});

test("reenviar respeta la espera de un minuto", async () => {
  let sent = 0;
  const { w, state } = appWindow({ forgot: async () => { sent++; return { resendAfterSeconds: 60 }; } });
  state.authMode = "forgot";
  state.passwordReset = { step: "code", email: "ana@truckcar.co", resendAt: Date.now() + 30_000 };
  await w.app.resendResetCode();
  assert.equal(sent, 0);
  state.passwordReset.resendAt = Date.now() - 1;
  await w.app.resendResetCode();
  assert.equal(sent, 1);
  clearTimeout(w.app.resetTimer);
});

test("pantallas: enlace en el login, cada paso con su campo y el aviso de éxito", () => {
  const { w } = appWindow({});
  const html = (state) => {
    const div = w.document.createElement("div");
    div.innerHTML = w.LoginView.render({ isAuthenticated: false, ...state });
    return div;
  };
  const login = html({ authMode: "login", loginEmail: "ana@truckcar.co", authNotice: "Contraseña actualizada. Inicie sesión con la contraseña nueva." });
  assert.ok([...login.querySelectorAll("button")].some(b => b.textContent.includes("¿Olvidó su contraseña?")));
  assert.equal(login.querySelector('input[name="email"]').value, "ana@truckcar.co");
  assert.match(login.querySelector(".login-ok").textContent, /Contraseña actualizada/);
  assert.equal(html({ authMode: "register" }).querySelector(".login-forgot"), null, "no aparece al registrarse");

  const email = html({ authMode: "forgot", passwordReset: { step: "email", email: "" } });
  assert.ok(email.querySelector('[data-reset-step="email"] input[type="email"]'));
  const code = html({ authMode: "forgot", passwordReset: { step: "code", email: "<b>ana</b>@truckcar.co", resendAt: Date.now() + 40_000 } });
  const input = code.querySelector("#reset-code");
  assert.equal(input.getAttribute("autocomplete"), "one-time-code");
  assert.equal(input.getAttribute("inputmode"), "numeric");
  assert.match(code.querySelector("[data-reset-wait]").textContent, /Puede pedir otro código en \d+ s/);
  assert.ok(!code.innerHTML.includes("<b>ana</b>"), "el correo se escapa");
  const ready = html({ authMode: "forgot", passwordReset: { step: "code", email: "ana@truckcar.co", resendAt: 0 } });
  assert.ok(ready.querySelector("[data-reset-resend]"));
  const pass = html({ authMode: "forgot", passwordReset: { step: "password", email: "ana@truckcar.co", resetToken: "t" } });
  assert.equal(pass.querySelectorAll('input[type="password"][autocomplete="new-password"]').length, 2);
});

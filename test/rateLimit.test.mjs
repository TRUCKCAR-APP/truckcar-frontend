// KAN-31: el gateway limita /api/v1/auth/login, /register y /refresh y responde 429 con Retry-After. La PWA muestra
// "Demasiados intentos, espere unos segundos" y un 429 al renovar la sesión no la cierra.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";

const SESSION_KEY = "truckcar.test.session";
const RATE_LIMITED = "Demasiados intentos, espere unos segundos";

/** Respuesta mínima de fetch: lo que api.js lee (status, ok, headers.get, text). */
function reply(status, body = "", headers = {}) {
  const lower = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
  if (body && !lower["content-type"]) lower["content-type"] = "application/json";
  return { status, ok: status >= 200 && status < 300, headers: { get: (name) => lower[name.toLowerCase()] ?? null },
    text: async () => body };
}

/** routes: { "POST /auth/login": () => reply(...) }. Devuelve la ventana y las llamadas hechas. */
function browser(routes) {
  const dom = new JSDOM("<!doctype html><html><body></body></html>", { runScripts: "outside-only", url: "http://localhost:5500/" });
  const w = dom.window;
  const calls = [];
  w.TruckCarConfig = { gatewayUrl: "http://localhost:8000", apiBaseUrl: "http://localhost:8000/api/v1",
    requestTimeoutMs: 5000, storageKeys: { session: SESSION_KEY } };
  w.fetch = async (url, options) => {
    const key = options.method + " " + new URL(url).pathname.replace("/api/v1", "");
    calls.push(key);
    const handler = routes[key];
    if (!handler) throw new Error("ruta no simulada: " + key);
    return handler();
  };
  w.eval(readFileSync("js/api.js", "utf8"));
  return { w, calls };
}

const gatewayBody = JSON.stringify({ status: 429, error: "Demasiadas solicitudes", message: RATE_LIMITED, path: "/api/v1/auth/login" });

test("un login limitado (429) es un ApiError con el mensaje y los segundos de Retry-After", async () => {
  const { w } = browser({ "POST /auth/login": () => reply(429, gatewayBody, { "Retry-After": "1" }) });

  await assert.rejects(w.TruckCarApi.auth.login("x@x.com", "incorrecta"), (error) => {
    assert.equal(error.status, 429);
    assert.equal(error.isRateLimited, true);
    assert.equal(error.retryAfterSeconds, 1);
    assert.equal(error.message, RATE_LIMITED);
    return true;
  });
  assert.equal(w.TruckCarApi.RATE_LIMITED_MESSAGE, RATE_LIMITED);
});

test("un 429 sin cuerpo ni Retry-After también se explica al usuario", async () => {
  const { w } = browser({ "POST /auth/register": () => reply(429) });

  await assert.rejects(w.TruckCarApi.auth.register({ email: "x@x.com" }), (error) => {
    assert.equal(error.isRateLimited, true);
    assert.equal(error.retryAfterSeconds, null);
    assert.equal(error.message, RATE_LIMITED);
    return true;
  });
});

function expiredSession(w) {
  w.localStorage.setItem(SESSION_KEY, JSON.stringify({ accessToken: "viejo", refreshToken: "r1", expiresAt: Date.now() - 1000, userId: "u1" }));
}

test("si /auth/refresh responde 429 la sesión NO se cierra: solo hay que esperar", async () => {
  const { w, calls } = browser({
    "POST /auth/refresh": () => reply(429, gatewayBody, { "Retry-After": "1" }),
    "GET /loads/mine": () => reply(401, JSON.stringify({ status: 401, message: "El token de acceso no es válido o ya venció" }))
  });
  expiredSession(w);
  let unauthorized = 0;
  w.addEventListener("truckcar:unauthorized", () => unauthorized++);

  await assert.rejects(w.TruckCarApi.http.get("/loads/mine"), (error) => error.isRateLimited);

  assert.ok(w.localStorage.getItem(SESSION_KEY), "la sesión sigue guardada");
  assert.equal(unauthorized, 0, "no se avisa a la app de que la sesión terminó");
  assert.ok(calls.includes("POST /auth/refresh"));
});

test("si /auth/refresh responde 401 (sesión revocada) la sesión sí se cierra, como antes", async () => {
  const { w } = browser({
    "POST /auth/refresh": () => reply(401, JSON.stringify({ status: 401, message: "Refresh token inválido" })),
    "GET /loads/mine": () => reply(401, JSON.stringify({ status: 401, message: "El token de acceso no es válido o ya venció" }))
  });
  expiredSession(w);
  let unauthorized = 0;
  w.addEventListener("truckcar:unauthorized", () => unauthorized++);

  await assert.rejects(w.TruckCarApi.http.get("/loads/mine"), (error) => error.isUnauthorized);

  assert.equal(w.localStorage.getItem(SESSION_KEY), null);
  assert.equal(unauthorized, 1);
});

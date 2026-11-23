import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";

// Lo que ve el usuario cuando algo falla: palabras que entienda, nunca códigos HTTP, nombres de servicios, códigos de
// rastreo ni textos técnicos o en inglés. El detalle técnico queda en la consola para soporte.

function ui({ online = true } = {}) {
  const w = new JSDOM("<!doctype html><body></body>", { runScripts: "outside-only" }).window;
  const logged = [];
  w.console.warn = (...args) => logged.push(args.join(" "));
  Object.defineProperty(w.navigator, "onLine", { configurable: true, value: online });
  w.eval(readFileSync("js/ui.js", "utf8"));
  return { w, logged };
}

const E = (status, message, extra = {}) => ({ status, message, correlationId: "4000ab12-9f3c-4b1e", path: "/auth/login", ...extra });
const TECHNICAL = /trace|4000ab12|HTTP|API|Gateway|https?:|Exception|null|\b[45]\d\d\b|must|blank|HERE_API_KEY|latitude/i;

test("inicio de sesión: credenciales, cuenta suspendida, sin red y demasiados intentos", () => {
  const { w } = ui();
  const m = (e) => w.ui.errorMessage(e, "login");
  assert.equal(m(E(401, "Credenciales inválidas")), "El correo o la contraseña no son correctos. Revíselos e intente de nuevo.");
  assert.equal(m(E(403, "La cuenta está suspendida; contacte a un administrador")), "La cuenta está suspendida; contacte a un administrador.");
  assert.equal(m(E(0, "Sin conexión con el servidor de TruckCar")),
    "No pudimos conectar con TruckCar. Revise su conexión a internet e intente de nuevo en un momento.");
  assert.equal(m(E(429, "Too Many Requests", { retryAfterSeconds: 12 })), "Hizo demasiados intentos seguidos. Espere 12 segundos e intente de nuevo.");
  assert.equal(w.ui.errorMessage(E(409, "El correo ya se encuentra registrado: ana@truckcar.co"), "register"),
    "Ya existe una cuenta con ese correo. Inicie sesión o use «¿Olvidó su contraseña?»");
  assert.equal(w.ui.errorMessage(E(401, "Código inválido"), "2fa"), "El código no es correcto o ya venció. Revise que sea el más reciente.");
});

test("sin internet lo dice así; si el servidor tarda, pide revisar la señal", () => {
  assert.equal(ui({ online: false }).w.ui.errorMessage(E(0, "Sin conexión con el servidor de TruckCar")),
    "No tiene conexión a internet. Revise los datos móviles o el wifi e intente de nuevo.");
  assert.equal(ui().w.ui.errorMessage(E(0, "Tiempo de espera agotado consultando /loads/mine")),
    "El servidor está tardando en responder. Revise su señal e intente de nuevo.");
});

test("lo que el servidor ya escribió para una persona se muestra; lo técnico o en inglés se reemplaza", () => {
  const { w } = ui();
  const m = (e) => w.ui.errorMessage(e);
  assert.equal(m(E(400, "La contraseña debe tener al menos 8 caracteres")), "La contraseña debe tener al menos 8 caracteres.");
  assert.equal(m(E(409, "La propuesta de la carga #12 ya no está vigente")), "La propuesta de la carga #12 ya no está vigente.");
  assert.equal(m(E(400, "must not be blank")), "Algunos datos no son válidos. Revíselos e intente de nuevo.");
  assert.equal(m(E(400, "Coordenadas inválidas: latitude en [-90, 90] y longitude en [-180, 180]")), "Algunos datos no son válidos. Revíselos e intente de nuevo.");
  assert.equal(m(E(401, "Sesión expirada o credenciales inválidas")), "Su sesión terminó. Inicie sesión de nuevo.");
  assert.equal(m(E(404, "Recurso no encontrado")), "No encontramos lo que buscaba; puede que ya no exista. Actualice e intente de nuevo.");
  assert.equal(m(new Error("Cannot read properties of undefined (reading 'x')")), "Algo salió mal. Intente de nuevo en un momento.");
});

test("una falla del servidor nunca muestra su detalle técnico", () => {
  const { w } = ui();
  for (const e of [E(500, "NullPointerException at java.lang.Thread"), E(503, "La búsqueda de destinos no tiene configurada la clave de HERE (HERE_API_KEY)"),
    E(502, "Load-Allocation respondió vacío al consultar"), E(503, "El servicio de rutas respondió 503")]) {
    assert.equal(w.ui.errorMessage(e), "El servicio no está disponible en este momento. Intente de nuevo en unos minutos.");
  }
  assert.equal(w.ui.errorMessage(E(504, "Gateway Timeout")), "El servicio tardó demasiado en responder. Intente de nuevo en un momento.");
});

test("ningún mensaje lleva códigos de rastreo ni jerga; el detalle técnico va a la consola", () => {
  const { w, logged } = ui();
  const samples = [E(401, "Credenciales inválidas"), E(0, "No hay conexión con el API Gateway (https://x.trycloudflare.com)"),
    E(500, "boom"), E(400, "must not be null"), E(418, "Error HTTP 418"), E(403, "Forbidden")];
  for (const e of samples) assert.doesNotMatch(w.ui.errorMessage(e, "login"), TECHNICAL, JSON.stringify(e));
  assert.ok(logged.some((line) => line.includes("4000ab12")), "el código de rastreo queda en la consola");
});

test("la cola sin señal, el Copiloto y la ventana de conflicto usan el mismo texto claro", () => {
  assert.match(readFileSync("js/offlineQueue.js", "utf8"), /status\.lastError = error \? \(window\.ui && window\.ui\.errorMessage/);
  assert.match(readFileSync("js/dataService.js", "utf8"), /\[section\]: window\.ui \? window\.ui\.errorMessage\(error\)/);
  assert.doesNotMatch(readFileSync("js/ui/sheet.js", "utf8"), /Referencia de soporte/);
  assert.doesNotMatch(readFileSync("js/api.js", "utf8"), /API Gateway \(/);
  const w = new JSDOM("<!doctype html><body></body>", { runScripts: "outside-only" }).window;
  w.console.warn = () => {};
  for (const file of ["js/ui.js", "js/services/voiceIntents.js", "js/services/voiceAssistant.js"]) w.eval(readFileSync(file, "utf8"));
  assert.equal(w.VoiceAssistant.errorText(E(503, "HERE no está disponible (HTTP 503)")),
    "El servicio no está disponible en este momento. Intente de nuevo en unos minutos");
});

test("el error RFC 7807 del gateway (application/problem+json) se lee por su detail, no como JSON crudo", async () => {
  const w = new JSDOM("<!doctype html><body></body>", { runScripts: "outside-only", url: "http://localhost:5500/" }).window;
  w.console.warn = () => {};
  w.TruckCarConfig = { gatewayUrl: "http://localhost:8000", apiBaseUrl: "http://localhost:8000/api/v1", requestTimeoutMs: 5000,
    routingUrl: "https://router.project-osrm.org/route/v1/driving/", storageKeys: { session: "truckcar.session" } };
  const headers = { "content-type": "application/problem+json", "x-correlation-id": "4000ab12-9f3c" };
  w.fetch = async () => ({ ok: false, status: 401, headers: { get: (k) => headers[k.toLowerCase()] || null },
    text: async () => JSON.stringify({ type: "about:blank", title: "Unauthorized", status: 401, detail: "Credenciales inválidas" }) });
  for (const file of ["js/ui.js", "js/api.js"]) w.eval(readFileSync(file, "utf8"));
  const error = await w.TruckCarApi.http.post("/auth/login", { email: "a@b.co", password: "x" }, { auth: false }).catch((e) => e);
  assert.equal(error.message, "Credenciales inválidas");
  assert.equal(w.ui.errorMessage(error, "login"), "El correo o la contraseña no son correctos. Revíselos e intente de nuevo.");
});

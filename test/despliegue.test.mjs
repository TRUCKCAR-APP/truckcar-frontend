import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { JSDOM } from "jsdom";
import { injectApiBaseUrl } from "../scripts/inject-config.mjs";

const require = createRequire(import.meta.url);

function config({ url, meta = "", native = false }) {
  const w = new JSDOM(`<!doctype html><html><head><meta name="truckcar-api-base-url" content="${meta}"></head><body></body></html>`,
    { runScripts: "outside-only", url }).window;
  if (native) w.Capacitor = { isNativePlatform: () => true };
  w.eval(readFileSync("js/config.js", "utf8"));
  return w.TruckCarConfig;
}

test("la URL del API inyectada al compilar manda sobre cualquier otra", () => {
  const c = config({ url: "https://app.truckcar.test/", meta: "https://api.truckcar.test/api/v1/" });
  assert.equal(c.gatewayUrl, "https://api.truckcar.test");
  assert.equal(c.apiBaseUrl, "https://api.truckcar.test/api/v1");
  assert.equal(c.environment, "production");
});

test("localhost:8000 solo se usa en desarrollo local por http; en producción el respaldo es el mismo origen", () => {
  assert.equal(config({ url: "http://localhost:5500/" }).gatewayUrl, "http://localhost:8000");
  assert.equal(config({ url: "http://localhost:5500/" }).environment, "local");
  assert.equal(config({ url: "https://app.truckcar.test/panel" }).gatewayUrl, "https://app.truckcar.test");
});

test("la APK sin URL inyectada no cae en localhost: queda sin servidor y la API responde con un error claro", async () => {
  const c = config({ url: "https://localhost/", native: true });
  assert.equal(c.gatewayUrl, "");
  assert.equal(c.apiBaseUrl, "");
  assert.equal(c.nativeApp, true);
  assert.equal(config({ url: "https://localhost/", native: true, meta: "https://api.truckcar.test" }).apiBaseUrl, "https://api.truckcar.test/api/v1");

  const w = new JSDOM("<!doctype html><body></body>", { runScripts: "outside-only", url: "https://localhost/" }).window;
  w.TruckCarConfig = { ...c, storageKeys: { session: "truckcar.session" } };
  w.fetch = async () => assert.fail("sin servidor configurado no se hace ninguna petición");
  w.eval(readFileSync("js/api.js", "utf8"));
  const error = await w.TruckCarApi.auth.login("ana@truckcar.co", "secreto123").catch((e) => e);
  assert.match(error.message, /no tiene configurada la dirección del servidor/);
});

test("el script de compilación inyecta la URL del API y rechaza una APK sin URL o sin https", () => {
  const html = readFileSync("index.html", "utf8");
  assert.match(html, /<meta name="truckcar-api-base-url" content="">/, "el repositorio no trae ninguna URL fija");
  const injected = injectApiBaseUrl(html, "https://api.truckcar.test");
  assert.match(injected, /<meta name="truckcar-api-base-url" content="https:\/\/api\.truckcar\.test">/);
  assert.equal(injectApiBaseUrl(injected, ""), html, "sin variable queda vacío: mismo origen");
  assert.throws(() => injectApiBaseUrl(html, "", { requireUrl: true }), /Falta TRUCKCAR_API_BASE_URL/);
  assert.throws(() => injectApiBaseUrl(html, "http://10.0.0.5:8000", { requireHttps: true }), /https/);
  assert.throws(() => injectApiBaseUrl(html, "api sin esquema"), /no es una URL válida/);
  assert.match(JSON.parse(readFileSync("package.json", "utf8")).scripts["build:apk"], /inject-config\.mjs .*--require-url --require-https/);
});

test("la APK de release apaga el tráfico en claro, el contenido mixto y la depuración del WebView", () => {
  const key = require.resolve("../capacitor.config.js");
  const load = (hostname) => {
    delete require.cache[key];
    if (hostname === undefined) delete process.env.TRUCKCAR_APP_HOSTNAME;
    else process.env.TRUCKCAR_APP_HOSTNAME = hostname;
    return require(key);
  };
  const base = load(undefined);
  assert.equal(base.server.cleartext, false);
  assert.equal(base.server.androidScheme, "https");
  assert.equal(base.android.allowMixedContent, false);
  assert.equal(base.android.webContentsDebuggingEnabled, false);
  assert.equal("hostname" in base.server, false, "sin parámetro no se inventa un hostname");
  assert.equal(load("app.truckcar.test").server.hostname, "app.truckcar.test");
  load(undefined);

  assert.match(readFileSync("android/app/src/main/AndroidManifest.xml", "utf8"), /android:usesCleartextTraffic="false"/);
  assert.match(readFileSync("android/app/build.gradle", "utf8"), /usesCleartextTraffic: "false"/);
  assert.throws(() => readFileSync("capacitor.config.json"), /ENOENT/);
});

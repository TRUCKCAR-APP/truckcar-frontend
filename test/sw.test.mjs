// Service Worker: el app shell precargado coincide con lo que carga index.html y las estrategias de caché nunca guardan
// la API ni las evidencias firmadas.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import vm from "node:vm";

const ORIGIN = "http://localhost:5500";

/** Carga sw.js con un ámbito de Service Worker mínimo y devuelve los manejadores registrados. */
function loadServiceWorker() {
  const handlers = {};
  const cacheStores = new Map();
  const keyOf = (request) => (typeof request === "string" ? request : request.url);
  // Como Cache Storage: "css/main.css" y "http://localhost:5500/css/main.css" son la misma entrada.
  const same = (a, b) => new URL(a, ORIGIN + "/").href === new URL(b, ORIGIN + "/").href;
  const cacheFor = (name) => {
    if (!cacheStores.has(name)) {
      const entries = new Map();
      cacheStores.set(name, {
        entries,
        addAll: async (urls) => urls.forEach((url) => entries.set(url, "precached")),
        match: async (request) => { const key = [...entries.keys()].find((k) => same(k, keyOf(request))); return key === undefined ? undefined : entries.get(key); },
        put: async (request, response) => entries.set(keyOf(request), response),
        keys: async () => [...entries.keys()],
        delete: async (key) => entries.delete(key),
      });
    }
    return cacheStores.get(name);
  };
  const context = {
    self: {
      addEventListener: (type, fn) => { handlers[type] = fn; },
      location: new URL(ORIGIN + "/sw.js"),
      skipWaiting: async () => {},
      clients: { claim: async () => {} },
    },
    caches: {
      open: async (name) => cacheFor(name),
      keys: async () => [...cacheStores.keys()],
      delete: async (name) => cacheStores.delete(name),
      match: async (request) => {
        for (const cache of cacheStores.values()) {
          const hit = await cache.match(request);
          if (hit) return hit;
        }
        return undefined;
      },
    },
    fetch: async (url) => ({ ok: true, type: "basic", body: typeof url === "string" ? url : url.url, clone() { return this; } }),
    Response: { error: () => ({ type: "error" }) },
    URL,
    Promise,
  };
  vm.createContext(context);
  vm.runInContext(readFileSync("sw.js", "utf8"), context, { filename: "sw.js" });
  return { handlers, context, cacheStores };
}

function fetchEvent(url, { method = "GET", mode = "cors" } = {}) {
  const event = { request: { url, method, mode }, responded: null };
  event.respondWith = (promise) => { event.responded = promise; };
  return event;
}

async function install(handlers) {
  let installing;
  handlers.install({ waitUntil: (promise) => { installing = promise; } });
  await installing;
}

test("registra install, activate y fetch", () => {
  const { handlers } = loadServiceWorker();
  assert.deepEqual(Object.keys(handlers).sort(), ["activate", "fetch", "install"]);
});

test("cada archivo del app shell existe y cada script y hoja de estilos de index.html está precargado", async () => {
  const { handlers, cacheStores } = loadServiceWorker();
  await install(handlers);
  const shell = [...cacheStores.values()][0].entries;
  for (const path of shell.keys()) {
    if (path === "./") continue;
    assert.ok(existsSync(path), `el app shell incluye ${path}, que no existe`);
  }
  const html = readFileSync("index.html", "utf8");
  const localScripts = [...html.matchAll(/<script src="(js\/[^"]+)"/g)].map((match) => match[1]);
  assert.ok(localScripts.length > 10, "index.html debería cargar los scripts de js/");
  for (const script of localScripts) {
    assert.ok(shell.has(script), `${script} se carga en index.html pero no está en el app shell: sin señal no cargaría`);
  }
  for (const css of [...html.matchAll(/<link[^>]+href="(css\/[^"]+)"/g)].map((match) => match[1])) {
    assert.ok(shell.has(css), `${css} se carga en index.html pero no está en el app shell`);
  }
});

test("la API, otros orígenes, las evidencias firmadas y las escrituras nunca pasan por la caché", () => {
  const { handlers } = loadServiceWorker();
  for (const [url, options] of [
    ["http://localhost:8000/api/v1/loads/mine", {}],
    ["http://localhost:8000/api/v1/fleets-drivers/sync/batch", { method: "POST" }],
    [`${ORIGIN}/pod-media/pod/7/photo-abc.jpg?X-Amz-Signature=1`, {}],
    ["https://router.project-osrm.org/route/v1/driving/1,2;3,4", {}],
    [`${ORIGIN}/js/app.js`, { method: "POST" }],
  ]) {
    const event = fetchEvent(url, options);
    handlers.fetch(event);
    assert.equal(event.responded, null, `${options.method || "GET"} ${url} no debe responderse desde el Service Worker`);
  }
});

test("teselas, CDN, navegación y app shell sí se sirven desde el Service Worker", () => {
  const { handlers } = loadServiceWorker();
  for (const [url, options] of [
    ["https://a.tile.openstreetmap.org/12/1200/1900.png", {}],
    ["https://unpkg.com/leaflet@1.9.4/dist/leaflet.js", {}],
    [`${ORIGIN}/`, { mode: "navigate" }],
    [`${ORIGIN}/js/offlineQueue.js`, {}],
  ]) {
    const event = fetchEvent(url, options);
    handlers.fetch(event);
    assert.ok(event.responded, `${url} debería responderse desde el Service Worker`);
  }
});

test("sin red, la navegación cae al index.html precargado", async () => {
  const { handlers, context } = loadServiceWorker();
  await install(handlers);
  context.fetch = async () => { throw new TypeError("Failed to fetch"); };
  const event = fetchEvent(`${ORIGIN}/conductor`, { mode: "navigate" });
  handlers.fetch(event);
  assert.equal((await event.responded).body, "index.html");
});

test("el precargado se salta la caché HTTP del navegador (una versión nueva nunca guarda el CSS viejo)", async () => {
  const { handlers, context } = loadServiceWorker();
  const options = [];
  context.fetch = async (url, init) => { options.push(init && init.cache); return { ok: true, body: url, clone() { return this; } }; };
  await install(handlers);
  assert.ok(options.length > 20);
  assert.ok(options.every((cache) => cache === "reload"), "cada archivo del app shell se pide con cache: 'reload'");
});

test("con red el app shell llega fresco; sin red, desde la copia guardada", async () => {
  const { handlers, context } = loadServiceWorker();
  await install(handlers);
  context.fetch = async (request, init) => ({ ok: true, body: "fresco:" + (init && init.cache), clone() { return this; } });
  const online = fetchEvent(`${ORIGIN}/css/main.css`);
  handlers.fetch(online);
  assert.equal((await online.responded).body, "fresco:no-cache");

  context.fetch = async () => { throw new TypeError("Failed to fetch"); };
  const offline = fetchEvent(`${ORIGIN}/css/tokens.css`);
  handlers.fetch(offline);
  assert.equal((await offline.responded).body, "css/tokens.css", "la copia precargada");
});

test("el manifiesto de la PWA es válido y sus íconos existen", () => {
  const manifest = JSON.parse(readFileSync("manifest.webmanifest", "utf8"));
  for (const field of ["name", "start_url", "display", "icons"]) assert.ok(manifest[field], `falta ${field}`);
  for (const icon of manifest.icons) assert.ok(existsSync(icon.src.replace(/^\.?\//, "")), `no existe el ícono ${icon.src}`);
});

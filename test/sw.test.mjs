import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import vm from "node:vm";
import { IDBFactory, IDBKeyRange } from "fake-indexeddb";

const ORIGIN = "http://localhost:5500";

function loadServiceWorker() {
  const handlers = {};
  const clock = { now: Date.parse("2026-11-01T12:00:00Z") };
  class FakeDate extends Date { static now() { return clock.now; } }
  const cacheStores = new Map();
  const keyOf = (request) => (typeof request === "string" ? request : request.url);
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
    fetch: async (url) => ({ ok: true, type: "basic", headers: new Headers(), body: typeof url === "string" ? url : url.url, clone() { return this; } }),
    Response,
    Headers,
    Blob,
    Uint8Array,
    atob,
    Date: FakeDate,
    indexedDB: new IDBFactory(),
    IDBKeyRange,
    URL,
    Promise,
    importScripts: (...files) => files.forEach((file) => vm.runInContext(readFileSync(file, "utf8"), context, { filename: file })),
  };
  vm.createContext(context);
  vm.runInContext(readFileSync("sw.js", "utf8"), context, { filename: "sw.js" });
  return { handlers, context, cacheStores, clock, tiles: context.self.TileStore };
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

test("Tailwind llega compilado y propio: sin CDN y en el mismo lugar de la cascada que tenía", () => {
  const html = readFileSync("index.html", "utf8");
  assert.doesNotMatch(html, /cdn\.tailwindcss\.com|tailwind\.config\s*=/, "Tailwind no se compila en el navegador");
  const links = [...html.matchAll(/<link rel="stylesheet" href="([^"]+)"/g)].map((match) => match[1]);
  assert.equal(links.at(-1), "css/tailwind.css", "va al final, donde el CDN inyectaba su hoja, después de main.css");
  assert.ok(existsSync("css/tailwind.css") && existsSync("tailwind.config.cjs"));
  assert.doesNotMatch(readFileSync("sw.js", "utf8"), /cdn\.tailwindcss\.com/);
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
    ["https://tiles.stadiamaps.com/tiles/alidade_smooth_dark/12/1200/1900@2x.png", {}],
    ["https://basemaps.cartocdn.com/rastertiles/dark_all/12/1200/1900.png", {}],
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

const TILE = "https://tiles.stadiamaps.com/tiles/alidade_smooth_dark/10/301/504@2x.png";
const HOUR = 60 * 60 * 1000;
const MB = 1024 * 1024;

function tileResponse(bytes = 11440, headers = { "content-type": "image/png", "cache-control": "max-age=21600" }, type = "cors") {
  const response = new Response(new Uint8Array(bytes), { status: 200, headers });
  Object.defineProperty(response, "type", { value: type });
  return response;
}

async function requestTile(handlers, url = TILE) {
  const event = fetchEvent(url);
  const waits = [];
  event.waitUntil = (promise) => waits.push(promise);
  handlers.fetch(event);
  const response = await event.responded;
  await Promise.all(waits);
  return response;
}

async function activate(handlers) {
  let activating;
  handlers.activate({ waitUntil: (promise) => { activating = promise; } });
  await activating;
}

test("el vencimiento sale de Cache-Control o Expires; sin cabeceras, 7 días; no-store y max-age=0 no se guardan", () => {
  const { tiles, clock } = loadServiceWorker();
  const now = clock.now;
  const h = (values) => new Headers(values);
  assert.equal(tiles.ttlFrom(h({ "cache-control": "max-age=21600" }), now), 6 * HOUR);
  assert.equal(tiles.ttlFrom(h({ "cache-control": "public, max-age=60", expires: "Wed, 01 Jan 2031 00:00:00 GMT" }), now), 60000,
    "max-age manda sobre Expires");
  assert.equal(tiles.ttlFrom(h({ expires: new Date(now + 2 * HOUR).toUTCString() }), now), 2 * HOUR);
  assert.equal(tiles.ttlFrom(h({}), now), 7 * 24 * HOUR);
  for (const headers of [{ "cache-control": "no-store" }, { "cache-control": "no-cache" }, { "cache-control": "max-age=0" },
    { expires: "Sat, 01 Jan 2000 00:00:00 GMT" }, { expires: "0" }]) {
    assert.equal(tiles.ttlFrom(h(headers), now), 0, JSON.stringify(headers));
  }
});

test("una tesela vista se guarda con su vencimiento y tamaño reales; vencida, nunca se sirve y se borra", async () => {
  const { handlers, context, clock, tiles, cacheStores } = loadServiceWorker();
  let network = 0;
  context.fetch = async () => { network++; return tileResponse(); };

  await requestTile(handlers);
  const record = await tiles.get(TILE);
  assert.equal(record.bytes, 11440, "cuenta los bytes reales de la @2x");
  assert.equal(record.expires, clock.now + 6 * HOUR, "vence cuando dice Cache-Control (6 h en Stadia)");

  await requestTile(handlers);
  assert.equal(network, 1, "vigente: se sirve desde la caché sin pedirla otra vez");

  clock.now += 6 * HOUR + 1;
  context.fetch = async () => { throw new TypeError("Failed to fetch"); };
  const offline = await requestTile(handlers);
  assert.equal(offline.status, 200);
  assert.equal(offline.headers.get("content-type"), "image/png");
  assert.ok((await offline.arrayBuffer()).byteLength < 100, "cuadro transparente, no la tesela vencida");
  assert.equal(await tiles.get(TILE), undefined, "el registro vencido se borra");
  assert.equal(cacheStores.get("truckcar-tiles-v2").entries.size, 0, "y la tesela también");
});

test("sin señal y sin tesela guardada: PNG transparente válido, sin error de red ni cuadro roto", async () => {
  const { handlers, context } = loadServiceWorker();
  context.fetch = async () => { throw new TypeError("Failed to fetch"); };
  const response = await requestTile(handlers);
  assert.notEqual(response.type, "error");
  assert.equal(response.status, 200);
  const png = new Uint8Array(await response.arrayBuffer());
  assert.equal(String.fromCharCode(...png.slice(1, 4)), "PNG");
  assert.equal(png[25], 6, "tipo de color RGBA");
});

test("respuestas opacas o con no-store no se guardan (no se conoce o no se permite su vencimiento)", async () => {
  const { handlers, context, tiles } = loadServiceWorker();
  context.fetch = async () => tileResponse(5000, {}, "opaque");
  await requestTile(handlers);
  context.fetch = async () => tileResponse(5000, { "cache-control": "no-store" });
  await requestTile(handlers, TILE.replace("504", "505"));
  assert.deepEqual(await tiles.all(), []);
});

test("tope de 100 MB: se expulsan primero las vencidas y después las de uso menos reciente", async () => {
  const { handlers, context, clock, tiles } = loadServiceWorker();
  assert.equal(tiles.MAX_BYTES, 100 * MB);
  const now = clock.now;
  await tiles.put({ url: "https://tiles.stadiamaps.com/vencida", bytes: 30 * MB, expires: now - 1, used: now - 1 });
  await tiles.put({ url: "https://tiles.stadiamaps.com/antigua", bytes: 60 * MB, expires: now + HOUR, used: now - 5 * HOUR });
  await tiles.put({ url: "https://tiles.stadiamaps.com/reciente", bytes: 20 * MB, expires: now + HOUR, used: now - HOUR });
  assert.deepEqual(Array.from(tiles.planEviction(await tiles.all(), now)), ["https://tiles.stadiamaps.com/vencida"],
    "sin las vencidas ya cabe: no se toca ninguna vigente");

  context.fetch = async () => tileResponse(25 * MB);
  await requestTile(handlers);
  const left = await tiles.all();
  assert.deepEqual(Array.from(left, (r) => r.url).sort(), ["https://tiles.stadiamaps.com/reciente", TILE].sort());
  assert.ok(left.reduce((sum, r) => sum + r.bytes, 0) <= tiles.MAX_BYTES);
});

test("sin precarga: instalar y activar no piden teselas, y cada tesela vista se pide una sola vez", async () => {
  const { handlers, context } = loadServiceWorker();
  const requested = [];
  const isTile = (url) => /stadiamaps|cartocdn/.test(url);
  context.fetch = async (request) => {
    const url = typeof request === "string" ? request : request.url;
    requested.push(url);
    return isTile(url) ? tileResponse() : { ok: true, body: url, clone() { return this; } };
  };
  await install(handlers);
  await activate(handlers);
  assert.equal(requested.filter(isTile).length, 0, "nada de zonas precargadas");
  requested.length = 0;
  await requestTile(handlers);
  assert.deepEqual(requested, [TILE], "solo la tesela pedida, sin vecinas");
});

test("al activarse borra la caché vieja de 1.500 teselas sin vencimiento y purga las vencidas", async () => {
  const { handlers, cacheStores, tiles, clock } = loadServiceWorker();
  cacheStores.set("truckcar-tiles-v1", { entries: new Map([["https://tile.openstreetmap.org/1/1/1.png", "x"]]) });
  await tiles.put({ url: "https://tiles.stadiamaps.com/vencida", bytes: 10, expires: clock.now - 1, used: clock.now - 1 });
  await activate(handlers);
  assert.equal(cacheStores.has("truckcar-tiles-v1"), false);
  assert.deepEqual(await tiles.all(), []);
});

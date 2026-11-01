// Cola durable offline (js/offlineQueue.js) sobre una IndexedDB real en memoria (fake-indexeddb).
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { IDBFactory, IDBKeyRange } from "fake-indexeddb";

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const source = readFileSync("js/offlineQueue.js", "utf8");

let queue;
let posts;
let online;
let respond;

/** Carga el script como en el navegador, con un api-gateway simulado que registra cada lote enviado. */
function load() {
  posts = [];
  online = false;
  respond = (endpoint, body) => ({ accepted: body.events.map((e) => e.clientEventId), duplicates: [], rejected: [] });
  const window = {
    crypto: globalThis.crypto,
    addEventListener: () => {},
    dispatchEvent: () => true,
    TruckCarApi: {
      session: { isRenewable: () => true },
      http: {
        post: async (endpoint, body) => {
          posts.push({ endpoint, body });
          return respond(endpoint, body);
        },
      },
    },
  };
  const context = {
    window,
    navigator: { get onLine() { return online; } },
    indexedDB: new IDBFactory(),
    IDBKeyRange,
    CustomEvent: class CustomEvent {
      constructor(type, init) { this.type = type; this.detail = init && init.detail; }
    },
    setTimeout: () => 0,
    clearTimeout: () => {},
    setInterval: () => 0,
    console,
    Date,
    Math,
    Promise,
  };
  vm.createContext(context);
  vm.runInContext(source, context, { filename: "js/offlineQueue.js" });
  return window.OfflineQueue;
}

beforeEach(() => {
  queue = load();
});

test("cada evento lleva un UUID v4, la hora del dispositivo y una secuencia creciente por viaje", async () => {
  const started = await queue.enqueue("trip.started", { loadId: 7 }, { tripId: 7 });
  const position = await queue.enqueue("position", { latitude: 4.6, longitude: -74.1 }, { tripId: 7 });
  const otherTrip = await queue.enqueue("position", { latitude: 4.7, longitude: -74.2 }, { tripId: 8 });

  assert.match(started.clientEventId, UUID_V4);
  assert.notEqual(started.clientEventId, position.clientEventId);
  assert.ok(!Number.isNaN(Date.parse(started.occurredAt)));
  assert.deepEqual([started.seq, position.seq, otherTrip.seq], [1, 2, 1]);
  assert.equal(queue.status().pending, 3);
});

test("rechaza tipos de evento que ningún servicio sabe ingerir", async () => {
  await assert.rejects(() => queue.enqueue("trip.teleported", {}), /desconocido/);
});

test("al reconectar envía un lote por servicio, Load-Allocation primero, y vacía la cola", async () => {
  await queue.enqueue("position", { latitude: 4.6, longitude: -74.1 }, { tripId: 7 });
  await queue.enqueue("alert.reported", { alertType: "DERRUMBE" });
  await queue.enqueue("trip.started", { loadId: 7 }, { tripId: 7 });

  online = true;
  await queue.flush();

  assert.deepEqual(posts.map((p) => p.endpoint), ["/loads/sync/batch", "/fleets-drivers/sync/batch", "/alerts/sync/batch"]);
  for (const { body } of posts) {
    for (const event of body.events) {
      assert.deepEqual(Object.keys(event).sort(), ["clientEventId", "kind", "occurredAt", "payload", "seq"]);
    }
  }
  assert.equal(queue.status().pending, 0);
});

test("los duplicados y rechazados salen de la cola; lo que el servidor no confirmó se queda", async () => {
  const accepted = await queue.enqueue("position", { latitude: 1, longitude: 1 }, { tripId: 1 });
  const duplicate = await queue.enqueue("position", { latitude: 2, longitude: 2 }, { tripId: 1 });
  const rejected = await queue.enqueue("position", { latitude: 3, longitude: 3 }, { tripId: 1 });
  const unanswered = await queue.enqueue("position", { latitude: 4, longitude: 4 }, { tripId: 1 });
  respond = () => ({
    accepted: [accepted.clientEventId],
    duplicates: [duplicate.clientEventId],
    rejected: [{ clientEventId: rejected.clientEventId, reason: "Coordenadas inválidas" }],
  });

  online = true;
  await queue.flush();

  assert.equal(queue.status().pending, 1);
  // Array.from: el arreglo viene del contexto vm (otro realm) y deepEqual compara prototipos.
  assert.deepEqual(Array.from(queue.status().rejected, (r) => r.reason), ["Coordenadas inválidas"]);

  respond = (endpoint, body) => ({ accepted: [], duplicates: body.events.map((e) => e.clientEventId), rejected: [] });
  await queue.flush();
  assert.equal(posts.at(-1).body.events[0].clientEventId, unanswered.clientEventId);
  assert.equal(queue.status().pending, 0);
});

test("sin conexión o con el gateway caído los eventos se conservan para el siguiente intento", async () => {
  await queue.enqueue("position", { latitude: 1, longitude: 1 }, { tripId: 1 });

  await queue.flush();
  assert.equal(posts.length, 0, "sin red no se intenta enviar");

  online = true;
  respond = () => { throw Object.assign(new Error("Bad Gateway"), { status: 502 }); };
  await queue.flush();
  assert.equal(queue.status().pending, 1);
  assert.match(queue.status().lastError, /Bad Gateway/);
  assert.ok(queue.status().nextRetryAt, "debe programar el reintento con backoff");
});

test("un lote mal formado (400) sale de la cola como rechazado en vez de reintentarse siempre", async () => {
  await queue.enqueue("position", { latitude: 1, longitude: 1 }, { tripId: 1 });
  respond = () => { throw Object.assign(new Error("events: tamaño máximo 200"), { status: 400 }); };
  online = true;

  await queue.flush();

  assert.equal(queue.status().pending, 0);
  assert.equal(queue.status().rejected.length, 1);
});

test("backoff exponencial con jitter: entre la mitad y el total del retardo, con tope de 5 minutos", () => {
  for (let attempt = 1; attempt <= 12; attempt += 1) {
    const exponential = Math.min(5 * 60 * 1000, 2000 * 2 ** (attempt - 1));
    for (let i = 0; i < 50; i += 1) {
      const delay = queue.backoffDelay(attempt);
      assert.ok(delay >= exponential / 2 && delay <= exponential, `intento ${attempt}: ${delay} fuera de rango`);
    }
  }
});

test("solo la falta de red y los 502/503/504 cuentan como error de conectividad", () => {
  for (const status of [0, 502, 503, 504]) assert.ok(queue.isConnectivityError({ status }));
  for (const status of [400, 401, 403, 409, 500]) assert.ok(!queue.isConnectivityError({ status }));
});

test("un SOS guardado sin señal sale primero, en su propio lote, antes que el viaje y las posiciones", async () => {
  await queue.enqueue("position", { latitude: 4.6, longitude: -74.1 }, { tripId: 7 });
  await queue.enqueue("trip.started", { loadId: 7 }, { tripId: 7 });
  await queue.enqueue("alert.reported", { alertType: "DERRUMBE" });
  const sos = await queue.enqueue("alert.sos", { latitude: 4.61, longitude: -74.11, loadId: 7 }, { tripId: 7 });

  online = true;
  await queue.flush();

  assert.deepEqual(posts.map((p) => p.endpoint),
    ["/alerts/sync/batch", "/loads/sync/batch", "/fleets-drivers/sync/batch", "/alerts/sync/batch"]);
  assert.deepEqual(posts[0].body.events.map((e) => e.clientEventId), [sos.clientEventId]);
  assert.equal(posts[0].body.events[0].kind, "alert.sos");
  assert.equal(queue.status().pending, 0);
});

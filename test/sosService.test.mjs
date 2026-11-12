import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const source = readFileSync("js/dataService.js", "utf8");

function service({ offline = false, post = async (body) => ({ id: 41, status: "ACTIVE", ...body }), active = async () => [] } = {}) {
  const posts = [];
  const queued = [];
  let next = 0;
  const window = {
    crypto: globalThis.crypto,
    TruckCarData: { activeLoadOrder: { id: "CARGA-30", backendId: 30 }, currentDriver: { name: "Ana Ruiz", vehicle: { plate: "TDK-410" } } },
    TruckCarApi: { alerts: { sos: async (body) => { posts.push(body); return post(body); }, activeSos: active } },
    OfflineQueue: {
      isOffline: () => offline,
      uuid: () => "00000000-0000-4000-8000-00000000000" + (next++),
      enqueue: async (kind, payload, options) => { queued.push({ kind, payload, options }); return {}; }
    }
  };
  const context = { window, console, Date, Math, Promise, Number, String, Error };
  vm.createContext(context);
  vm.runInContext(source, context, { filename: "js/dataService.js" });
  return { svc: window.TruckCarService, data: window.TruckCarData, posts, queued };
}

const httpError = (status) => Object.assign(new Error("Error HTTP " + status), { status });

test("el SOS usa un solo clientEventId entre el envío en línea y la cola", async () => {
  for (const status of [0, 401, 408, 429, 500, 503]) {
    const { svc, posts, queued } = service({ post: async () => { throw httpError(status); } });
    const sos = await svc.triggerSos([4.6, -74.1], 8.4);
    assert.equal(sos.pendingSync, true, "status " + status + " se encola");
    assert.equal(posts.length, 1);
    assert.equal(queued.length, 1);
    assert.equal(queued[0].kind, "alert.sos");
    assert.equal(queued[0].options.clientEventId, posts[0].clientEventId);
    assert.equal(queued[0].payload.latitude, 4.6);
    assert.equal(queued[0].payload.accuracyMeters, 8);
  }
});

test("un 4xx que no es reintentable no se encola y se informa como no enviado", async () => {
  for (const status of [400, 403, 404, 422]) {
    const { svc, queued } = service({ post: async () => { throw httpError(status); } });
    await assert.rejects(svc.triggerSos([4.6, -74.1], 8), (error) => error.status === status);
    assert.equal(queued.length, 0, "status " + status + " no se encola");
  }
});

test("sin posición el SOS no se envía ni se encola", async () => {
  for (const coords of [null, [], [NaN, -74.1], [4.6, undefined]]) {
    const { svc, posts, queued } = service();
    await assert.rejects(svc.triggerSos(coords, 8), /NO se envió/);
    assert.equal(posts.length, 0);
    assert.equal(queued.length, 0);
  }
});

test("sin conexión el SOS va directo a la cola; un duplicado del servidor cuenta como enviado", async () => {
  const offline = service({ offline: true });
  const queuedSos = await offline.svc.triggerSos([4.6, -74.1], 8);
  assert.equal(offline.posts.length, 0);
  assert.equal(queuedSos.pendingSync, true);
  assert.match(offline.queued[0].options.clientEventId, /^0{8}-/);

  const duplicate = service({ post: async () => ({ id: 41, status: "ACTIVE", receivedAt: "2026-11-12T10:00:00Z" }) });
  const sent = await duplicate.svc.triggerSos([4.6, -74.1], 8);
  assert.equal(sent.id, 41);
  assert.ok(!sent.pendingSync);
  assert.equal(duplicate.queued.length, 0);
});

test("la torre solo ve los SOS sin atender: excluye atendidos y resueltos", async () => {
  const mixed = service({ active: async () => [
    { id: 1, status: "ACTIVE" }, { id: 2, status: "ACKNOWLEDGED" }, { id: 3, status: "RESOLVED" }, { id: 4, status: "ACTIVE" }
  ] });
  const list = await mixed.svc.loadActiveSos();
  assert.deepEqual(list.map((s) => s.id), [1, 4]);
  assert.deepEqual(mixed.data.activeSos.map((s) => s.id), [1, 4]);
});

test("un SOS sin estado o con un estado desconocido se sigue mostrando", async () => {
  const odd = service({ active: async () => [{ id: 5 }, { id: 6, status: null }, { id: 7, status: "ESCALATED" }] });
  assert.deepEqual((await odd.svc.loadActiveSos()).map((s) => s.id), [5, 6, 7]);
});

test("una respuesta vacía del servidor deja la lista de SOS vacía", async () => {
  const empty = service({ active: async () => null });
  assert.deepEqual(Array.from(await empty.svc.loadActiveSos()), []);
  assert.deepEqual(Array.from(empty.data.activeSos), []);
});

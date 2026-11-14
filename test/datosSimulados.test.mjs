import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function apiClient(respond) {
  const dom = new JSDOM("<!doctype html><html><body></body></html>", { runScripts: "outside-only", url: "http://localhost:5500/" });
  const w = dom.window;
  const requests = [];
  w.TruckCarConfig = { apiBaseUrl: "http://localhost:8000/api/v1", gatewayUrl: "http://localhost:8000", requestTimeoutMs: 5000, storageKeys: { session: "truckcar.session" } };
  w.fetch = async (url, options) => {
    const request = { method: options.method, path: new URL(url).pathname.replace("/api/v1", ""), body: options.body ? JSON.parse(options.body) : null };
    requests.push(request);
    const { status = 200, body = null } = respond(request) || {};
    return {
      ok: status >= 200 && status < 300,
      status,
      headers: { get: (name) => name === "Content-Type" ? "application/json" : null },
      text: async () => body === null ? "" : JSON.stringify(body)
    };
  };
  w.eval(readFileSync("js/api.js", "utf8"));
  return { api: w.TruckCarApi, requests };
}

const VEHICLE = { plate: "tdk-410", model: "Kenworth T800", type: "DOBLETROQUE", height: 3.9, tareWeight: 12.5, maxPayload: 22 };

test("registrar un vehículo conserva el estado del conductor que devuelve el backend y no fuerza ACTIVO", async () => {
  const stored = {
    driverId: "driver-ana", driverName: "Ana Ruiz", licenseCategory: "C3", rating: 4.7, totalTrips: 31,
    vehiclePlate: "OLD-111", vehicleType: "TURBO", maxHeightMeters: 3.1, tareWeightTons: 5, maxPayloadTons: 8,
    netCargoWeightTons: 0, grossWeightTons: 5, drivingHoursToday: 6.5, maxDailyDrivingHours: 9, remainingDrivingHours: 2.5,
    mandatoryRestLocation: "Parador El Espinal", restRequiredAlert: false, hazmatAuthorized: true, coldChainCertified: false,
    runtValid: true, electronicTollTagActive: true, activeBadges: ["Verificado"], currentLatitude: 4.61, currentLongitude: -74.08,
    currentSpeedKmH: 0, currentHeading: 90, status: "INACTIVO", lastUpdate: "2026-11-01T10:00:00", currentLoadId: null,
    onTrip: false, accountStatus: "ACTIVE", accountVerified: true
  };
  const { api, requests } = apiClient((request) => request.method === "GET" ? { body: stored } : { body: stored });
  await api.fleet.registerVehicle("driver-ana", VEHICLE);

  assert.deepEqual(requests.map((r) => r.method + " " + r.path), ["GET /fleets-drivers/drivers/driver-ana", "POST /fleets-drivers/state"]);
  const sent = requests[1].body;
  assert.equal(sent.status, "INACTIVO", "el estado es el del backend, no ACTIVO forzado");
  for (const field of ["driverName", "licenseCategory", "rating", "totalTrips", "drivingHoursToday", "mandatoryRestLocation",
    "hazmatAuthorized", "runtValid", "electronicTollTagActive", "currentLatitude", "currentLongitude"]) {
    assert.deepEqual(sent[field], stored[field], field + " se conserva");
  }
  assert.deepEqual(sent.activeBadges, ["Verificado"]);
  assert.equal(sent.vehiclePlate, "TDK-410");
  assert.equal(sent.vehicleType, "DOBLETROQUE");
  assert.equal(sent.maxHeightMeters, 3.9);
  assert.equal(sent.tareWeightTons, 12.5);
  assert.equal(sent.maxPayloadTons, 22);
  for (const derived of ["grossWeightTons", "remainingDrivingHours", "maxDailyDrivingHours", "restRequiredAlert", "currentHeading",
    "lastUpdate", "onTrip", "accountStatus", "accountVerified", "currentLoadId"]) {
    assert.ok(!(derived in sent), derived + " lo calcula el backend y no se envía");
  }
});

test("un conductor sin estado previo se registra solo con lo digitado: sin altura, tara, capacidad, tipo ni estado inventados", async () => {
  const { api, requests } = apiClient((request) => request.method === "GET" ? { status: 404, body: { message: "sin estado" } } : { body: {} });
  await api.fleet.registerVehicle("driver-nuevo", { plate: "SNT-238", model: "International", height: "", tareWeight: NaN, maxPayload: undefined });

  assert.deepEqual(requests[1].body, { driverId: "driver-nuevo", vehiclePlate: "SNT-238", vehicleModel: "International" });
  const source = readFileSync("js/api.js", "utf8");
  assert.doesNotMatch(source, /\|\| 4\.1|\|\| 34\.0|\|\| 16\.0|status: 'ACTIVO'|\|\| 'TRACTOMULA_3S3'/);
  const panel = readFileSync("js/views/coordinatorPanel.js", "utf8");
  assert.doesNotMatch(panel, /\|\| '4\.1'|\|\| '16\.0'|\|\| '34\.0'|badges: \['Verificado'\]/);
});

test("si no se puede leer el estado actual del conductor, el vehículo no se envía: nada se sobrescribe a ciegas", async () => {
  const { api, requests } = apiClient(() => ({ status: 503, body: { message: "flota no disponible" } }));
  await assert.rejects(api.fleet.registerVehicle("driver-ana", VEHICLE), (error) => error.status === 503);
  assert.deepEqual(requests.map((r) => r.method), ["GET"]);
});

test("publicar una carga no envía generatorCompanyId: la empresa la decide el backend con el usuario autenticado", () => {
  const publish = readFileSync("js/views/generatorPanel.js", "utf8").match(/publishLoad\(\{[\s\S]*?\}\);/)[0];
  assert.doesNotMatch(publish, /generatorCompanyId/);
  assert.match(publish, /generatorCompanyName/);
});

function deliveryForm() {
  const dom = new JSDOM("<!doctype html><html><body></body></html>", { runScripts: "outside-only", pretendToBeVisual: true, url: "http://localhost:5500/?demo=1" });
  const w = dom.window;
  w.ui = { escape: (v) => String(v ?? ""), toast() {}, errorMessage: (e) => (e && e.message) || String(e) };
  w.PodEvidence = { sha256Hex: async () => "0".repeat(64), dataUrlToBlob: async (dataUrl) => new w.Blob([dataUrl]) };
  w.HTMLCanvasElement.prototype.getContext = () => new Proxy({}, { get: (target, key) => key === "createLinearGradient" ? () => ({ addColorStop() {} }) : () => {}, set: () => true });
  w.HTMLCanvasElement.prototype.toDataURL = (type) => "data:" + (type || "image/png") + ";base64,AAAA";
  w.HTMLCanvasElement.prototype.setPointerCapture = () => {};
  w.eval(readFileSync("js/views/podModals.js", "utf8"));
  const submitted = [];
  const result = w.PodUI.openDeliveryForm({ id: "CARGA-88", cargoType: "Café", destination: { name: "Ibagué, Tolima" } },
    async (pod) => { submitted.push(pod); });
  const form = w.document.getElementById("pod-form");
  const sign = () => {
    const down = new w.Event("pointerdown", { bubbles: true, cancelable: true });
    Object.assign(down, { pointerId: 1, clientX: 10, clientY: 10 });
    w.document.getElementById("pod-signature").dispatchEvent(down);
  };
  const submit = async () => {
    form.dispatchEvent(new w.Event("submit", { bubbles: true, cancelable: true }));
    await sleep(20);
  };
  return { w, form, submitted, result, sign, submit };
}

test("la foto simulada se ve en el formulario pero no se sube como evidencia", async () => {
  const { w, form, submitted, result, sign, submit } = deliveryForm();
  form.elements.receiverName.value = "Jefe de bodega";
  sign();
  form.querySelector('[data-action="simulate-photo"]').click();

  assert.ok(!w.document.getElementById("pod-photo-figure").classList.contains("hidden"), "la vista previa se muestra");
  const note = form.querySelector("[data-photo-simulated]");
  assert.ok(!note.classList.contains("hidden"));
  assert.match(note.textContent, /no se envía como evidencia/);

  await submit();
  assert.equal(await result, true);
  assert.equal(submitted.length, 1);
  assert.equal(submitted[0].photoBlob, null, "la foto simulada no viaja al backend");
  assert.ok(submitted[0].signatureBlob, "la firma real sí se envía");
});

test("al quitar la foto simulada desaparece el aviso y la entrega sigue sin foto", async () => {
  const { form, submitted, sign, submit } = deliveryForm();
  form.elements.receiverName.value = "Jefe de bodega";
  sign();
  form.querySelector('[data-action="simulate-photo"]').click();
  form.querySelector('[data-action="remove-photo"]').click();
  assert.ok(form.querySelector("[data-photo-simulated]").classList.contains("hidden"));
  await submit();
  assert.equal(submitted[0].photoBlob, null);
});

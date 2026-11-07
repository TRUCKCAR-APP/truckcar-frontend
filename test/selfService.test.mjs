// Autoservicio en el despliegue: el conductor registra su vehículo y su disponibilidad, y la torre registra
// restricciones y administra cuentas, sin scripts ni llamadas directas a la API.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";

function windowWith(files, setup = () => {}) {
  const w = new JSDOM("<!doctype html><body></body>", { runScripts: "outside-only" }).window;
  w.ui = { escape: (v) => String(v ?? "").replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`), errorMessage: (e) => e.message };
  setup(w);
  for (const file of files) w.eval(readFileSync(file, "utf8"));
  return w;
}
// Los objetos creados dentro de jsdom tienen otro Object.prototype: se comparan por su contenido.
const same = (actual, expected, message) => assert.deepEqual(JSON.parse(JSON.stringify(actual)), expected, message);
const text = (html) => new JSDOM(html).window.document.body.textContent.replace(/\s+/g, " ");

const VALID_VEHICLE = {
  vehiclePlate: "tdk 410", vehicleType: "TRACTOMULA_3S3", vehicleModel: " Kenworth T800 ", licenseCategory: "C3",
  maxHeightMeters: "4,10", maxPayloadTons: "34", tareWeightTons: "15", runtValid: true, location: "gps"
};

test("el vehículo se valida antes de enviarlo: placa normalizada, cifras con coma y tipos que una carga puede pedir", () => {
  const { VehicleForm } = windowWith(["js/views/generatorPanel.js", "js/views/vehicleForm.js"]);
  const ok = VehicleForm.validate(VALID_VEHICLE);
  same(ok.errors, {});
  assert.equal(ok.location, "gps");
  assert.equal(ok.vehicle.vehiclePlate, "TDK-410");
  assert.equal(ok.vehicle.vehicleModel, "Kenworth T800");
  assert.equal(ok.vehicle.maxHeightMeters, 4.1);
  assert.equal(ok.vehicle.runtValid, true);
  assert.equal(ok.vehicle.coldChainCertified, false);

  const bad = VehicleForm.validate({ ...VALID_VEHICLE, vehiclePlate: "AB12", vehicleType: "TRACTOMULA_3S2", maxHeightMeters: "7", tareWeightTons: "" });
  assert.equal(bad.vehicle, null);
  same(Object.keys(bad.errors).sort(), ["maxHeightMeters", "tareWeightTons", "vehiclePlate", "vehicleType"]);
  assert.ok(!VehicleForm.TRUCK_TYPES.some(([code]) => code === "TRACTOMULA_3S2"), "un tipo que ninguna carga pide no se ofrece");

  // Sin GPS (un computador), la ciudad del catálogo da la posición: sin ella el motor casi nunca lo elegiría.
  const inCity = VehicleForm.validate({ ...VALID_VEHICLE, location: "bogota" });
  assert.equal(inCity.location, "bogota");
  same(VehicleForm.cityCoords("Bogotá"), [4.6097, -74.0817]);
  assert.ok(VehicleForm.validate({ ...VALID_VEHICLE, location: "Atlantis" }).errors.location);
});

test("sin vehículo, la pestaña Vehículo invita a registrarlo; con vehículo, muestra la disponibilidad y deja editarlo", () => {
  const driver = { name: "Andrés Rojas", status: "SIN_VEHICULO", hoursDrivenToday: 0, maxDailyHours: 9, rating: "—", tripsCompleted: 0, vehicle: null, state: null };
  const w = windowWith(["js/views/driverApp.js"], (win) => { win.TruckCarData = { currentDriver: driver }; });
  const empty = w.DriverApp.renderProfileScreen({ dataStatus: {} });
  assert.match(text(empty), /Sin vehículo registrado/);
  assert.match(text(empty), /Registrar mi vehículo/);
  assert.doesNotMatch(text(empty), /La torre de control debe registrar/);

  w.TruckCarData.currentDriver = {
    ...driver, status: "ACTIVO", state: { status: "ACTIVO" },
    vehicle: { plate: "TDK-410", brand: "Kenworth T800", category: "TRACTOMULA_3S3", height: 4.1, grossWeight: 15, tareWeight: 15, netCargoWeight: 0, badges: [] }
  };
  const active = new JSDOM(w.DriverApp.renderProfileScreen({ dataStatus: {} })).window.document;
  const toggle = active.querySelector('[role="switch"]');
  assert.equal(toggle.getAttribute("aria-checked"), "true");
  assert.equal(toggle.disabled, false);
  assert.match(active.body.textContent, /Disponible para cargas/);
  assert.match(active.body.textContent, /Editar vehículo/);

  w.TruckCarData.currentDriver.status = "INACTIVO";
  const off = new JSDOM(w.DriverApp.renderProfileScreen({ dataStatus: {} })).window.document;
  assert.equal(off.querySelector('[role="switch"]').getAttribute("aria-checked"), "false");
  assert.match(off.body.textContent, /No recibirá propuestas de carga/);

  w.TruckCarData.currentDriver.status = "ACTIVO";
  w.TruckCarData.activeLoadOrder = { id: "CARGA-9", status: "IN_TRANSIT" };
  const inTrip = new JSDOM(w.DriverApp.renderProfileScreen({ dataStatus: {} })).window.document;
  assert.equal(inTrip.querySelector('[role="switch"]').disabled, true, "con la carga a bordo no se puede apagar");
});

test("editar el vehículo reenvía el estado completo: no se pierden calificación, viajes, horas ni posición", async () => {
  const sent = [];
  const state = {
    driverId: "d-1", driverName: "Andrés Rojas", rating: 4.8, totalTrips: 126, drivingHoursToday: 3.5, vehiclePlate: "TDK-410",
    vehicleType: "TRACTOMULA_3S3", maxHeightMeters: 4.1, maxPayloadTons: 34, tareWeightTons: 15, netCargoWeightTons: 0,
    runtValid: true, currentLatitude: 4.6, currentLongitude: -74.08, status: "ACTIVO"
  };
  const w = windowWith(["js/dataService.js"], (win) => {
    win.store = { state: { currentUser: { id: "d-1", firstName: "Andrés", lastName: "Rojas" }, dataStatus: { errors: {} } }, setState() {} };
    win.TruckCarData = {};
    win.TruckCarApi = {
      session: { get: () => ({ userId: "d-1" }) },
      users: { me: async () => ({}) },
      fleet: { updateState: async (body) => { sent.push(body); }, getDriver: async () => ({ ...state, ...sent.at(-1) }) }
    };
  });
  await w.TruckCarService.loadDriverProfile();
  await w.TruckCarService.saveVehicle({ vehiclePlate: "TDK-410", vehicleType: "TRACTOMULA_3S3", maxHeightMeters: 4.2, maxPayloadTons: 34, tareWeightTons: 15 }, null);
  const edit = sent[0];
  assert.equal(edit.maxHeightMeters, 4.2);
  assert.equal(edit.rating, 4.8);
  assert.equal(edit.totalTrips, 126);
  assert.equal(edit.drivingHoursToday, 3.5);
  assert.equal(edit.currentLatitude, 4.6, "sin GPS se conserva la última posición");
  assert.equal(edit.status, "ACTIVO");

  await w.TruckCarService.setAvailability(false, null);
  assert.equal(sent[1].status, "INACTIVO");
  assert.equal(sent[1].vehiclePlate, "TDK-410");
});

test("el primer registro deja al conductor ACTIVO y con la posición del GPS para el motor de asignación", async () => {
  const sent = [];
  const w = windowWith(["js/dataService.js"], (win) => {
    win.store = { state: { currentUser: { id: "d-2", firstName: "Laura", lastName: "Méndez" }, dataStatus: { errors: {} } }, setState() {} };
    win.TruckCarData = {};
    win.TruckCarApi = {
      session: { get: () => ({ userId: "d-2" }) },
      fleet: {
        updateState: async (body) => { sent.push(body); },
        getDriver: async () => { if (!sent.length) throw Object.assign(new Error("404"), { isNotFound: true }); return sent.at(-1); }
      }
    };
  });
  await w.TruckCarService.loadDriverProfile();
  assert.equal(w.TruckCarData.currentDriver.state, null);
  await w.TruckCarService.saveVehicle({ vehiclePlate: "SNT-238", vehicleType: "TURBO", maxHeightMeters: 3.4, maxPayloadTons: 4.5, tareWeightTons: 3.5 }, [4.71, -74.07]);
  assert.equal(sent[0].driverId, "d-2");
  assert.equal(sent[0].driverName, "Laura Méndez");
  assert.equal(sent[0].status, "ACTIVO");
  same([sent[0].currentLatitude, sent[0].currentLongitude], [4.71, -74.07]);
  assert.equal(w.TruckCarData.currentDriver.vehicle.plate, "SNT-238");
});

test("una restricción necesita tipo, valor según el tipo, corredor y un punto en el mapa", () => {
  const w = windowWith(["js/views/towerAdmin.js"]);
  const base = { restrictionType: "GALIBO_ALTURA", title: "Puente de la 80", roadCorridor: "Bogotá - Tunja", severity: "PRECAUCION", latitude: "4.7", longitude: "-74.05" };
  const ok = w.TowerAdmin.validateRestriction({ ...base, limit: "3,80" });
  same(ok.errors, {});
  assert.equal(ok.restriction.maxClearanceMeters, 3.8);
  assert.equal(ok.restriction.latitude, 4.7);

  const noLimit = w.TowerAdmin.validateRestriction({ ...base, limit: "" });
  assert.ok(noLimit.errors.limit);
  const noPoint = w.TowerAdmin.validateRestriction({ ...base, limit: "3.8", latitude: "", longitude: "" });
  assert.ok(noPoint.errors.location);

  const closure = w.TowerAdmin.validateRestriction({ ...base, restrictionType: "CIERRE_PROGRAMADO", limit: "" });
  same(closure.errors, {}, "un cierre no lleva valor");
  assert.equal(closure.restriction.maxClearanceMeters, undefined);

  const weight = w.TowerAdmin.validateRestriction({ ...base, restrictionType: "PESO_BRUTO", limit: "32" });
  assert.equal(weight.restriction.maxGrossWeightTons, 32);
});

test("Usuarios es solo del ADMIN: un coordinador que pide esa pestaña vuelve a la torre", () => {
  const w = windowWith(["js/views/coordinatorPanel.js"]);
  const P = w.CoordinatorPanel;
  assert.equal(P.activeTab({ coordinatorTab: "users", sessionRole: "ADMIN" }), "users");
  assert.equal(P.activeTab({ coordinatorTab: "users", sessionRole: "COORDINADOR" }), "fleet");
  assert.equal(P.activeTab({ coordinatorTab: "restrictions", sessionRole: "COORDINADOR" }), "restrictions");
  assert.equal(P.activeTab({ coordinatorTab: "otra", sessionRole: "ADMIN" }), "fleet");

  const tabs = (role) => [...new JSDOM(P.renderTabs({ coordinatorTab: "fleet", sessionRole: role })).window.document.querySelectorAll('[role="tab"]')]
    .map((b) => b.getAttribute("aria-label"));
  same(tabs("COORDINADOR"), ["Torre de control", "Mis envíos", "Restricciones"]);
  same(tabs("ADMIN"), ["Torre de control", "Mis envíos", "Restricciones", "Usuarios"]);
});

test("el ADMIN filtra las cuentas y no puede cambiarse a sí mismo el rol ni suspenderse", () => {
  const users = [
    { id: "a", email: "admin@x", firstName: "Ada", lastName: "Admin", role: "ADMIN", status: "ACTIVE" },
    { id: "b", email: "c@x", firstName: "Carlos", lastName: "Uribe", role: "CONDUCTOR", status: "PENDING_VERIFICATION" },
    { id: "c", email: "g@x", firstName: "Gabriela", lastName: "Castro", role: "GENERADOR", status: "ACTIVE" },
    { id: "d", email: "t@x", firstName: "Tomás", lastName: "Torre", role: "COORDINADOR", status: "SUSPENDED" }
  ];
  const w = windowWith(["js/views/driverApp.js", "js/views/coordinatorPanel.js", "js/views/towerAdmin.js"], (win) => {
    win.TruckCarData = { users, fleetVehicles: [], communityAlerts: [] };
  });
  same(w.TowerAdmin.filterUsers(users, "PENDING_VERIFICATION").map((u) => u.id), ["b"]);
  same(w.TowerAdmin.filterUsers(users, "tower").map((u) => u.id), ["a", "d"]);

  w.ui.syncBanner = () => "";
  const doc = new JSDOM(w.TowerAdmin.render({
    coordinatorTab: "users", sessionRole: "ADMIN", currentUser: { id: "a", firstName: "Ada", lastName: "Admin" },
    dataStatus: { errors: {} }, adminStatus: { users: "ready" }
  }, "users")).window.document;
  const cards = [...doc.querySelectorAll("article")];
  assert.equal(cards.length, 4);
  const own = cards.find((c) => c.textContent.includes("su cuenta"));
  assert.equal(own.querySelector("select").disabled, true);
  assert.equal(own.querySelectorAll("button").length, 0);
  assert.match(cards.find((c) => c.textContent.includes("Carlos")).textContent, /Verificar/);
  assert.match(cards.find((c) => c.textContent.includes("Tomás")).textContent, /Reactivar/);
  assert.match(cards.find((c) => c.textContent.includes("Gabriela")).textContent, /Suspender/);
});

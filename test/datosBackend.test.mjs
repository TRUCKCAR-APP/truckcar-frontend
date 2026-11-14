import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";

const DRIVER_STATE = {
  driverId: "driver-ana", driverName: "Ana Ruiz", licenseCategory: "C3", rating: 4.7, totalTrips: 31,
  vehiclePlate: "TDK-410", vehicleModel: "Kenworth T800", vehicleType: "TRACTOMULA_3S3", maxHeightMeters: 4.1,
  netCargoWeightTons: 24, maxPayloadTons: 34, tareWeightTons: 16, grossWeightTons: 40, drivingHoursToday: 7.5,
  maxDailyDrivingHours: 10, remainingDrivingHours: 2.5, mandatoryRestLocation: "Parador El Espinal",
  restRequiredAlert: true, hazmatAuthorized: false, coldChainCertified: false, runtValid: true,
  electronicTollTagActive: true, activeBadges: [], currentLatitude: 4.61, currentLongitude: -74.08,
  currentSpeedKmH: 0, currentHeading: 90, status: "ACTIVO", lastUpdate: "2026-11-12T10:00:00", currentLoadId: 30,
  currentLoadStatus: "IN_TRANSIT", onTrip: true, accountStatus: "VERIFIED", accountVerified: true
};

const ROUTE_PLAN = {
  planId: 9, vehiclePlate: "TDK-410", originCity: "Bogotá", destinationCity: "Ibagué",
  recommendedCorridor: "Bogotá - Ibagué (Troncal Principal)", totalDistanceKm: 204.4, estimatedDurationHours: 4.5,
  riskLevel: "MEDIO", activeAlertsCount: 2,
  segments: [
    { segmentName: "Bogotá - Girardot", distanceKm: 134, condition: "NORMAL", checkpointName: "Peaje Chinauta" },
    { segmentName: "Girardot - Ibagué", distanceKm: 70.4, condition: "NORMAL", checkpointName: "Peaje Gualanday" }
  ],
  warnings: ["Derrumbe reportado en el km 42"],
  alternatives: [{ corridorName: "Vía La Mesa", distanceKm: 230, estimatedHours: 5.5, isPassable: false, riskLevel: "INTRANSITABLE", issues: ["Gálibo de 3,8 m"] }],
  aiRecommendation: "Tome la troncal principal y descanse en Girardot.", generatedAt: "2026-11-12T09:58:00"
};

const MATCH_RESULT = {
  decisionId: 71, loadId: 30, status: "SUCCESSFUL", selectedDriverId: "driver-ana", selectedDriverName: "Ana Ruiz",
  selectedVehiclePlate: "TDK-410", matchingScore: 87.4, deadheadDistanceKm: 12.3, reasonDetails: "Asignación propuesta",
  explanation: "Asignado por algoritmo determinista (Cercanía + Capacidad + Calificación): TDK-410 (Ana Ruiz), puntaje 87,40.",
  evaluatedCandidates: [
    { vehiclePlate: "TDK-410", driverId: "driver-ana", driverName: "Ana Ruiz", truckType: "TRACTOMULA_3S3",
      deadheadDistanceKm: 12.3, capacityUtilizationPercent: 71, score: 87.4, eligible: true, reason: null },
    { vehiclePlate: "SNT-221", driverId: "driver-luis", driverName: "Luis Paz", truckType: "TURBO",
      deadheadDistanceKm: 3.1, capacityUtilizationPercent: null, score: null, eligible: false, reason: "Incompatible por tipo de camión" }
  ],
  executedAt: "2026-11-12T09:50:00"
};

function service({ role = "driver", api = {} } = {}) {
  const w = new JSDOM("<!doctype html><body></body>", { runScripts: "outside-only" }).window;
  const state = { activeRole: role, currentUser: { id: "driver-ana", firstName: "Ana", lastName: "Ruiz", documentNumber: "1032456789" },
    dataStatus: { loading: false, errors: {}, lastSync: null }, selectedLoadId: null };
  w.store = { get state() { return state; }, setState: (patch) => Object.assign(state, patch) };
  w.eval(readFileSync("js/ui.js", "utf8"));
  w.TruckCarData = {};
  w.DriverTelemetry = { isRunning: false, start() {}, stop() {} };
  w.RouteGuidance = { prepare() {}, reset() {} };
  w.TruckCarApi = { session: { get: () => ({ userId: "driver-ana" }) }, ...api };
  w.eval(readFileSync("js/dataService.js", "utf8"));
  return { w, data: w.TruckCarData, service: w.TruckCarService, state };
}

function text(html) {
  return new JSDOM(html).window.document.body.textContent.replace(/\s+/g, " ");
}

function driverScreens(w) {
  w.eval(readFileSync("js/views/driverApp.js", "utf8"));
  return w.DriverApp;
}

test("el perfil del conductor usa la categoría de licencia, la jornada y el descanso que da fleets-drivers", async () => {
  const { w, data, service: s } = service({ api: { fleet: { getDriver: async () => DRIVER_STATE } } });
  await s.loadDriverProfile();
  const d = data.currentDriver;
  assert.equal(d.licenseCategory, "C3");
  assert.equal(d.maxDailyHours, 10);
  assert.equal(d.remainingDrivingHours, 2.5);
  assert.equal(d.restRequired, true);
  assert.equal(d.mandatoryRestLocation, "Parador El Espinal");
  assert.equal(d.onTrip, true);
  assert.equal(d.accountVerified, true);
  assert.equal(d.vehicle.grossWeight, 40, "el peso bruto es grossWeightTons, no una suma del front");

  const screen = text(driverScreens(w).renderProfileScreen({ dataStatus: {} }));
  assert.match(screen, /Categoría de licencia\s*C3/);
  assert.doesNotMatch(screen, /1032456789/, "el número de documento no se muestra como licencia");
  assert.match(screen, /7,5 h de 10 h/);
  assert.match(screen, /Horas de conducción restantes\s*2,5 h/);
  assert.match(screen, /Descanso requerido\s*· Parador El Espinal/);
  assert.match(screen, /Cuenta\s*Verificada/);
  assert.match(screen, /En viaje\s*Sí/);
});

test("si fleets-drivers no devuelve un dato el perfil dice «No disponible» y no inventa 9 h ni el documento", async () => {
  const partial = { driverId: "driver-ana", vehiclePlate: "TDK-410", maxHeightMeters: 4.1, tareWeightTons: 16, status: "ACTIVO" };
  const { w, data, service: s } = service({ api: { fleet: { getDriver: async () => partial } } });
  await s.loadDriverProfile();
  assert.equal(data.currentDriver.maxDailyHours, null);
  assert.equal(data.currentDriver.licenseCategory, null);
  assert.equal(data.currentDriver.vehicle.grossWeight, null);

  const screen = text(driverScreens(w).renderProfileScreen({ dataStatus: {} }));
  assert.match(screen, /Categoría de licencia\s*No disponible/);
  assert.match(screen, /Horas de conducción hoy\s*No disponible/);
  assert.match(screen, /Peso bruto actual \(tara \+ carga\)\s*No disponible/);
  assert.match(screen, /Cuenta\s*No disponible/);
  assert.doesNotMatch(screen, /9 h|1032456789/);
});

test("la ruta muestra distancia, duración, riesgo, alertas y peajes del plan de Route-AI", async () => {
  const requests = [];
  const { w, data, service: s } = service({ api: {
    fleet: { getDriver: async () => DRIVER_STATE },
    routes: { plan: async (request) => { requests.push(request); return ROUTE_PLAN; } }
  } });
  await s.loadDriverProfile();
  data.activeLoadOrder = { backendId: 30, status: "ASSIGNED", netWeight: 24,
    origin: { city: "Bogotá", name: "Bogotá", coords: [4.6, -74.08] }, destination: { city: "Ibagué", name: "Ibagué", coords: [4.43, -75.23] } };
  await s.loadRoutePlan();

  const opt = data.routes.optimal;
  assert.equal(opt.totalDistanceKm, 204.4);
  assert.equal(opt.estimatedDurationHours, 4.5);
  assert.equal(opt.riskLevel, "MEDIO");
  assert.equal(opt.activeAlertsCount, 2);
  assert.deepEqual([...opt.checkpoints], ["Peaje Chinauta", "Peaje Gualanday"]);

  const app = driverScreens(w);
  const screen = text(app.renderRouteOverviewScreen({ dataStatus: { errors: {} } }));
  assert.match(screen, /204km\s*4h 30min/);
  assert.match(screen, /Riesgo\s*Medio/);
  assert.match(screen, /Alertas activas en la ruta\s*2/);
  assert.match(screen, /Restricciones\s*Derrumbe reportado en el km 42/);
  assert.match(screen, /Peajes y puestos de control\s*Peaje Chinauta · Peaje Gualanday/);
  assert.match(screen, /Recomendación\s*Tome la troncal principal/);
  assert.doesNotMatch(screen, /estimado para auto|sin fuente de datos/);
  assert.equal(app.roadDistanceKm(), 204, "los km de la carga salen de totalDistanceKm");
});

test("un plan sin riesgo, alertas, distancia ni peajes muestra «No disponible» en cada dato", () => {
  const { w, data } = service();
  data.activeLoadOrder = { backendId: 30, status: "ASSIGNED", origin: { city: "Bogotá" }, destination: { city: "Ibagué" } };
  data.currentDriver = { vehicle: { plate: "TDK-410" } };
  data.routes = { optimal: { title: "Bogotá → Ibagué", riskLevel: null, activeAlertsCount: null, totalDistanceKm: null,
    estimatedDurationHours: null, checkpoints: [], warnings: null, aiRecommendation: null, waypoints: [] } };
  const screen = text(driverScreens(w).renderRouteOverviewScreen({ dataStatus: { errors: {} } }));
  for (const label of ["Riesgo", "Alertas activas en la ruta", "Restricciones", "Peajes y puestos de control", "Recomendación"]) {
    assert.match(screen, new RegExp(label + "\\s*No disponible"), label);
  }
  assert.equal((screen.match(/No disponible/g) || []).length, 7, "distancia y duración también");
});

test("la flota muestra la jornada, el descanso y la última actualización que da fleets-drivers", async () => {
  const { data, service: s } = service({ role: "coordinator", api: { fleet: { listActive: async () => [DRIVER_STATE, { driverId: "driver-luis", vehiclePlate: "SNT-221", status: "ACTIVO" }] } } });
  await s.loadFleet();
  const [ana, luis] = data.fleetVehicles;
  assert.equal(ana.remainingDrivingHours, 2.5);
  assert.equal(ana.mandatoryRestLocation, "Parador El Espinal");
  assert.equal(ana.restRequired, true);
  assert.equal(ana.onTrip, true);
  assert.equal(ana.accountVerified, true);
  assert.equal(ana.lastSeenAt, "2026-11-12T10:00:00");
  assert.equal(luis.lastCheckin, "No disponible");
  assert.equal(luis.hoursActive, "No disponible");
  assert.equal(luis.speed, null);
});

test("el matching guarda explanation y evaluatedCandidates tal como los devuelve fleet-allocation", async () => {
  const history = [{ ...MATCH_RESULT, evaluatedCandidates: undefined }];
  const { w, data, service: s } = service({ role: "coordinator", api: {
    allocation: { matchLoad: async () => MATCH_RESULT, history: async () => history },
    loads: { listAvailable: async () => [{ id: 30, originCity: "Bogotá", destinationCity: "Ibagué", status: "AVAILABLE",
      assignmentStatus: "PROPOSED", assignedDriverId: "driver-ana", assignmentStatusChangedAt: "2026-11-12T09:50:02" }] }
  } });
  await s.requestMatching(30);

  assert.equal(data.activeLoadOrder.assignmentStatusChangedAt, "2026-11-12T09:50:02");
  const [decision] = data.dispatchEvaluation.candidates;
  assert.equal(decision.explanation, MATCH_RESULT.explanation);
  assert.equal(decision.evaluatedCandidates, null, "el historial no trae candidatos");
  assert.equal(data.lastMatching.decision.evaluatedCandidates.length, 2);
  assert.equal(data.lastMatching.decision.evaluatedCandidates[1].reason, "Incompatible por tipo de camión");

  w.document.body.innerHTML = '<div id="ai-inspection-modal" class="hidden"><div id="ai-inspection-body"></div></div>';
  w.eval(readFileSync("js/views/coordinatorPanel.js", "utf8"));
  w.coordinatorCtrl.showAiInspectionModal(0);
  const modal = w.document.getElementById("ai-inspection-body").textContent.replace(/\s+/g, " ");
  assert.match(modal, /Explicación del motor: Asignado por algoritmo determinista/);
  assert.match(modal, /Luis Paz \(SNT-221\)\s*Descartado/);
  assert.match(modal, /Incompatible por tipo de camión/);
  assert.doesNotMatch(modal, /50%|30%|20%/, "los pesos del modelo no están escritos en el front");

  data.lastMatching = null;
  w.coordinatorCtrl.showAiInspectionModal(0);
  assert.match(w.document.getElementById("ai-inspection-body").textContent, /Candidatos evaluados: No disponible/);
});

test("un bloqueo de /topic/road-blockages recarga las alertas y pide un plan nuevo a Route-AI, una vez por evento", async () => {
  const calls = [];
  const { data, service: s } = service({ api: {
    alerts: { listActive: async () => { calls.push("alerts"); return []; } },
    routes: { plan: async () => { calls.push("plan"); return ROUTE_PLAN; } }
  } });
  data.currentDriver = { vehicle: { plate: "TDK-410", category: "TRACTOMULA_3S3", height: 4.1, tareWeight: 16, grossWeight: 40 } };
  data.activeLoadOrder = { backendId: 30, status: "IN_TRANSIT", netWeight: 24,
    origin: { city: "Bogotá", name: "Bogotá", coords: [4.6, -74.08] }, destination: { city: "Ibagué", name: "Ibagué", coords: [4.43, -75.23] } };
  const blockage = { eventId: "e-1", alertId: 55, latitude: 4.42, longitude: -74.3, alertType: "DERRUMBE", title: "Derrumbe en el km 42",
    description: "Vía cerrada", severity: "CRITICA", confidence: 0.9, source: "community-alerts", reason: "Alerta validada por la comunidad",
    affectedCorridor: "Bogotá - Girardot", occurredAt: "2026-11-12T15:00:00Z" };

  const first = await s.handleRoadBlockage(blockage);
  assert.equal(first.title, "Derrumbe en el km 42");
  assert.equal(first.corridor, "Bogotá - Girardot");
  assert.deepEqual(calls, ["alerts", "plan"]);
  assert.equal(await s.handleRoadBlockage(blockage), null, "el mismo eventId no se procesa dos veces");
  assert.deepEqual(calls, ["alerts", "plan"]);
  assert.equal(data.roadBlockages.length, 1);
});

const LOADS_MINE = [
  { id: 41, status: "AVAILABLE", assignmentStatus: "NOTIFIED", assignedDriverId: "driver-ana", originCity: "Cali", destinationCity: "Pasto",
    assignedAt: "2026-11-12T11:00:00", assignmentStatusChangedAt: "2026-11-12T11:00:05" },
  { id: 30, status: "IN_TRANSIT", assignmentStatus: "ACCEPTED", assignedDriverId: "driver-ana", originCity: "Bogotá", destinationCity: "Ibagué",
    assignedAt: "2026-11-12T08:00:00", tripStartedAt: "2026-11-12T08:30:00" }
];

const ROAD_ALERT = {
  id: 55, clientAlertId: null, driverId: "driver-luis", driverName: null, alertType: "DERRUMBE", severity: "MEDIA",
  title: "Derrumbe en el km 42", description: null, roadCorridor: "Bogotá - Girardot", maxClearanceMeters: null,
  latitude: 4.42, longitude: -74.3, confirmationsCount: 5, isActive: true, reportedAt: "2026-11-12T09:00:00",
  syncedAt: null, resolvedAt: null, resolvedBy: null, resolutionNotes: null
};

test("la carga vigente del conductor es la que fleets-drivers marca en currentLoadId, no un orden calculado en el front", async () => {
  const { data, service: s } = service({ api: {
    fleet: { getDriver: async () => DRIVER_STATE },
    loads: { mine: async () => LOADS_MINE }
  } });
  await s.loadDriverProfile();
  await s.loadDriverAssignment();
  assert.equal(data.activeLoadOrder.backendId, 30, "currentLoadId = 30");

  data.currentDriver.currentLoadId = null;
  await s.loadDriverAssignment();
  assert.equal(data.activeLoadOrder.backendId, 41, "sin currentLoadId se toma la primera en el orden de /loads/mine");
});

test("el estado de la flota sale de restRequiredAlert, currentLoadStatus y status; la velocidad no decide nada", () => {
  const { service: s } = service();
  assert.equal(s.fleetStatus({ status: "ACTIVO", restRequiredAlert: false, currentLoadStatus: null, currentSpeedKmH: 80 }), "ACTIVO");
  assert.equal(s.fleetStatus({ status: "ACTIVO", restRequiredAlert: false, currentLoadStatus: "IN_TRANSIT", currentSpeedKmH: 0 }), "EN_TRANSITO");
  assert.equal(s.fleetStatus({ status: "ACTIVO", restRequiredAlert: false, currentLoadStatus: "ASSIGNED" }), "CON_CARGA");
  assert.equal(s.fleetStatus({ status: "ACTIVO", restRequiredAlert: true, currentLoadStatus: "IN_TRANSIT" }), "DESCANSO");
  assert.equal(s.fleetStatus({ status: "INACTIVO" }), "INACTIVO");
  assert.equal(s.fleetStatus({}), null);
});

test("las alertas no inventan validación, descripción, autor ni confirmaciones", async () => {
  const { w, data, service: s } = service({ api: { alerts: { listActive: async () => [ROAD_ALERT, { ...ROAD_ALERT, id: 56, confirmationsCount: null }] } } });
  await s.loadAlerts();
  const [second, first] = data.communityAlerts;
  assert.equal(first.validated, null, "RoadAlertResponse no trae validated: 5 confirmaciones no la validan en el front");
  assert.equal(first.description, null);
  assert.equal(first.author, null);
  assert.equal(first.upvotes, 5);
  assert.equal(second.upvotes, null);
  assert.equal(s.towerHighlightsAlert(first), false);
  assert.equal(s.towerHighlightsAlert({ ...first, severity: "CRITICA" }), true);
  assert.equal(s.towerHighlightsAlert({ ...first, validated: true }), true);

  w.OfflineQueue = { status: () => ({ pending: 0 }) };
  const screen = text(driverScreens(w).renderAlertsScreen({ alertFilter: "all", dataStatus: { errors: {} } }));
  assert.match(screen, /5 confirmaciones\s*Validación: No disponible/);
  assert.match(screen, /Confirmaciones: No disponible/);
  assert.doesNotMatch(screen, /Validada|Red TruckCar|Corredor Bogotá/);
});

test("el reporte envía el tipo, la severidad y el título que exige Community-Alerts y no inventa la descripción", async () => {
  const sent = [];
  const { w, data, service: s } = service({ api: { alerts: {
    create: async (alert) => { sent.push(alert); return { ...ROAD_ALERT, ...alert, id: 60, confirmationsCount: 1 }; },
    listActive: async () => []
  } } });
  w.OfflineQueue = { isOffline: () => false, isConnectivityError: () => false };
  data.currentDriver = { name: "Ana Ruiz" };
  await s.reportAlert("landslide", "", [4.42, -74.3]);
  await s.reportAlert("police", "Retén antes del peaje", [4.5, -74.4]);
  assert.equal(sent[0].alertType, "DERRUMBE");
  assert.equal(sent[0].severity, "ALTA");
  assert.equal(sent[0].title, "Derrumbe");
  assert.equal(sent[0].description, null, "sin detalle del conductor no se envía un texto inventado");
  assert.equal(sent[1].alertType, "RETEN");
  assert.equal(sent[1].severity, "MEDIA");
  assert.equal(sent[1].description, "Retén antes del peaje");
});

test("las acciones de una carga se deciden en un solo lugar según status y assignmentStatus", () => {
  const { service: s } = service();
  const on = (load) => Object.entries(s.loadActions(load)).filter(([, allowed]) => allowed).map(([name]) => name).sort();
  assert.deepEqual(on({ status: "AVAILABLE", assignmentStatus: null }), ["cancel", "requestMatching", "shareTracking"]);
  assert.deepEqual(on({ status: "AVAILABLE", assignmentStatus: "PROPOSED" }), ["awaitNotification", "cancel", "shareTracking"]);
  assert.deepEqual(on({ status: "AVAILABLE", assignmentStatus: "NOTIFIED" }), ["cancel", "respond", "shareTracking"]);
  assert.deepEqual(on({ status: "AVAILABLE", assignmentStatus: "UNASSIGNED_NO_DRIVERS" }), ["cancel", "requestMatching", "shareTracking"]);
  assert.deepEqual(on({ status: "ASSIGNED", assignmentStatus: "ACCEPTED" }), ["cancel", "navigate", "shareTracking", "startTrip", "trackTruck"]);
  assert.deepEqual(on({ status: "IN_TRANSIT", assignmentStatus: "ACCEPTED" }), ["deliver", "navigate", "shareTracking", "trackTruck", "transmitPosition"]);
  assert.deepEqual(on({ status: "DELIVERED", assignmentStatus: "ACCEPTED" }), ["shareTracking", "viewProofOfDelivery"]);
  assert.deepEqual(on({ status: "CANCELLED", assignmentStatus: "ACCEPTED" }), []);
});

test("lo que cada rol puede abrir se decide en un solo lugar", () => {
  const { service: s } = service();
  assert.deepEqual({ ...s.roleAccess("CONDUCTOR") }, { home: "driver", controlTower: false, driver: true, shipmentsOnly: false, roadBlockages: true });
  assert.deepEqual({ ...s.roleAccess("GENERADOR") }, { home: "generator", controlTower: false, driver: false, shipmentsOnly: true, roadBlockages: false });
  for (const role of ["COORDINADOR", "ADMIN"]) {
    assert.deepEqual({ ...s.roleAccess(role) }, { home: "coordinator", controlTower: true, driver: false, shipmentsOnly: false, roadBlockages: true });
  }
});

test("la ruta por carretera se pide en un solo punto del front, con la URL de la configuración", async () => {
  const w = new JSDOM("<!doctype html><body></body>", { runScripts: "outside-only", url: "http://localhost:5500/" }).window;
  const urls = [];
  w.TruckCarConfig = { apiBaseUrl: "http://localhost:8000/api/v1", gatewayUrl: "http://localhost:8000", requestTimeoutMs: 5000,
    routingUrl: "https://rutas.example.test/route/v1/driving/", storageKeys: { session: "truckcar.session" } };
  w.fetch = async (url) => { urls.push(String(url)); return { ok: true, json: async () => ({ routes: [{ geometry: { coordinates: [[-74, 4.6], [-73.99, 4.61]] }, legs: [] }] }) }; };
  w.eval(readFileSync("js/api.js", "utf8"));
  const route = await w.TruckCarApi.routing.drivingRoute([[4.6, -74], [4.61, -73.99]], { steps: true });
  assert.equal(urls[0], "https://rutas.example.test/route/v1/driving/-74,4.6;-73.99,4.61?overview=full&geometries=geojson&steps=true");
  assert.equal(route.geometry.coordinates.length, 2);
  for (const file of ["js/navigation.js", "js/mapController.js", "js/telemetry.js"]) {
    assert.doesNotMatch(readFileSync(file, "utf8"), /router\.project-osrm|fetch\(/, file + " no llama al servicio de rutas por su cuenta");
  }
});

test("los tipos de camión son exactamente los del enum TruckTypeRequired de Load-Allocation, en un solo catálogo", () => {
  const { w, service: s } = service();
  const backendEnum = ["TURBO", "SENCILLO", "DOBLETROQUE", "CUATRO_MANOS", "MINIMULA", "TRACTOMULA_3S3", "REFRIGERADO"];
  assert.deepEqual(Array.from(s.truckTypes(), (t) => t.code).sort(), [...backendEnum].sort());
  assert.equal(s.truckTypeLabel("TRACTOMULA_3S2"), null, "el 3S2 no existe en el backend");
  assert.equal(driverScreens(w).truckTypeLabel("DOBLETROQUE"), "Doble troque");
  for (const file of ["js/views/driverApp.js", "js/views/generatorPanel.js", "js/views/coordinatorPanel.js"]) {
    assert.doesNotMatch(readFileSync(file, "utf8"), /TRACTOMULA_3S|MINIMULA|CUATRO_MANOS/, file + " no repite el catálogo");
  }
});

test("las ciudades con coordenadas viven en un solo punto del front y el formulario no trae un trayecto de ejemplo", () => {
  const { w, service: s } = service();
  assert.equal(s.cityCatalog().length, 20);
  assert.deepEqual({ ...s.cityCatalog().find((c) => c.city === "Ibagué") }, { city: "Ibagué", department: "Tolima", latitude: 4.4389, longitude: -75.2322 });
  const panel = readFileSync("js/views/generatorPanel.js", "utf8");
  assert.doesNotMatch(panel, /-7\d\.\d{3,}|Cundinamarca/, "el panel no guarda coordenadas ni departamentos");
  w.PodUI = { formatDate: () => "" };
  w.eval(panel);
  const draft = w.generatorCtrl.draft();
  assert.equal(draft.originCity, "");
  assert.equal(draft.destinationCity, "");
});

test("el chat local y el registro de push se quitaron: el backend no tiene esos endpoints", () => {
  for (const file of ["js/messagingService.js", "js/notifications.js"]) {
    assert.throws(() => readFileSync(file), /ENOENT/, file);
  }
  const sources = ["index.html", "sw.js", "js/app.js", "js/state.js", "js/api.js", "js/views/driverApp.js", "js/views/coordinatorPanel.js"]
    .map((file) => readFileSync(file, "utf8")).join("\n");
  assert.doesNotMatch(sources, /TruckCarMessaging|TruckCarNotifications|chatMessages|savePushToken|messagingService|notifications\.js/);
  assert.doesNotMatch(readFileSync("sw.js", "utf8"), /addEventListener\('push'/);
});

function apiClient(respond, { stored = null } = {}) {
  const w = new JSDOM("<!doctype html><html><body></body></html>", { runScripts: "outside-only", url: "http://localhost:5500/" }).window;
  const requests = [];
  w.TruckCarConfig = { apiBaseUrl: "http://localhost:8000/api/v1", gatewayUrl: "http://localhost:8000", requestTimeoutMs: 5000, storageKeys: { session: "truckcar.session" } };
  if (stored) w.localStorage.setItem("truckcar.session", JSON.stringify(stored));
  w.fetch = async (url, options) => {
    const request = { method: options.method, path: new URL(url).pathname.replace("/api/v1", ""), body: options.body ? JSON.parse(options.body) : null };
    requests.push(request);
    const { status = 200, body = null } = (await respond(request, w)) || {};
    return { ok: status >= 200 && status < 300, status, headers: { get: (name) => name === "Content-Type" ? "application/json" : null },
      text: async () => body === null ? "" : JSON.stringify(body) };
  };
  w.eval(readFileSync("js/api.js", "utf8"));
  return { w, api: w.TruckCarApi, requests };
}

test("un 400 de validación sin message muestra los mensajes de details, no solo «Validación fallida»", async () => {
  const body = { timestamp: "2026-11-12T10:00:00", status: 400, error: "Validación fallida",
    details: { title: "El título de la alerta es obligatorio", severity: "La severidad es obligatoria" } };
  const { api } = apiClient(() => ({ status: 400, body }));
  const error = await api.alerts.create({}).catch((e) => e);
  assert.equal(error.status, 400);
  assert.match(error.message, /El título de la alerta es obligatorio/);
  assert.match(error.message, /La severidad es obligatoria/);
  assert.doesNotMatch(error.message, /Validación fallida/);

  const withMessage = apiClient(() => ({ status: 400, body: { status: 400, error: "Validación de datos fallida",
    message: "El volumen debe ser mayor a 0 m³", details: { volumeM3: "El volumen debe ser mayor a 0 m³" } } }));
  const loadError = await withMessage.api.loads.publish({}).catch((e) => e);
  assert.equal(loadError.message, "El volumen debe ser mayor a 0 m³");
});

test("expiresIn llega en segundos: una sesión de 900 s vence a los 15 minutos, no en menos de un segundo", async () => {
  const opaque = { accessToken: "token-sin-claims", refreshToken: "r1", tokenType: "Bearer", expiresIn: 900 };
  const { api } = apiClient(() => ({ body: opaque }));
  const before = Date.now();
  const session = await api.auth.login("ana@truckcar.co", "secreto123");
  assert.ok(session.expiresAt >= before + 900 * 1000 - 50 && session.expiresAt <= Date.now() + 900 * 1000 + 50);
  assert.equal(api.session.isActive(), true);
});

test("si otra pestaña ya renovó la sesión, esta usa el token nuevo y no gasta el refresh token viejo", async () => {
  const old = { accessToken: "a1", refreshToken: "r1", expiresAt: Date.now() - 1000, role: "CONDUCTOR", userId: "driver-ana" };
  const renewed = { accessToken: "a2", refreshToken: "r2", expiresAt: Date.now() + 900000, role: "CONDUCTOR", userId: "driver-ana" };
  const { w, api, requests } = apiClient(() => ({ body: [] }), { stored: old });
  let release;
  Object.defineProperty(w.navigator, "locks", { configurable: true, value: {
    request: (name, task) => new Promise((resolve) => { release = () => resolve(task()); })
  } });
  const pending = api.ensureFreshSession();
  w.localStorage.setItem("truckcar.session", JSON.stringify(renewed));
  release();
  const session = await pending;
  assert.equal(session.accessToken, "a2");
  assert.deepEqual(requests, [], "no se llama a /auth/refresh");
});

test("el volumen es opcional, pero si se escribe debe ser mayor que 0 antes de enviar la carga", () => {
  const { w } = service();
  w.PodUI = { formatDate: () => "" };
  w.eval(readFileSync("js/views/generatorPanel.js", "utf8"));
  const ok = { cargoDescription: "Café", weightTons: "28", volumeM3: "", originCity: "Bogotá", destinationCity: "Cali", offeredBudget: "3000000" };
  assert.equal(w.GeneratorPanel.validate(ok).volumeM3, undefined);
  assert.equal(w.GeneratorPanel.validate({ ...ok, volumeM3: "12.5" }).volumeM3, undefined);
  assert.match(w.GeneratorPanel.validate({ ...ok, volumeM3: "0" }).volumeM3, /mayor a 0/);
  assert.match(w.GeneratorPanel.validate({ ...ok, volumeM3: "-3" }).volumeM3, /mayor a 0/);
});

test("la sesión se comparte entre pestañas: cerrar o iniciar sesión en una se refleja en la otra", () => {
  const w = new JSDOM("<!doctype html><body></body>", { runScripts: "outside-only", url: "http://localhost:5500/" }).window;
  const calls = [];
  let stored = null;
  const state = { isAuthenticated: true, sessionRole: "CONDUCTOR", currentUser: { id: "driver-ana" } };
  w.store = { get state() { return state; }, setState: (patch) => Object.assign(state, patch) };
  w.TruckCarConfig = { storageKeys: { session: "truckcar.session" } };
  w.TruckCarApi = { session: { get: () => stored, isActive: () => Boolean(stored), clear: () => calls.push("clear") } };
  w.eval(readFileSync("js/app.js", "utf8"));
  w.app.endSession = (options = {}) => { calls.push("end" + (options.keepStoredSession ? ":keep" : "")); state.isAuthenticated = false; };
  w.app.startSession = (session) => { calls.push("start:" + session.role); state.isAuthenticated = true; state.sessionRole = session.role; };
  w.app.scheduleSessionRefresh = () => calls.push("reschedule");

  w.app.onSessionStorageChange({ key: "otra.clave" });
  assert.deepEqual(calls, []);
  w.app.onSessionStorageChange({ key: "truckcar.session" });
  assert.deepEqual(calls, ["end"], "otra pestaña cerró la sesión");

  stored = { accessToken: "a2", role: "COORDINADOR", userId: "coord-1" };
  w.app.onSessionStorageChange({ key: "truckcar.session" });
  assert.deepEqual(calls, ["end", "start:COORDINADOR"], "otra pestaña inició sesión");

  state.currentUser = { id: "coord-1" };
  stored = { accessToken: "a3", role: "COORDINADOR", userId: "coord-1" };
  w.app.onSessionStorageChange({ key: "truckcar.session" });
  assert.deepEqual(calls, ["end", "start:COORDINADOR", "reschedule"], "otra pestaña renovó el token de la misma cuenta");

  stored = { accessToken: "b1", role: "GENERADOR", userId: "gen-1" };
  w.app.onSessionStorageChange({ key: null });
  assert.deepEqual(calls.slice(3), ["end:keep", "start:GENERADOR"], "otra cuenta: se cambia sin borrar la sesión nueva");
});

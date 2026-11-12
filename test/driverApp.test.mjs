import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";

function loadDriverApp(w) {
  const stubs = w.ui || {};
  w.eval(readFileSync("js/ui.js", "utf8"));
  Object.assign(w.ui, stubs);
  w.eval(readFileSync("js/views/driverApp.js", "utf8"));
}

function driverApp() {
  const w = new JSDOM("<!doctype html><body></body>", { runScripts: "outside-only" }).window;
  loadDriverApp(w);
  return Object.assign(w.DriverApp, { core: w.ui });
}

test("los estados del backend se muestran en español, nunca como código", () => {
  const app = driverApp();
  assert.equal(app.statusLabel("IN_TRANSIT"), "En tránsito");
  assert.equal(app.statusLabel("ASSIGNED"), "Aceptada");
  assert.equal(app.statusLabel("PROPOSED"), "Propuesta");
  assert.equal(app.statusLabel("SIN_VEHICULO"), "Sin vehículo");
  assert.equal(app.statusLabel(null), "Sin estado");
  assert.equal(app.statusLabel("EN_REVISION"), "En revision", "un estado nuevo se lee como texto, no como código");
});

test("el perfil rotula el peso bruto como el actual (tara + carga a bordo), no como una capacidad máxima", () => {
  const w = new JSDOM("<!doctype html><body></body>", { runScripts: "outside-only" }).window;
  w.ui = { escape: (v) => String(v ?? "") };
  w.TruckCarData = { currentDriver: {
    name: "Carlos Conductor", status: "DISPONIBLE", hoursDrivenToday: 0, maxDailyHours: 9, rating: 4.8, tripsCompleted: 126,
    hasVehicle: true, badges: [],
    vehicle: { plate: "TDK-410", brand: "Kenworth T800", category: "TURBO", height: 3.9, grossWeight: 8.5, tareWeight: 8.5, netCargoWeight: 0, badges: [] }
  } };
  loadDriverApp(w);
  const text = new JSDOM(w.DriverApp.renderProfileScreen({ dataStatus: {} })).window.document.body.textContent.replace(/\s+/g, " ");

  assert.match(text, /Peso bruto actual \(tara \+ carga\)\s*8,5 t/);
  assert.match(text, /Tara\s*8,5 t/);
  assert.match(text, /Carga a bordo\s*0,0 t/);
  assert.doesNotMatch(text, /Peso Bruto Máx|Carga Útil/);
});

test("sin fuente de datos, restricciones, alertas y riesgo van en una sola fila; un dato real sale en su propia fila", () => {
  const w = new JSDOM("<!doctype html><body></body>", { runScripts: "outside-only" }).window;
  w.ui = { escape: (v) => String(v ?? "") };
  w.mapCtrl = { routeFiguresHtml: () => "" };
  w.TruckCarData = {
    activeLoadOrder: { status: "IN_TRANSIT", origin: { city: "Bogotá" }, destination: { city: "Ibagué" } },
    currentDriver: { vehicle: { plate: "TDK-410" } },
    routes: { optimal: { title: "Bogotá - Ibagué (Troncal Principal)", riskLevel: "BAJO", warnings: [], waypoints: [] } }
  };
  loadDriverApp(w);
  const text = new JSDOM(w.DriverApp.renderRouteOverviewScreen({ dataStatus: {} })).window.document.body.textContent.replace(/\s+/g, " ");
  assert.match(text, /Restricciones, alertas y riesgo · sin fuente de datos todavía/);
  assert.doesNotMatch(text, /Sin información/, "no se repite «Sin información» fila por fila");
  assert.doesNotMatch(text, /Bajo|BAJO/, "el riesgo por defecto de Route-AI no se muestra");

  w.TruckCarData.routes.optimal.warnings = ["Gálibo de 4,0 m en el km 32"];
  const withData = new JSDOM(w.DriverApp.renderRouteOverviewScreen({ dataStatus: {} })).window.document.body.textContent.replace(/\s+/g, " ");
  assert.match(withData, /Restricciones\s*Gálibo de 4,0 m en el km 32/);
  assert.match(withData, /Alertas y riesgo · sin fuente de datos todavía/);
});

test("las acciones guardadas sin señal se cuentan sobre la pestaña Offline, con texto para lectores de pantalla", () => {
  const w = new JSDOM("<!doctype html><body></body>", { runScripts: "outside-only" }).window;
  let pending = 2;
  w.OfflineQueue = { status: () => ({ pending }) };
  w.TruckCarData = {};
  loadDriverApp(w);
  const tab = new JSDOM(w.DriverApp.tabButton("profile", "offline", "Offline", "cloud-arrow-down")).window.document;
  assert.equal(tab.querySelector(".driver-tab-count").textContent, "2");
  assert.equal(tab.querySelector(".driver-tab-count").getAttribute("aria-hidden"), "true");
  assert.match(tab.querySelector(".sr-only").textContent, /2 acciones guardadas sin enviar/);
  pending = 0;
  const empty = new JSDOM(w.DriverApp.tabButton("profile", "offline", "Offline", "cloud-arrow-down")).window.document;
  assert.equal(empty.querySelector(".driver-tab-count"), null);
});

function screens({ alerts = [], dataStatus = {}, queue = { pending: 0, byKind: {}, rejected: [] }, search = "", offlineData = {} } = {}) {
  const w = new JSDOM("<!doctype html><body></body>", { runScripts: "outside-only", url: "http://localhost:5500/" + search }).window;
  w.ui = { escape: (v) => String(v ?? "") };
  w.OfflineQueue = { status: () => queue };
  w.TruckCarConfig = { demoTools: search.includes("demo=1") };
  w.TruckCarData = { communityAlerts: alerts, offlineSyncData: offlineData };
  loadDriverApp(w);
  const text = (html) => new JSDOM(html).window.document.body.textContent.replace(/\s+/g, " ");
  return { w, text, state: { alertFilter: "all", dataStatus: { errors: {}, ...dataStatus }, isOffline: false } };
}

test("Alertas distingue cargando, error y vacío; el vacío no afirma que la vía sea segura", () => {
  const loading = screens({ dataStatus: { loading: true } });
  assert.match(loading.text(loading.w.DriverApp.renderAlertsScreen(loading.state)), /Buscando reportes cerca de usted/);

  const failed = screens({ dataStatus: { errors: { alerts: "Error HTTP 503" } } });
  const errorText = failed.text(failed.w.DriverApp.renderAlertsScreen(failed.state));
  assert.match(errorText, /No se pudieron cargar las alertas/);
  assert.match(errorText, /Reintentar/);
  assert.doesNotMatch(errorText, /Sin reportes recientes/);

  const empty = screens();
  const emptyText = empty.text(empty.w.DriverApp.renderAlertsScreen(empty.state));
  assert.match(emptyText, /Sin reportes recientes/);
  assert.match(emptyText, /Reportar novedad/);
  assert.doesNotMatch(emptyText, /segura|sin riesgo/i);

  const list = screens({ alerts: [{ id: 7, type: "scale", badge: "Báscula", title: "Báscula abierta en Fusagasugá", timeAgo: "hace 5 min", upvotes: 3 }] });
  const listText = list.text(list.w.DriverApp.renderAlertsScreen(list.state));
  assert.match(listText, /Báscula abierta en Fusagasugá/);
  assert.match(listText, /Báscula · hace 5 min · 3 confirmaciones/);
});

test("Offline muestra lo pendiente por tipo, la fecha real del mapa guardado y la simulación solo con ?demo=1", () => {
  const until = new Date(2026, 10, 2, 3, 40).getTime();
  const s = screens({ queue: { pending: 3, byKind: { "alert.sos": 1, position: 2 }, rejected: [] }, offlineData: { cachedTiles: 4, cachedTilesExpiry: until } });
  const html = s.w.DriverApp.renderOfflineScreen(s.state);
  const text = s.text(html);
  assert.match(text, /SOS\s*1/);
  assert.match(text, /Posiciones del viaje\s*2/);
  assert.match(text, /Entregas\s*Ninguna/);
  assert.match(text, /Mapa de la zona del viaje\s*Guardado hasta .*3:40/);
  assert.doesNotMatch(text, /Simular pérdida de señal/);
  assert.match(text, /Enviar ahora/);

  const demo = screens({ search: "?demo=1" });
  assert.match(demo.text(demo.w.DriverApp.renderOfflineScreen(demo.state)), /Simular pérdida de señal/);
});

test("los estados de asignación y de flota de la Torre y «Mis envíos» también se dicen en español", () => {
  const app = driverApp();
  assert.equal(app.statusLabel("UNASSIGNED_NO_DRIVERS"), "Sin conductores disponibles");
  assert.equal(app.statusLabel("ACCEPTED"), "Aceptada");
  assert.equal(app.statusLabel("TIMEOUT"), "Sin respuesta a tiempo");
  assert.equal(app.statusLabel("INACTIVO"), "Inactivo");
});

test("la Torre y «Mis envíos» usan solo la paleta de tokens: sin matices sueltos, mayúsculas ni códigos como etiqueta", () => {
  for (const file of ["js/views/coordinatorPanel.js", "js/views/generatorPanel.js"]) {
    const src = readFileSync(file, "utf8");
    assert.doesNotMatch(src, /\b(bg|text|border|from|to|shadow)-(emerald|indigo|rose|blue|sky|amber|teal|orange|red|brand)-\d/, file + ": matiz fuera de los tokens");
    assert.doesNotMatch(src, /\buppercase\b/, file + ": etiqueta en mayúsculas");
  }
  const gen = readFileSync("js/views/generatorPanel.js", "utf8");
  assert.doesNotMatch(gen, /label: '(AVAILABLE|PROPOSED|NOTIFIED|ASSIGNED|IN_TRANSIT|DELIVERED|CANCELLED)'/, "estados con el código del backend");
  assert.doesNotMatch(readFileSync("js/views/coordinatorPanel.js", "utf8"), /CENTRAL DE MONITOREO|SIN ASIGNAR/);
});

test("los estados del motor de asignación (AllocationStatus) se dicen en español", () => {
  const app = driverApp();
  for (const code of ["SUCCESSFUL", "NO_DRIVERS_AVAILABLE", "REJECTED", "DEGRADED_USING_CACHE", "RECOMMENDATION_PENDING", "ASSIGNMENT_CONFLICT", "ASSIGNMENT_FAILED"]) {
    assert.ok(app.core.STATUS_LABELS[code], code + " sin etiqueta en español");
    assert.equal(app.statusLabel(code), app.core.STATUS_LABELS[code], code + ": el conductor usa la etiqueta del núcleo");
  }
  assert.equal(app.statusLabel("SUCCESSFUL"), "Conductor seleccionado");
});

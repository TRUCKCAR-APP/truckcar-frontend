import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";

const HEADER = `<div id="role-switcher" class="hidden"><button id="role-btn-driver"></button><button id="role-btn-coordinator"></button></div>
  <button id="rotate-device-btn"></button><button id="sim-toggle-btn"></button>`;

function app({ phone, sessionRole, activeRole, demo = false }) {
  const w = new JSDOM(`<!doctype html><body>${HEADER}</body>`, { runScripts: "outside-only" }).window;
  const listeners = [];
  w.matchMedia = (query) => ({
    get matches() { return query === "(min-width: 768px)" ? !w.__phone : false; },
    addEventListener: (_, fn) => listeners.push(fn)
  });
  w.__phone = phone;
  const state = { isAuthenticated: true, sessionRole, activeRole };
  w.store = { get state() { return state; }, setState: (patch) => Object.assign(state, patch) };
  w.TruckCarService = { loadAll: async () => {} };
  w.TruckCarConfig = { demoTools: demo };
  w.eval(readFileSync("js/ui.js", "utf8"));
  w.eval(readFileSync("js/app.js", "utf8"));
  return { w, state, resize(toPhone) { w.__phone = toPhone; listeners.forEach(fn => fn()); } };
}

const SURFACE_GLOBALS = ["DriverApp", "DriverActions", "DriverTelemetry", "RouteGuidance", "DeviceLocation", "CoordinatorPanel",
  "GeneratorPanel", "generatorCtrl", "SosMonitor", "LiveTracking"];

function core({ sessionRole = "CONDUCTOR", activeRole = "driver", isAuthenticated = true } = {}) {
  const { w, state } = app({ phone: false, sessionRole, activeRole });
  Object.assign(state, { isAuthenticated, driverScreen: "assigned_load", coordinatorTab: "fleet" });
  w.document.body.insertAdjacentHTML("beforeend", '<div id="phone-mockup-frame"><div id="app-mount"></div></div>');
  const calls = [];
  w.LoginView = { render: () => "<p>login</p>" };
  w.Native = { markScreen: (mount, key) => calls.push("screen:" + key), NetworkStatus: { render() {} }, animateCounters() {} };
  w.mapCtrl = { map: null };
  w.TruckCarTelemetry = { renderStatusBadges() {}, disconnect: () => calls.push("core:disconnect") };
  w.TruckCarService.reset = () => calls.push("core:reset");
  w.TruckCarApi = { session: { clear: () => calls.push("core:session.clear") } };
  w.store.setState = (patch) => Object.assign(state, patch);
  return { w, state, calls, mount: w.document.getElementById("app-mount") };
}

const switcherVisible = (w) => !w.document.getElementById("role-switcher").classList.contains("hidden");

test("en el teléfono ADMIN y COORDINADOR no ven el selector y no pueden abrir la app del conductor", async () => {
  for (const sessionRole of ["ADMIN", "COORDINADOR"]) {
    const { w, state } = app({ phone: true, sessionRole, activeRole: "coordinator" });
    w.app.updateHeader(state);
    assert.equal(switcherVisible(w), false, sessionRole);
    await w.app.setRole("driver");
    assert.equal(state.activeRole, "coordinator", sessionRole + " sigue en la torre");
  }
});

test("en escritorio la torre conserva el selector y la vista previa del conductor", async () => {
  const { w, state } = app({ phone: false, sessionRole: "ADMIN", activeRole: "coordinator", demo: true });
  w.app.updateHeader(state);
  assert.equal(switcherVisible(w), true);
  await w.app.setRole("driver");
  assert.equal(state.activeRole, "driver");
});

test("el conductor no tiene selector y sigue en su app en el teléfono", async () => {
  const { w, state } = app({ phone: true, sessionRole: "CONDUCTOR", activeRole: "driver" });
  w.app.updateHeader(state);
  assert.equal(switcherVisible(w), false);
  assert.equal(w.app.canUseDriverView("CONDUCTOR"), true);
});

test("si la ventana pasa a tamaño teléfono con la vista previa abierta, vuelve a la torre", async () => {
  const { w, state, resize } = app({ phone: false, sessionRole: "COORDINADOR", activeRole: "driver", demo: true });
  w.app.watchPhoneLayout();
  resize(true);
  await Promise.resolve();
  assert.equal(state.activeRole, "coordinator");
  w.app.updateHeader(state);
  assert.equal(switcherVisible(w), false);
});

test("el encabezado de la torre se apila en 390 px: columna encogible y textos sin cortes internos", () => {
  const src = readFileSync("js/views/coordinatorPanel.js", "utf8");
  assert.match(src, /<div class="min-w-0 flex-1">\s*<h1/, "la columna del título puede encogerse");
  assert.match(src, /whitespace-nowrap"><span class="dot ok"><\/span> En línea/, "En línea no se parte ni se monta");
  assert.match(src, /<span class="whitespace-nowrap">Última sincronización:/, "la hora de sincronización no se parte");
  assert.match(src, /<p class="[^"]*flex-wrap[^"]*"><span data-network-status class="tower-net/, "el estado de red y la hora se apilan");
  const css = readFileSync("css/main.css", "utf8");
  assert.ok(css.includes('.tower-net:has(.net-status[data-state="online"]) { display: none; }'), "no repite En línea: el título ya lo dice");
});

const ROLES = ["ADMIN", "COORDINADOR", "CONDUCTOR", "GENERADOR"];
const homeView = (role) => (role === "CONDUCTOR" ? "driver" : role === "GENERADOR" ? "generator" : "coordinator");

test("sin ?demo=1 nadie ve el selector de rol, ni en escritorio ni en el teléfono", () => {
  for (const phone of [false, true]) {
    for (const sessionRole of ROLES) {
      const { w, state } = app({ phone, sessionRole, activeRole: homeView(sessionRole) });
      w.app.updateHeader(state);
      assert.equal(switcherVisible(w), false, sessionRole + (phone ? " en teléfono" : " en escritorio"));
    }
  }
});

test("con ?demo=1 la torre ve el selector en escritorio y el conductor y el generador no", () => {
  const expected = { ADMIN: true, COORDINADOR: true, CONDUCTOR: false, GENERADOR: false };
  for (const sessionRole of ROLES) {
    const { w, state } = app({ phone: false, sessionRole, activeRole: homeView(sessionRole), demo: true });
    w.app.updateHeader(state);
    assert.equal(switcherVisible(w), expected[sessionRole], sessionRole);
  }
});

test("el rol real de la sesión sigue mandando la pantalla, con o sin demo", async () => {
  for (const demo of [false, true]) {
    const { w } = app({ phone: false, sessionRole: "ADMIN", activeRole: "coordinator", demo });
    for (const role of ROLES) assert.equal(w.app.roleToView(role), homeView(role), role);
    const phone = app({ phone: true, sessionRole: "COORDINADOR", activeRole: "coordinator", demo });
    await phone.w.app.setRole("driver");
    assert.equal(phone.state.activeRole, "coordinator", "en el teléfono la torre no abre la app del conductor" + (demo ? " (demo)" : ""));
  }
});

test("la app pinta solo la vista registrada para el rol y corre los ganchos; el núcleo no nombra al conductor ni al panel", () => {
  const { w, state, calls, mount } = core();
  for (const name of SURFACE_GLOBALS) assert.equal(w[name], undefined, name + " no está cargado en esta prueba");

  w.app.renderCurrentView(state);
  assert.equal(mount.innerHTML, "", "sin vista registrada no se pinta nada y no falla");

  w.app.registerView("driver", {
    render: (s) => "<p>conductor " + s.driverScreen + "</p>",
    mountMap: () => calls.push("map:driver"),
    screen: (s) => s.driverScreen
  });
  w.app.registerView("coordinator", { render: () => "<p>torre</p>", screen: (s) => s.coordinatorTab, keepAliveMaps: ["coordinator-map-container"] });
  w.app.onMount(() => calls.push("mount-hook"));
  w.app.onRender((s) => calls.push("render-hook:" + (s.isAuthenticated ? s.activeRole : "login")));

  calls.length = 0;
  w.app.renderCurrentView(state);
  assert.equal(mount.textContent, "conductor assigned_load");
  assert.deepEqual(calls, ["map:driver", "mount-hook", "screen:driver:assigned_load", "render-hook:driver"]);

  calls.length = 0;
  Object.assign(state, { activeRole: "coordinator", sessionRole: "COORDINADOR" });
  w.app.renderCurrentView(state);
  assert.equal(mount.textContent, "torre");
  assert.deepEqual(calls, ["mount-hook", "screen:coordinator:fleet", "render-hook:coordinator"]);

  calls.length = 0;
  state.isAuthenticated = false;
  w.app.renderCurrentView(state);
  assert.equal(mount.textContent, "login");
  assert.deepEqual(calls, ["screen:login", "render-hook:login"], "sin sesión no se monta mapa ni corren los ganchos de montaje");
});

test("el mapa de la torre se conserva entre pintadas solo si su vista lo declara", () => {
  const { w, state, mount } = core({ sessionRole: "COORDINADOR", activeRole: "coordinator" });
  const live = w.document.createElement("div");
  live.id = "coordinator-map-container";
  live.dataset.live = "1";
  let invalidated = 0;
  w.mapCtrl = { map: { getContainer: () => live, invalidateSize: () => { invalidated++; } } };
  const render = () => '<div id="coordinator-map-container"></div>';

  w.app.registerView("coordinator", { render, screen: () => "fleet" });
  w.app.renderCurrentView(state);
  assert.equal(mount.querySelector("#coordinator-map-container").dataset.live, undefined, "sin declararlo, el mapa se vuelve a crear");

  w.app.registerView("coordinator", { render, screen: () => "fleet", keepAliveMaps: ["coordinator-map-container"] });
  w.app.renderCurrentView(state);
  assert.equal(mount.querySelector("#coordinator-map-container").dataset.live, "1", "el contenedor vivo reemplaza al recién pintado");
  assert.equal(invalidated, 1);
});

test("al terminar la sesión corren los ganchos de cada superficie antes de cerrar el núcleo", () => {
  const { w, state, calls } = core();
  w.app.onSessionEnd(() => calls.push("hook:conductor"));
  w.app.onSessionEnd(() => calls.push("hook:panel"));
  w.app.endSession();
  assert.deepEqual(calls, ["hook:conductor", "hook:panel", "core:disconnect", "core:reset", "core:session.clear"]);
  assert.equal(state.isAuthenticated, false);
  assert.equal(state.sessionRole, null);
});

test("renderCurrentView, endSession y loadAll no llaman a globales del conductor ni del panel", () => {
  const appSrc = readFileSync("js/app.js", "utf8");
  const method = (src, from, to) => {
    const start = src.indexOf(from);
    const end = src.indexOf(to, start);
    assert.ok(start >= 0 && end > start, "no se encontró " + from.trim());
    return src.slice(start, end);
  };
  const bodies = {
    renderCurrentView: method(appSrc, "    renderCurrentView(state) {", "    syncLiveTracking(state) {"),
    endSession: method(appSrc, "    endSession() {", "    async submitLogin"),
    loadAll: method(readFileSync("js/dataService.js", "utf8"), "        async loadAll() {", "        async refreshCoordinator() {")
  };
  const forbidden = new RegExp("\\b(" + SURFACE_GLOBALS.join("|") + ")\\b");
  for (const [name, body] of Object.entries(bodies)) {
    assert.doesNotMatch(body, forbidden, name);
    assert.doesNotMatch(body, /loadDriver|loadFleet|loadCoordinatorLoad|refreshShipments|handle\w+MapMount/, name);
  }
});

function wiredSurfaces(files) {
  const w = new JSDOM("<!doctype html><body></body>", { runScripts: "outside-only" }).window;
  const registered = { views: {}, mount: [], render: [], end: [], loaders: {} };
  const calls = [];
  const spy = (name) => new Proxy({}, { get: (target, method) => (...args) => { calls.push(name + "." + String(method)); return "<" + name + ">"; } });
  w.app = {
    registerView: (role, view) => { registered.views[role] = view; },
    onMount: (hook) => registered.mount.push(hook),
    onRender: (hook) => registered.render.push(hook),
    onSessionEnd: (hook) => registered.end.push(hook),
    handleDriverMapMount: () => calls.push("app.handleDriverMapMount"),
    handleGeneratorMapMount: () => calls.push("app.handleGeneratorMapMount"),
    handleCoordinatorMapMount: () => calls.push("app.handleCoordinatorMapMount"),
    syncLiveTracking: () => calls.push("app.syncLiveTracking")
  };
  const service = spy("service");
  w.TruckCarService = new Proxy({}, { get: (target, method) => method === "registerLoader"
    ? (role, loader) => { registered.loaders[role] = loader; }
    : async () => { calls.push("service." + String(method)); } });
  for (const name of SURFACE_GLOBALS) w[name] = spy(name);
  files.forEach((file) => w.eval(readFileSync(file, "utf8")));
  return { w, registered, calls, service };
}

test("la superficie del conductor registra su vista, sus ganchos y su carga de datos, y nada del panel", async () => {
  const { registered, calls } = wiredSurfaces(["js/surfaces/driver.js"]);
  assert.deepEqual(Object.keys(registered.views), ["driver"]);
  assert.deepEqual(Object.keys(registered.loaders), ["driver"]);
  const state = { isAuthenticated: true, activeRole: "driver", driverScreen: "navigation", coordinatorTab: "fleet" };
  assert.equal(registered.views.driver.render(state), "<DriverApp>");
  assert.equal(registered.views.driver.screen(state), "navigation");
  registered.views.driver.mountMap(state);
  registered.mount.forEach((hook) => hook(state));
  registered.render.forEach((hook) => hook(state));
  registered.end.forEach((hook) => hook());
  await registered.loaders.driver();
  assert.deepEqual(calls, ["DriverApp.render", "app.handleDriverMapMount", "DriverTelemetry.renderBadge", "DriverActions.syncSos",
    "DeviceLocation.sync", "DriverTelemetry.renderSimulationToggle", "DriverTelemetry.stop", "RouteGuidance.reset", "DeviceLocation.forget",
    "service.loadDriverProfile", "service.loadDriverAssignment", "service.loadAlerts", "service.loadRoutePlan"]);

  calls.length = 0;
  registered.render.forEach((hook) => hook({ isAuthenticated: false }));
  assert.deepEqual(calls, ["DriverActions.syncSos", "DeviceLocation.sync"], "sin sesión no se toca el botón de simulación");
});

test("la superficie del panel registra torre y generador con sus mapas vivos, ganchos y cargas, y nada del conductor", async () => {
  const { w, registered, calls } = wiredSurfaces(["js/surfaces/panel.js"]);
  assert.deepEqual(Object.keys(registered.views).sort(), ["coordinator", "generator"]);
  assert.deepEqual(Object.keys(registered.loaders).sort(), ["coordinator", "generator"]);
  for (const view of Object.values(registered.views)) {
    assert.deepEqual(Array.from(view.keepAliveMaps), ["coordinator-map-container", "generator-map-container"]);
    assert.equal(view.screen({ coordinatorTab: "shipments" }), "shipments");
  }
  assert.equal(registered.views.generator.render({ coordinatorTab: "fleet" }), "<GeneratorPanel>");
  assert.equal(registered.views.coordinator.render({ coordinatorTab: "fleet" }), "<CoordinatorPanel>");
  assert.equal(registered.views.coordinator.render({ coordinatorTab: "shipments" }), "<GeneratorPanel>", "la pestaña de envíos de la torre usa la vista del generador");

  calls.length = 0;
  registered.views.coordinator.mountMap({});
  assert.deepEqual(calls, [], "sin contenedor de mapa no se monta nada");
  w.document.body.innerHTML = '<div id="coordinator-map-container"></div>';
  registered.views.coordinator.mountMap({});
  w.document.body.innerHTML = '<div id="generator-map-container"></div><div id="coordinator-map-container"></div>';
  registered.views.generator.mountMap({});
  assert.deepEqual(calls, ["app.handleCoordinatorMapMount", "app.handleGeneratorMapMount"]);

  calls.length = 0;
  registered.render.forEach((hook) => hook({ isAuthenticated: false }));
  registered.end.forEach((hook) => hook());
  await registered.loaders.generator();
  await registered.loaders.coordinator();
  assert.deepEqual(calls, ["app.syncLiveTracking", "SosMonitor.sync", "SosMonitor.stop", "LiveTracking.stopAll", "generatorCtrl.reset",
    "service.refreshShipments", "service.loadFleet", "service.loadAlerts", "service.loadCoordinatorLoad", "service.loadDeliveredLoads",
    "service.loadPublishedLoads"]);
  assert.equal(registered.mount.length, 0);
});

test("loadAll carga solo lo que registró la superficie del rol activo", async () => {
  const w = new JSDOM("<!doctype html><body></body>", { runScripts: "outside-only" }).window;
  const state = { activeRole: "driver", dataStatus: { loading: false, errors: {}, lastSync: null } };
  w.store = { get state() { return state; }, setState: (patch) => Object.assign(state, patch) };
  w.TruckCarApi = { users: { me: async () => ({ id: "u1" }) } };
  w.TruckCarData = {};
  w.eval(readFileSync("js/dataService.js", "utf8"));
  const loaded = [];
  w.TruckCarService.registerLoader("driver", async () => { loaded.push("driver"); });
  w.TruckCarService.registerLoader("coordinator", async () => { loaded.push("coordinator"); });

  await w.TruckCarService.loadAll();
  state.activeRole = "coordinator";
  await w.TruckCarService.loadAll();
  state.activeRole = "generator";
  await w.TruckCarService.loadAll();

  assert.deepEqual(loaded, ["driver", "coordinator"], "un rol sin superficie cargada no pide datos de otra");
  assert.equal(state.dataStatus.loading, false);
  assert.ok(state.dataStatus.lastSync);
  assert.equal(state.currentUser.id, "u1");
});

test("la sesión de demostración vive en su propio archivo y solo se pide con ?demo=1", async () => {
  const appSrc = readFileSync("js/app.js", "utf8");
  assert.doesNotMatch(appSrc, /demo-token|truckcar\.demo|Carlos Conductor/, "app.js ya no trae los datos de demo");
  assert.doesNotMatch(readFileSync("index.html", "utf8"), /demoSession\.js/, "index.html no la carga de entrada");
  assert.match(readFileSync("js/demo/demoSession.js", "utf8"), /accessToken: 'demo-token'/);

  const off = app({ phone: false, sessionRole: null, activeRole: "driver" });
  const toasts = [];
  off.w.ui.toast = (title, type) => toasts.push(type + ":" + title);
  await off.w.app.startDemoSession("driver");
  assert.equal(off.w.document.querySelector("script[src*='demoSession']"), null, "sin ?demo=1 ni siquiera se pide el archivo");
  assert.deepEqual(toasts, ["warning:La sesión de demostración solo está disponible con ?demo=1."]);

  const on = app({ phone: false, sessionRole: null, activeRole: "driver", demo: true });
  on.state.isAuthenticated = false;
  on.w.TruckCarConfig.storageKeys = { session: "truckcar.session" };
  on.w.TruckCarData = {};
  on.w.Toaster = { show() {} };
  const starting = on.w.app.startDemoSession("coordinator");
  const script = on.w.document.querySelector("script[src='js/demo/demoSession.js']");
  assert.ok(script, "con ?demo=1 se pide al pulsar el botón");
  on.w.eval(readFileSync("js/demo/demoSession.js", "utf8"));
  script.onload();
  await starting;
  assert.equal(on.state.isAuthenticated, true);
  assert.equal(on.state.sessionRole, "COORDINADOR");
  assert.equal(on.state.activeRole, "coordinator");
  assert.equal(on.w.TruckCarData.fleetVehicles.length, 3);
});

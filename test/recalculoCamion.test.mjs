import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";
import { IDBFactory, IDBKeyRange } from "fake-indexeddb";

// Recálculo durante el viaje: HERE para camión (con respaldo OSRM), nunca hacia una ruta con restricciones si la actual
// está limpia, y confirmación hablada si la alterna es más larga o no se pudo verificar.

// Geometría con un punto cada ~100 m, como las rutas reales (la guía ubica el tramo a evitar sobre sus vértices).
function dense(points) {
  const out = [points[0]];
  for (let i = 1; i < points.length; i++) {
    const [a, b] = [points[i - 1], points[i]];
    const n = Math.max(1, Math.round(Math.hypot(b[0] - a[0], b[1] - a[1]) / 0.0009));
    for (let k = 1; k <= n; k++) out.push([a[0] + (b[0] - a[0]) * k / n, a[1] + (b[1] - a[1]) * k / n]);
  }
  return out;
}
const step = (lng, lat, type = "depart") => ({ distance: 1000, name: "Vía", ref: "", maneuver: { type, location: [lng, lat] } });
const OSRM = (via, distance) => ({
  distance, duration: distance / 15,
  geometry: { coordinates: dense([[-74.0, 4.6], via, [-73.99, 4.61]]) },
  legs: [{ steps: [step(-74.0, 4.6), step(via[0], via[1], "turn"), step(-73.99, 4.61, "arrive")] }]
});
const PRINCIPAL = OSRM([-74.0, 4.61], 2200);
const ALTERNA = OSRM([-73.995, 4.605], 2600);
const HERE_OPTION = (via, distance, extra = {}) => ({
  distanceMeters: distance, durationSeconds: distance / 12,
  geometry: dense([[4.6, -74.0], [via[1], via[0]], [4.61, -73.99]]),
  steps: [
    { action: "depart", instruction: "Diríjase a Calle 80. Siga durante 300 m.", latitude: 4.6, longitude: -74.0, distanceMeters: 300 },
    { action: "turn", direction: "right", severity: "quite", instruction: "Gire a la derecha en Autopista Norte. Siga durante 2 km.",
      latitude: via[1], longitude: via[0], distanceMeters: 2000 },
    { action: "arrive", instruction: "Ha llegado a su destino.", latitude: 4.61, longitude: -73.99, distanceMeters: 0 }
  ],
  violations: [], tollCost: 0, ...extra
});
const LOAD = { backendId: 30, status: "IN_TRANSIT", raw: { id: 30, status: "IN_TRANSIT" },
  origin: { coords: [4.6, -74.0] }, destination: { coords: [4.61, -73.99] } };
const DRIVER = { id: "driver-ana", vehicle: { plate: "TDK-410", height: 4.1, grossWeight: 40, category: "TRACTOMULA_3S3" } };
const BRIDGE = { kind: "GALIBO_ALTURA", alongRouteMeters: 1100, distanceFromRouteMeters: 5,
  restriction: { id: 7, title: "Puente", maxClearanceMeters: 3.8, latitude: 4.605, longitude: -73.995 } };

function browser({ osrm = () => [PRINCIPAL, ALTERNA], here = null, validate = () => ({ blocking: [], warnings: [] }) } = {}) {
  const w = new JSDOM("<!doctype html><body></body>", { runScripts: "outside-only", url: "http://localhost:5500/" }).window;
  w.indexedDB = new IDBFactory();
  w.IDBKeyRange = IDBKeyRange;
  const hereRequests = [];
  w.fetch = async (url, options = {}) => {
    const u = String(url);
    if (u.includes("/routes/reroute")) {
      const body = JSON.parse(options.body);
      hereRequests.push(body);
      const answer = here ? here(body) : { status: 503, json: { status: 503, detail: "HERE no está disponible" } };
      return { ok: answer.status === 200, status: answer.status, headers: { get: (h) => (/content-type/i.test(h) ? "application/json" : null) },
        text: async () => JSON.stringify(answer.json) };
    }
    return { ok: true, json: async () => ({ routes: osrm(u) }) };
  };
  w.voiceEngine = { speak: () => {}, alert: () => {} };
  w.mapCtrl = { drawGuidanceLine() {} };
  w.TruckCarData = { currentDriver: DRIVER };
  w.TruckCarConfig = { apiBaseUrl: "http://localhost:8000/api/v1", gatewayUrl: "http://localhost:8000", requestTimeoutMs: 5000,
    routingUrl: "https://rutas.example.test/route/v1/driving/", storageKeys: { session: "truckcar.session" } };
  ["js/ui.js", "js/api.js"].forEach((file) => w.eval(readFileSync(file, "utf8")));
  w.TruckCarApi.session.save({ accessToken: "a.b.c", refreshToken: "r", expiresIn: 3600 });
  w.TruckCarApi.restrictions = { validateRoute: async (request) => validate(request) };
  ["js/routeStore.js", "js/navigation.js"].forEach((file) => w.eval(readFileSync(file, "utf8")));
  return { w, hereRequests };
}

async function guided(options) {
  const b = browser(options);
  await b.w.RouteGuidance.prepare(LOAD);
  b.w.RouteGuidance.update({ coords: [4.6, -74.0] });
  return b;
}
const plain = (value) => JSON.parse(JSON.stringify(value));

test("la ruta alterna se pide a HERE para el camión, evitando el tramo, y la guía usa sus instrucciones en español", async () => {
  const { w, hereRequests } = await guided({ here: () => ({ status: 200, json: { provider: "HERE", routes: [HERE_OPTION([-73.98, 4.62], 2400)] } }) });
  const plan = await w.RouteGuidance.planReroute({ avoidAhead: true });
  assert.equal(plan.ok, true, JSON.stringify({ reason: plan.reason }));
  assert.equal(plan.provider, "HERE");
  const request = hereRequests.at(-1);
  assert.equal(request.heightMeters, 4.1);
  assert.equal(request.grossWeightTons, 40);
  assert.equal(request.truckType, "TRACTOMULA_3S3");
  assert.deepEqual([request.originLatitude, request.originLongitude], [4.6, -74.0]);
  assert.equal(request.avoid.length, 1, "el tramo de adelante va como zona a evitar");
  assert.equal(request.avoid[0].radiusMeters, 300);

  const applied = plain(w.RouteGuidance.applyReroute(plan));
  assert.equal(applied.ok, true);
  assert.equal(applied.provider, "HERE");
  const steps = w.RouteGuidance.route.steps.map((s) => s.text);
  assert.equal(steps[1], "Gire a la derecha en Autopista Norte", "texto de HERE sin el «Siga durante», la guía antepone la distancia");
  assert.equal(steps.at(-1), "Llegó al destino de la carga");
  assert.equal(w.RouteGuidance.route.steps[1].glyph, "arrow-bend-up-right");
  assert.equal(w.RouteGuidance.avoidPoints.length, 1, "la zona evitada se guarda solo al aplicar");
});

test("si HERE no responde, recalcula con el respaldo OSRM", async () => {
  const { w, hereRequests } = await guided();
  const plan = await w.RouteGuidance.planReroute({ avoidAhead: false });
  assert.equal(hereRequests.length, 1, "primero intentó HERE");
  assert.equal(plan.ok, true);
  assert.equal(plan.provider, "OSRM");
});

test("nunca cambia a una ruta con restricciones de gálibo o peso si la actual está limpia", async () => {
  const blocked = { blocking: [BRIDGE], warnings: [] };
  let calls = 0;
  // La ruta actual se valida limpia al preparar; desde el recálculo, todas las alternativas tienen el puente.
  const { w } = await guided({ validate: () => (calls++ < 1 ? { blocking: [], warnings: [] } : blocked) });
  const before = JSON.stringify(w.RouteGuidance.route.geometry);
  const plan = plain(await w.RouteGuidance.planReroute({ avoidAhead: false }));
  assert.equal(plan.ok, false);
  assert.equal(plan.reason, "restricted-alternatives");
  const result = plain(await w.RouteGuidance.recalculate({ avoidAhead: false }));
  assert.equal(result.reason, "restricted-alternatives", "recalcular sin preguntar tampoco la toma");
  assert.equal(JSON.stringify(w.RouteGuidance.route.geometry), before, "la guía sigue por la ruta actual");
});

test("una restricción que HERE marca en la ruta también cuenta", async () => {
  const { w } = await guided({ here: () => ({ status: 200, json: { provider: "HERE", routes: [
    HERE_OPTION([-73.995, 4.605], 2400, { violations: ["Altura máxima 3,8 m"] })] } }) });
  const plan = plain(await w.RouteGuidance.planReroute({ avoidAhead: false }));
  assert.equal(plan.reason, "restricted-alternatives");
});

test("una alterna mucho más larga pide confirmación con los kilómetros de más", async () => {
  const { w } = await guided({ here: () => ({ status: 200, json: { provider: "HERE", routes: [HERE_OPTION([-73.9, 4.7], 40000)] } }) });
  const plan = await w.RouteGuidance.planReroute({ avoidAhead: true });
  assert.equal(plan.ok, true, JSON.stringify({ reason: plan.reason }));
  assert.equal(plan.longer, true);
  assert.equal(plan.needsConfirmation, true);
  assert.ok(plan.extraM > 15000, "el desvío por el nororiente suma más de 15 km a los 2,2 km que faltan");
  assert.equal(plan.unchecked, false, "HERE ya calculó para el camión");
});

test("sin poder verificar gálibo y peso (OSRM y Routing-Restrictions caído) pide confirmación", async () => {
  const { w } = await guided({ validate: () => { throw new Error("503"); } });
  const plan = await w.RouteGuidance.planReroute({ avoidAhead: false });
  assert.equal(plan.ok, true);
  assert.equal(plan.provider, "OSRM");
  assert.equal(plan.unchecked, true);
  assert.equal(plan.needsConfirmation, true);
});

// ── Copiloto ─────────────────────────────────────────────────────────────────────────────────────────────────

function copilot(planReroute, applied = []) {
  const w = new JSDOM("<!doctype html><body></body>", { runScripts: "outside-only" }).window;
  for (const file of ["js/services/voiceIntents.js", "js/services/voiceAssistant.js"]) w.eval(readFileSync(file, "utf8"));
  const said = [];
  const ctrl = w.VoiceAssistant.createController({
    say: async (text) => { said.push(text); },
    listen: () => {},
    actions: {
      hasRoute: () => true,
      planReroute,
      applyReroute: async (plan) => { applied.push(plan); return { ok: true, remainingM: plan.remainingM, durationS: plan.durationS, provider: plan.provider }; }
    }
  });
  return { ctrl, said, applied };
}

test("el copiloto pregunta antes de tomar una ruta más larga; con sí la toma, con cancelar sigue por la actual", async () => {
  const longer = async () => ({ ok: true, remainingM: 156400, durationS: 12660, provider: "HERE", longer: true, unchecked: false,
    extraM: 17600, extraS: 2220, needsConfirmation: true });
  const yes = copilot(longer);
  const asked = await yes.ctrl.handle("hay mucho tráfico, quiero ir por otra ruta");
  assert.equal(asked.status, "confirming");
  assert.equal(yes.said.at(-1), "La ruta alterna es 18 kilómetros más larga, unos 37 minutos más. ¿La tomo? Diga sí o cancelar.");
  assert.equal(yes.applied.length, 0, "nada cambia antes del sí");
  await yes.ctrl.handle("sí");
  assert.equal(yes.applied.length, 1);
  assert.equal(yes.said.at(-1), "Nueva ruta: 156 kilómetros, aproximadamente 3 horas y 31 minutos. Calculada para su camión con el tráfico actual.");

  const no = copilot(longer);
  await no.ctrl.handle("cambia la ruta que hay trancón");
  await no.ctrl.handle("cancelar");
  assert.equal(no.applied.length, 0);
  assert.equal(no.said.at(-1), "Sigo por la ruta actual.");
});

test("el copiloto explica por qué no cambia y avisa cuando no pudo verificar", async () => {
  const restricted = copilot(async () => ({ ok: false, reason: "restricted-alternatives", blocking: 2 }));
  await restricted.ctrl.handle("otra ruta, hay mucho tráfico");
  assert.equal(restricted.said.at(-1), "Las rutas alternas tienen restricciones de gálibo o peso para su camión. Siga por la ruta actual.");

  const unchecked = copilot(async () => ({ ok: true, remainingM: 2400, durationS: 200, provider: "OSRM", longer: false, unchecked: true,
    extraM: 200, extraS: 30, needsConfirmation: true }));
  await unchecked.ctrl.handle("recalcular ruta");
  assert.equal(unchecked.said.at(-1), "No pude verificar gálibo y peso en la ruta alterna. ¿La tomo? Diga sí o cancelar.");

  const direct = copilot(async () => ({ ok: true, remainingM: 2400, durationS: 200, provider: "HERE", needsConfirmation: false }));
  await direct.ctrl.handle("recalcular ruta");
  assert.equal(direct.applied.length, 1, "una alterna parecida y verificada se toma sin preguntar");
});

test("«cambia la ruta que hay trancón» es recalcular, no un reporte", () => {
  const w = new JSDOM("<!doctype html><body></body>", { runScripts: "outside-only" }).window;
  w.eval(readFileSync("js/services/voiceIntents.js", "utf8"));
  for (const text of ["cambia la ruta que hay trancón", "hay mucho tráfico, quiero ir por otra ruta", "recalcula, hay mucho tráfico"]) {
    const intent = plain(w.VoiceIntents.parse(text));
    assert.equal(intent.type, "REROUTE", text);
    assert.equal(intent.avoidAhead, true, text);
  }
  assert.equal(plain(w.VoiceIntents.parse("hay un trancón")).type, "REPORT");
});

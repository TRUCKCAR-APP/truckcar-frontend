// La guía elige, entre las alternativas de OSRM, la primera ruta que el camión puede recorrer sin incumplir gálibo ni
// peso (Routing-Restrictions /validate-route); si ninguna sirve, la de menor impacto, con el aviso en el HUD.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";

const step = (lng, lat, type = "depart", name = "Vía") => ({ distance: 1000, name, ref: "", maneuver: { type, location: [lng, lat] } });
// Tres rutas entre los mismos puntos; cada una pasa por un punto intermedio distinto que la identifica.
const ROUTE = (via, distance) => ({
  distance, duration: distance / 15,
  geometry: { coordinates: [[-74.0, 4.6], via, [-73.99, 4.61]] },
  legs: [{ steps: [step(-74.0, 4.6), step(via[0], via[1], "turn"), step(-73.99, 4.61, "arrive")] }]
});
const PRINCIPAL = ROUTE([-74.0, 4.61], 2200);
const ALTERNA_1 = ROUTE([-73.995, 4.605], 2600);
const ALTERNA_2 = ROUTE([-74.005, 4.62], 2400);
const LOAD = { backendId: 30, status: "IN_TRANSIT", origin: { coords: [4.6, -74.0] }, destination: { coords: [4.61, -73.99] } };
const BRIDGE = (id) => ({ kind: "GALIBO_ALTURA", alongRouteMeters: 1100, restriction: { id, title: "Puente", maxClearanceMeters: 3.8 } });

/** blockedBy: punto intermedio (lng,lat) → restricciones que incumple esa ruta. */
function browser(blockedBy, { failValidation = false } = {}) {
  const dom = new JSDOM(`<!doctype html><body>
      <div data-nav-route-notice hidden><span data-nav-route-notice-text></span><span data-nav-route-notice-sub></span></div>
    </body>`, { runScripts: "outside-only", url: "http://localhost:5500/" });
  const w = dom.window;
  const fetches = [];
  const spoken = [];
  const validated = [];
  const drawn = [];
  w.fetch = async (url) => { fetches.push(String(url)); return { ok: true, json: async () => ({ routes: [PRINCIPAL, ALTERNA_1, ALTERNA_2] }) }; };
  w.voiceEngine = { speak: (text) => spoken.push(text) };
  w.mapCtrl = { drawGuidanceLine: (geometry, discarded) => drawn.push({ geometry, discarded }) };
  w.TruckCarData = { currentDriver: { vehicle: { plate: "TDK-410", height: 4.1, grossWeight: 40 } } };
  w.TruckCarApi = { restrictions: { validateRoute: async (request) => {
    validated.push(request);
    if (failValidation) throw new Error("503");
    const via = request.path[1];
    const blocking = blockedBy[via[1] + "," + via[0]] || [];
    return { passable: !blocking.length, blocking, warnings: [] };
  } } };
  w.eval(readFileSync("js/navigation.js", "utf8"));
  return { w, fetches, spoken, validated, drawn };
}
const key = (route) => route.geometry.coordinates[1].join(",");
const notice = (w) => ({
  hidden: w.document.querySelector("[data-nav-route-notice]").hidden,
  text: w.document.querySelector("[data-nav-route-notice-text]").textContent,
  sub: w.document.querySelector("[data-nav-route-notice-sub]").textContent
});

test("pide las alternativas a OSRM y toma la primera que no incumple gálibo ni peso", async () => {
  const { w, fetches, spoken, validated, drawn } = browser({ [key(PRINCIPAL)]: [BRIDGE(7)] });

  await w.RouteGuidance.prepare(LOAD);

  assert.match(fetches[0], /alternatives=true/);
  assert.equal(validated.length, 3, "se valida cada alternativa con la altura y el peso del camión");
  assert.ok(validated.every((r) => r.heightMeters === 4.1 && r.grossWeightTons === 40));
  const route = w.RouteGuidance.route;
  assert.equal(JSON.stringify(route.geometry[1]), "[4.605,-73.995]", "la alternativa 1, la primera libre en el orden de OSRM");
  assert.equal(route.choice.index, 1);
  assert.equal(route.choice.restricted, false);
  assert.equal(drawn.at(-1).discarded.length, 2, "las otras dos se dibujan como descartadas");

  const n = notice(w);
  assert.equal(n.hidden, false);
  assert.equal(n.text, "Ruta alternativa apta para su vehículo");
  assert.equal(n.sub, "· evita 1 restricción de la ruta principal");
  assert.ok(spoken.some((t) => /ruta alternativa que evita restricciones/.test(t)));
  assert.equal(w.RouteGuidance.clearance.items.length, 0, "la ruta elegida no trae restricciones incumplidas");
});

test("si todas incumplen, avisa en el HUD y elige la de menor impacto", async () => {
  const { w, spoken } = browser({
    [key(PRINCIPAL)]: [BRIDGE(7), BRIDGE(8)],
    [key(ALTERNA_1)]: [BRIDGE(9)],
    [key(ALTERNA_2)]: [BRIDGE(10)]
  });

  await w.RouteGuidance.prepare(LOAD);

  const route = w.RouteGuidance.route;
  assert.equal(route.choice.restricted, true);
  assert.equal(route.choice.blocking, 1);
  // Las dos alternativas incumplen una restricción: gana la de menor longitud real sobre la geometría.
  const lengths = [ALTERNA_1, ALTERNA_2].map((r) => {
    const c = r.geometry.coordinates;
    return c.slice(1).reduce((sum, p, i) => sum + Math.hypot(p[0] - c[i][0], p[1] - c[i][1]), 0);
  });
  const shortest = lengths[0] <= lengths[1] ? ALTERNA_1 : ALTERNA_2;
  assert.equal(JSON.stringify(route.geometry[1]), JSON.stringify([shortest.geometry.coordinates[1][1], shortest.geometry.coordinates[1][0]]),
    "entre las de 1 restricción, la más corta");
  const n = notice(w);
  assert.equal(n.hidden, false);
  assert.equal(n.text, "Atención: La ruta contiene restricciones no aptas para su vehículo");
  assert.equal(n.sub, "· se eligió la de menor impacto (1 de 3 rutas evaluadas)");
  assert.ok(spoken.some((t) => /Atención: la ruta contiene restricciones no aptas para su vehículo/.test(t)));
  assert.equal(w.RouteGuidance.clearance.items.length, 1, "la restricción que queda se sigue avisando al acercarse");
});

test("si la ruta principal ya es apta, se usa sin aviso", async () => {
  const { w, spoken } = browser({ [key(ALTERNA_1)]: [BRIDGE(9)] });

  await w.RouteGuidance.prepare(LOAD);

  assert.equal(w.RouteGuidance.route.choice.index, 0);
  assert.equal(notice(w).hidden, true);
  assert.equal(w.RouteGuidance.routeNotice(), null);
  assert.ok(!spoken.some((t) => /alternativa|restricciones no aptas/.test(t)));
});

test("sin respuesta de Routing-Restrictions o sin vehículo no se descarta ninguna ruta ni se inventa un aviso", async () => {
  const { w } = browser({}, { failValidation: true });
  await w.RouteGuidance.prepare(LOAD);
  assert.equal(w.RouteGuidance.route.choice.index, 0, "se queda la principal de OSRM");
  assert.equal(w.RouteGuidance.route.choice.checked, false);
  assert.equal(w.RouteGuidance.clearance.status, "unavailable");
  assert.equal(notice(w).hidden, true);

  const noVehicle = browser({ [key(PRINCIPAL)]: [BRIDGE(7)] });
  noVehicle.w.TruckCarData.currentDriver = { vehicle: null };
  await noVehicle.w.RouteGuidance.prepare(LOAD);
  assert.equal(noVehicle.validated.length, 0, "sin altura ni peso no se consulta");
  assert.equal(noVehicle.w.RouteGuidance.clearance.status, "no-vehicle");
  assert.equal(noVehicle.w.RouteGuidance.route.choice.index, 0);
});

test("al recalcular por salirse de la ruta también se evitan las restricciones", async () => {
  const { w, fetches } = browser({ [key(PRINCIPAL)]: [BRIDGE(7)] });
  await w.RouteGuidance.prepare(LOAD);
  fetches.length = 0;

  w.RouteGuidance.update({ coords: [4.7, -74.2], speed: 40, source: "gps" }); // lejos de la ruta
  await new Promise((r) => setTimeout(r, 10));

  assert.match(fetches[0], /alternatives=true/);
  assert.equal(w.RouteGuidance.route.source, "recalculada");
  assert.equal(w.RouteGuidance.route.choice.index, 1);
});

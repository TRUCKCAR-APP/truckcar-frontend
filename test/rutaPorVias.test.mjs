import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";

// Una ruta va por las vías: el mapa nunca dibuja una recta entre origen y destino ni entre paradas.

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const ORIGIN = [4.6584, -74.0602];
const DEST = [4.78312, -74.04221];
// Geometría por vías (GeoJSON, [lng, lat]) con varias curvas.
const ROAD = Array.from({ length: 30 }, (_, i) => [ORIGIN[1] + (DEST[1] - ORIGIN[1]) * i / 29 + Math.sin(i) * 0.003,
  ORIGIN[0] + (DEST[0] - ORIGIN[0]) * i / 29]);

function mapWindow(routing) {
  const w = new JSDOM(`<!doctype html><body><div id="m"></div></body>`,
    { runScripts: "outside-only", pretendToBeVisual: true, url: "http://localhost:5500/" }).window;
  const el = w.document.getElementById("m");
  Object.defineProperty(el, "clientWidth", { get: () => 390 });
  Object.defineProperty(el, "clientHeight", { get: () => 700 });
  // jsdom no implementa createSVGRect: sin él Leaflet no tiene con qué dibujar líneas.
  w.SVGSVGElement.prototype.createSVGRect = () => ({});
  w.eval(readFileSync("assets/vendor/leaflet/leaflet.js", "utf8"));
  w.TruckCarConfig = { map: { tileUrl: "https://tiles.example.test/{z}/{x}/{y}.png", lightTileUrl: "https://tiles.example.test/{z}/{x}/{y}.png",
    attribution: "", maxZoom: 19 } };
  w.TruckCarData = {};
  w.TruckCarApi = { routing };
  w.RouteGuidance = { route: null, snapshot: () => ({}) };
  w.eval(readFileSync("js/ui.js", "utf8"));
  w.eval(readFileSync("js/mapController.js", "utf8"));
  w.mapCtrl.initMap("m", ORIGIN, 10);
  return w;
}

function polylines(w) {
  const found = [];
  w.mapCtrl.map.eachLayer((layer) => { if (layer instanceof w.L.Polyline) found.push(layer.getLatLngs().length); });
  return found;
}

const load = { origin: { coords: ORIGIN, city: "Bogotá" }, destination: { coords: DEST, city: "Chía" } };

test("el envío no une origen y destino con una recta: dibuja la ruta por vías cuando llega", async () => {
  let resolve;
  const w = mapWindow({ drivingRoute: () => new Promise((r) => { resolve = r; }) });
  w.mapCtrl.drawShipment(load, null);
  assert.deepEqual(polylines(w), [], "mientras llega la ruta solo están los pines");
  resolve({ geometry: { coordinates: ROAD } });
  await wait(10);
  assert.deepEqual(polylines(w), [30], "la línea sigue la geometría por vías");
  w.mapCtrl.drawShipment(load, null, { fit: false });
  assert.deepEqual(polylines(w), [30], "al refrescar usa la ruta ya obtenida");
});

test("si el servicio de rutas falla, el envío muestra solo los pines", async () => {
  const w = mapWindow({ drivingRoute: () => Promise.reject(new Error("sin red")) });
  w.mapCtrl.drawShipment(load, null);
  await wait(10);
  assert.deepEqual(polylines(w), []);
});

test("la ruta de la carga no traza rectas entre paradas mientras llega la geometría por vías", async () => {
  let resolve;
  const w = mapWindow({ drivingRoute: () => new Promise((r) => { resolve = r; }) });
  w.TruckCarData.routes = { optimal: { id: "r1", waypoints: [
    { coords: ORIGIN, name: "Origen", instruction: "" }, { coords: [4.70, -74.05], name: "Parada", instruction: "" },
    { coords: DEST, name: "Destino", instruction: "" }] } };
  w.mapCtrl.renderRoutes();
  assert.deepEqual(polylines(w), [], "solo las paradas");
  resolve({ geometry: { coordinates: ROAD } });
  await wait(10);
  assert.ok(polylines(w).length > 0 && polylines(w).every((n) => n === 0 || n >= 2), "dibuja la ruta por vías");
  assert.ok(Math.max(...polylines(w)) >= 15, "con la geometría de las vías, no 3 puntos");
});

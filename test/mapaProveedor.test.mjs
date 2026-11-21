import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";

// Stadia sin clave solo sirve teselas a localhost (401 en otro dominio) y CARTO ya exige clave en todas sus URL (la
// tesela dice «API KEY REQUIRED»). Fuera de localhost y sin clave se usa el mapa gris de Esri: base + nombres de calles.

function load(url, setup) {
  const w = new JSDOM("<!doctype html><head></head><body><div id='m'></div></body>", { runScripts: "outside-only", pretendToBeVisual: true, url }).window;
  if (setup) setup(w);
  w.eval(readFileSync("assets/vendor/leaflet/leaflet.js", "utf8"));
  w.eval(readFileSync("js/config.js", "utf8"));
  return w;
}

test("en un dominio público o en la APK el mapa usa Esri, que no pide clave, con la capa de nombres de calles", () => {
  for (const url of ["https://toner-riding-offerings-civilization.trycloudflare.com/", "https://app.truckcar.co/"]) {
    const map = load(url).TruckCarConfig.map;
    assert.equal(map.provider, "esri", url);
    assert.match(map.tileUrl, /^https:\/\/server\.arcgisonline\.com\/.*World_Dark_Gray_Base\/MapServer\/tile\/\{z\}\/\{y\}\/\{x\}$/);
    assert.match(map.labelsUrl, /World_Dark_Gray_Reference/);
    assert.equal(map.maxNativeZoom, 16, "más cerca de 16, Leaflet amplía las teselas de Esri");
    assert.match(map.attribution, /Esri/);
    assert.doesNotMatch(map.tileUrl + map.lightTileUrl, /cartocdn/, "CARTO ya no sirve sin clave");
  }
});

test("layer() arma la base y los nombres, y cambia de tema sin recrear el mapa", () => {
  const w = load("https://app.truckcar.co/");
  const layer = w.TruckCarConfig.map.layer("dark");
  const urls = () => layer.getLayers().map((l) => l._url);
  assert.equal(layer.getLayers().length, 2);
  assert.match(urls()[0], /World_Dark_Gray_Base/);
  assert.match(urls()[1], /World_Dark_Gray_Reference/);
  layer.setTheme("light");
  assert.match(urls()[0], /World_Light_Gray_Base/);
  assert.match(urls()[1], /World_Light_Gray_Reference/);
});

test("en localhost sigue Stadia (una sola capa); con clave configurada, Stadia en cualquier dominio", () => {
  const local = load("http://localhost:5500/").TruckCarConfig.map;
  assert.equal(local.provider, "stadia");
  assert.equal(local.labelsUrl, null);
  assert.equal(local.layer("dark").getLayers().length, 1);
  const keyed = load("https://app.truckcar.co/", (w) => { w.TRUCKCAR_MAP_API_KEY = "clave-de-prueba"; }).TruckCarConfig.map;
  assert.equal(keyed.provider, "stadia");
  assert.match(keyed.tileUrl, /tiles\.stadiamaps\.com.*\?api_key=clave-de-prueba$/);
});

test("la caché sin conexión guarda también las teselas de Esri", () => {
  assert.match(readFileSync("sw.js", "utf8"), /server\\\.arcgisonline\\\.com/);
});

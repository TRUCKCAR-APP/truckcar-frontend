import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";

// Stadia sin clave solo sirve teselas a localhost: en el dominio del clúster o en la APK (https://app.truckcar.co)
// respondía 401 y el mapa salía cubierto de avisos de error. Fuera de localhost, sin clave, se usa CARTO.

function config(url, setup) {
  const w = new JSDOM("<!doctype html><head></head><body></body>", { runScripts: "outside-only", url }).window;
  if (setup) setup(w);
  w.eval(readFileSync("js/config.js", "utf8"));
  return w.TruckCarConfig.map;
}

test("en un dominio público o en la APK el mapa usa CARTO, que no pide clave", () => {
  for (const url of ["https://toner-riding-offerings-civilization.trycloudflare.com/", "https://app.truckcar.co/"]) {
    const map = config(url);
    assert.equal(map.provider, "carto", url);
    assert.match(map.tileUrl, /^https:\/\/basemaps\.cartocdn\.com\/rastertiles\/dark_all\//);
    assert.match(map.attribution, /CARTO/);
  }
});

test("en localhost sigue Stadia; con clave configurada, Stadia en cualquier dominio", () => {
  assert.equal(config("http://localhost:5500/").provider, "stadia");
  const keyed = config("https://app.truckcar.co/", (w) => { w.TRUCKCAR_MAP_API_KEY = "clave-de-prueba"; });
  assert.equal(keyed.provider, "stadia");
  assert.match(keyed.tileUrl, /tiles\.stadiamaps\.com.*\?api_key=clave-de-prueba$/);
});

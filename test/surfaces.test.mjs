import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { SURFACES, ON_DEMAND, PAGES, pageScripts, allScripts } from "../scripts/surfaces.mjs";

const scriptsOf = (html) => [...html.matchAll(/<script src="(js\/[^"]+)"/g)].map((match) => match[1]);
const sorted = (list) => [...list].sort();

function shellScripts() {
  const sw = readFileSync("sw.js", "utf8");
  const shell = sw.slice(sw.indexOf("const SHELL = ["), sw.indexOf("];", sw.indexOf("const SHELL = [")));
  return [...shell.matchAll(/'(js\/[^']+)'/g)].map((match) => match[1]);
}

function filesUnder(dir) {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    return statSync(path).isDirectory() ? filesUnder(path) : [path.replace(/\\/g, "/")];
  }).filter((path) => path.endsWith(".js"));
}

test("cada script de js/ pertenece a una sola superficie y cada entrada de la lista existe", () => {
  const listed = allScripts();
  assert.equal(new Set(listed).size, listed.length, "ningún script está en dos superficies");
  for (const script of listed) assert.ok(existsSync(script), script + " está en la lista y no existe");
  assert.deepEqual(sorted(listed), sorted(filesUnder("js")), "todo archivo de js/ está en núcleo, conductor, panel o bajo demanda");
  assert.deepEqual(Object.keys(SURFACES), ["core", "driver", "panel"]);
});

test("index.html carga exactamente núcleo, conductor y panel, y respeta el orden de cada superficie", () => {
  const loaded = scriptsOf(readFileSync("index.html", "utf8"));
  assert.equal(new Set(loaded).size, loaded.length, "sin scripts repetidos");
  assert.deepEqual(PAGES["index.html"], ["core", "driver", "panel"]);
  assert.deepEqual(sorted(loaded), sorted(pageScripts("index.html")));
  for (const [surface, scripts] of Object.entries(SURFACES)) {
    assert.deepEqual(loaded.filter((script) => scripts.includes(script)), scripts, "orden de carga de " + surface);
  }
  const at = (script) => loaded.indexOf(script);
  assert.ok(at("js/ui.js") < at("js/ui/toaster.js"), "window.ui existe antes que cualquier vista");
  for (const view of loaded.filter((script) => script.startsWith("js/views/"))) {
    assert.ok(at("js/ui.js") < at(view), "js/ui.js va antes de " + view);
  }
  for (const wiring of ["js/surfaces/driver.js", "js/surfaces/panel.js"]) {
    assert.ok(at("js/app.js") < at(wiring), wiring + " se registra cuando window.app ya existe");
    assert.ok(at("js/dataService.js") < at(wiring));
  }
  for (const script of SURFACES.driver.slice(0, -1)) assert.ok(at(script) < at("js/surfaces/driver.js"), script + " carga antes de su registro");
  for (const script of SURFACES.panel.slice(0, -1)) assert.ok(at(script) < at("js/surfaces/panel.js"), script + " carga antes de su registro");
});

test("lo que se carga bajo demanda no está en index.html", () => {
  const loaded = scriptsOf(readFileSync("index.html", "utf8"));
  for (const script of Object.values(ON_DEMAND).flat()) {
    assert.ok(!loaded.includes(script), script + " solo se pide cuando hace falta");
  }
  assert.match(readFileSync("js/app.js", "utf8"), /script\.src = 'js\/demo\/demoSession\.js'/);
});

test("el Service Worker precarga los scripts de todas las superficies, incluidos los de bajo demanda, y ninguno más", () => {
  const shell = shellScripts();
  assert.equal(new Set(shell).size, shell.length, "sin entradas repetidas en el app shell");
  assert.deepEqual(sorted(shell), sorted(allScripts()));
});

test("el núcleo no nombra las vistas del conductor ni del panel al pintar ni al cargar: cada superficie se registra sola", () => {
  const driver = readFileSync("js/surfaces/driver.js", "utf8");
  const panel = readFileSync("js/surfaces/panel.js", "utf8");
  assert.doesNotMatch(driver, /CoordinatorPanel|GeneratorPanel|generatorCtrl|SosMonitor|LiveTracking/, "el conductor no toca el panel");
  assert.doesNotMatch(panel, /DriverApp|DriverActions|DriverTelemetry|RouteGuidance|DeviceLocation/, "el panel no toca al conductor");
  for (const src of [readFileSync("js/views/coordinatorPanel.js", "utf8"), readFileSync("js/mapController.js", "utf8")]) {
    assert.doesNotMatch(src, /DriverApp\.statusLabel/, "las etiquetas de estado vienen del núcleo");
    assert.match(src, /window\.ui\.statusLabel\(/);
  }
  assert.match(readFileSync("js/ui.js", "utf8"), /^window\.ui = \{/);
  assert.doesNotMatch(readFileSync("js/app.js", "utf8"), /window\.ui = /);
});

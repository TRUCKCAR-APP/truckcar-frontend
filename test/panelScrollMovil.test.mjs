import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// En el celular la página de los paneles es el único contenedor con scroll: las listas internas solo tienen scroll
// propio desde lg (escritorio). Si una lista vuelve a tener overflow-y-auto en el celular, con
// overscroll-behavior: contain atrapa el gesto y la página solo baja tocando los márgenes.
const PANELS = ["js/views/coordinatorPanel.js", "js/views/generatorPanel.js"];

for (const file of PANELS) {
  test(`${file}: en el celular solo la página (data-screen) y los modales tienen scroll`, () => {
    const source = readFileSync(file, "utf8");
    const classLists = [...source.matchAll(/class="([^"]*)"/g)].map(m => m[1]);
    const offenders = classLists.filter(list => /(^|\s)overflow-y-auto(\s|$)/.test(list))
      .filter(list => !/lg:overflow-hidden/.test(list) && !/max-h-\[90vh\]/.test(list));
    assert.deepEqual(offenders, [], "listas con scroll propio en el celular");
  });
}

test("el mapa de la torre deja libre la mitad de la pantalla para la página en el celular", () => {
  const source = readFileSync("js/views/coordinatorPanel.js", "utf8");
  assert.match(source, /min-h-\[42vh\] lg:min-h-0[^"]*"[^>]*>\s*<div id="coordinator-map-container"/);
});

test("mapas de panel: un dedo desplaza la página y dos dedos mueven el mapa en pantallas táctiles pequeñas", () => {
  const source = readFileSync("js/mapController.js", "utf8");
  assert.match(source, /SCROLL_FRIENDLY_MAPS = new Set\(\['coordinator-map-container', 'generator-map-container'\]\)/);
  assert.match(source, /\(pointer: coarse\) and \(max-width: 1023\.98px\)/);
  assert.match(source, /map\.dragging\.disable\(\)/);
  // La navegación del conductor conserva el arrastre con un dedo.
  assert.doesNotMatch(source, /SCROLL_FRIENDLY_MAPS = new Set\([^)]*live-nav-map-container/);
});

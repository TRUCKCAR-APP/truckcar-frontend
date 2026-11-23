import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Inicio de sesión fuera del celular: sin el marco de teléfono, marca a la izquierda en pantallas anchas y tarjeta
// centrada en tableta vertical; en el celular, igual que antes.
const css = readFileSync("css/main.css", "utf8");
const view = readFileSync("js/views/loginView.js", "utf8");

test("las tres pantallas (ingreso/registro, verificación y contraseña) llevan el panel de marca", () => {
  assert.equal(view.split('class="login-screen">${this.brandPanel()}').length - 1, 3);
  assert.match(view, /Rutas para su camión[\s\S]*Copiloto por voz[\s\S]*Funciona sin señal[\s\S]*Torre de control/);
});

test("el login no usa el marco de 480 px del celular y se adapta a tableta y computador", () => {
  assert.match(css, /body\[data-view="login"\] \.phone-frame \{ max-width: none !important;/);
  assert.match(css, /\.login-aside \{ display: none; \}/, "en el celular el panel no se ve");
  assert.match(css, /@media \(min-width: 641px\) and \(max-width: 959px\) \{\s*\.login-screen/);
  assert.match(css, /@media \(min-width: 960px\) \{\s*\.login-screen \{ display: grid; grid-template-columns: minmax\(380px, 42%\) 1fr;/);
  assert.match(css, /background: rgb\(20 23 28\)/, "panel oscuro fijo: el logo blanco se ve también en tema claro");
});

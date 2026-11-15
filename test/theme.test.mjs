import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const source = readFileSync("js/theme.js", "utf8");

function boot({ saved = null, dark = false } = {}) {
  const listeners = { document: {}, window: {}, media: {} };
  const root = { dataset: {}, style: {} };
  const meta = { content: "" };
  const selects = [];
  const storage = new Map(saved ? [["truckcar.theme.preference", saved]] : []);
  const document = {
    documentElement: root,
    querySelector: () => meta,
    querySelectorAll: () => selects,
    addEventListener: (name, fn) => { (listeners.document[name] ||= []).push(fn); }
  };
  const media = {
    matches: dark,
    addEventListener: (name, fn) => { (listeners.media[name] ||= []).push(fn); }
  };
  const window = {
    matchMedia: () => media,
    dispatchEvent: event => { (listeners.window[event.type] ||= []).forEach(fn => fn(event)); },
    addEventListener: (name, fn) => { (listeners.window[name] ||= []).push(fn); },
    CustomEvent: class CustomEvent { constructor(type, init) { this.type = type; this.detail = init.detail; } }
  };
  const localStorage = {
    getItem: key => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, value)
  };
  vm.runInNewContext(source, { window, document, localStorage });
  return { window, document, root, meta, media, listeners, storage, selects };
}

test("sin preferencia guardada adopta el tema del sistema", () => {
  const light = boot();
  assert.equal(light.root.dataset.theme, "light");
  assert.equal(light.window.TruckCarTheme.getPreference(), "system");

  const dark = boot({ dark: true });
  assert.equal(dark.root.dataset.theme, "dark");
  assert.equal(dark.root.style.colorScheme, "dark");
});

test("el modo automático sigue cambios del sistema y actualiza el tema de Android", () => {
  const app = boot();
  app.media.matches = true;
  app.listeners.media.change[0]();
  assert.equal(app.root.dataset.theme, "dark");
  assert.equal(app.meta.content, "#0C0E12");

  app.media.matches = false;
  app.listeners.media.change[0]();
  assert.equal(app.root.dataset.theme, "light");
  assert.equal(app.meta.content, "#F6F7F9");
});

test("una preferencia manual persiste y no cambia al cambiar el sistema", () => {
  const app = boot({ saved: "light" });
  app.media.matches = true;
  app.listeners.media.change[0]();
  assert.equal(app.root.dataset.theme, "light");

  app.window.TruckCarTheme.setPreference("dark");
  assert.equal(app.storage.get("truckcar.theme.preference"), "dark");
  app.media.matches = false;
  app.listeners.media.change[0]();
  assert.equal(app.root.dataset.theme, "dark");
});

test("el selector delega el cambio y permite volver al modo automático", () => {
  const app = boot({ saved: "dark" });
  const select = { value: "system", matches: selector => selector === "[data-theme-select]" };
  app.listeners.document.change[0]({ target: select });
  assert.equal(app.storage.get("truckcar.theme.preference"), "system");
  assert.equal(app.root.dataset.theme, "light");
});

test("el tema se inicializa antes de los estilos y el selector ofrece las tres preferencias", () => {
  const html = readFileSync("index.html", "utf8");
  assert.ok(html.indexOf('src="js/theme.js"') < html.indexOf('href="css/tokens.css"'));
  assert.match(html, /data-theme-select[\s\S]*value="system"[\s\S]*value="light"[\s\S]*value="dark"/);
  const app = boot({ saved: "system" });
  assert.match(app.window.TruckCarTheme.selector(), /Automático[\s\S]*Claro[\s\S]*Oscuro/);
});

test("tokens y mapas tienen estilos para el tema claro", () => {
  const tokens = readFileSync("css/tokens.css", "utf8");
  const styles = readFileSync("css/main.css", "utf8");
  const maps = readFileSync("js/mapController.js", "utf8") + readFileSync("js/views/publicTracking.js", "utf8");
  assert.match(tokens, /:root\[data-theme="light"\]/);
  assert.match(styles, /\.theme-select/);
  assert.match(maps, /lightTileUrl/);
  assert.match(maps, /truckcar:themechange/);
});

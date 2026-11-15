// Pila de avisos del HUD de navegación: como máximo dos a la vista, por prioridad (bloqueo de la IA > gálibo/peso >
// fuera de ruta > GPS), el resto en "+N avisos", y sin llegar al panel de velocidad.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";

function browser() {
  const dom = new JSDOM(`<!doctype html><body><div class="nav-screen">
      <section class="hud-card">
        <div class="hud-meta"></div>
        <div class="hud-row" data-hud-alert="3" data-nav-offroute hidden>Fuera de la ruta</div>
        <div class="hud-row hud-route-notice" data-hud-alert="2.5" data-nav-route-notice hidden>Ruta</div>
        <div class="hud-row hud-ai-alert" data-hud-alert="1" data-nav-ai-alert hidden>IA</div>
        <div class="hud-row" data-hud-alert="2" data-nav-clearance hidden>Gálibo</div>
        <div class="hud-row hud-gps" data-hud-alert="5" id="driver-telemetry-badge"></div>
        <button class="hud-row hud-more" data-hud-more hidden><span data-hud-more-text></span></button>
      </section>
      <div class="hud-panel"></div>
    </div></body>`, { runScripts: "outside-only", url: "http://localhost:5500/" });
  const w = dom.window;
  w.eval(readFileSync("js/navigation.js", "utf8"));
  const $ = (sel) => w.document.querySelector(sel);
  const show = (...names) => names.forEach((n) => { $(`[data-nav-${n}]`).hidden = false; });
  const gps = (state, text = "Sin transmitir") => { const el = $("#driver-telemetry-badge"); el.dataset.state = state; el.textContent = text; };
  const visible = () => Array.from(w.document.querySelectorAll("[data-hud-alert]"))
    .filter((el) => !el.hidden && !el.classList.contains("is-overflow") && (!el.classList.contains("hud-gps") || (el.textContent && el.dataset.state !== "ok")))
    .map((el) => el.textContent.trim());
  const more = () => ({ hidden: $("[data-hud-more]").hidden, text: $("[data-hud-more-text]").textContent });
  return { w, $, show, gps, visible, more };
}

test("con tres o más avisos quedan dos a la vista, por prioridad, y el resto en +N avisos", () => {
  const { w, show, gps, visible, more } = browser();
  show("offroute", "clearance", "ai-alert");
  gps("warn");

  w.RouteGuidance.layoutAlerts();

  assert.deepEqual(visible(), ["IA", "Gálibo"], "bloqueo de la IA y gálibo antes que fuera de ruta y GPS");
  assert.deepEqual(more(), { hidden: false, text: "+2 avisos" });
});

test("tocar +N despliega todos, oculta el panel mientras se leen y vuelve a replegar", () => {
  const { w, $, show, visible, more } = browser();
  show("offroute", "clearance", "ai-alert");
  w.RouteGuidance.layoutAlerts();

  w.RouteGuidance.toggleAlerts();
  assert.deepEqual(visible(), ["IA", "Gálibo", "Fuera de la ruta"]);
  assert.deepEqual(more(), { hidden: false, text: "Ocultar avisos" });
  assert.equal($("[data-hud-more]").getAttribute("aria-expanded"), "true");
  assert.ok($(".nav-screen").classList.contains("alerts-expanded"));

  w.RouteGuidance.toggleAlerts();
  assert.deepEqual(visible(), ["IA", "Gálibo"]);
  assert.equal(more().text, "+1 aviso");
  assert.ok(!$(".nav-screen").classList.contains("alerts-expanded"));
});

test("con dos avisos o menos no hay fila +N, y al bajar de tres se repliega solo", () => {
  const { w, $, show, gps, visible, more } = browser();
  show("offroute", "clearance", "ai-alert");
  w.RouteGuidance.layoutAlerts();
  w.RouteGuidance.toggleAlerts();

  $("[data-nav-offroute]").hidden = true;
  gps("ok", "Transmitiendo");   // transmitiendo no es un aviso
  w.RouteGuidance.layoutAlerts();

  assert.deepEqual(visible(), ["IA", "Gálibo"]);
  assert.equal(more().hidden, true);
  assert.ok(!$(".nav-screen").classList.contains("alerts-expanded"));
});

test("la ruta alternativa apta (confirmación) cede ante fuera de ruta; la ruta con restricciones no", () => {
  const { w, $, show, visible } = browser();
  show("route-notice", "offroute", "clearance");
  $("[data-nav-route-notice]").classList.add("is-ok");
  w.RouteGuidance.layoutAlerts();
  assert.deepEqual(visible(), ["Gálibo", "Fuera de la ruta"]);

  $("[data-nav-route-notice]").classList.remove("is-ok");
  w.RouteGuidance.layoutAlerts();
  assert.deepEqual(visible(), ["Gálibo", "Ruta"], "la restricción próxima antes que el aviso general de la ruta");
});

test("si la tarjeta llega al panel de velocidad, oculta altura/peso y pasa el panel a una fila, conservando dos avisos", () => {
  const { w, $, show, visible, more } = browser();
  show("ai-alert", "clearance");
  const card = $(".hud-card");
  const panel = $(".hud-panel");
  Object.defineProperty(panel, "offsetHeight", { value: 320 });
  panel.getBoundingClientRect = () => ({ top: panel.classList.contains("is-row") ? 560 : 430, left: 300, right: 372 });
  card.getBoundingClientRect = () => {
    const rows = Array.from(card.querySelectorAll("[data-hud-alert]")).filter((el) => !el.hidden && !el.classList.contains("is-overflow") && el.textContent).length;
    return { top: 100, left: 16, right: 374, bottom: 240 + ($(".hud-meta").hidden ? 0 : 70) + rows * 110 };
  };

  w.RouteGuidance.layoutAlerts();

  assert.equal($(".hud-meta").hidden, true);
  assert.ok(panel.classList.contains("is-row"));
  assert.deepEqual(visible(), ["IA", "Gálibo"]);
  assert.equal(more().hidden, true);
});

test("si no cabe ni con el panel en fila, deja un solo aviso: el de mayor prioridad", () => {
  const { w, $, show, visible, more } = browser();
  show("ai-alert", "clearance");
  const card = $(".hud-card");
  const panel = $(".hud-panel");
  // Geometría de un teléfono de 390×844: el panel empieza en y=430; cada fila visible mide 110 px y la de
  // altura/peso 70 px, sobre una cabecera que termina en y=240.
  Object.defineProperty(panel, "offsetHeight", { value: 320 });
  // En fila, el panel empieza en y=450: dos avisos (hasta y=460) aún no caben.
  panel.getBoundingClientRect = () => ({ top: panel.classList.contains("is-row") ? 450 : 430, left: 300, right: 372 });
  card.getBoundingClientRect = () => {
    const rows = Array.from(card.querySelectorAll("[data-hud-alert]")).filter((el) => !el.hidden && !el.classList.contains("is-overflow") && el.textContent).length;
    const moreRow = card.querySelector("[data-hud-more]").hidden ? 0 : 44;
    return { top: 100, left: 16, right: 374, bottom: 240 + ($(".hud-meta").hidden ? 0 : 70) + rows * 110 + moreRow };
  };

  w.RouteGuidance.layoutAlerts();

  assert.equal($(".hud-meta").hidden, true, "primero se oculta altura/peso");
  assert.ok(panel.classList.contains("is-row"), "después el panel pasa a una fila al pie");
  assert.deepEqual(visible(), ["IA"], "y si aún no cabe, un solo aviso: el de mayor prioridad");
  assert.deepEqual(more(), { hidden: false, text: "+1 aviso" });
  assert.ok(card.getBoundingClientRect().bottom + 8 <= 450);

  $("[data-nav-clearance]").hidden = true;
  $("[data-nav-ai-alert]").hidden = true;
  w.RouteGuidance.layoutAlerts();
  assert.equal($(".hud-meta").hidden, false, "sin avisos vuelve la fila de altura y peso");
  assert.ok(!panel.classList.contains("is-row"), "y el panel vertical");
});

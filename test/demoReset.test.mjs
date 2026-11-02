// Script de datos de la demo local (scripts/demo/reset-demo.mjs): sus comprobaciones de seguridad y el SQL acotado.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { assertLocalGateway, assertLocalContainer, validateState, driverDiff, loadDiff, loadSql } from "../scripts/demo/reset-demo.mjs";

const state = () => JSON.parse(readFileSync("scripts/demo/demo-state.json", "utf8"));

test("solo corre contra el gateway local", () => {
  assert.doesNotThrow(() => assertLocalGateway("http://localhost:8000"));
  assert.doesNotThrow(() => assertLocalGateway("http://127.0.0.1:8000"));
  assert.throws(() => assertLocalGateway("https://truckcar.example.com"), /localhost/);
  assert.throws(() => assertLocalGateway("http://10.0.0.5:8000"), /localhost/);
});

test("solo acepta los contenedores del compose local de esta carpeta", () => {
  const ok = { "com.docker.compose.project": "truckcar", "com.docker.compose.project.working_dir": "/srv/swnt" };
  assert.doesNotThrow(() => assertLocalContainer("truckcar-redis", ok, "/srv/swnt"));
  assert.throws(() => assertLocalContainer("truckcar-redis", { ...ok, "com.docker.compose.project": "otro" }, "/srv/swnt"), /compose/);
  assert.throws(() => assertLocalContainer("truckcar-redis", ok, "/srv/otra-carpeta"), /compose/);
  assert.throws(() => assertLocalContainer("truckcar-redis", {}, "/srv/swnt"), /compose/);
});

test("el estado canónico solo nombra ids de demo; un id ajeno o con comillas se rechaza", () => {
  assert.doesNotThrow(() => validateState(state()));
  const bad = state();
  bad.mockDriverIds.push("abc27ef4-1e64-4b94-809a-9605ddc3d2e5");
  assert.throws(() => validateState(bad), /drv-e2e/);
  const injected = state();
  injected.load.driverName = "Carlos'; DROP TABLE x; --";
  assert.throws(() => validateState(injected), /formato/);
});

test("el SQL toca solo la carga de demo, por id exacto y en una transacción", () => {
  const sql = loadSql(state().load);
  assert.match(sql, /^BEGIN;/);
  assert.match(sql, /COMMIT;\s*$/);
  assert.match(sql, /WHERE id = 88;/);
  assert.match(sql, /DELETE FROM load_allocation\.freight_load_pod_media WHERE load_id = 88;/);
  assert.doesNotMatch(sql, /DROP|TRUNCATE|FLUSH/i);
  assert.equal((sql.match(/WHERE/g) || []).length, 2, "cada sentencia lleva su WHERE");
});

test("el plan solo propone cambios cuando el dato real difiere del canónico", () => {
  const { load, drivers } = state();
  const carlos = drivers[0].state;
  assert.deepEqual(driverDiff(carlos, { ...carlos, grossWeightTons: 40 }), []);
  assert.deepEqual(driverDiff(carlos, { ...carlos, vehiclePlate: "XYZ-123" }), ["vehiclePlate"]);
  assert.deepEqual(driverDiff(carlos, null), ["(no registrado)"]);
  const row = { status: "IN_TRANSIT", assigned_driver_id: load.driverId, assigned_vehicle_plate: load.vehiclePlate };
  assert.deepEqual(loadDiff(load, row, []), []);
  assert.match(loadDiff(load, { ...row, status: "DELIVERED", delivered_at: "2026-11-01" }, [{}]).join(" "), /DELIVERED → IN_TRANSIT.*entrega.*1 evidencia/);
});

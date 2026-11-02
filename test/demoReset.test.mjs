// Script de datos de la demo local (scripts/demo/reset-demo.mjs): sus comprobaciones de seguridad y el SQL acotado.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { assertLocalGateway, assertLocalContainer, validateState, driverDiff, loadDiff, chronologyOk, loadSql, plateSql, transactionSql } from "../scripts/demo/reset-demo.mjs";

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

test("las horas de la carga van en la zona de Load-Allocation y una salida en el futuro se repara", () => {
  const { load } = state();
  const sql = loadSql(load, "America/Bogota");
  assert.match(sql, /now\(\) AT TIME ZONE 'America\/Bogota'/);
  assert.doesNotMatch(sql.replace(/now\(\) AT TIME ZONE '[^']+'/g, ""), /now\(\)/, "ninguna hora en la zona de Postgres (UTC)");
  assert.throws(() => loadSql(load, "UTC'; DROP TABLE x; --"), /Zona horaria/);
  const row = { status: "IN_TRANSIT", assigned_driver_id: load.driverId, assigned_vehicle_plate: load.vehiclePlate };
  assert.deepEqual(loadDiff(load, { ...row, trip_started_at: "2026-11-01T21:40:00" }, [], "2026-11-01T22:40:00"), []);
  assert.match(loadDiff(load, { ...row, trip_started_at: "2026-11-02T02:19:16" }, [], "2026-11-01T22:40:00").join(" "), /futuro/);
});

test("la cronología del seguimiento público queda en orden: publicado, asignado, en ruta", () => {
  const { load } = state();
  const row = { status: "IN_TRANSIT", assigned_driver_id: load.driverId, assigned_vehicle_plate: load.vehiclePlate };
  const ordered = { published_at: "2026-11-01T10:00:00", assigned_at: "2026-11-01T11:00:00", trip_started_at: "2026-11-01T13:00:00" };
  assert.equal(chronologyOk(ordered), true);
  assert.deepEqual(loadDiff(load, { ...row, ...ordered }, [], "2026-11-01T22:40:00"), []);
  // El caso real de la demo: "Conductor asignado 2:46 p. m." antes de "Envío publicado 4:45 p. m.".
  const broken = { published_at: "2026-11-01T16:45:50", assigned_at: "2026-11-01T14:46:00", trip_started_at: "2026-11-01T21:40:32" };
  assert.equal(chronologyOk(broken), false);
  assert.match(loadDiff(load, { ...row, ...broken }, [], "2026-11-02T06:17:00").join(" "), /cronología/);
  const sql = loadSql(load, "America/Bogota");
  assert.match(sql, /published_at <= assigned_at AND assigned_at <= trip_started_at/);
  assert.match(sql, /published_at = CASE [\s\S]*? LEAST\(published_at,/);
  assert.equal((sql.match(/WHERE/g) || []).length, 2, "sigue con un WHERE por sentencia");
});

test("la corrección de placa toca solo al conductor de demo y su placa vieja, en la misma transacción que la carga", () => {
  const st = state();
  const c = st.plateCorrections[0];
  const sql = plateSql([c]);
  assert.match(sql, /UPDATE fleet_allocation\.allocation_decisions SET selected_vehicle_plate = 'TKR-527'\s+WHERE selected_driver_id = '207a8e39-990e-48da-9b85-10178c83a8cb' AND selected_vehicle_plate = 'TDK-410';/);
  assert.match(sql, /UPDATE load_allocation\.freight_loads SET assigned_vehicle_plate = 'TKR-527'\s+WHERE assigned_driver_id = '207a8e39-990e-48da-9b85-10178c83a8cb' AND assigned_vehicle_plate = 'TDK-410';/);
  const tx = transactionSql({ load: st.load, corrections: [c] });
  assert.equal((tx.match(/BEGIN;/g) || []).length, 1);
  assert.equal((tx.match(/COMMIT;/g) || []).length, 1);
  assert.match(tx, /WHERE id = 88;[\s\S]*allocation_decisions/);

  const foreign = state();
  foreign.plateCorrections[0].driverId = "11111111-2222-3333-4444-555555555555";
  assert.throws(() => validateState(foreign), /conductores de demo/);
});

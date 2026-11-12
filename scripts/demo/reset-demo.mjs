import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const COMPOSE_ROOT = resolve(HERE, "../../..");
const COMPOSE_PROJECT = "truckcar";
const CONTAINERS = { redis: "truckcar-redis", postgres: "truckcar-postgis", loads: "truckcar-load-allocation", kafka: "truckcar-kafka" };
const LOAD_EVENTS_TOPIC = "truckcar.events.load-allocation";
const REDIS_PREFIX = "driver_vehicle_state";
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

export function assertLocalGateway(url) {
  let host;
  try { host = new URL(url).hostname; } catch (e) { throw new Error("URL del gateway no válida: " + url); }
  if (!LOCAL_HOSTS.has(host)) throw new Error("Solo para la demo local: el gateway debe ser localhost (es " + host + ")");
}

export function assertLocalContainer(name, labels, composeRoot) {
  const project = labels["com.docker.compose.project"];
  const workdir = labels["com.docker.compose.project.working_dir"];
  if (project !== COMPOSE_PROJECT) throw new Error(`${name} no es del compose "${COMPOSE_PROJECT}" (es "${project}")`);
  if (!workdir || resolve(workdir).toLowerCase() !== resolve(composeRoot).toLowerCase()) {
    throw new Error(`${name} no es del compose de ${composeRoot} (es ${workdir})`);
  }
}

const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const MOCK_ID = /^drv-e2e-[1-3]$/;
const PLATE = /^[A-Z0-9]{2,4}-?[0-9A-Z]{2,4}$/;
const NAME = /^[\p{L} ]{2,60}$/u;
const DRIVER_STATUS = new Set(["ACTIVO", "INACTIVO"]);

export function validateState(state) {
  if (!Number.isInteger(state.load.id)) throw new Error("load.id debe ser un entero");
  if (!ID.test(state.load.driverId) || !PLATE.test(state.load.vehiclePlate) || !NAME.test(state.load.driverName)) {
    throw new Error("Datos de la carga con formato inesperado");
  }
  if (!state.mockDriverIds.every((id) => MOCK_ID.test(id))) throw new Error("Solo se pueden borrar drv-e2e-1..3");
  state.drivers.forEach((d) => {
    if (!ID.test(d.state.driverId) || !PLATE.test(d.state.vehiclePlate)) throw new Error("Conductor con formato inesperado: " + d.key);
  });
  const demoIds = new Set(state.drivers.map((d) => d.state.driverId));
  state.drivers.forEach((d) => {
    if (!DRIVER_STATUS.has(d.state.status)) throw new Error("Estado no reconocido por el motor: " + d.state.status + " (" + d.key + ")");
  });
  if (state.pendingLoad) {
    if (!Number.isInteger(state.pendingLoad.id) || state.pendingLoad.id === state.load.id) throw new Error("pendingLoad.id debe ser un entero distinto de la carga en tránsito");
    if (!demoIds.has(state.pendingLoad.expectDriverId)) throw new Error("pendingLoad debe esperar a un conductor de demo");
  }
  const stale = (state.staleCancelledLoads && state.staleCancelledLoads.ids) || [];
  if (!stale.every(Number.isInteger) || stale.includes(state.load.id) || (state.pendingLoad && stale.includes(state.pendingLoad.id))) {
    throw new Error("staleCancelledLoads.ids: enteros, sin la carga en tránsito ni la pendiente");
  }
  (state.plateCorrections || []).forEach((c) => {
    if (!demoIds.has(c.driverId)) throw new Error("La corrección de placa solo puede tocar conductores de demo");
    if (!PLATE.test(c.from) || !PLATE.test(c.to) || c.from === c.to) throw new Error("Placas de la corrección con formato inesperado");
  });
  return state;
}

export function driverDiff(canonical, current) {
  if (!current) return ["(no registrado)"];
  const same = (a, b) => (a == null && b == null) || JSON.stringify(a) === JSON.stringify(b)
    || (typeof a === "number" && typeof b === "number" && Math.abs(a - b) < 1e-9);
  return Object.keys(canonical).filter((k) => !same(canonical[k], current[k]));
}

export function loadDiff(target, row, podRows, nowLocal = null) {
  if (!row) return ["(la carga no existe)"];
  const diff = [];
  if (nowLocal && row.trip_started_at && row.trip_started_at > nowLocal) diff.push("hora de salida en el futuro → hace 1 h");
  else if (!chronologyOk(row)) diff.push("cronología incoherente → publicado hace 4 h o antes, asignado hace 3 h, en ruta hace 1 h");
  if (row.status !== target.status) diff.push(`status ${row.status} → ${target.status}`);
  if (row.assigned_driver_id !== target.driverId) diff.push(`conductor ${row.assigned_driver_id} → ${target.driverId}`);
  if (row.assigned_vehicle_plate !== target.vehiclePlate) diff.push(`placa ${row.assigned_vehicle_plate} → ${target.vehiclePlate}`);
  if (row.delivered_at || row.pod_receiver_name || row.pod_has_photo || row.pod_has_signature) diff.push("datos de entrega → vacíos");
  if (row.cancelled_at) diff.push("cancelación → vacía");
  if (podRows.length) diff.push(`${podRows.length} evidencia(s) POD → borradas`);
  return diff;
}

export function chronologyOk(row) {
  const { published_at: p, assigned_at: a, trip_started_at: t } = row;
  if (!p || !a || !t) return true;
  return p <= a && a <= t;
}

export function pendingLoadDiff(row, discarded) {
  if (!row) return ["(la carga no existe)"];
  const diff = [];
  if (row.status !== "AVAILABLE") diff.push(`status ${row.status} → AVAILABLE`);
  if (row.assignment_status && row.assignment_status !== "UNASSIGNED_NO_DRIVERS") diff.push(`propuesta ${row.assignment_status} → ninguna`);
  if (row.assigned_driver_id || row.assigned_driver_name) diff.push(`conductor ${row.assigned_driver_name || row.assigned_driver_id} → ninguno`);
  if (row.delivered_at || row.cancelled_at) diff.push("entrega o cancelación → vacías");
  if (row.assignment_attempts) diff.push(`intentos ${row.assignment_attempts} → 0`);
  if (discarded.length) diff.push(`${discarded.length} conductor(es) descartado(s) → ninguno`);
  return diff;
}

export function pendingLoadSql(id) {
  if (!Number.isInteger(id)) throw new Error("id de carga no válido");
  return `UPDATE load_allocation.freight_loads SET
  status = 'AVAILABLE', assignment_status = NULL, assignment_status_changed_at = NULL, assignment_attempts = 0,
  assigned_driver_id = NULL, assigned_driver_name = NULL, assigned_vehicle_plate = NULL, assigned_at = NULL,
  trip_started_at = NULL, delivered_at = NULL, pod_notes = NULL, pod_receiver_document = NULL, pod_receiver_name = NULL,
  pod_has_photo = NULL, pod_has_signature = NULL, cancellation_reason = NULL, cancelled_at = NULL, cancelled_by = NULL,
  version = COALESCE(version, 0) + 1
WHERE id = ${id};
DELETE FROM load_allocation.freight_load_discarded_drivers WHERE load_id = ${id};
DELETE FROM load_allocation.freight_load_pod_media WHERE load_id = ${id};
`;
}

export function staleCancelledSql(ids) {
  if (!ids.length) return "";
  if (!ids.every(Number.isInteger)) throw new Error("ids de cargas no válidos");
  return `UPDATE load_allocation.freight_loads SET assignment_status = NULL, assignment_status_changed_at = NULL,
  version = COALESCE(version, 0) + 1
WHERE id IN (${ids.join(", ")}) AND status = 'CANCELLED' AND assignment_status IN ('PROPOSED', 'NOTIFIED');
`;
}

export function tripStartedEvent(load, eventId, occurredAt) {
  return {
    eventId, eventType: "trip.started", occurredAt, version: 1, producer: "demo-reset",
    payload: { loadId: load.id, assignedDriverId: load.driverId, assignedDriverName: load.driverName,
      assignedVehiclePlate: load.vehiclePlate, loadStatus: load.status }
  };
}

const TIME_ZONE = /^[A-Za-z]+(\/[A-Za-z_]+)+$/;

export function plateSql(corrections) {
  const q = (v) => "'" + String(v).replace(/'/g, "''") + "'";
  return corrections.map((c) => `UPDATE fleet_allocation.allocation_decisions SET selected_vehicle_plate = ${q(c.to)}
WHERE selected_driver_id = ${q(c.driverId)} AND selected_vehicle_plate = ${q(c.from)};
UPDATE load_allocation.freight_loads SET assigned_vehicle_plate = ${q(c.to)}
WHERE assigned_driver_id = ${q(c.driverId)} AND assigned_vehicle_plate = ${q(c.from)};
`).join("");
}

export function transactionSql({ load = null, timeZone = "America/Bogota", corrections = [], pendingLoadId = null, staleIds = [] }) {
  const body = (load ? loadSql(load, timeZone).replace(/^BEGIN;\n/, "").replace(/COMMIT;\n$/, "") : "")
    + (pendingLoadId != null ? pendingLoadSql(pendingLoadId) : "") + staleCancelledSql(staleIds) + plateSql(corrections);
  return `BEGIN;\n${body}COMMIT;\n`;
}

export function loadSql(target, timeZone = "America/Bogota") {
  if (!TIME_ZONE.test(timeZone)) throw new Error("Zona horaria no válida: " + timeZone);
  const q = (v) => "'" + String(v).replace(/'/g, "''") + "'";
  const local = `(now() AT TIME ZONE ${q(timeZone)})`;
  const keep = `(status = 'IN_TRANSIT' AND assigned_at IS NOT NULL AND trip_started_at IS NOT NULL
         AND published_at <= assigned_at AND assigned_at <= trip_started_at AND trip_started_at <= ${local})`;
  return `BEGIN;
UPDATE load_allocation.freight_loads SET
  status = ${q(target.status)}, assignment_status = NULL, assignment_status_changed_at = NULL,
  assigned_driver_id = ${q(target.driverId)}, assigned_driver_name = ${q(target.driverName)},
  assigned_vehicle_plate = ${q(target.vehiclePlate)},
  published_at = CASE WHEN ${keep} THEN published_at ELSE LEAST(published_at, ${local} - interval '4 hours') END,
  assigned_at = CASE WHEN ${keep} THEN assigned_at ELSE ${local} - interval '3 hours' END,
  trip_started_at = CASE WHEN ${keep} THEN trip_started_at ELSE ${local} - interval '1 hour' END,
  delivered_at = NULL, pod_notes = NULL, pod_receiver_document = NULL, pod_receiver_name = NULL,
  pod_has_photo = NULL, pod_has_signature = NULL, cancellation_reason = NULL, cancelled_at = NULL, cancelled_by = NULL,
  version = COALESCE(version, 0) + 1
WHERE id = ${target.id};
DELETE FROM load_allocation.freight_load_pod_media WHERE load_id = ${target.id};
COMMIT;
`;
}

const docker = (args, input) => execFileSync("docker", args, { encoding: "utf8", input, stdio: ["pipe", "pipe", "pipe"] });

function containerLabels(name) {
  return JSON.parse(docker(["inspect", name, "--format", "{{json .Config.Labels}}"]));
}

function redis(...args) {
  return docker(["exec", CONTAINERS.redis, "redis-cli", "--raw", ...args]).replace(/\r/g, "");
}

function redisHash(key) {
  const lines = redis("HGETALL", key).split("\n").filter((l, i, a) => i < a.length - 1 || l !== "");
  const out = {};
  for (let i = 0; i + 1 < lines.length; i += 2) out[lines[i]] = lines[i + 1];
  return out;
}

function sqlJson(pg, query) {
  const out = docker(["exec", CONTAINERS.postgres, "psql", "-U", pg.user, "-d", pg.db, "-tA", "-v", "ON_ERROR_STOP=1", "-c", query]).trim();
  return out ? JSON.parse(out) : null;
}

async function api(gateway, path, { token, method = "GET", body } = {}) {
  const res = await fetch(gateway + "/api/v1" + path, {
    method,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: "Bearer " + token } : {}) },
    body: body ? JSON.stringify(body) : undefined
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${text.slice(0, 160)}`);
  return text ? JSON.parse(text) : null;
}

const login = async (gateway, email, password) => (await api(gateway, "/auth/login", { method: "POST", body: { email, password } })).accessToken;

async function main() {
  const apply = process.argv.includes("--apply");
  const gateway = (process.env.TRUCKCAR_GATEWAY_URL || "http://localhost:8000").replace(/\/+$/, "");
  const password = process.env.TRUCKCAR_DEMO_PASSWORD;
  const state = validateState(JSON.parse(readFileSync(join(HERE, "demo-state.json"), "utf8")));

  assertLocalGateway(gateway);
  Object.values(CONTAINERS).forEach((name) => assertLocalContainer(name, containerLabels(name), COMPOSE_ROOT));
  if (!password) throw new Error("Falta TRUCKCAR_DEMO_PASSWORD (la contraseña de los usuarios de demo).");
  const pg = {
    user: docker(["exec", CONTAINERS.postgres, "printenv", "POSTGRES_USER"]).trim(),
    db: docker(["exec", CONTAINERS.postgres, "printenv", "POSTGRES_DB"]).trim()
  };
  let timeZone = "America/Bogota";
  try { timeZone = docker(["exec", CONTAINERS.loads, "printenv", "TZ"]).trim() || timeZone; } catch (e) { }
  const nowLocal = sqlJson(pg, `SELECT to_json(now() AT TIME ZONE '${timeZone.replace(/'/g, "")}')`);

  const token = await login(gateway, state.coordinatorEmail, password);
  const mocks = state.mockDriverIds.map((id) => {
    const hash = redisHash(`${REDIS_PREFIX}:${id}`);
    const inSet = redis("SISMEMBER", REDIS_PREFIX, id).trim() === "1";
    return { id, hash, inSet, present: Object.keys(hash).length > 0 || inSet };
  });
  const loadRow = sqlJson(pg, `SELECT row_to_json(f) FROM load_allocation.freight_loads f WHERE id = ${state.load.id}`);
  const podRows = sqlJson(pg, `SELECT COALESCE(json_agg(p), '[]'::json) FROM load_allocation.freight_load_pod_media p WHERE load_id = ${state.load.id}`) || [];
  const plateRows = (state.plateCorrections || []).map((c) => ({
    ...c,
    decisions: sqlJson(pg, `SELECT COALESCE(json_agg(d), '[]'::json) FROM fleet_allocation.allocation_decisions d WHERE selected_driver_id = '${c.driverId}' AND selected_vehicle_plate = '${c.from}'`) || [],
    loads: sqlJson(pg, `SELECT COALESCE(json_agg(json_build_object('id', f.id, 'assigned_vehicle_plate', f.assigned_vehicle_plate)), '[]'::json) FROM load_allocation.freight_loads f WHERE assigned_driver_id = '${c.driverId}' AND assigned_vehicle_plate = '${c.from}'`) || []
  }));
  const plateFixes = plateRows.filter((p) => p.decisions.length || p.loads.length);
  const pending = state.pendingLoad;
  const pendingRow = pending ? sqlJson(pg, `SELECT row_to_json(f) FROM load_allocation.freight_loads f WHERE id = ${pending.id}`) : null;
  const pendingDiscarded = pending ? sqlJson(pg, `SELECT COALESCE(json_agg(d), '[]'::json) FROM load_allocation.freight_load_discarded_drivers d WHERE load_id = ${pending.id}`) || [] : [];
  const staleIds = (state.staleCancelledLoads && state.staleCancelledLoads.ids) || [];
  const staleRows = staleIds.length ? sqlJson(pg, `SELECT COALESCE(json_agg(json_build_object('id', id, 'status', status, 'assignment_status', assignment_status, 'assignment_status_changed_at', assignment_status_changed_at)), '[]'::json) FROM load_allocation.freight_loads WHERE id IN (${staleIds.join(", ")}) AND status = 'CANCELLED' AND assignment_status IN ('PROPOSED', 'NOTIFIED')`) || [] : [];
  const drivers = [];
  for (const d of state.drivers) {
    let current = null;
    try { current = await api(gateway, "/fleets-drivers/drivers/" + d.state.driverId, { token }); } catch (e) { }
    drivers.push({ ...d, current, diff: driverDiff(d.state, current) });
  }

  const plan = [];
  mocks.filter((m) => m.present).forEach((m) => plan.push(`Redis: borrar ${m.id} (placa ${m.hash.vehiclePlate || "—"}) y sus índices`));
  const ld = loadDiff(state.load, loadRow, podRows, nowLocal);
  if (ld.length) plan.push(`SQL: carga ${state.load.id}: ${ld.join("; ")}`);
  const pd = pending ? pendingLoadDiff(pendingRow, pendingDiscarded) : [];
  if (pd.length) plan.push(`SQL: carga pendiente ${pending.id}: ${pd.join("; ")}`);
  if (staleRows.length) plan.push(`SQL: canceladas con propuesta vieja → sin propuesta: ${staleRows.map((r) => `${r.id} (${r.assignment_status})`).join(", ")}`);
  plateFixes.forEach((p) => plan.push(`SQL: placa ${p.from} → ${p.to} del conductor ${p.driverId}: ${p.decisions.length} decisión(es) del motor y ${p.loads.length} carga(s)`));
  drivers.filter((d) => d.diff.length).forEach((d) => plan.push(`API: ${d.state.driverName}: ${d.diff.join(", ")}`));
  const loadDriver = drivers.find((d) => d.state.driverId === state.load.driverId);
  const fleetKnowsTrip = loadDriver && loadDriver.current && loadDriver.current.currentLoadId === state.load.id
    && loadDriver.current.currentLoadStatus === state.load.status;
  if (!fleetKnowsTrip) plan.push(`Kafka: trip.started de la carga ${state.load.id} para que fleets-drivers sepa que ${state.load.driverName} va en ruta`);

  console.log(`Demo local · gateway ${gateway} · compose ${COMPOSE_ROOT}`);
  console.log(plan.length ? "Cambios:\n  - " + plan.join("\n  - ") : "Nada que cambiar: la demo ya está en el estado conocido.");
  if (!apply) {
    console.log("\nDry-run: no se modificó nada. Ejecute con --apply para aplicar.");
    return;
  }

  if (plan.length) {
    const dir = join(HERE, "backups", new Date().toISOString().replace(/[:.]/g, "-"));
    mkdirSync(dir, { recursive: true });
    const plateSets = {};
    mocks.forEach((m) => {
      if (m.hash.vehiclePlate) plateSets[m.hash.vehiclePlate] = redis("SMEMBERS", `${REDIS_PREFIX}:vehiclePlate:${m.hash.vehiclePlate}`).trim().split("\n").filter(Boolean);
    });
    writeFileSync(join(dir, "redis.json"), JSON.stringify({
      mainSet: redis("SMEMBERS", REDIS_PREFIX).trim().split("\n").filter(Boolean),
      mocks: mocks.map((m) => ({ ...m, idx: redis("SMEMBERS", `${REDIS_PREFIX}:${m.id}:idx`).trim().split("\n").filter(Boolean) })),
      plateSets,
      drivers: drivers.map((d) => ({ id: d.state.driverId, hash: redisHash(`${REDIS_PREFIX}:${d.state.driverId}`) }))
    }, null, 2));
    writeFileSync(join(dir, "sql.json"), JSON.stringify({ load: loadRow, podMedia: podRows, plateCorrections: plateFixes,
      pendingLoad: pendingRow, pendingLoadDiscardedDrivers: pendingDiscarded, staleCancelledLoads: staleRows }, null, 2));
    console.log("\nRespaldo: " + dir);

    for (const m of mocks.filter((x) => x.present)) {
      redis("DEL", `${REDIS_PREFIX}:${m.id}`, `${REDIS_PREFIX}:${m.id}:idx`);
      redis("SREM", REDIS_PREFIX, m.id);
      if (m.hash.vehiclePlate) redis("SREM", `${REDIS_PREFIX}:vehiclePlate:${m.hash.vehiclePlate}`, m.id);
    }
    if (ld.length || plateFixes.length || pd.length || staleRows.length) {
      docker(["exec", "-i", CONTAINERS.postgres, "psql", "-U", pg.user, "-d", pg.db, "-v", "ON_ERROR_STOP=1", "-q"],
        transactionSql({ load: ld.length ? state.load : null, timeZone, corrections: plateFixes,
          pendingLoadId: pd.length ? pending.id : null, staleIds: staleRows.map((r) => r.id) }));
    }
    for (const d of drivers.filter((x) => x.diff.length)) {
      await api(gateway, "/fleets-drivers/state", { token, method: "POST", body: d.state });
    }
    if (!fleetKnowsTrip) {
      const event = tripStartedEvent(state.load, randomUUID(), new Date().toISOString());
      docker(["exec", "-i", CONTAINERS.kafka, "/opt/kafka/bin/kafka-console-producer.sh", "--bootstrap-server", "localhost:9092",
        "--topic", LOAD_EVENTS_TOPIC, "--property", "parse.key=true", "--property", "key.separator=|"],
        `${state.load.id}|${JSON.stringify(event)}\n`);
      for (let i = 0; i < 20; i++) {
        const now = await api(gateway, "/fleets-drivers/drivers/" + state.load.driverId, { token });
        if (now.currentLoadId === state.load.id) break;
        await new Promise((r) => setTimeout(r, 500));
      }
    }
  }

  const checks = [];
  const active = await api(gateway, "/fleets-drivers/active", { token });
  const mockLeft = active.filter((d) => /^drv-e2e-/.test(d.driverId)).length;
  checks.push([mockLeft === 0, `Conductores Mock: ${mockLeft}`]);
  for (const d of state.drivers) {
    const now = await api(gateway, "/fleets-drivers/drivers/" + d.state.driverId, { token });
    checks.push([now.vehiclePlate === d.state.vehiclePlate && now.status === d.state.status,
      `${d.state.driverName}: placa ${now.vehiclePlate}, ${now.status}, posición ${now.currentLatitude}, ${now.currentLongitude}`]);
    if (d.state.driverId === state.load.driverId) {
      checks.push([now.currentLoadId === state.load.id && now.currentLoadStatus === state.load.status,
        `${d.state.driverName}: fleets-drivers lo ve en ruta con la carga ${now.currentLoadId} (${now.currentLoadStatus})`]);
    }
    if (d.email) {
      const loads = await api(gateway, "/loads/mine", { token: await login(gateway, d.email, password) });
      const open = loads.filter((l) => ["ASSIGNED", "IN_TRANSIT"].includes(l.status) || ["PROPOSED", "NOTIFIED"].includes(l.assignmentStatus));
      const ok = d.key === "carlos"
        ? open.length === 1 && open[0].id === state.load.id && open[0].status === "IN_TRANSIT"
        : open.length === 0;
      checks.push([ok, `${d.state.driverName}: ${open.length ? open.map((l) => `carga ${l.id} ${l.status}`).join(", ") : "sin carga"} (esperado: ${d.expect})`]);
    }
  }
  for (const c of state.plateCorrections || []) {
    const left = sqlJson(pg, `SELECT to_json((SELECT count(*) FROM fleet_allocation.allocation_decisions WHERE selected_driver_id = '${c.driverId}' AND selected_vehicle_plate = '${c.from}') + (SELECT count(*) FROM load_allocation.freight_loads WHERE assigned_driver_id = '${c.driverId}' AND assigned_vehicle_plate = '${c.from}'))`);
    checks.push([Number(left) === 0, `Placa ${c.from} en lo guardado de ${c.driverId}: ${left}`]);
  }
  const after = sqlJson(pg, `SELECT row_to_json(f) FROM (SELECT published_at, assigned_at, trip_started_at FROM load_allocation.freight_loads WHERE id = ${state.load.id}) f`);
  checks.push([!!after && chronologyOk(after) && !!after.assigned_at && !!after.trip_started_at,
    `Carga ${state.load.id} en orden: publicada ${after && after.published_at}, asignada ${after && after.assigned_at}, en ruta ${after && after.trip_started_at}`]);
  if (pending) {
    const row = sqlJson(pg, `SELECT row_to_json(f) FROM (SELECT status, assignment_status, assigned_driver_id FROM load_allocation.freight_loads WHERE id = ${pending.id}) f`);
    const discardedLeft = sqlJson(pg, `SELECT to_json(count(*)) FROM load_allocation.freight_load_discarded_drivers WHERE load_id = ${pending.id}`);
    const ok = row && row.status === "AVAILABLE" && Number(discardedLeft) === 0
      && (!row.assignment_status || row.assignment_status === "UNASSIGNED_NO_DRIVERS" || row.assigned_driver_id === pending.expectDriverId);
    checks.push([ok, `Carga ${pending.id} en espera para el motor: ${row && row.status}, ${(row && row.assignment_status) || "sin propuesta"}, ${discardedLeft} descartado(s)`]);
  }
  if (staleIds.length) {
    const left = sqlJson(pg, `SELECT to_json(count(*)) FROM load_allocation.freight_loads WHERE id IN (${staleIds.join(", ")}) AND status = 'CANCELLED' AND assignment_status IN ('PROPOSED', 'NOTIFIED')`);
    checks.push([Number(left) === 0, `Canceladas de demo con propuesta vieja: ${left}`]);
  }
  const plates = new Set(active.map((d) => d.vehiclePlate));
  checks.push([plates.size === active.length, `Placas únicas en la flota: ${plates.size} de ${active.length}`]);
  console.log("\nVerificación:");
  checks.forEach(([ok, text]) => console.log(`  ${ok ? "✓" : "✗"} ${text}`));
  if (checks.some(([ok]) => !ok)) process.exitCode = 1;
  if (pending) console.log(`\nEl motor reintenta las cargas en espera cada 2 min: en ese plazo la Torre muestra la carga ${pending.id} propuesta con su puntaje.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error("✗ " + error.message);
    process.exit(1);
  });
}

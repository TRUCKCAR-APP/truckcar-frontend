// Deja la demo LOCAL de TruckCar en un estado conocido (scripts/demo/demo-state.json):
//   - Carlos en tránsito con la carga 88, Diana sin carga, Ana con su placa propia, cada uno en su posición inicial.
//   - Sin los conductores de prueba "Mock drv-e2e-1..3".
//
// Uso:  TRUCKCAR_DEMO_PASSWORD=… node scripts/demo/reset-demo.mjs            (dry-run: solo muestra qué cambiaría)
//       TRUCKCAR_DEMO_PASSWORD=… node scripts/demo/reset-demo.mjs --apply    (respalda, aplica y verifica)
//
// Seguridad: solo corre contra el gateway de localhost y los contenedores del compose local; toca únicamente los ids de
// demo (por clave o WHERE exacto, SQL en una transacción); sin FLUSHALL, DROP ni borrados masivos; antes de modificar
// respalda Redis y SQL en scripts/demo/backups/. Modifica datos locales directamente: no es para producción.
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const COMPOSE_ROOT = resolve(HERE, "../../..");          // carpeta del docker-compose (padre de truckcar-frontend)
const COMPOSE_PROJECT = "truckcar";
const CONTAINERS = { redis: "truckcar-redis", postgres: "truckcar-postgis", loads: "truckcar-load-allocation" };
const REDIS_PREFIX = "driver_vehicle_state";
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

// ------------------------------------------------------------------ comprobaciones (puras, con pruebas)

/** El gateway debe ser local: el script nunca corre contra un despliegue. */
export function assertLocalGateway(url) {
  let host;
  try { host = new URL(url).hostname; } catch (e) { throw new Error("URL del gateway no válida: " + url); }
  if (!LOCAL_HOSTS.has(host)) throw new Error("Solo para la demo local: el gateway debe ser localhost (es " + host + ")");
}

/** Los contenedores deben ser los del compose local de esta carpeta (etiquetas de Docker Compose). */
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

/** El estado canónico solo puede nombrar ids de demo con formato estricto (también protege el SQL). */
export function validateState(state) {
  if (!Number.isInteger(state.load.id)) throw new Error("load.id debe ser un entero");
  if (!ID.test(state.load.driverId) || !PLATE.test(state.load.vehiclePlate) || !NAME.test(state.load.driverName)) {
    throw new Error("Datos de la carga con formato inesperado");
  }
  if (!state.mockDriverIds.every((id) => MOCK_ID.test(id))) throw new Error("Solo se pueden borrar drv-e2e-1..3");
  state.drivers.forEach((d) => {
    if (!ID.test(d.state.driverId) || !PLATE.test(d.state.vehiclePlate)) throw new Error("Conductor con formato inesperado: " + d.key);
  });
  return state;
}

/** Campos del estado canónico que difieren del actual (los que la API devuelve). */
export function driverDiff(canonical, current) {
  if (!current) return ["(no registrado)"];
  const same = (a, b) => (a == null && b == null) || JSON.stringify(a) === JSON.stringify(b)
    || (typeof a === "number" && typeof b === "number" && Math.abs(a - b) < 1e-9);
  return Object.keys(canonical).filter((k) => !same(canonical[k], current[k]));
}

/** La carga está como la demo la necesita: en tránsito con el conductor y sin datos de entrega. */
export function loadDiff(target, row, podRows, nowLocal = null) {
  if (!row) return ["(la carga no existe)"];
  const diff = [];
  // Load-Allocation guarda horas locales sin zona: una salida "en el futuro" es un dato roto que hay que rehacer.
  if (nowLocal && row.trip_started_at && row.trip_started_at > nowLocal) diff.push("hora de salida en el futuro → hace 1 h");
  if (row.status !== target.status) diff.push(`status ${row.status} → ${target.status}`);
  if (row.assigned_driver_id !== target.driverId) diff.push(`conductor ${row.assigned_driver_id} → ${target.driverId}`);
  if (row.assigned_vehicle_plate !== target.vehiclePlate) diff.push(`placa ${row.assigned_vehicle_plate} → ${target.vehiclePlate}`);
  if (row.delivered_at || row.pod_receiver_name || row.pod_has_photo || row.pod_has_signature) diff.push("datos de entrega → vacíos");
  if (row.cancelled_at) diff.push("cancelación → vacía");
  if (podRows.length) diff.push(`${podRows.length} evidencia(s) POD → borradas`);
  return diff;
}

const TIME_ZONE = /^[A-Za-z]+(\/[A-Za-z_]+)+$/;

/**
 * SQL de la carga: un UPDATE y un DELETE por id exacto, en una transacción. Las horas van en la zona horaria de
 * Load-Allocation (guarda horas locales sin zona), no en la de Postgres (UTC).
 */
export function loadSql(target, timeZone = "America/Bogota") {
  if (!TIME_ZONE.test(timeZone)) throw new Error("Zona horaria no válida: " + timeZone);
  const q = (v) => "'" + String(v).replace(/'/g, "''") + "'";
  const local = `(now() AT TIME ZONE ${q(timeZone)})`;
  return `BEGIN;
UPDATE load_allocation.freight_loads SET
  status = ${q(target.status)}, assignment_status = NULL, assignment_status_changed_at = NULL,
  assigned_driver_id = ${q(target.driverId)}, assigned_driver_name = ${q(target.driverName)},
  assigned_vehicle_plate = ${q(target.vehiclePlate)}, assigned_at = COALESCE(assigned_at, ${local} - interval '3 hours'),
  trip_started_at = CASE WHEN status = 'IN_TRANSIT' AND trip_started_at IS NOT NULL AND trip_started_at <= ${local}
                         THEN trip_started_at ELSE ${local} - interval '1 hour' END,
  delivered_at = NULL, pod_notes = NULL, pod_receiver_document = NULL, pod_receiver_name = NULL,
  pod_has_photo = NULL, pod_has_signature = NULL, cancellation_reason = NULL, cancelled_at = NULL, cancelled_by = NULL,
  version = COALESCE(version, 0) + 1
WHERE id = ${target.id};
DELETE FROM load_allocation.freight_load_pod_media WHERE load_id = ${target.id};
COMMIT;
`;
}

// ------------------------------------------------------------------ acceso a Docker y a la API

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

// ------------------------------------------------------------------ programa

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
  // Zona horaria con la que Load-Allocation guarda sus horas (sin zona en la base): la de su contenedor.
  let timeZone = "America/Bogota";
  try { timeZone = docker(["exec", CONTAINERS.loads, "printenv", "TZ"]).trim() || timeZone; } catch (e) { /* sin TZ: la del compose */ }
  const nowLocal = sqlJson(pg, `SELECT to_json(now() AT TIME ZONE '${timeZone.replace(/'/g, "")}')`);

  // Estado actual.
  const token = await login(gateway, state.coordinatorEmail, password);
  const mocks = state.mockDriverIds.map((id) => {
    const hash = redisHash(`${REDIS_PREFIX}:${id}`);
    const inSet = redis("SISMEMBER", REDIS_PREFIX, id).trim() === "1";
    return { id, hash, inSet, present: Object.keys(hash).length > 0 || inSet };
  });
  const loadRow = sqlJson(pg, `SELECT row_to_json(f) FROM load_allocation.freight_loads f WHERE id = ${state.load.id}`);
  const podRows = sqlJson(pg, `SELECT COALESCE(json_agg(p), '[]'::json) FROM load_allocation.freight_load_pod_media p WHERE load_id = ${state.load.id}`) || [];
  const drivers = [];
  for (const d of state.drivers) {
    let current = null;
    try { current = await api(gateway, "/fleets-drivers/drivers/" + d.state.driverId, { token }); } catch (e) { /* no registrado */ }
    drivers.push({ ...d, current, diff: driverDiff(d.state, current) });
  }

  // Plan.
  const plan = [];
  mocks.filter((m) => m.present).forEach((m) => plan.push(`Redis: borrar ${m.id} (placa ${m.hash.vehiclePlate || "—"}) y sus índices`));
  const ld = loadDiff(state.load, loadRow, podRows, nowLocal);
  if (ld.length) plan.push(`SQL: carga ${state.load.id}: ${ld.join("; ")}`);
  drivers.filter((d) => d.diff.length).forEach((d) => plan.push(`API: ${d.state.driverName}: ${d.diff.join(", ")}`));

  console.log(`Demo local · gateway ${gateway} · compose ${COMPOSE_ROOT}`);
  console.log(plan.length ? "Cambios:\n  - " + plan.join("\n  - ") : "Nada que cambiar: la demo ya está en el estado conocido.");
  if (!apply) {
    console.log("\nDry-run: no se modificó nada. Ejecute con --apply para aplicar.");
    return;
  }

  if (plan.length) {
    // Respaldo de lo que se va a tocar, antes de tocarlo.
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
    writeFileSync(join(dir, "sql.json"), JSON.stringify({ load: loadRow, podMedia: podRows }, null, 2));
    console.log("\nRespaldo: " + dir);

    // Redis: solo las claves exactas de los Mock (como lo haría el repositorio de Spring Data al borrar).
    for (const m of mocks.filter((x) => x.present)) {
      redis("DEL", `${REDIS_PREFIX}:${m.id}`, `${REDIS_PREFIX}:${m.id}:idx`);
      redis("SREM", REDIS_PREFIX, m.id);
      if (m.hash.vehiclePlate) redis("SREM", `${REDIS_PREFIX}:vehiclePlate:${m.hash.vehiclePlate}`, m.id);
    }
    // SQL: la carga por id exacto, en una transacción.
    if (ld.length) {
      docker(["exec", "-i", CONTAINERS.postgres, "psql", "-U", pg.user, "-d", pg.db, "-v", "ON_ERROR_STOP=1", "-q"], loadSql(state.load, timeZone));
    }
    // Conductores: por la API (mantiene el índice de placas de fleets-drivers).
    for (const d of drivers.filter((x) => x.diff.length)) {
      await api(gateway, "/fleets-drivers/state", { token, method: "POST", body: d.state });
    }
  }

  // Verificación.
  const checks = [];
  const active = await api(gateway, "/fleets-drivers/active", { token });
  const mockLeft = active.filter((d) => /^drv-e2e-/.test(d.driverId)).length;
  checks.push([mockLeft === 0, `Conductores Mock: ${mockLeft}`]);
  for (const d of state.drivers) {
    const now = await api(gateway, "/fleets-drivers/drivers/" + d.state.driverId, { token });
    checks.push([now.vehiclePlate === d.state.vehiclePlate, `${d.state.driverName}: placa ${now.vehiclePlate}, ${now.status}, posición ${now.currentLatitude}, ${now.currentLongitude}`]);
    if (d.email) {
      const loads = await api(gateway, "/loads/mine", { token: await login(gateway, d.email, password) });
      const open = loads.filter((l) => ["ASSIGNED", "IN_TRANSIT"].includes(l.status) || ["PROPOSED", "NOTIFIED"].includes(l.assignmentStatus));
      const ok = d.key === "carlos"
        ? open.length === 1 && open[0].id === state.load.id && open[0].status === "IN_TRANSIT"
        : open.length === 0;
      checks.push([ok, `${d.state.driverName}: ${open.length ? open.map((l) => `carga ${l.id} ${l.status}`).join(", ") : "sin carga"} (esperado: ${d.expect})`]);
    }
  }
  const plates = new Set(active.map((d) => d.vehiclePlate));
  checks.push([plates.size === active.length, `Placas únicas en la flota: ${plates.size} de ${active.length}`]);
  console.log("\nVerificación:");
  checks.forEach(([ok, text]) => console.log(`  ${ok ? "✓" : "✗"} ${text}`));
  if (checks.some(([ok]) => !ok)) process.exitCode = 1;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error("✗ " + error.message);
    process.exit(1);
  });
}

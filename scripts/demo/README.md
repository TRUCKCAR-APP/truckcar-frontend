# Datos de la demo local

`reset-demo.mjs` deja la demo local en un estado conocido, definido en [`demo-state.json`](demo-state.json):

- **Carlos Conductor:** en tránsito con la carga 88 (Bogotá → Ibagué), tractocamión `TDK-410`, en el origen de la carga.
- **Diana Rios:** sin carga, camión `SNT-238`, en Bogotá.
- **Ana Torres:** con su placa propia `TKR-527`, disponible y sin carga a bordo. Sus decisiones del motor de asignación y
  sus cargas guardadas también dicen `TKR-527`, no la placa vieja `TDK-410`.
- **Ningún conductor de prueba:** "Mock drv-e2e-1..3" no aparece.
- **Los tres en estado `ACTIVO`:** es el único estado que fleets-drivers y el motor de asignación reconocen para
  asignar (además de `INACTIVO`). "Disponible" y "En tránsito" son etiquetas que la Torre calcula a partir de
  `ACTIVO` y del viaje en curso: guardarlas como estado dejaba a Ana fuera del motor.
- **Carga 8 en espera para Ana:** 25 t, tractomula 3S3, Bogotá → Medellín, sin propuesta ni conductores descartados. El
  motor reintenta solo cada 2 minutos y se la propone a Ana (87/100 en la pila local).
- **Canceladas sin propuesta vieja:** las cargas 1, 14, 26, 45 y 50 ya no conservan `PROPOSED` o `NOTIFIED`.

## Cuándo correrlo

- Antes de ensayar la demo.
- Antes de la sustentación.
- Después de correr `Load-Allocation/scripts/e2e/e2e-asignacion.sh`, que vuelve a crear los conductores Mock.

## Cómo

Con el `docker compose` local levantado, desde `truckcar-frontend`:

```bash
# 1. Ver qué cambiaría (no modifica nada)
TRUCKCAR_DEMO_PASSWORD='…' node scripts/demo/reset-demo.mjs

# 2. Aplicarlo: respalda, aplica y verifica
TRUCKCAR_DEMO_PASSWORD='…' node scripts/demo/reset-demo.mjs --apply
```

En PowerShell: `$env:TRUCKCAR_DEMO_PASSWORD='…'; node scripts/demo/reset-demo.mjs --apply`.

Variables:

| Variable | Para qué |
|---|---|
| `TRUCKCAR_DEMO_PASSWORD` | Contraseña de los usuarios de demo. Es obligatoria y nunca se escribe en el repositorio. |
| `TRUCKCAR_GATEWAY_URL` | Opcional. Por defecto `http://localhost:8000`; si no es `localhost`, el script se niega a correr. |

Al final imprime la verificación:
- Los tres en `ACTIVO`.
- Carlos con la carga 88 en tránsito, sus horas en orden y fleets-drivers sabiendo que va en ruta.
- Diana sin carga y Ana con `TKR-527`.
- La carga 8 en espera para el motor.
- Las canceladas sin propuesta vieja, 0 Mock y placas únicas.

## Qué toca y qué no

> **Modifica datos locales directamente. No es para producción.**

- **Solo local:**
  - El gateway debe ser `localhost`.
  - `truckcar-redis` y `truckcar-postgis` deben ser los contenedores del compose `truckcar` de esta carpeta.
  - Si algo no cuadra, aborta sin tocar nada.
- **Seguro por defecto:** sin `--apply` solo muestra los cambios.
- **Respaldo previo:** antes de modificar guarda en `scripts/demo/backups/<fecha>/` (ignorado por git):
  - `redis.json` con los registros, los índices y los conjuntos de lo que va a tocar.
  - `sql.json` con la carga 88, sus evidencias de entrega, las filas con la placa vieja, la carga 8 con sus
    descartados y las canceladas que se limpian.
  - Imprime la ruta del respaldo.
- **Cambios acotados:**
  - **Conductores:** Carlos, Diana y Ana, por la API de fleets-drivers (`POST /fleets-drivers/state`, como
    coordinador), con su posición inicial.
  - **Conductores Mock:** `drv-e2e-1..3` en Redis, solo sus claves exactas, como las borraría el repositorio de
    fleets-drivers. No hay una API para borrar conductores.
  - **Placa de Ana en lo guardado:** en SQL, `UPDATE … WHERE` el id exacto de Ana y la placa vieja exacta, en
    `fleet_allocation.allocation_decisions` (lo que muestra la Torre) y `load_allocation.freight_loads`.
  - **Carga 8:** en SQL, un `UPDATE … WHERE id = 8` que la deja disponible y sin propuesta (intentos en 0), y dos
    `DELETE … WHERE load_id = 8` (conductores descartados y evidencias). Va en la misma transacción.
  - **Canceladas 1, 14, 26, 45 y 50:** `UPDATE … WHERE id IN (…) AND status = 'CANCELLED' AND assignment_status IN
    ('PROPOSED', 'NOTIFIED')`, en la misma transacción.
  - **Viaje de Carlos en fleets-drivers:** si fleets-drivers no sabe que Carlos lleva la carga 88 (el SQL no emite
    eventos), el script publica un `trip.started` en `truckcar.events.load-allocation` con el contrato de
    Load-Allocation. De los consumidores de ese tópico solo fleets-drivers lo usa; AI-fleet y Notifications lo ignoran.
  - **Carga 88:** en SQL, un `UPDATE … WHERE id = 88` que la deja en tránsito con Carlos y sin datos de entrega, y un
    `DELETE` de sus evidencias de entrega (`WHERE load_id = 88`). Va en la misma transacción que la placa.
    - **Horas en orden** para el seguimiento público: publicado ≤ asignado ≤ en ruta ≤ ahora. Si ya lo están, no se
      tocan. Si no, se rehacen contando desde ahora (asignado hace 3 h, en ruta hace 1 h); la publicación solo se
      adelanta a hace 4 h si era posterior.
  - Sin `FLUSHALL`, `DROP` ni borrados masivos. Los ids permitidos se validan con un formato estricto.
- **Credenciales:**
  - La contraseña viene de `TRUCKCAR_DEMO_PASSWORD`.
  - El usuario y la base de Postgres se leen de la configuración del propio contenedor (`POSTGRES_USER`,
    `POSTGRES_DB`).
- **Fuera de alcance:**
  - Las fotos y firmas en el almacenamiento de objetos (MinIO) de una entrega anterior quedan huérfanas: solo se
    borran sus registros.
  - Los usuarios de User-Identity no se crean; deben existir.

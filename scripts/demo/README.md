# Datos de la demo local

`reset-demo.mjs` deja la demo local en un estado conocido, definido en [`demo-state.json`](demo-state.json):

- **Carlos Conductor:** en tránsito con la carga 88 (Bogotá → Ibagué), tractocamión `TDK-410`, en el origen de la carga.
- **Diana Rios:** sin carga, camión `SNT-238`, en Bogotá.
- **Ana Torres:** con su placa propia `TKR-527`, disponible y sin carga a bordo.
- **Ningún conductor de prueba:** "Mock drv-e2e-1..3" no aparece.

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

Al final imprime la verificación: Carlos con la carga 88 en tránsito, Diana sin carga, Ana con `TKR-527`, 0 Mock y
placas únicas.

## Qué toca y qué no

> **Modifica datos locales directamente. No es para producción.**

- **Solo local:**
  - El gateway debe ser `localhost`.
  - `truckcar-redis` y `truckcar-postgis` deben ser los contenedores del compose `truckcar` de esta carpeta.
  - Si algo no cuadra, aborta sin tocar nada.
- **Seguro por defecto:** sin `--apply` solo muestra los cambios.
- **Respaldo previo:** antes de modificar guarda en `scripts/demo/backups/<fecha>/` (ignorado por git):
  - `redis.json` con los registros, los índices y los conjuntos de lo que va a tocar.
  - `sql.json` con la carga 88 y sus evidencias de entrega.
  - Imprime la ruta del respaldo.
- **Cambios acotados:**
  - **Conductores:** Carlos, Diana y Ana, por la API de fleets-drivers (`POST /fleets-drivers/state`, como
    coordinador), con su posición inicial.
  - **Conductores Mock:** `drv-e2e-1..3` en Redis, solo sus claves exactas, como las borraría el repositorio de
    fleets-drivers. No hay una API para borrar conductores.
  - **Carga 88:** en SQL, un `UPDATE … WHERE id = 88` que la deja en tránsito con Carlos y sin datos de entrega, y un
    `DELETE` de sus evidencias de entrega (`WHERE load_id = 88`), en una transacción.
  - Sin `FLUSHALL`, `DROP` ni borrados masivos. Los ids permitidos se validan con un formato estricto.
- **Credenciales:**
  - La contraseña viene de `TRUCKCAR_DEMO_PASSWORD`.
  - El usuario y la base de Postgres se leen de la configuración del propio contenedor (`POSTGRES_USER`,
    `POSTGRES_DB`).
- **Fuera de alcance:**
  - Las fotos y firmas en el almacenamiento de objetos (MinIO) de una entrega anterior quedan huérfanas: solo se
    borran sus registros.
  - Los usuarios de User-Identity no se crean; deben existir.

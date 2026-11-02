# Guion de la demostración (6 a 8 minutos)

Recorrido de la app del conductor y de la Torre de control con los datos de demostración locales. Cada paso dice qué
hacer, dónde y qué debe verse. Los tiempos son orientativos.

## Antes de empezar (no cuenta en el tiempo)

1. **Levante el compose local** desde la raíz del proyecto (`docker compose up -d`) y espere a que el gateway responda
   en `http://localhost:8000`.
2. **Deje los datos en su estado conocido**, desde `truckcar-frontend`:

   ```bash
   TRUCKCAR_DEMO_PASSWORD='…' node scripts/demo/reset-demo.mjs          # ver qué cambiaría
   TRUCKCAR_DEMO_PASSWORD='…' node scripts/demo/reset-demo.mjs --apply  # respaldar, aplicar y verificar
   ```

   Debe terminar con la verificación en verde: Carlos con la carga 88 en tránsito, Diana sin carga, Ana con `TKR-527`,
   0 conductores Mock y placas únicas. Detalles en [scripts/demo/README.md](../../scripts/demo/README.md).
   **Modifica datos locales; no es para producción.**
3. **Abra Chrome** (escritorio, 1440×900 o más) en una ventana normal, no de incógnito, para que el Service Worker
   guarde el mapa. Permita la ubicación cuando la pida: el SOS usa la posición real del navegador, nunca la simulada.
4. **Ensaye el mismo día.** El mapa guardado sin señal dura **6 horas** (lo que permite Stadia). Si recorrió la ruta
   ayer, vuelva a recorrerla con señal antes de presentar.

Usuarios (contraseña común de la demo, fuera del repositorio):

| Quién | Usuario | Para qué |
|---|---|---|
| Carlos Conductor | `conductor@truckcar.demo` | App del conductor, carga 88 Bogotá → Ibagué, tractocamión `TDK-410` |
| Tomás Torre | `torre@truckcar.demo` | Torre de control y cambio de rol |

## 1. Entrar como conductor · 0:00–0:45

- **URL:** `http://localhost:5500/?demo=1`
- **Hacer:** entrar con `conductor@truckcar.demo`.
- **Esperar:**
  - En escritorio, la app en una columna de teléfono sobre el fondo grafito.
  - Arriba, la barra de la demostración con **Rotar** y **Simular GPS**. Solo aparecen con `?demo=1`; sin él, la
    app se ve como en producción.
  - La pestaña **Carga** con la carga 88 en tránsito, Bogotá → Ibagué, y "Llegué: registrar entrega".
  - Un solo color de acento, el ámbar, en la acción principal y la pestaña activa.

## 2. Recorrer la ruta con señal · 0:45–2:15

- **Hacer:** pulsar **Simular GPS** en la barra de arriba (pasa a "Simulando GPS") y abrir **Navegar**.
- **Esperar:**
  - La tarjeta de navegación: la maniobra, la distancia, la calle y la altura y el peso del vehículo (4,1 m; 40 t).
  - El camión avanzando con su rumbo sobre el mapa oscuro.
  - La barra del viaje abajo, con lo que falta y "Llegué".
- **Contar:** se lee de reojo, con cifras grandes. Mientras hay señal, el Service Worker guarda **solo las teselas
  que se ven**, no precarga la ruta.
- **Opcional (15 s):** **Rotar** muestra el diseño en horizontal: tarjeta a la izquierda y panel a la derecha.

## 3. Simular la pérdida de señal · 2:15–3:15

- **Hacer:** pestaña **Offline** → **Simular pérdida de señal**. Vuelva a **Navegar** y mueva el mapa.
- **Esperar:**
  - El indicador de red pasa a "Sin señal".
  - La zona ya vista sigue en el mapa; una zona no vista queda **oscura y limpia, sin cuadros rotos**.
  - En **Offline**, la fecha real del mapa guardado y lo que hay por enviar.
- **Contar:** la app no finge conexión; dice qué tiene guardado y desde cuándo.

## 4. SOS sin señal · 3:15–4:15

- **Hacer:** con la señal aún simulada como perdida, **mantener presionado el botón SOS 1,5 segundos**. Un toque
  corto no lo dispara.
- **Esperar:**
  - La hoja del SOS con "Sin señal: el aviso se enviará al recuperar la señal", con triángulo ámbar. **No** dice
    "Torre de control avisada": eso solo aparece con el acuse del servidor.
  - Un número ámbar sobre la pestaña **Offline**: acciones guardadas sin enviar.
- **Hacer:** **Offline** → **Terminar la simulación sin señal**.
- **Esperar:** la cola se envía sola, el número desaparece y el SOS pasa a "Torre de control avisada · …" con la hora
  del servidor.
- **Contar:** el rojo es solo del SOS; en toda la app no hay otro rojo.

## 5. Registrar la entrega · 4:15–5:15

- **Hacer:** pestaña **Carga** → **Llegué: registrar entrega**. Escriba el nombre de quien recibe, firme con el ratón
  en el recuadro, pulse **Simular foto** (solo con `?demo=1`) y **Confirmar entrega**.
- **Esperar:**
  - El formulario no se cierra con un toque accidental fuera de él: la firma no se pierde.
  - Al confirmar, la carga queda entregada y la pestaña Carga pasa a su estado vacío.
- **Ojo:** la entrega es real en los datos locales. Para volver a ensayar, corra otra vez el script de datos.

## 6. Torre de control · 5:15–7:00

- **Hacer:** cerrar sesión (ícono de salida arriba a la derecha) y entrar con `torre@truckcar.demo` en la misma URL,
  `http://localhost:5500/?demo=1`.
- **Esperar:**
  - "Central de monitoreo de flota" con **Flota activa 3 / 3**: Carlos, Diana y Ana. Ningún conductor Mock.
  - Si el SOS del paso 4 no se atendió, la franja del SOS arriba, con "Atender". Al atenderlo desaparece para todos
    los coordinadores.
  - En **Decisiones del motor**, Ana Torres con su placa `TKR-527`. `TDK-410` es solo de Carlos.
  - Estados en español, sin mayúsculas y con la misma paleta que la app del conductor.

## 7. Cambiar de rol · 7:00–7:45

- **Hacer:** en la barra de arriba, el selector **Conductor / Torre de Control**. Solo aparece para coordinadores.
- **Esperar:**
  - En **Conductor**, la app del conductor con la sesión del coordinador: "Sin carga asignada", con "Consultar de
    nuevo", porque el coordinador no tiene cargas. Es el estado vacío del rediseño.
  - De vuelta en **Torre de Control**, el panel como estaba.
- **Cierre:** la misma app sirve al conductor en la cabina y al coordinador en el escritorio, con un solo sistema
  visual.

## Si algo sale mal

| Síntoma | Qué hacer |
|---|---|
| La carga 88 no aparece en tránsito | Corra el script de datos con `--apply` y recargue. |
| El mapa sin señal está oscuro en la ruta | El mapa guardado venció (6 h) o se abrió en incógnito: recorra la ruta con señal otra vez. |
| La hoja del SOS dice que no hay GPS | Permita la ubicación de `localhost` en Chrome. La simulación no sirve para el SOS, a propósito. |
| No se ven Rotar ni Simular GPS | Falta `?demo=1` en la URL. |
| Ana aparece con `TDK-410` en la Torre | Corra el script con `--apply`: corrige la placa en las decisiones guardadas. |

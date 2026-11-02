# Rediseño premium nativo · PWA del conductor

Rama `refactor/ui-premium` · un commit por fase · capturas en 390×844, 360×800, 768×1024 y 1440×900.
Auditoría inicial: [AUDITORIA.md](AUDITORIA.md). Dirección visual aprobada: **B** (prototipo en
[`prototipo/`](prototipo/)).

| Fase | Contenido | Estado |
|---|---|---|
| 1 | Auditoría y design tokens | Hecha; tokens actualizados a la dirección B |
| — | Prototipo de dirección (A y B) y pantallas de la dirección B | Aprobado; ajustes de la ronda 4 en revisión |
| 2 | Mapa oscuro, caché de teselas, barra inferior, botón y modal SOS | Hecha, en revisión |
| 3 | Recorrido de la demo: Carga, Rutas y Navegar (HUD) y columna de escritorio de 480 px | Pendiente: espera el merge del PR #1 en `main` |
| 4 | Vehículo, Alertas (vacío, cargando y error), Offline con fecha real, POD con botón fijo, hoja de reportar e inicio de sesión | Pendiente |

## 1. Paleta: antes y después

Todos los valores viven en [`css/tokens.css`](../../css/tokens.css). Tailwind lee las mismas variables
(`index.html`), así que también sus utilidades son tokens. Son los del prototipo B aprobado.

| Rol | Antes | Después (dirección B) |
|---|---|---|
| Fondo | `#020617` (slate-950, tinte azul) | `#0C0E12` grafito |
| Superficie | `#0F172A` (slate-900) | `#14171C` |
| Elevada | `#1E293B` (slate-800) | `#1B1F26` |
| Líneas | `rgba(148,163,184,.14)` | `rgba(255,255,255,.07)`; `.10` en lo que flota |
| Texto primario | `#F1F5F9` y `#FFFFFF` | `#ECEEF1` (sin blanco puro: deslumbra de noche) |
| Texto secundario | `#A3B1C6`, `#8796AD`, `slate-500` (3,7:1) | `#8A919C` (5,6:1 sobre superficie) |
| Acento | 7 matices de Tailwind compitiendo: `blue`/`brand`, `emerald`, `amber`, `rose`, `indigo`, `violet`, `orange` | **Uno: ámbar apagado `#E8A33D`**, solo en el botón principal y la pestaña activa |
| Texto sobre el acento | blanco | `#0C0E12` (9,1:1) |
| Estado ok | `#10B981` | `#5BC48A` (solo estado) |
| Advertencia | `#F59E0B` | `#E3A93C`, **siempre con triángulo y texto** |
| SOS y emergencia | `#EF4444` mezclado con el rosa de rechazos y errores | **Exclusivo**: `#E5484D`; texto del botón en reposo `#FF6369` (5,7:1); relleno y modal activo `#C62828` (texto blanco 5,6:1) |
| Ruta en el mapa | `#10B981` sobre teselas claras | `#5AA2FF` con borde `#0C0E12` sobre teselas oscuras; lo recorrido en `#3A4049` |
| Tipografía | Inter (Google Fonts) + JetBrains Mono | **Manrope** 500/600/700 servida desde la app (`fonts/`), cifras tabulares; sin monoespaciada |
| Íconos | Font Awesome, sólido y regular mezclados, de colores | Phosphor, trazo regular y relleno solo en la pestaña activa |

**El acento y la advertencia se parecen** (`#E8A33D` y `#E3A93C`). Por eso el color nunca es la única señal: el
acento solo aparece en el botón principal y en la pestaña activa, y toda advertencia lleva un triángulo y un texto
que la nombra ("Fuera de la ruta", "Sin señal").

**Escalas.**
- **Tipografía:** 12 (solo etiquetas de la barra inferior) · 14 (apoyo, mínimo) · 15 · 17 (cuerpo) · 20 · 28 · 34 · 44 px.
- **Espacio:** múltiplos de 4 px (`--space-1` a `--space-16`); el margen lateral (`--gutter`) es de 16 px.
- **Radios:** 10 (SOS) · 12 (botones y listas) · 16 (tarjetas) · 20 (hojas y HUD) · píldora.
- **Elevación:** neutra y con desplazamiento (`--elev-1` a `--elev-3`), nunca con halos de color.
- **Movimiento:** `--ease-out`, 140 ms al presionar y escala 0,98. El SOS se mantiene 1,5 s.
- **Preferencias del sistema:** `prefers-reduced-motion`, `prefers-reduced-transparency` y `prefers-contrast` ajustan
  los tokens, no los componentes.

**Estado de la app.**
- Los neutros, el blanco, el acento y la tipografía ya usan estos tokens en toda la app.
- Hojas, toasts, el indicador de red, el marco de escritorio y las tarjetas ya están en tokens.
- La Torre de control y "Mis envíos" heredan los tokens sin rediseñar su estructura.
- Los íconos de Font Awesome y los matices restantes (verde, índigo, rosa) se reemplazan pantalla por pantalla en las
  fases 2 a 4.

## 2. Tarjeta unificada del HUD

Pendiente (fase 3). Diseño aprobado en el prototipo:
- Una sola tarjeta superior de vidrio con la maniobra y su distancia, la altura del vehículo y el peso bruto.
- El límite de velocidad queda fuera hasta que exista una fuente real.
- Un panel vertical derecho con la velocidad, la voz y el botón de reportar.

## 3. Barra inferior

Hecha en la fase 2 ([`js/views/driverApp.js`](../../js/views/driverApp.js) `TABS`, estilos `.driver-tabbar` en
[`css/main.css`](../../css/main.css)).

- **Altura:** seis pestañas iguales de 56 px más `safe-area-inset-bottom`, en una rejilla de 6 columnas. "Navegar" ya
  no es un botón sobredimensionado con degradado y halo azul: es una pestaña más.
- **Íconos:** Phosphor servidos desde [`assets/icons.svg`](../../assets/icons.svg), sin Font Awesome en la barra.
  - Inactiva: trazo regular en gris `#8A919C`.
  - Activa: el mismo ícono relleno, en ámbar, con una píldora ámbar al 15 % detrás.
  - Sin línea superior ni otro indicador.
  - Alertas usa una campana: el triángulo queda solo para advertencias.
- **Etiquetas:** 12 px en peso medio (500) en todas las pestañas; es la única excepción al mínimo de 14 px.
- **Áreas táctiles:** cada pestaña mide 56 px de alto (mínimo 44 px). Fondo sólido `#0C0E12` con micro-borde superior
  al 7 %.
- **Toques:** sin resaltado azul al tocar y sin `:hover` pegado en el teléfono. Al presionar, el texto pasa al color
  primario.
- **Carga pendiente:** se marca con un punto ámbar sobre el ícono de Carga, con su texto para lectores de pantalla.

## 4. Estados vacíos

Pendiente (fase 4). En el prototipo, Alertas tiene tres estados distintos: vacío ("Sin reportes recientes", sin
afirmar que la vía sea segura), cargando y error ("No se pudieron cargar las alertas").

## 5. Capturas

**Prototipo, dirección B** ([`prototipo/capturas/`](prototipo/capturas/), cada captura rotulada con pantalla y
estado):
- [comparativa-b.png](prototipo/capturas/comparativa-b.png): las nueve pantallas y los estados del SOS.
- [comparativa-nuevas-2.png](prototipo/capturas/comparativa-nuevas-2.png): inicio de sesión, entrega (POD),
  hoja de reportar y los cambios de la última ronda.

- [ronda-4/comparativa-ronda-4.png](prototipo/capturas/ronda-4/comparativa-ronda-4.png): ajustes de la ronda 4
  (solo lo que cambió).
  - POD con el botón fijo y pestaña Alertas con campana.
  - Flecha de navegación con el rumbo real y modal SOS con las etiquetas al 92 %.
  - Escritorio en sus dos opciones (marco y columna).
  - Torre de control y "Mis envíos" de la app con los tokens actuales.
  - Cada captura también va por separado en [`ronda-4/`](prototipo/capturas/ronda-4/).

**App real**

| Pantalla | Antes | Fase 1 | Fase 2 |
|---|---|---|---|
| Carga (barra inferior y SOS) | [antes](antes/carga-390x844.jpg) | [fase 1](fase-1/carga-390x844.jpg) | [fase 2](fase-2/carga-390x844.jpg) |
| Rutas (mapa oscuro) | [antes](antes/rutas-390x844.jpg) | [fase 1](fase-1/rutas-390x844.jpg) | [fase 2](fase-2/rutas-390x844.jpg) |
| Navegar (mapa oscuro) | [antes](antes/navegar-390x844.jpg) | [fase 1](fase-1/navegar-390x844.jpg) | [fase 2](fase-2/navegar-390x844.jpg) |
| SOS confirmado | [antes](antes/sos-390x844.jpg) | [fase 1](fase-1/sos-390x844.jpg) | [fase 2](fase-2/sos-390x844.jpg) |
| SOS sin señal | — | — | [fase 2](fase-2/sos-sin-senal-390x844.jpg) |
| Inicio de sesión (escritorio) | [antes](antes/login-1440x900.jpg) | [fase 1](fase-1/login-1440x900.jpg) | [fase 2](fase-2/login-1440x900.jpg) |

- Cada carpeta tiene todas sus pantallas en los 4 tamaños (390×844, 360×800, 768×1024 y 1440×900).
- [`fase-2/`](fase-2/) suma la Torre de control (`torre-*`), "Mis envíos" (`envios-*`) y los estados vacíos.
- Las capturas de la fase 1 son anteriores a la actualización de los tokens a la dirección B.

**Fase 2: app real vs prototipo (390×844).**
[comparativa-app-vs-prototipo-390x844.png](fase-2/comparativa-app-vs-prototipo-390x844.png) anota bajo cada par las
diferencias visuales:
- Iguales al prototipo: la barra inferior, el botón SOS, las teselas, los colores de la ruta, los marcadores y el modal
  SOS.
- La atribución de Rutas va abajo y no arriba, a propósito.
- Quedan para su fase: la cabecera, el HUD y el marcador del camión (fase 3), y la estructura de Rutas y Carga
  (fase 4).

**Verificación de la fase 2** (sin regresiones en el flujo):
- POD: el formulario de entrega abre y conserva sus campos ([pod-390x844.jpg](fase-2/pod-390x844.jpg)).
- Cola offline: con la red caída, el SOS queda en la cola durable y la pantalla Offline lo muestra pendiente ("Sin
  señal · 1 guardado") ([cola-390x844.jpg](fase-2/cola-390x844.jpg)).
- Modal SOS confirmado por el servidor ([sos-390x844.jpg](fase-2/sos-390x844.jpg)) y sin señal
  ([sos-sin-senal-390x844.jpg](fase-2/sos-sin-senal-390x844.jpg)).
- Teselas sin señal, con el Service Worker activo:
  - Una zona no vista queda con el fondo oscuro limpio
    ([offline-zona-no-vista-390x844.jpg](fase-2/offline-zona-no-vista-390x844.jpg)).
  - La ruta ya vista se sirve desde la caché ([offline-zona-vista-390x844.jpg](fase-2/offline-zona-vista-390x844.jpg)).

## 6. Inconsistencias de datos encontradas

1. **Vehículo: "Peso Bruto Máx." igual a la tara y "Carga Útil" en 0,0 t.** fleets-drivers calcula
   `grossWeightTons` como tara más carga a bordo: es el peso bruto actual, no una capacidad. *Corregido en
   `fix/telemetry-stationary`*: ahora dice "Peso bruto actual (tara + carga)" y "Carga a bordo". El peso bruto máximo
   homologado del vehículo sigue sin existir en el backend.
2. **Carga en tránsito: "Volumen —"** mientras peso y distancia tienen valor. El campo es opcional al publicar y
   ocupaba un tercio del ancho; el prototipo solo muestra datos que existen.
3. **Estado `IN_TRANSIT`** con el nombre interno del backend en lugar de "En tránsito". *Corregido en
   `fix/telemetry-stationary`.*
4. **Distancia de la ruta.** La app muestra 450 km y 10 h (plan de Route-AI); OSRM da 195 km y 3 h 20 min por
   carretera para Bogotá → Ibagué. El plan de Route-AI parece una estimación de respaldo (dos tramos iguales de
   225 km con un "Checkpoint Intermedio"). El tiempo de OSRM es de perfil de auto y subestima el de un camión: el
   prototipo lo rotula "estimado para auto".
5. **Datos de demostración incoherentes:** un turbo con una carga de 24 t, "Disponible" mientras llevaba una carga en
   tránsito, y 0 t a bordo. *Corregido en los datos locales*: tractocamión 3S3, tara 16 t, 24 t a bordo, 40 t brutas,
   en tránsito.
6. **Misma placa en dos conductores (Torre de control).**
   - El mapa de la flota muestra dos marcadores `TDK-410`.
   - La evaluación de despacho propone a "Ana Torres (TDK-410)", pero esa placa es la del tractocamión de Carlos.
   - fleets-drivers no impide registrar la misma placa en dos vehículos.
   - *Corregido en los datos locales (1 de noviembre de 2026):* Ana Torres tiene ahora la placa `TKR-527`.
     - Se cambió con la API de fleets-drivers (`POST /api/v1/fleets-drivers/state`, como coordinador), reenviando todos
       sus datos para que solo cambiara la placa y el índice de placas de Redis quedara bien.
     - `GET /vehicles/TDK-410` devuelve solo a Carlos y `GET /vehicles/TKR-527` a Ana Torres.
   - Sigue sin existir una validación de placa única en fleets-drivers: el backend no se tocó.
7. **Conductores de prueba en la flota real.** "Mock drv-e2e-1" a "Mock drv-e2e-3" (placas E2E101 a E2E103) aparecían
   en "Flota en operación" como inactivos desde hace 18 días.
   - Vienen de las pruebas de extremo a extremo y no se borraron de la base local.
   - *Eliminados de la base local (1 de noviembre de 2026).* fleets-drivers no tiene un endpoint para borrar
     conductores, así que se borraron en Redis como lo haría su repositorio: el registro, su índice, el miembro del
     conjunto principal y la entrada del índice de placas.
   - `GET /fleets-drivers/active` devuelve ahora solo a Ana Torres, Carlos Conductor y Diana Ríos.
   - Antes de borrar se guardó un respaldo de los registros.
   - Redis tiene AOF activo, así que el cambio persiste tras un reinicio.
   - Se conservan como historial las 2 cargas canceladas (2 y 3) y las 16 decisiones de asignación que los mencionan.
   - **Volverán a aparecer** si se ejecuta `Load-Allocation/scripts/e2e/e2e-asignacion.sh`, que los crea.
8. **Estados internos en "Mis envíos".**
   - Los filtros dicen `AVAILABLE`, `PROPOSED`, `NOTIFIED`, `ASSIGNED`, `IN_TRANSIT`, `DELIVERED` y `CANCELLED`.
   - La carga 88 dice `IN_TRANSIT`.
   - La corrección de `fix/telemetry-stationary` solo cubre la app del conductor. No corregido.

## 7. Decisiones de diseño

- **Dirección B: grafito casi monocromo con acento ámbar apagado `#E8A33D`.** El color comunica estado (ok,
  advertencia, SOS) y el acento solo marca la acción principal y dónde está el conductor. Elegida sobre la dirección A
  (sin acento), con la que comparte la base.
- **Manrope servida desde la app.** Una sola familia en 500, 600 y 700, con cifras tabulares, cargada desde
  `fonts/` y no desde Google Fonts: así funciona sin señal y no depende de terceros. Tiene aberturas amplias y
  números claros, que se leen bien de reojo.
- **Las advertencias nunca dependen solo del color.** Llevan triángulo y texto, porque el ámbar de advertencia se
  parece al del acento.
- **Solo datos reales.** Lo que no tiene fuente dice "Sin información" o no se muestra: aptitud de la ruta,
  restricciones, alertas en la ruta, límite de velocidad. "Torre de control avisada" solo aparece con el acuse del
  servidor.
- **SOS:** pequeño y plano en reposo, con 44 px de área táctil. Se llena de rojo mientras se mantiene, y el modal
  activo es rojo pleno con la antigüedad de la lectura GPS.
- **Placa colombiana de carga:** fondo amarillo, texto negro y nunca partida en dos líneas.
- **Mapa oscuro.** CARTO Dark Matter ya exige clave de API: devuelve una imagen "API KEY REQUIRED" con código 200.
  **Aprobado: Stadia Maps *Alidade Smooth Dark*.** Son teselas raster oscuras reales, sin clave en `localhost`; en
  producción requieren una cuenta con el dominio registrado.
- **Stadia y el caché del modo Offline** (términos de servicio, versión del 18 de marzo de 2026, §8 y §13):
  - Se permite guardar "pequeñas cantidades" para uso sin conexión en una aplicación móvil: **máximo 100 MB por
    dispositivo** y solo con una **suscripción activa** que cubra esas teselas.
  - Fuera de eso, solo el caché estándar del dispositivo, nunca en un servidor, y **sin guardar las teselas más tiempo
    del que indican sus cabeceras HTTP** (7 días si no envían ninguna).
  - El plan gratuito es solo para uso no comercial o de evaluación; TruckCar en producción necesita un plan pago.
  - La atribución es obligatoria y no puede ocultarse.
  - La política anterior (hasta 1.500 teselas de OpenStreetMap sin vencimiento) se eliminó en la fase 2; ver
    "Caché de teselas" más abajo.
- **Proveedor del mapa: un solo punto de configuración** ([`js/config.js`](../../js/config.js), `MAP_PROVIDER` y
  `MAP_PROVIDERS`), con la URL de las teselas, la atribución y el nombre del parámetro de la clave.
  - **Pasar a CARTO Dark Matter (plan B):**
    1. En `js/config.js`, cambie `const MAP_PROVIDER = 'stadia';` por `'carto'`.
    2. Pida una clave gratuita en [carto.com/basemaps/apikey](https://carto.com/basemaps/apikey/). Sin clave, CARTO
       responde con código 200 una imagen que dice "API KEY REQUIRED".
    3. El despliegue pone la clave en `<meta name="truckcar-map-api-key" content="…">` de `index.html`, o en
       `window.TRUCKCAR_MAP_API_KEY`. Va como `?key=` (Stadia usa `?api_key=`).
    4. El Service Worker ya reconoce los dos dominios: no hay que tocarlo.
  - **Probar el cambio a CARTO cuando llegue la clave**, en local y sin hacer commit de la clave:
    1. Ponga `'carto'` en `MAP_PROVIDER` y la clave en el `meta` `truckcar-map-api-key` de `index.html`.
    2. Abra la app en `http://localhost:5500` (en una ventana de incógnito o tras "Borrar datos del sitio", para que
       no quede ninguna tesela de Stadia guardada) y entre como conductor a Rutas y a Navegar.
    3. **Teselas:** deben verse oscuras y **sin** el texto "API KEY REQUIRED". Si aparece, la clave no llegó o no es
       válida.
    4. **Atribución:** debe decir "© OpenStreetMap © CARTO", en una línea y sin que nada la tape.
    5. **Peticiones:** en DevTools → Red, las teselas van a `basemaps.cartocdn.com/rastertiles/dark_all/…?key=…`.
    6. **Caché:** en DevTools → Aplicación → IndexedDB → `truckcar-tiles` → `tiles`, cada tesela tiene su `expires`.
       Anote cuántas horas da CARTO en su `Cache-Control`: es lo que durará el mapa sin señal con este proveedor.
    7. **Sin señal:** con DevTools → Red → "Sin conexión", lo ya visto debe seguir viéndose y lo no visto debe quedar
       oscuro, sin cuadros rotos.
    8. Al terminar, vuelva a `'stadia'` y deje el `meta` vacío antes de cualquier commit.
  - Sin respaldo automático de un proveedor a otro.
  - La clave nunca va en el repositorio: el `meta` queda vacío y en `localhost` Stadia no la exige.
  - La atribución ("© Stadia Maps © OpenMapTiles © OpenStreetMap") va abajo a la izquierda, en una sola línea, gris
    `#8A919C` sobre fondo oscuro.
    - Los controles de Rutas y Navegar quedan por encima de ella (`.map-above-attribution`); en horizontal también.
    - Revisado en los 4 tamaños: ninguna barra, hoja ni panel la tapa.
  - Ruta en `#5AA2FF` con borde `#0C0E12`, y lo ya recorrido en `#3A4049`.
    - La ruta se parte en la última posición del GPS si está a menos de 250 m de la línea; si no, toda la ruta queda
      por recorrer.
    - El origen es un anillo hueco, el destino un pin con bandera y las paradas intermedias un anillo pequeño.
    - El panel "Mis envíos" usa los mismos marcadores.
- **Caché de teselas** ([`sw.js`](../../sw.js) y [`js/tileStore.js`](../../js/tileStore.js)):
  - **Caché propia:** `truckcar-tiles-v2`, separada del app shell. La v1, con la política anterior, se borra entera al
    activarse la versión nueva.
  - **Solo lo que el conductor vio:** se guardan únicamente las teselas que el mapa pidió. No hay precarga por zonas
    ni descargas en bloque.
  - **Vencimiento:** cada tesela vence según su `Cache-Control` (`max-age`) o, si no lo trae, su `Expires`; sin
    ninguna de las dos, a los 7 días.
    - `no-store`, `no-cache`, `max-age=0` y un `Expires` vencido no se guardan.
    - Una tesela vencida nunca se sirve: se borra.
    - Las vencidas se purgan al activarse el Service Worker y cada 15 minutos mientras se usa el mapa.
  - **Tope de 100 MB** con el tamaño real de cada respuesta (una tesela @2x pesa más y cuenta más). Al superarlo se
    expulsan primero las vencidas y después las de uso menos reciente.
  - **Solo respuestas legibles:** el mapa pide las teselas con CORS para leer sus cabeceras. Una respuesta opaca no se
    guarda, porque no se sabría cuándo vence.
  - **Vencimiento disponible para la app:** el índice (IndexedDB `truckcar-tiles`) guarda el tamaño y el vencimiento
    de cada tesela. `TileStore.summary()` da la fecha real para el "Guardado hasta" de la pantalla Offline (fase 4).
    El contador escrito a mano sobre la caché v1 se eliminó.
  - **Sin señal y sin tesela:** un PNG transparente válido, así que se ve el fondo oscuro del mapa, sin cuadros rotos
    ni errores en la consola.
  - **Pruebas:** vencimiento, tope de 100 MB, no-precarga, respuestas opacas, borrado de la v1 y cuadro sin señal, en
    [`test/sw.test.mjs`](../../test/sw.test.mjs).
  - **Verificado en Chrome** con el Service Worker activo:
    - Se pidieron solo las 4 teselas visibles.
    - Se guardaron con su tamaño @2x real (178 KB) y vencimiento a 6 h.
    - Sin señal, una zona no vista quedó oscura y limpia (0 teselas rotas, 0 errores) y la zona ya vista se sirvió
      desde la caché.
- **Hallazgo: Stadia envía `Cache-Control: max-age=21600` (6 horas), no 7 días.**
  - Lo comprobé el 1 de noviembre de 2026 con `tiles.stadiamaps.com/tiles/alidade_smooth_dark/…`.
  - Respetar las cabeceras significa que el mapa sin señal dura **6 horas** desde que se vio, no una semana.
  - El "Guardado hasta 8 nov" del prototipo suponía 7 días: la fase 4 mostrará la fecha real del índice.
  - **Decisión: el vencimiento se queda en 6 h.** No se amplía.
  - **Nota para la demo: mapa offline = 6 h, repetir el recorrido el mismo día de la demo.**
- **SOS: el acuse del servidor sí está disponible en la interfaz** sin tocar la lógica.
  - `triggerSos` devuelve el SOS con su `id` cuando el servidor lo recibió, y `pendingSync: true` cuando quedó en la
    cola sin señal. El modal usa exactamente eso.
  - "Torre de control avisada · SOS #id, hora" aparece solo con `id`.
  - Sin señal: "Sin señal: el aviso se enviará al recuperar la señal. Llame al 123 ahora."
  - Error del servidor: "No se pudo enviar el SOS: … Llame al 123 ahora."
  - Sin GPS: "No hay posición GPS…" y la misma instrucción.
  - La lectura del GPS muestra su antigüedad, que se actualiza cada segundo ("hace 40 s", o "última confirmada hace 5
    min" si es la última conocida).
- **Contraste del modal SOS, medido (WCAG 2.x) sobre `#C62828`:**

  | Elemento | Color | Contraste |
  |---|---|---|
  | Texto principal, botón "Cerrar" | blanco 100 % | 5,62:1 |
  | Etiquetas ("Posición", "Lectura GPS"…) y texto de apoyo | blanco al 92 % (`#FAEEEE`) | 4,96:1 |
  | Antes, en el prototipo: etiquetas al 80 % | `#F4D4D4` | 4,07:1 (no cumplía 4,5:1) |
  | Texto "SOS" del botón en reposo | `#FF6369` sobre `#1B1F26` | 5,70:1 |

- **SOS sin nada encima:**
  - Mientras el modal está abierto no se muestra ningún aviso: un toast tapaba "Llamar al 123".
  - El foco va al modal y no a "Llamar al 123": si el conductor mantuvo Enter para activar el SOS, la repetición de la
    tecla podría marcar sin querer.
  - En escritorio el modal ocupa el marco del teléfono, no la ventana.
- **Escritorio: propuesta.** Recomiendo reemplazar el marco de teléfono por una **columna centrada sin marco** de 480 px
  ([capturas](prototipo/capturas/ronda-4/comparativa-ronda-4.png)).
  - Ocupa toda la altura, así que en Navegar se ve más mapa.
  - No imita un aparato que el usuario no tiene.
  - El marco tiene sentido solo en una presentación del proyecto. La decisión es suya; no se aplicó a la app.
- **Torre de control y "Mis envíos" con los tokens actuales** ([capturas](prototipo/capturas/ronda-4/comparativa-ronda-4.png)).
  Heredan grafito, ámbar y Manrope, pero quedan restos del diseño viejo:
  - Verde en la pestaña "Torre de control", en la leyenda del mapa, en "3 / 6" y en los distintivos POD.
  - Índigo en "Ejecutar matching con IA" y en el ícono de "Mis envíos".
  - Rosa en "Cancelar carga" y en `UNASSIGNED_NO_DRIVERS`.
  - Marcadores azules y verdes de la flota.
  - Etiquetas en mayúsculas y un halo ámbar bajo "Siguiente".
  - No están en las fases 2 a 4: necesitan una fase propia si se quieren rediseñar.

**Pendientes antes del despliegue**
- Registrar el dominio de la demo en Stadia (cuenta y dominio). En `localhost` no hace falta.
- Leer la versión de los términos de Stadia vigente desde el 9 de noviembre de 2026 y anotar cualquier cambio sobre
  caché.
- Confirmar con Stadia si una PWA cuenta como "aplicación móvil" para la excepción de 100 MB (lo consulta el
  responsable del proyecto).
- Plan B: la clave de CARTO la pide el responsable del proyecto; la prueba está descrita arriba.
- El plan gratuito es solo para uso no comercial: alcanza para la demo académica, no para producción.
- Consecuencia de la política de caché: si el conductor no abre la app, el mapa sin señal se vacía. Con las cabeceras
  actuales de Stadia esto pasa a las **6 horas**, no a la semana; con un proveedor sin cabeceras, a los 7 días.
- **Fondo oscuro:** decidido por la escena (cabina de noche, sol directo sobre una pantalla oscura con texto claro de
  alto contraste), no por la categoría.

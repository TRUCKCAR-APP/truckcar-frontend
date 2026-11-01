# Rediseño premium nativo · PWA del conductor

Rama `refactor/ui-premium` · un commit por fase · capturas en 390×844, 360×800, 768×1024 y 1440×900.
Auditoría inicial: [AUDITORIA.md](AUDITORIA.md). Dirección visual aprobada: **B** (prototipo en
[`prototipo/`](prototipo/)).

| Fase | Contenido | Estado |
|---|---|---|
| 1 | Auditoría y design tokens | Hecha; tokens actualizados a la dirección B |
| — | Prototipo de dirección (A y B) y pantallas de la dirección B | Hecho, en revisión |
| 2 | Mapa oscuro, barra inferior y botón SOS | Pendiente de aprobación del prototipo |
| 3 | HUD de navegación en vivo | Pendiente |
| 4 | Estados vacíos y pantallas Vehículo, Rutas, Alertas y Offline | Pendiente |

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

Pendiente (fase 2).

## 4. Estados vacíos

Pendiente (fase 4). En el prototipo, Alertas tiene tres estados distintos: vacío ("Sin reportes recientes", sin
afirmar que la vía sea segura), cargando y error ("No se pudieron cargar las alertas").

## 5. Capturas

**Prototipo, dirección B** ([`prototipo/capturas/`](prototipo/capturas/), cada captura rotulada con pantalla y
estado):
- [comparativa-b.png](prototipo/capturas/comparativa-b.png): las nueve pantallas y los estados del SOS.
- [comparativa-nuevas-2.png](prototipo/capturas/comparativa-nuevas-2.png): inicio de sesión, entrega (POD),
  hoja de reportar y los cambios de la última ronda.

**App real**

| Pantalla | Antes | Fase 1 |
|---|---|---|
| Carga | [antes](antes/carga-390x844.jpg) | [fase 1](fase-1/carga-390x844.jpg) |
| Vehículo | [antes](antes/vehiculo-390x844.jpg) | [fase 1](fase-1/vehiculo-390x844.jpg) |
| Navegar | [antes](antes/navegar-390x844.jpg) | [fase 1](fase-1/navegar-390x844.jpg) |
| SOS | [antes](antes/sos-390x844.jpg) | [fase 1](fase-1/sos-390x844.jpg) |
| Inicio de sesión (escritorio) | [antes](antes/login-1440x900.jpg) | [fase 1](fase-1/login-1440x900.jpg) |

Cada carpeta tiene las 10 pantallas en los 4 tamaños. Las capturas de la fase 1 son anteriores a la actualización
de los tokens a la dirección B.

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
  - Consecuencia: el Service Worker guarda hoy hasta 1.500 teselas sin vencimiento. Al pasar a Stadia debe respetar
    `Cache-Control`/`Expires` (o 7 días), quedarse bajo 100 MB y no precargar zonas en bloque.
  - Pendiente con Stadia: confirmar si una PWA en el navegador cuenta como "aplicación móvil" para la excepción de
    100 MB, y revisar la versión de los términos vigente desde el 9 de noviembre de 2026.
- **Fondo oscuro:** decidido por la escena (cabina de noche, sol directo sobre una pantalla oscura con texto claro de
  alto contraste), no por la categoría.

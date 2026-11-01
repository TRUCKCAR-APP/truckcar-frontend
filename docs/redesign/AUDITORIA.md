# Auditoría inicial · PWA del conductor (antes del rediseño)

Fecha: 1 de noviembre de 2026 · Rama `refactor/ui-premium` · Capturas en [`antes/`](antes/) (390×844, 360×800,
768×1024 y 1440×900). Método: `impeccable audit` (detector estático + revisión del render) y mediciones del código
(`js/`, `css/`, `index.html`).

## Puntaje

| # | Dimensión | Puntaje | Hallazgo principal |
|---|-----------|---------|--------------------|
| 1 | Accesibilidad | 2 | 232 textos de 9–12 px; `slate-500` sobre superficie a 3,7:1 |
| 2 | Rendimiento | 3 | `backdrop-filter` en hojas, toasts y tarjetas flotantes, sin respaldo para Android de gama media |
| 3 | Theming | 1 | Variables en `:root` existen, pero los componentes usan 40 hex y ~800 clases de color de Tailwind directas |
| 4 | Responsive | 3 | Funciona de 360 a 1440; chips de Alertas cortados y placa que se parte ("TDK-/410") |
| 5 | Integridad de la implementación | 1 | Sin sistema: 7 matices compitiendo como acento, monoespaciada como disfraz "técnico", glows de color |
| **Total** | | **10/20** | **Aceptable: trabajo significativo** |

## Veredicto de integridad

**No pasa.** No hay un sistema propio del producto. La interfaz combina los recursos que cualquier generador usa por
defecto: tarjetas iguales con gradiente azul marino, glows de color, monoespaciada para parecer técnica y un ícono de
color distinto junto a cada título. Nada de eso nace del uso real (cabina, sol, noche, un vistazo).

## Mediciones

| Medida | Antes |
|---|---|
| Matices de color usados como acento | 7: azul/`brand` (59), verde (128), ámbar (70), rosa/rojo (74), índigo (36), violeta, naranja |
| Neutros | `slate` con tinte azul (443 usos) sobre fondo `#020617` |
| Monoespaciada (`font-mono`, JetBrains Mono) | 74 usos en cifras, etiquetas y estados |
| Sombras de color / glow | 45 sombras; 7 de color (`shadow-brand-900/50`, `shadow-emerald-600/40`…) |
| Gradientes | 15 (tarjetas, botones, SOS, franja de la torre, login) |
| Texto de 12 px o menos | 232 ocurrencias |
| Etiquetas en mayúsculas espaciadas | 19 |
| Íconos | Font Awesome, 112 glifos distintos, en sólido y regular mezclados y de colores |
| Valores fijos en `css/main.css` | 65 hex/rgba |

## Hallazgos por severidad

**P1 Mayores**

- **[P1] Paleta caótica.** 7 matices como acento; cada título con su propio ícono de color. *Ubicación*:
  `js/views/driverApp.js`, `coordinatorPanel.js`, `generatorPanel.js`. *Impacto*: el ojo no sabe qué es acción, qué
  es estado y qué es emergencia; de reojo, todo pesa igual. → `/impeccable colorize` + tokens.
- **[P1] El rojo no es exclusivo de la emergencia.** Rosa/rojo para rechazar, cancelar, gálibo, errores y el botón
  "Llamar al 123" con el mismo tono que el SOS. *Impacto*: el SOS pierde su carácter inconfundible.
- **[P1] Texto pequeño.** 232 textos ≤12 px, etiquetas de la barra inferior de 11 px. *WCAG 1.4.4 / brief (≥17 px)*.
  → `/impeccable typeset`.
- **[P1] Estados vacíos flotando.** "Sin carga asignada" y "No hay alertas activas" en el centro de un vacío de
  ~1.300 px. *Impacto*: parece cargando o roto. → `/impeccable onboard`.
- **[P1] Navegación con información contradictoria** (no es de estilo, ver más abajo): el HUD dice "Sin posición" y
  "Fuera de la ruta" a la vez, mientras Carga dice "Transmitiendo ±9 m".

**P2 Menores**

- **[P2] Monoespaciada como disfraz** en cifras y etiquetas junto a Inter.
- **[P2] SOS con gradiente radial y glow rojo**; botón "Navegar" sobredimensionado en la barra inferior y una línea
  superior redundante en la pestaña activa.
- **[P2] Mapa claro (teselas OSM estándar) dentro de un contenedor oscuro**: deslumbra de noche.
- **[P2] Tarjetas idénticas** (mismo borde, mismo fondo con gradiente) en todas las pantallas, sin jerarquía.
- **[P2] Chips de Alertas cortados** al borde derecho sin indicio de desplazamiento.
- **[P2] Desenfoque sin respaldo**: `backdrop-filter` en hojas, toasts y tarjetas sin `@supports` para gama media.

**P3 Pulido**

- **[P3] Selección de texto, cursor y barra de desplazamiento** con los colores del navegador.
- **[P3] Placa partida** en el encabezado de Vehículo ("TDK-" / "410").

## Patrones sistémicos

- El color vive en las clases de Tailwind de cada vista, no en tokens: cambiar la marca exige tocar ~800 clases.
- La jerarquía se intenta con color e íconos, no con tamaño, peso y espacio.

## Lo que funciona y se conserva

- Base móvil sólida: `viewport-fit=cover`, áreas seguras, `100dvh`, sin zoom bloqueado, `:active` al presionar,
  `hover` solo con puntero fino, campos de 16 px en táctil, área táctil de 44 px con pseudo-elemento.
- Hojas inferiores arrastrables, toasts tipo Sonner, `prefers-reduced-motion` respetado.
- SOS de mantener 1,5 s con anillo de progreso (evita activaciones accidentales).

## Fuera del alcance visual (reportado, no corregido)

1. **GPS en reposo marcado como "Sin posición".** La telemetría solo acepta lecturas de los últimos 10 s y el
   navegador no repite lecturas si el teléfono no se mueve: con el camión detenido el HUD dice "Sin posición" aunque
   haya una lectura válida. Es lógica (`js/telemetry.js`), no presentación.
2. **"Fuera de la ruta" junto al punto de origen**: OSRM ajusta el origen a la vía más cercana; si la carga se
   publicó con coordenadas dentro de un parque o predio, el primer punto de la ruta queda a más de 250 m.
3. **Alertas: 0 en la interfaz con 3 activas en la base.** La API (`GET /alerts`) devuelve 0; el filtro es del
   backend. La interfaz muestra fielmente lo que recibe.

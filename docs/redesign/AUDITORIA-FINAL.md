# Auditoría final · PWA de TruckCar (después del rediseño)

Fecha: 2 de noviembre de 2026 · Rama `refactor/ui-premium` (fases 1 a 5).

**Método:** el mismo de la [auditoría inicial](AUDITORIA.md): `impeccable audit` con la misma rúbrica de 5 dimensiones.
- **Detector estático** sobre `index.html`, `css/` y `js/`.
- **Detector sobre el render** (Chrome) en 390×844 y 1440×900. La app autenticada no se puede escanear por URL, así que
  se escanearon lo que abre un usuario sin sesión: el inicio de sesión y el seguimiento público.
- **Revisión de las capturas** de [`fase-5/`](fase-5/) y mediciones del código.

## Puntaje: antes y después

| # | Dimensión | Antes | Después | Hallazgo que define el puntaje final |
|---|-----------|-------|---------|--------------------------------------|
| 1 | Accesibilidad | 2 | **3** | La app del conductor cumple AA (texto ≥14 px, secundario a 6:1, foco blanco a 14–16:1, SOS a 4,96:1). Quedan 91 textos de 12 px o menos en la Torre y "Mis envíos", el seguimiento público con textos de 11,5 px y un gris a 4,0:1, y el texto de ejemplo del inicio de sesión a 3,5:1. |
| 2 | Rendimiento | 3 | **3** | El desenfoque solo está en el HUD y en las tarjetas flotantes, con respaldo sólido (`@supports` y menos transparencia). La caché de teselas tiene un tope de 100 MB y vence sola. Sigue Tailwind por CDN, que compila las clases en el navegador: no es para producción. |
| 3 | Theming | 1 | **3** | Una sola fuente de tokens (`css/tokens.css`), y Tailwind lee los mismos tokens. Los 29 valores fijos de `main.css` no son matices: negro y blanco con transparencia, máscaras y la placa amarilla. La excepción es el seguimiento público, con su propio mapa claro. |
| 4 | Responsive | 3 | **3** | Los 4 tamaños sin desbordes, la columna de 480 px en escritorio, filtros con desplazamiento, placa en una línea, áreas seguras y áreas táctiles de 44 px. Los gestos y el teclado abierto solo se probaron con un teléfono emulado. |
| 5 | Integridad de la implementación | 1 | **3** | La app del conductor tiene un sistema propio, coherente de punta a punta. La Torre y "Mis envíos" comparten la paleta pero conservan su estructura vieja (tarjetas anidadas, Font Awesome). El seguimiento público quedó fuera del sistema. |
| **Total** | | **10/20** | **15/20** | **Bueno: atender las dimensiones débiles** |

## Veredicto de integridad

**Pasa en la app del conductor; pasa con reservas en el producto completo.**

La app del conductor expresa un sistema propio que nace del uso real:
- **Grafito casi monocromo:** el ámbar marca solo la acción principal y la pestaña activa; el verde, el estado ok; el
  ámbar con triángulo, la advertencia; y el rojo, solo el SOS.
- **Lectura de reojo:** cifras grandes y una sola tarjeta de navegación con la maniobra, la altura y el peso del
  vehículo.
- **Honestidad de los datos:** "Sin información" donde no hay fuente, y "Torre de control avisada" solo con el acuse
  del servidor.

Las reservas son tres:
- **Torre de control y "Mis envíos":** usan la paleta y los estados en español, pero conservan las tarjetas anidadas,
  Font Awesome y el texto pequeño de su diseño original.
- **Seguimiento público:** quedó fuera del rediseño y es lo primero que ve un cliente externo.
- **Tailwind por CDN:** no es apto para producción.

**Detector:** un hallazgo estático, el `clip-path: path()` del pin de destino. Es un **falso positivo verificado**: es
la silueta geométrica de un alfiler de mapa, no un contorno orgánico que imita un material.

## Mediciones: antes y después

| Medida | Antes | Después |
|---|---|---|
| Matices usados como acento | 7 (azul, verde, ámbar, rosa, índigo, violeta, naranja) | **1** (ámbar `#E8A33D`). El resto son estados: ok, advertencia y SOS. |
| Clases de matices fuera de los tokens | ~370 | **0 sin control.** Las 23 que quedan (seguimiento público, telemetría, recibo de entrega) pasan por la red de seguridad de Tailwind, que las lleva a ok, advertencia o grafito. |
| Neutros | `slate` con tinte azul sobre `#020617` | Grafito sin tinte sobre `#0C0E12`. `slate` es un alias del grafito (299 usos). |
| Monoespaciada | 74 usos de JetBrains Mono | 0 en pantalla. Quedan 30 clases `font-mono`, que ahora son Manrope con cifras tabulares. |
| Sombras de color y halos | 7 | **0** |
| Gradientes | 15 | **3**, funcionales: el desvanecido sobre el botón fijo y la máscara de los filtros. Ninguno decorativo. |
| Texto de 12 px o menos | 232 | **121** (114 clases y 7 reglas de CSS). En la app del conductor solo quedan las etiquetas de la barra inferior (12 px, excepción aceptada); el resto está en la Torre, "Mis envíos" y el seguimiento público. |
| Etiquetas en mayúsculas | 19 | **1**, en el seguimiento público. |
| Íconos | Font Awesome, 112 glifos de colores | **Phosphor, 55 símbolos** en la app del conductor, sin colores por tipo. Quedan 71 glifos de Font Awesome en la Torre, "Mis envíos", el seguimiento público y las hojas compartidas. |
| Valores fijos en `css/main.css` | 65 colores | 29, ninguno de matiz, frente a 593 usos de tokens |
| Desenfoque sin respaldo | Hojas, toasts y tarjetas | Solo el HUD y las tarjetas flotantes, con respaldo sólido. |
| Rojo fuera del SOS | Rechazar, cancelar, gálibo, errores | **Ninguno.** Las acciones destructivas son neutras y las advertencias, ámbar con triángulo. |

## Hallazgos que quedan

**P1 Mayores**

- **[P1] El seguimiento público quedó fuera del rediseño.** Es lo que abre un cliente con el enlace
  ([390×844](final/seguimiento-publico-390x844.jpg), [1440×900](final/seguimiento-publico-1440x900.jpg)).
  - *Ubicación:* `js/views/publicTracking.js`.
  - *Qué tiene:*
    - El **mapa claro** de OpenStreetMap, con su propia capa de teselas en lugar del proveedor de `js/config.js`, que el
      Service Worker no guarda.
    - "SEGUIMIENTO DE ENVÍO" en mayúsculas, un chip ámbar teñido ("En ruta") e íconos ámbar decorativos.
    - 4 textos de 11,5 px y un gris a 4,0:1, por debajo de AA.
    - El botón de voz, que no tiene función para un visitante.
  - *Impacto:* lo primero que ve un cliente externo no se parece a la app, y de noche el mapa claro deslumbra.
  - → `/impeccable colorize` + `/impeccable typeset`, con el mapa del proveedor configurado.
- **[P1] Tailwind por CDN** (`index.html`, línea 29). `cdn.tailwindcss.com` compila las clases en el navegador en
  cada carga.
  - *Impacto:* más tiempo hasta la primera pintura en un Android de gama media, y dependencia de un tercero sin
    versión fija. Tailwind lo desaconseja para producción.
  - → `/impeccable optimize`: generar el CSS en el despliegue.

**P2 Menores**

- **[P2] Texto pequeño en la Torre y "Mis envíos":** 91 clases de 12 px o menos (53 y 38), dentro de tarjetas
  anidadas. *WCAG 1.4.4.* Se acordó dejarlo fuera de la fase 5. → `/impeccable typeset` + `/impeccable layout`.
- **[P2] Font Awesome en la Torre, "Mis envíos", el seguimiento público y las hojas compartidas:** 71 glifos distintos
  junto a Phosphor. Son dos lenguajes de íconos en un mismo producto. → `/impeccable polish`.
- **[P2] Texto de ejemplo de los campos a 3,5:1** (`--color-text-disabled` sobre el fondo). Es un ejemplo, no una
  etiqueta, pero se lee mal bajo el sol. → `/impeccable polish`: usar el gris secundario (6:1).
- **[P2] Hojas de confirmación con íconos de Font Awesome** (`js/ui/sheet.js`): su color ya sigue los tokens, pero el
  glifo no es Phosphor como en el resto de la app del conductor.

**P3 Pulido**

- **[P3] Barra de la demostración en escritorio:** sigue con íconos de Font Awesome y un subtítulo de 12 px.
- **[P3] Prototipo estático** (`docs/redesign/prototipo/`): su anillo de foco sigue en azul. No es parte de la app.

## Patrones sistémicos

- **Dos sistemas conviviendo:** la app del conductor está construida con tokens, Phosphor y componentes propios
  (`.list`, `.btn-accent`, `.empty-state`). La Torre y "Mis envíos" siguen con clases utilitarias y tarjetas anidadas;
  la red de seguridad de color los acerca, pero no los integra.
- **El color ya no decide la jerarquía:** en todas las vistas la decide el tamaño, el peso y el espacio, y el color
  solo comunica estado.

## Lo que funciona y se conserva

- Una paleta con un significado por color, verificable: el rojo solo en el SOS y las advertencias siempre con
  triángulo.
- Datos honestos:
  - "Sin información" donde no hay fuente.
  - El riesgo por defecto de Route-AI no se muestra.
  - El acuse real del SOS.
  - La fecha real del mapa guardado.
  - El rumbo real o un punto.
- Funcionamiento sin señal verificado en Chrome:
  - La cola durable.
  - La caché de teselas con su vencimiento.
  - Una zona no vista se ve oscura y sin cuadros rotos.
- Base móvil heredada y respetada: áreas seguras, `100dvh`, sin zoom bloqueado, `:active`, `prefers-reduced-motion`,
  `prefers-reduced-transparency` y `prefers-contrast`.
- Pruebas: 69 en verde, con guardas contra matices sueltos, mayúsculas y códigos internos en los paneles.

## Recomendaciones en orden

1. **[P1] `/impeccable colorize`:** llevar el seguimiento público a la paleta, al mapa oscuro configurado y a los
   textos de ≥14 px.
2. **[P1] `/impeccable optimize`:** generar el CSS de Tailwind en el despliegue, en lugar del CDN.
3. **[P2] `/impeccable typeset`:** texto de 12 px o menos en la Torre y "Mis envíos".
4. **[P2] `/impeccable polish`:** Font Awesome → Phosphor en lo que queda, y el gris del texto de ejemplo de los campos.

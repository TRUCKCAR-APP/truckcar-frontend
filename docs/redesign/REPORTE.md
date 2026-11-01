# Rediseño premium nativo · PWA del conductor

Rama `refactor/ui-premium` · un commit por fase · capturas en 390×844, 360×800, 768×1024 y 1440×900.
Auditoría inicial: [AUDITORIA.md](AUDITORIA.md).

| Fase | Contenido | Estado |
|---|---|---|
| 1 | Auditoría y design tokens | Hecha |
| 2 | Mapa oscuro, barra inferior y botón SOS | Pendiente |
| 3 | HUD de navegación en vivo | Pendiente |
| 4 | Estados vacíos y pantallas Vehículo, Rutas, Alertas y Offline | Pendiente |

## 1. Paleta: antes y después

Todos los valores viven en [`css/tokens.css`](../../css/tokens.css). Tailwind lee las mismas variables
(`index.html`), así que también sus utilidades son tokens.

| Rol | Antes | Después |
|---|---|---|
| Fondo | `#020617` (slate-950, tinte azul) | `#0B0D12` grafito |
| Superficie | `#0F172A` (slate-900) | `#14171F` |
| Elevada | `#1E293B` (slate-800) | `#1C2029` |
| Borde | `rgba(148,163,184,.14)` | `rgba(255,255,255,.08)`; `.10` en elementos elevados |
| Texto primario | `#F1F5F9` y `#FFFFFF` | `#F3F4F6` (sin blanco puro: deslumbra de noche) |
| Texto secundario | `#A3B1C6`, `#8796AD`, `slate-500` (3,7:1) | `#9CA3AF` (7,1:1 sobre superficie) |
| Acento | 7 matices: azul `#2563EB`, verde, ámbar, rosa, índigo, violeta, naranja | **Uno: naranja seguridad `#FF8A1F`** |
| Texto sobre el acento | blanco (2,8:1 sobre naranja) | `#0B0D12` (8,2:1) |
| Estado ok | `#10B981` | `#22C55E` (solo estado) |
| Advertencia | `#F59E0B` | `#F5B83D` (solo estado) |
| SOS y emergencia | `#EF4444` mezclado con rosa de rechazos y errores | `#EF4444` **exclusivo** |
| Tipografía | Inter + JetBrains Mono | SF Pro (Apple) / Inter, cifras con `tabular-nums`; sin monoespaciada |

**Por qué naranja seguridad y no ámbar.** El brief reserva el ámbar para advertencias: un acento ámbar haría
indistinguibles "esto es un botón" y "esto es un aviso". El naranja es el color de alta visibilidad que el
conductor ya lee en la vía (señalización de obra, chalecos). Se separa del rojo SOS por luminancia y no solo por tono:
el acento lleva texto oscuro (8,2:1) y el SOS texto blanco. Esa diferencia sobrevive al daltonismo rojo-verde, que
confunde rojo y naranja por tono pero no por claridad.

**Escalas.** Tipografía 13 · 15 · 17 · 20 · 24 · 28 · 36 · 48 px (cuerpo 17, cifras clave ≥28). Espacio en múltiplos
de 4 px (`--space-1` a `--space-16`, margen lateral `--gutter` = 16 px). Radios 8 · 12 (botones) · 16 (tarjetas) ·
20 (hojas y HUD) · píldora. Elevación neutra con desplazamiento (`--elev-1` a `--elev-3`), nunca halos de color.
Movimiento: `--ease-out`, `--dur-press` 140 ms, `--press-scale` 0,97, y `prefers-reduced-motion`,
`prefers-reduced-transparency` y `prefers-contrast` ajustan los tokens, no los componentes.

**Fase 1 aplicada.** Neutros, blanco, acento (`brand`) y tipografía remapeados globalmente a tokens; hojas, toasts,
indicador de red, marco de escritorio y tarjetas en tokens, sin gradientes ni desenfoque decorativo. Torre de control
y "Mis envíos" heredan los tokens sin rediseño de estructura (decisión confirmada). Los matices restantes (verde,
índigo, rosa) se migran pantalla por pantalla en las fases 2–4.

## 2. Tarjeta unificada del HUD

Pendiente (fase 3).

## 3. Barra inferior

Pendiente (fase 2).

## 4. Estados vacíos

Pendiente (fase 4).

## 5. Capturas antes y después

| Pantalla | Antes | Fase 1 |
|---|---|---|
| Carga | [antes](antes/carga-390x844.jpg) | [fase 1](fase-1/carga-390x844.jpg) |
| Vehículo | [antes](antes/vehiculo-390x844.jpg) | [fase 1](fase-1/vehiculo-390x844.jpg) |
| Navegar | [antes](antes/navegar-390x844.jpg) | [fase 1](fase-1/navegar-390x844.jpg) |
| SOS | [antes](antes/sos-390x844.jpg) | [fase 1](fase-1/sos-390x844.jpg) |
| Inicio de sesión (escritorio) | [antes](antes/login-1440x900.jpg) | [fase 1](fase-1/login-1440x900.jpg) |

Cada carpeta tiene las 10 pantallas en los 4 tamaños.

## 6. Inconsistencias de datos encontradas (reportadas, no corregidas)

1. **Vehículo: "Peso Bruto Máx." igual a la Tara y "Carga Útil" en 0.0 Ton** (TDK-410: 8.5 / 8.5 / 0.0). La interfaz
   calcula el peso bruto como tara + carga actual (`netCargoWeightTons`, que es 0 sin carga a bordo), no como el peso
   bruto máximo homologado del vehículo. El rótulo promete una capacidad y muestra un estado. Falta en el backend el
   dato de capacidad (peso bruto vehicular o carga útil máxima).
2. **Carga en tránsito: "Volumen —"** mientras peso y distancia tienen valor: el campo es opcional al publicar y la
   tarjeta reserva un tercio del ancho para un dato que casi nunca existe.
4. **Distancia de la ruta: 450 km y 10 h en la app (plan de Route-AI) contra 195 km y 3 h 20 min por carretera (OSRM)**
   para Bogotá → Ibagué. El plan de Route-AI parece una estimación de respaldo (dos tramos iguales de 225 km con un
   "Checkpoint Intermedio"); el tiempo de OSRM es de perfil de carro y subestima el de un camión.
3. **"Orden #CARGA-88" junto a la etiqueta técnica `IN_TRANSIT`**: el estado se muestra con el nombre interno del
   backend y no con su texto en español ("En tránsito"), que la misma pantalla sí usa en el stepper.

## 7. Decisiones de diseño

- **Acento naranja seguridad** (ver §1).
- **SF Pro donde exista, Inter en el resto**: el brief permite ambas; en iOS la fuente del sistema trae ajuste óptico
  y tracking por tamaño, y en Android Inter se carga de Google Fonts. El detector de impeccable marca Inter como
  "fuente sobreusada"; aquí la fija el brief, y en una herramienta de trabajo la familiaridad es una virtud.
- **Mapa oscuro: CARTO Dark Matter ya exige clave de API** (devuelve una imagen "API KEY REQUIRED" con código 200).
  El prototipo usa Stadia Maps *Alidade Smooth Dark*: teselas raster oscuras reales, sin clave en `localhost`; en
  producción requiere una cuenta (gratuita para uso no comercial) con el dominio registrado. Alternativa: Esri Dark Gray
  Canvas. **Aprobado: Stadia.**
- **Stadia y el caché del modo Offline** (Términos de servicio, versión del 18 de marzo de 2026, §8 y §13):
  - Se permite guardar "pequeñas cantidades" para uso sin conexión en una aplicación móvil, **máximo 100 MB por
    dispositivo**, y solo con una **suscripción activa** que cubra esas teselas.
  - Fuera de eso, el caché permitido es el estándar del cliente: **local al dispositivo**, nunca en servidor, y
    **sin guardar las teselas más tiempo del que indican sus cabeceras HTTP** (7 días si no envían ninguna).
  - El plan gratuito es solo para uso no comercial o evaluación; TruckCar en producción necesita un plan pago.
  - La atribución es obligatoria y no puede ocultarse.
  - Consecuencia para la fase 2: el Service Worker guarda hoy hasta 1.500 teselas "caché primero" sin vencimiento.
    Al cambiar a Stadia debe respetar `Cache-Control`/`Expires` (o 7 días), quedarse bajo 100 MB y no precargar
    zonas en bloque. Si una PWA en el navegador cuenta como "aplicación móvil" para la excepción de 100 MB no lo dicen
    los términos: hay que confirmarlo con Stadia. Además, publicaron una versión nueva vigente desde el 9 de noviembre
    de 2026 que conviene revisar.
- **Fondo oscuro**: decidido por la escena (cabina de noche, sol directo sobre una pantalla oscura con texto claro de
  alto contraste), no por la categoría.

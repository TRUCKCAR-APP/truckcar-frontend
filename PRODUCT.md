# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

- **Conductor de carga pesada** (usuario principal de esta PWA). Maneja tractocamiones y camiones rígidos por corredores
  colombianos (Bogotá–Ibagué, La Línea, Buenaventura). Mira la pantalla de reojo, de noche o bajo sol directo, con
  las manos ocupadas, en un **Android de gama media en vertical, montado en un soporte de tablero** (confirmado por el
  usuario). Su trabajo: aceptar cargas, seguir la ruta segura para su vehículo, reportar novedades de la vía, pedir
  ayuda (SOS) y registrar la entrega con prueba.
- **Torre de control** (COORDINADOR/ADMIN): monitorea la flota, asigna cargas y atiende SOS. Comparte la PWA.
- **Generador de carga** (GENERADOR): publica envíos, los sigue y comparte un enlace público de seguimiento.

## Product Purpose

TruckCar conecta generadores de carga con conductores de carga pesada y acompaña el viaje de punta a punta:
asignación, ruta apta para el vehículo (gálibo, peso), navegación paso a paso, alertas viales comunitarias, SOS y
prueba de entrega digital, con funcionamiento sin señal. El éxito es que el conductor complete el viaje y la entrega
sin distraerse de la vía y que nada de lo que hace sin cobertura se pierda.

## Positioning

Es una herramienta de trabajo para el camionero colombiano, no un mapa de consumo: la ruta respeta las restricciones
del vehículo, las alertas vienen de otros conductores en la misma vía y todo funciona sin señal en la cordillera.

## Operating Context

- Cabina en movimiento: vibración, sol directo, conducción nocturna, guantes o manos ocupadas; lectura a un vistazo.
- Cobertura intermitente en corredores de montaña: la PWA guarda posiciones, alertas, entregas y SOS en una cola
  durable y los envía al reconectar.
- La guía de voz acompaña la navegación; la pantalla confirma, no exige lectura larga.
- Entrega con firma y foto del receptor (POD) en el punto de descargue.

## Capabilities and Constraints

- PWA sin build: HTML, CSS y JavaScript plano, Tailwind por CDN, Leaflet para mapas, Font Awesome hasta el rediseño.
- Backend vía api-gateway (microservicios); telemetría por STOMP/WebSocket; Service Worker con app shell en caché.
- Navegación paso a paso: plan de Route-AI + maniobras de OSRM (perfil de carro; aún no considera gálibo/peso en el
  trazado calle por calle).
- El GPS real del dispositivo es la única fuente de posición para SOS y reportes; la simulación es solo herramienta
  de prueba.
- Rojo reservado exclusivamente para SOS y emergencias (compromiso del brief de rediseño).
- No cambiar lógica de negocio, endpoints, rutas, el flujo de POD, la cola offline ni el modal de SOS en trabajos de
  presentación.

## Brand Commitments

- Nombre: **TruckCar** (wordmark "TRUCKCAR"); ícono en `assets/icon.svg`.
- Idioma: español de Colombia, trato de "usted", tono directo y operativo.
- Rediseño premium nativo (noviembre 2026): paleta grafito neutra con un solo acento, Inter o SF Pro con cifras
  tabulares, sin monoespaciada en la UI, un solo set de íconos de trazo consistente.

## Evidence on Hand

- Usuarios y datos de demostración locales (`*@truckcar.demo`), carga de ejemplo Bogotá → Ibagué. No hay clientes,
  testimonios ni métricas de negocio reales: no se inventan.

## Product Principles

1. Un vistazo basta: la información de conducción se lee en menos de un segundo, de día y de noche.
2. Nada se pierde sin señal: cada acción del conductor se guarda y se sincroniza.
3. La emergencia es inconfundible: el SOS y sus estados nunca compiten con otro color o control.
4. Verdad antes que adorno: lo que la pantalla muestra es real (GPS, ruta, estado), y si algo es simulado lo dice.

## Accessibility & Inclusion

- WCAG AA mínimo (4.5:1 texto, 3:1 texto grande); texto principal ≥17px, cifras clave ≥28px.
- Áreas táctiles ≥44×44px, márgenes laterales de 16px, safe areas respetadas.
- `prefers-reduced-motion` respetado; sin zoom bloqueado.

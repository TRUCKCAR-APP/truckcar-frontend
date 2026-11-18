# Copiloto TruckCar: comandos de voz del conductor

El conductor opera la app sin soltar el volante. Habla, el copiloto entiende la orden, llama a las mismas funciones que
usan los botones y responde por voz. Toda respuesta se lee en voz alta, incluidos los errores del backend: nunca hay
que leer texto pequeño conduciendo.

## Cómo se activa

| Forma | Dónde funciona |
|---|---|
| Botón flotante **Copiloto** (abajo a la derecha, sobre la barra de pestañas) | Navegador y APK. El primer toque enciende el copiloto y escucha; los siguientes escuchan una orden; mantenerlo presionado lo apaga |
| Teclas multimedia del volante o de audífonos Bluetooth (play/pausa, siguiente) | Con el copiloto encendido, por `MediaSession`. En Chrome de Android funciona; en el WebView de la APK depende del fabricante |
| Palabra de activación **"Hola TruckCar"** o **"Copiloto"** | Solo en el navegador, con escucha continua |

**Por qué la palabra de activación no está en la APK:** el reconocedor de Android no es continuo. Cada sesión hace un
pitido del sistema y se corta con el silencio, así que repetir sesiones sin parar molesta y gasta batería. En la APK se
usan el botón y las teclas multimedia.

## Órdenes

| Intención | Ejemplos | Qué hace |
|---|---|---|
| Reporte vial | "reportar accidente", "hay un derrumbe adelante", "vía cerrada", "retén", "báscula", "gálibo bajo", "parador seguro" | Toma la posición GPS actual, publica en Community-Alerts con el tipo exacto (`DERRUMBE`, `ACCIDENTE`, `OBRA_EN_VIA`, `RETEN`, `BASCULA`, `GALIBO_REDUCIDO` o `PARADOR_SEGURO`) y confirma: «Reporte de derrumbe registrado en su ubicación». Sin señal, lo guarda en la cola offline. Sin GPS, no envía nada y lo dice |
| SOS | "enviar alerta SOS", "auxilio", "emergencia" | Pide confirmación y abre el mismo flujo del botón SOS (posición, torre de control y llamada al 123) |
| Recalcular ruta | "recalcular ruta" | Nueva ruta desde la posición actual. Lee la distancia y el tiempo nuevos |
| Ruta alterna | "cambiar de ruta", "buscar ruta alterna", "evitar este tramo" | Evita el tramo de adelante (≈1,5 km), con el mismo mecanismo de desvío de los bloqueos. Valida gálibo y peso y avisa si la alternativa tiene restricciones |
| Datos de la carga | "qué llevo", "especificaciones de la carga", "cuál es el peso", "dirección de destino" | Lee la carga asignada real (Load-Allocation) |
| Tiempo restante | "cuánto falta para llegar" | Distancia y tiempo restantes de la ruta guiada, y hora estimada de llegada |
| Jornada | "cuántas horas llevo manejando", "cuánto me falta para descansar" | `drivingHoursToday` y `remainingDrivingHours` de fleets-drivers (calculadas con la telemetría), o el descanso obligatorio |
| Propuesta | "aceptar carga", "rechazar la carga" | Pide confirmación y ejecuta lo mismo que los botones |
| Viaje | "iniciar viaje", "confirmar entrega" | Iniciar pide confirmación (la carga pasa a tránsito). Entregar pide confirmación y abre el registro de entrega: la firma y el nombre de quien recibe se completan con el vehículo detenido |
| Guía | "repite la instrucción", "qué sigue" | Lee la próxima maniobra |
| Alertas cercanas | "alertas cercanas", "qué hay adelante" | Lee las 3 alertas o bloqueos más cercanos, hasta 50 km |
| Ayuda / apagar | "ayuda", "apagar copiloto" | — |

**Confirmación verbal:** aceptar, rechazar, iniciar viaje, entregar y SOS preguntan «… Diga sí o cancelar».
- Si la respuesta no es clara, lo pide una vez más.
- Si tampoco entonces es clara, o el conductor no responde, cancela.
- Una confirmación vence a los 15 segundos: un «sí» tardío no ejecuta nada.

**Lo que no entiende:** responde con ejemplos breves. No abre ventanas ni bloquea la pantalla.

**Respaldo con IA (Voice-AI-Assistant):**
- Cuando las reglas no entienden una frase ("se vino la montaña encima de la vía", "llévame por otro lado"), el copiloto la consulta una vez en `POST /api/v1/assistant/interpret`.
- **Qué viaja:** solo el texto y si hay carga o navegación activa, nunca el audio. El tiempo límite es de 6 s.
- **Qué se ejecuta:** la respuesta vuelve a validarse en la app contra las intenciones que conoce, y se ejecuta con las mismas confirmaciones de siempre.
- **Reportes:** un reporte que solo entendió la IA se confirma ("¿Reporto vía cerrada en su ubicación?") antes de publicarse para los demás conductores.
- **Preguntas generales de conducción:** reciben una respuesta corta, sin acción.
- **Si falla:** sin conexión, si el servicio falla o si Azure no está configurado, el copiloto responde las opciones de siempre.
- **Qué nunca se delega:** lo que las reglas sí entienden nunca se envía a la IA, y apagar el copiloto nunca se le delega.

**Tráfico pesado:** Community-Alerts no tiene un tipo para eso. El copiloto lo dice y enumera lo que sí se puede
reportar, en lugar de publicarlo con un tipo equivocado. Para reportarlo habría que agregar un tipo nuevo al enum
`AlertType` del backend.

## Arquitectura

| Archivo | Responsabilidad |
|---|---|
| `js/services/voiceIntents.js` | Parser puro de intenciones: normaliza (minúsculas, sin tildes, sin relleno ni palabra de activación) y aplica reglas ordenadas por prioridad. El peligro en la vía va antes que las órdenes de ruta, y rechazar antes que aceptar («no acepto la carga») |
| `js/services/voiceAssistant.js` | `createController(deps)`: qué decir y qué hacer, con confirmaciones; recibe las acciones inyectadas y se prueba sin DOM. Además, los reconocedores (nativo y web), el botón, el banner con la transcripción (`pointer-events: none`, no tapa el mapa ni el scroll) y `MediaSession` |
| `js/speechEngine.js` | Voz. En la APK usa el plugin nativo `TextToSpeech`, en cola propia, porque el plugin siempre interrumpe la frase anterior. En el navegador usa `speechSynthesis`. `say()` resuelve al terminar de hablar, así el copiloto no se escucha a sí mismo |
| `js/navigation.js` | `RouteGuidance.recalculate({ avoidAhead })` y `remaining()`, sobre la misma lógica de rutas y desvíos de la navegación |

El único endpoint propio del copiloto es el respaldo con IA (`TruckCarApi.assistant.interpret`). Las acciones son las funciones reales de la app:
- `TruckCarService.reportAlert`, `DriverActions.activate` (SOS) y `TruckCarService.loadDriverProfile`;
- `app.handleAcceptTrip`, `app.performRejectTrip`, `app.startNavigation` y `app.finishTrip`.

Los plugins nativos se llaman con el puente de Capacitor (`Capacitor.nativePromise` y `Capacitor.addListener`), sin
empaquetar `@capacitor/core`. Ver [ANDROID-APK-BUILD.md](ANDROID-APK-BUILD.md).

**Tonos:**
- dos notas ascendentes al empezar a escuchar;
- dos notas descendentes al terminar;
- se generan con Web Audio, sin archivos.

## Pruebas

- **`test/copilotoVoz.test.mjs`** (16 pruebas):
  - frases de cada intención, con ruido;
  - palabra de activación;
  - respuestas sí/no;
  - confirmaciones (sí, cancelar, silencio, respuesta confusa y vencimiento);
  - errores RFC 7807 leídos sin el código de traza;
  - lecturas de carga y jornada;
  - recálculo;
  - voz nativa en cola.
- **`test/copilotoIA.test.mjs`** (8 pruebas):
  - lo que entienden las reglas no se envía;
  - los reportes de la IA se confirman;
  - SOS, carga, tiempo restante y recálculo desde la IA;
  - respuesta general;
  - aclaración y caída del servicio;
  - validación de lo que devuelve;
  - qué viaja al servicio y que no se llama sin conexión.
- **`test/stageAndroid.test.mjs`:** los plugins nativos registrados en Gradle y en `capacitor.plugins.json`, y el permiso de micrófono.

## Límites conocidos

- **Teléfono real:** el reconocimiento en la APK depende del servicio de voz de Google en el teléfono y del paquete de español. Hay que probarlo en un teléfono real antes de una demostración.
- **Sin señal:** sin conexión, el reconocimiento de Android funciona solo si el teléfono tiene descargado el español para uso sin conexión.
- **Teclas multimedia en la APK:** dependen del WebView y del fabricante.

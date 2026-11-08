# Dependencias pendientes de backend y Android

El frontend usa `POST /fleets-drivers/state` para registrar o actualizar el estado de un conductor,
`GET /fleets-drivers/active` para refrescar la flota y el WebSocket de telemetría para posiciones. Las capacidades
siguientes requieren contratos de backend antes de conectarse.

## Contratos de API pendientes

- **Directorio de conductores:** la torre necesita una consulta paginada/autorizada de usuarios con rol CONDUCTOR,
  incluyendo id, nombre, teléfono y vehículo actual. `GET /users` no aparece documentado como contrato. Actualmente se
  usan conductores conocidos por la flota y candidatos de asignación; si no hay ninguno, el formulario queda bloqueado.
- **Unicidad de placa:** el frontend impide elegir una placa ya asociada a otro conductor en la flota visible. El backend
  debe imponer la unicidad de forma transaccional y devolver `409` ante colisiones; los datos locales no garantizan que
  no exista una placa duplicada fuera de la flota recibida.
- **Mensajería de despacho:** hacen falta operaciones para listar y enviar mensajes, identificador idempotente,
  confirmación de recepción/lectura y un contrato STOMP con destinos de suscripción/publicación, permisos y formato de
  eventos. Los mensajes no se almacenan ni se presentan como enviados hasta que exista ese contrato.
- **Push:** hacen falta el endpoint autenticado de asociación/eliminación de token por dispositivo, contrato de payload
  y configuración de entrega en backend. Para Web Push se necesita una clave pública VAPID; para Android, proyecto y
  `google-services.json` de Firebase Cloud Messaging. No se solicita permiso ni se registra un token automáticamente
  mientras la entrega no esté configurada.

## Android

El identificador declarado es `co.com.truckcar.app`. Esta carpeta no contiene el wrapper Gradle (`gradlew`,
`gradlew.bat` y `gradle-wrapper.jar`), no hay Android SDK configurado en este entorno y las dependencias Capacitor no
están instaladas en `node_modules`. Además, `package-lock.json` no incluye las dependencias Capacitor declaradas en
`package.json`; hay que regenerarlo con `npm install` antes de que `npm ci` pueda preparar un build reproducible. La
actividad principal ya hereda de `BridgeActivity` y requiere sincronizar el proyecto Capacitor antes de compilar.

Para segundo plano se requiere instalar y registrar un plugin Capacitor de geolocalización en segundo plano que sea
compatible con Capacitor 6, declarar sus permisos/servicio conforme a su documentación y validar los permisos de
ubicación en primer plano y segundo plano en el dispositivo. La API web de geolocalización solo funciona mientras la
aplicación está activa y no equivale a rastreo continuo.

La Background Sync del Service Worker solo despierta una página que ya esté abierta para que envíe la cola con su sesión
autenticada. Sin una integración nativa que gestione credenciales de forma segura, la sincronización durable ocurre al
reconectar o volver a abrir la aplicación; no se afirma sincronización con la app terminada.

Una vez disponibles JDK 17, Android SDK, dependencias npm instaladas y la configuración de Firebase/backend requerida,
se puede sincronizar la plataforma con `npx cap sync android` y compilar el APK debug con
`cd android; .\\gradlew.bat assembleDebug`.

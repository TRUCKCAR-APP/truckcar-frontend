# Compilar el APK de TruckCar para Android

TruckCar es la misma aplicación web (HTML, CSS y JavaScript) empaquetada en un APK con **Capacitor 6**. El proyecto
Android ya está en el repositorio, en la carpeta `android/`. No hace falta ejecutar `npx cap add android`.

## 1. Requisitos

| Herramienta | Versión |
|---|---|
| Node.js | 20 o superior |
| JDK | **17**. Gradle 8.2.1 no se ejecuta con JDK 21. Configure `JAVA_HOME` con el JDK 17 |
| Android SDK | Platform 34 y Build-Tools 34. Configure `ANDROID_HOME` (en Windows: `C:\Users\<usuario>\AppData\Local\Android\Sdk`) |

No hace falta instalar Gradle: el repositorio trae el wrapper (`android/gradlew` y `android/gradlew.bat`).

## 2. Compilar

```bash
npm ci
npm run build:css

# Copia la web a android/, inyecta la URL del API y registra los plugins nativos.
TRUCKCAR_API_BASE_URL=https://<dominio-del-api-gateway> npm run build:apk

cd android
./gradlew assembleDebug        # Windows: .\gradlew.bat assembleDebug
```

El APK queda en `android/app/build/outputs/apk/debug/app-debug.apk`.

### `TRUCKCAR_API_BASE_URL`

- **Es obligatoria y debe ser `https`.** La APK no tiene URL de respaldo, y en `capacitor.config.js` están apagados el tráfico en claro, el contenido mixto y la depuración del WebView.
- **CORS:** la app instalada llama al backend con el origen `https://localhost`, que debe estar en `TRUCKCAR_CORS_ALLOWED_ORIGINS` y `TRUCKCAR_WEBSOCKET_ALLOWED_ORIGINS`.
- **`TRUCKCAR_APP_HOSTNAME`** es opcional y cambia ese nombre interno. **No es la URL del backend.** Si se le pone el dominio del API, Capacitor sirve localmente las llamadas a ese dominio y ninguna llega al servidor.

### Qué hace `npm run build:apk` (`scripts/stage-android.mjs`)

Reemplaza a `cap sync`, que falla porque Capacitor 6 rechaza `webDir: "."` (la web está en la raíz del repositorio).

1. Copia a `android/app/src/main/assets/public/` exactamente lo que publica el Dockerfile: `index.html`, `manifest.webmanifest`, `sw.js`, `assets/`, `fonts/`, `css/` y `js/`.
2. Inyecta la URL del API en `index.html`.
3. Escribe `capacitor.config.json` y `capacitor.plugins.json`. El segundo lo arma con los plugins nativos de `node_modules/@capacitor-community`. Si un plugin no está ahí, Capacitor no lo registra y su llamada falla en el teléfono.

Esos archivos generados están en `android/.gitignore`.

## 3. Plugins nativos

| Plugin | Para qué |
|---|---|
| `@capacitor-community/speech-recognition` 6.0.1 | Reconocimiento de órdenes del copiloto de voz. El WebView de Android **no** implementa `SpeechRecognition` |
| `@capacitor-community/text-to-speech` 4.1.1 | Voz de la app: guía de navegación, avisos y copiloto. El WebView de Android **no** implementa `speechSynthesis`, así que sin este plugin la guía de voz sería muda en la APK |

**Para agregar otro plugin de Capacitor:**
1. Instálelo con la versión exacta.
2. Agréguelo a `android/settings.gradle` (`include` y `projectDir`) y a `android/app/build.gradle` (`implementation project(...)`).
3. `npm run build:apk` lo registra solo en `capacitor.plugins.json`.

La prueba `test/stageAndroid.test.mjs` comprueba que los dos estén incluidos.

## 4. Permisos (`android/app/src/main/AndroidManifest.xml`)

| Permiso | Uso |
|---|---|
| `INTERNET`, `ACCESS_NETWORK_STATE` | API, WebSocket de telemetría y detección del modo sin señal |
| `ACCESS_FINE_LOCATION`, `ACCESS_COARSE_LOCATION` | Navegación, telemetría, reportes viales y SOS |
| `CAMERA` | Foto de la prueba de entrega |
| `VIBRATE` | Alertas |
| `RECORD_AUDIO` | Copiloto de voz. Se pide la primera vez que se activa |

También declara `<queries>` para `android.speech.RecognitionService` y `TTS_SERVICE`. Desde Android 11, sin esas
consultas la app no ve el reconocedor ni el motor de voz del sistema.

## 5. Instalar en el teléfono

1. Copie `app-debug.apk` al teléfono, o publíquelo en un GitHub Release y compártalo con un QR.
2. Ábralo. Android pedirá permitir **instalar aplicaciones de fuentes desconocidas**.
3. Una APK nueva se instala encima de la anterior si se compiló en el mismo equipo, porque usa la misma llave de depuración.

Si el reconocimiento de voz no responde, el teléfono necesita la app **Google** (servicio de voz del sistema) y el
paquete de idioma español.

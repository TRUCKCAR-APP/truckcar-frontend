# Guía de Compilación y Generación del APK de TruckCar para Android

TruckCar es una aplicación diseñada para conductores de carga pesada y operadores de torre de control. Aunque funciona con tecnología PWA moderna, **se compila directamente a un archivo binario nativo de Android (`.apk`) utilizando Capacitor**.

No es necesario reescribir la aplicación en otro lenguaje: todo el código existente (HTML5, Tailwind CSS, Leaflet Maps, WebSockets STOMP y la cola durable en IndexedDB) se ejecuta dentro del motor nativo optimizado de Android.

---

## 1. Requisitos Previos

En la máquina de compilación (Windows, macOS o Linux):
1. **Node.js**: Versión `>= 20.x` y `npm`.
2. **Java Development Kit (JDK)**: JDK 17 o JDK 21 (configurado en la variable de entorno `JAVA_HOME`).
3. **Android Studio**: Con el **Android SDK Platform 34**, **Android SDK Build-Tools** y **Android SDK Command-line Tools** instalados.
4. **Variable de entorno ANDROID_HOME**:
   - Windows: `C:\Users\<tu-usuario>\AppData\Local\Android\Sdk`

---

## 2. Configuración Inicial (Solo la primera vez)

Desde la raíz del proyecto `TRUCKCAR`:

1. **Instalar dependencias del proyecto:**
   ```bash
   npm install
   ```

2. **Compilar los estilos de producción:**
   ```bash
   npm run build:css
   ```

3. **Inicializar la plataforma nativa de Android con Capacitor:**
   ```bash
   npx cap add android
   ```
   *Esto generará automáticamente la carpeta `/android` con el proyecto Gradle, las actividades nativas y el archivo `AndroidManifest.xml`.*

4. **Sincronizar el código:**
   ```bash
   npx cap sync
   ```

---

## 3. Generación del APK

### Opción A: Compilación Rápida por Consola (Sin abrir Android Studio)

Una vez creada la carpeta `/android`, puedes generar el archivo `.apk` de prueba directamente desde la línea de comandos:

```bash
cd android
./gradlew assembleDebug
```
*(En Windows PowerShell: `.\gradlew assembleDebug`)*

El archivo `.apk` compilado quedará listo para instalar en:
```text
android/app/build/outputs/apk/debug/app-debug.apk
```

### Opción B: Desde Android Studio (Recomendado para Release / Google Play)

1. Abre el proyecto en Android Studio:
   ```bash
   npx cap open android
   ```
2. Espera a que Gradle termine de indexar el proyecto.
3. Para probar en un emulador o teléfono conectado por USB:
   - Haz clic en el botón verde **Run (Play)**.
4. Para generar el instalador final:
   - En el menú superior, ve a **Build** > **Build Bundle(s) / APK(s)** > **Build APK(s)**.
   - O para subir a Google Play: **Build** > **Generate Signed Bundle / APK**.

---

## 4. Instalación en el Teléfono del Conductor

1. Copia el archivo `app-debug.apk` al teléfono del conductor (por cable USB, descarga directa o WhatsApp).
2. En el teléfono Android:
   - Abre el archivo APK descargado.
   - Si Android lo solicita, activa el permiso **"Instalar aplicaciones de fuentes desconocidas"**.
   - Presiona **Instalar**.
3. La aplicación aparecerá en el cajón de aplicaciones de Android con el icono oficial de **TruckCar** y se ejecutará a pantalla completa como una aplicación nativa.

---

## 5. Permisos Nativos Configurados (`AndroidManifest.xml`)

Al sincronizar con Capacitor, el archivo `android/app/src/main/AndroidManifest.xml` debe incluir los permisos críticos de hardware que usa TruckCar:

```xml
<manifest xmlns:android="http://schemas.android.com/apk/res/android">
    <!-- Ubicación GPS en tiempo real para navegación y SOS -->
    <uses-permission android:name="android.permission.ACCESS_FINE_LOCATION" />
    <uses-permission android:name="android.permission.ACCESS_COARSE_LOCATION" />
    
    <!-- Conectividad a Internet y WebSockets de telemetría -->
    <uses-permission android:name="android.permission.INTERNET" />
    <uses-permission android:name="android.permission.ACCESS_NETWORK_STATE" />
    
    <!-- Cámara para captura de evidencias y remisión firmada (POD) -->
    <uses-permission android:name="android.permission.CAMERA" />
    
    <!-- Evitar que la pantalla se apague mientras se navega en la cabina -->
    <uses-permission android:name="android.permission.WAKE_LOCK" />
</manifest>
```

---

## 6. Flujo de Actualizaciones Posteriores

Cada vez que se modifique código JavaScript, HTML o CSS en el frontend:

```bash
# 1. Compilar CSS si hubo cambios de diseño
npm run build:css

# 2. Sincronizar el contenido web con la carpeta nativa de Android
npm run cap:sync

# 3. Compilar el nuevo APK
cd android && ./gradlew assembleDebug
```

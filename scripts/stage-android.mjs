// Prepara android/ para compilar la APK sin `cap sync` (Capacitor 6 rechaza webDir: "." y el proyecto web está en la
// raíz del repositorio). Copia exactamente lo que publica el Dockerfile, inyecta la URL del API y escribe los dos
// archivos que Capacitor lee al arrancar: capacitor.config.json y capacitor.plugins.json (plugins nativos instalados).
//
// Uso: TRUCKCAR_API_BASE_URL=https://<api> node scripts/stage-android.mjs
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { injectApiBaseUrl, injectMapApiKey } from "./inject-config.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const ASSETS = join(ROOT, "android", "app", "src", "main", "assets");
const PUBLIC = join(ASSETS, "public");
// Modelo de voz en español de Vosk para oír la frase de activación en el teléfono, sin internet ni pitidos. No va en
// git (58 MB): se descarga de https://alphacephei.com/vosk/models y se indica con VOSK_MODEL_DIR (por defecto
// ~/tools/vosk/vosk-model-small-es-0.42). Sin modelo, la APK usa el reconocedor de Android también para la frase.
const VOSK_MODEL = process.env.VOSK_MODEL_DIR || join(homedir(), "tools", "vosk", "vosk-model-small-es-0.42");
const MODEL_ASSET = join(ASSETS, "model-es");
const WEB = ["index.html", "manifest.webmanifest", "sw.js", "assets", "fonts", "css", "js"];

/** Plugins nativos de node_modules/@capacitor-community: paquete y clase Java que extiende Plugin. */
export function nativePlugins(root = ROOT) {
  const scope = join(root, "node_modules", "@capacitor-community");
  if (!existsSync(scope)) return [];
  const javaFiles = (dir) => readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    return statSync(path).isDirectory() ? javaFiles(path) : path.endsWith(".java") ? [path] : [];
  });
  return readdirSync(scope).sort().flatMap((name) => {
    const src = join(scope, name, "android", "src", "main", "java");
    if (!existsSync(src)) return [];
    for (const file of javaFiles(src)) {
      const code = readFileSync(file, "utf8");
      const cls = code.match(/public class (\w+) extends Plugin\b/);
      const pkg = code.match(/^package ([\w.]+);/m);
      if (cls && pkg && /@CapacitorPlugin\b/.test(code)) {
        return [{ pkg: "@capacitor-community/" + name, classpath: pkg[1] + "." + cls[1] }];
      }
    }
    return [];
  });
}

function main() {
  const apiBaseUrl = process.env.TRUCKCAR_API_BASE_URL;
  rmSync(PUBLIC, { recursive: true, force: true });
  mkdirSync(PUBLIC, { recursive: true });
  for (const entry of WEB) cpSync(join(ROOT, entry), join(PUBLIC, entry), { recursive: true });

  const index = join(PUBLIC, "index.html");
  writeFileSync(index, injectMapApiKey(injectApiBaseUrl(readFileSync(index, "utf8"), apiBaseUrl, { requireUrl: true, requireHttps: true }),
    process.env.TRUCKCAR_MAP_API_KEY));

  const config = createRequire(import.meta.url)(join(ROOT, "capacitor.config.js"));
  writeFileSync(join(ASSETS, "capacitor.config.json"), JSON.stringify({ ...config, webDir: "public" }, null, 2));
  const plugins = nativePlugins();
  writeFileSync(join(ASSETS, "capacitor.plugins.json"), JSON.stringify(plugins, null, 2));

  rmSync(MODEL_ASSET, { recursive: true, force: true });
  const model = existsSync(join(VOSK_MODEL, "am")) && existsSync(join(VOSK_MODEL, "conf"));
  if (model) {
    cpSync(VOSK_MODEL, MODEL_ASSET, { recursive: true });
    // StorageService.unpack de Vosk copia el modelo al teléfono solo cuando cambia este identificador.
    writeFileSync(join(MODEL_ASSET, "uuid"), "vosk-model-small-es-0.42");
  }

  console.log("android/: web copiada, URL del API inyectada, " + plugins.length + " plugin(s) nativo(s): "
    + plugins.map((p) => p.pkg).join(", ") + (process.env.TRUCKCAR_MAP_API_KEY ? "; mapa Stadia con clave" : "; mapa sin clave (Esri)") + (model ? "; modelo de voz Vosk incluido" : "; SIN modelo Vosk (la frase usa el reconocedor de Android)"));
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  try {
    main();
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}

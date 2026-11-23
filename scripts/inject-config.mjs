import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const META = /(<meta name="truckcar-api-base-url" content=")[^"]*(">)/;
const MAP_KEY_META = /(<meta name="truckcar-map-api-key" content=")[^"]*(">)/;

/**
 * Clave de Stadia Maps (TRUCKCAR_MAP_API_KEY). Sin clave, Stadia solo sirve a localhost y config.js usa Esri; con
 * ella, Stadia funciona en cualquier dominio y en la APK. Es una clave de cliente (viaja en cada tesela), no un secreto
 * del servidor: limítela en el panel de Stadia y no la ponga en el repositorio.
 */
export function injectMapApiKey(html, mapApiKey) {
  const value = String(mapApiKey || "").trim();
  if (!MAP_KEY_META.test(html)) throw new Error("index.html no tiene la etiqueta meta truckcar-map-api-key");
  if (value && !/^[A-Za-z0-9_-]{8,128}$/.test(value)) throw new Error("TRUCKCAR_MAP_API_KEY no tiene el formato de una clave de Stadia");
  return html.replace(MAP_KEY_META, (match, open, close) => open + value + close);
}

export function injectApiBaseUrl(html, apiBaseUrl, { requireUrl = false, requireHttps = false } = {}) {
  const value = String(apiBaseUrl || "").trim();
  if (!META.test(html)) throw new Error("index.html no tiene la etiqueta meta truckcar-api-base-url");
  if (!value) {
    if (requireUrl) throw new Error("Falta TRUCKCAR_API_BASE_URL: esta compilación necesita la URL del API");
    return html.replace(META, "$1$2");
  }
  let url;
  try {
    url = new URL(value);
  } catch (error) {
    throw new Error("TRUCKCAR_API_BASE_URL no es una URL válida: " + value);
  }
  if (requireHttps && url.protocol !== "https:") {
    throw new Error("TRUCKCAR_API_BASE_URL debe usar https en esta compilación: " + value);
  }
  return html.replace(META, (match, open, close) => open + value.replace(/&/g, "&amp;").replace(/"/g, "&quot;") + close);
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  const args = process.argv.slice(2);
  const target = args.find((arg) => !arg.startsWith("--"));
  if (!target) {
    console.error("Uso: node scripts/inject-config.mjs <index.html> [--require-url] [--require-https]");
    process.exit(1);
  }
  try {
    const html = injectMapApiKey(injectApiBaseUrl(readFileSync(target, "utf8"), process.env.TRUCKCAR_API_BASE_URL, {
      requireUrl: args.includes("--require-url"),
      requireHttps: args.includes("--require-https")
    }), process.env.TRUCKCAR_MAP_API_KEY);
    writeFileSync(target, html);
    console.log(target + ": URL del API " + (process.env.TRUCKCAR_API_BASE_URL ? "inyectada" : "vacía (mismo origen)")
      + "; mapa " + (process.env.TRUCKCAR_MAP_API_KEY ? "Stadia con clave" : "sin clave (Esri fuera de localhost)"));
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}

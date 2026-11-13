import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const META = /(<meta name="truckcar-api-base-url" content=")[^"]*(">)/;

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
    const html = injectApiBaseUrl(readFileSync(target, "utf8"), process.env.TRUCKCAR_API_BASE_URL, {
      requireUrl: args.includes("--require-url"),
      requireHttps: args.includes("--require-https")
    });
    writeFileSync(target, html);
    console.log(target + ": URL del API " + (process.env.TRUCKCAR_API_BASE_URL ? "inyectada" : "vacía (mismo origen)"));
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}

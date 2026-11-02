// Comprueba que cada enlace relativo de la documentación apunte a un archivo que existe: los de Markdown
// ([texto](ruta)) y los src/href de HTML en línea. Ignora URLs absolutas, correo y anclas de la misma página.
// Uso: node scripts/check-doc-links.mjs [archivo.md ...]   (sin argumentos: docs/redesign/*.md y todos los README.md)
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

function readmes(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry.startsWith(".")) continue;
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) readmes(path, out);
    else if (entry.toLowerCase() === "readme.md") out.push(path);
  }
  return out;
}

const files = process.argv.length > 2
  ? process.argv.slice(2)
  : [...readdirSync("docs/redesign").filter((f) => f.endsWith(".md")).map((f) => join("docs/redesign", f)), ...readmes(".")];

let checked = 0;
const broken = [];
for (const file of files) {
  const text = readFileSync(file, "utf8").replace(/```[\s\S]*?```/g, "");
  const targets = [
    ...[...text.matchAll(/\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g)].map((m) => m[1]),
    ...[...text.matchAll(/\b(?:src|href)="([^"]+)"/g)].map((m) => m[1]),
  ];
  for (const raw of targets) {
    if (/^(?:[a-z][a-z0-9+.-]*:|#|\/\/)/i.test(raw)) continue;
    const target = decodeURIComponent(raw.split("#")[0].split("?")[0]);
    if (!target) continue;
    checked += 1;
    if (!existsSync(resolve(dirname(file), target))) broken.push(`${file}: ${raw}`);
  }
}
console.log(`${files.length} documentos, ${checked} enlaces relativos revisados, ${broken.length} rotos`);
broken.forEach((b) => console.log("  ✗ " + b));
process.exit(broken.length ? 1 : 0);

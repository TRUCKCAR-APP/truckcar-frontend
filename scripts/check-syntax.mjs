// Comprueba que todos los scripts de la PWA (y el Service Worker) se puedan analizar: un error de sintaxis en cualquiera
// rompe la app entera porque se cargan en orden desde index.html.
import { execFileSync } from "node:child_process";
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const files = [];
const walk = (path) => {
  if (statSync(path).isDirectory()) readdirSync(path).forEach((entry) => walk(join(path, entry)));
  else if (path.endsWith(".js")) files.push(path);
};
["js", "sw.js"].forEach(walk);

let failed = 0;
for (const file of files) {
  try {
    execFileSync(process.execPath, ["--check", file], { stdio: "pipe" });
  } catch (error) {
    failed += 1;
    console.error(`✗ ${file}\n${error.stderr.toString()}`);
  }
}
console.log(`${files.length - failed}/${files.length} archivos sin errores de sintaxis`);
process.exit(failed ? 1 : 0);

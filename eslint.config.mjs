// ESLint (configuración plana). La app son scripts clásicos que se cargan en orden desde index.html y se comunican por
// window.*; sw.js corre en el ámbito del Service Worker.
import js from "@eslint/js";
import globals from "globals";

export default [
  { ignores: ["node_modules/", "src/", "out/"] },
  js.configs.recommended,
  {
    rules: {
      // Estilo del código: catch (e) {} para fallos esperados y callbacks con parámetros que no se usan.
      "no-unused-vars": ["error", { args: "none", caughtErrors: "none" }],
      "no-empty": ["error", { allowEmptyCatch: true }],
    },
  },
  {
    files: ["js/**/*.js"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "script",
      globals: {
        ...globals.browser,
        L: "readonly",
      },
    },
  },
  {
    // Prototipo estático del rediseño (docs/redesign/prototipo): scripts de navegador sueltos.
    files: ["docs/**/*.js"],
    languageOptions: { ecmaVersion: 2022, sourceType: "script", globals: { ...globals.browser, L: "readonly" } },
  },
  {
    files: ["sw.js"],
    languageOptions: { ecmaVersion: 2022, sourceType: "script", globals: globals.serviceworker },
  },
  {
    files: ["test/**/*.mjs", "scripts/**/*.mjs", "eslint.config.mjs"],
    languageOptions: { ecmaVersion: 2022, sourceType: "module", globals: globals.node },
  },
];

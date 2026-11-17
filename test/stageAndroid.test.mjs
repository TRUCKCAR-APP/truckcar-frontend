import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { nativePlugins } from "../scripts/stage-android.mjs";

// La APK se prepara sin `cap sync` (Capacitor 6 rechaza webDir: "."): scripts/stage-android.mjs copia la web y escribe
// capacitor.plugins.json. Si un plugin nativo falta ahí, Capacitor no lo registra y su llamada falla en el teléfono.

test("los plugins nativos del copiloto de voz se registran con su clase Java real", () => {
  const plugins = nativePlugins();
  assert.deepEqual(plugins, [
    { pkg: "@capacitor-community/speech-recognition", classpath: "com.getcapacitor.community.speechrecognition.SpeechRecognition" },
    { pkg: "@capacitor-community/text-to-speech", classpath: "com.getcapacitor.community.tts.TextToSpeechPlugin" }
  ]);
});

test("cada plugin nativo está incluido en Gradle y la APK pide el micrófono", () => {
  const settings = readFileSync("android/settings.gradle", "utf8");
  const app = readFileSync("android/app/build.gradle", "utf8");
  for (const module of [":capacitor-community-speech-recognition", ":capacitor-community-text-to-speech"]) {
    assert.ok(settings.includes("include '" + module + "'"), module + " en settings.gradle");
    assert.ok(app.includes("implementation project('" + module + "')"), module + " en app/build.gradle");
  }
  assert.match(readFileSync("android/app/src/main/AndroidManifest.xml", "utf8"), /android\.permission\.RECORD_AUDIO/);
  // npm run build:apk ya no usa cap sync, que falla con webDir ".".
  assert.equal(JSON.parse(readFileSync("package.json", "utf8")).scripts["build:apk"], "node scripts/stage-android.mjs");
});

test("los archivos de Gradle no llevan BOM (Groovy no compila un build.gradle que empieza con U+FEFF)", () => {
  for (const file of ["android/build.gradle", "android/settings.gradle", "android/app/build.gradle", "android/gradle.properties",
    "android/gradle/wrapper/gradle-wrapper.properties"]) {
    const bytes = readFileSync(file);
    assert.ok(!(bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf), file);
  }
});

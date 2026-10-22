import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { viteSingleFile } from "vite-plugin-singlefile";

// Eine einzige index.html mit allem darin: pywebview laedt sie als Datei,
// ohne Server und ohne Nachladen - das ist der schnellste Start.
//
// `vite build --mode android` baut dieselbe Seite für die Android-App
// (Capacitor) nach ../webdist-android, dazu public-android/: die
// Startdaten (Stationsliste, Verzeichnis, Göttingen), die
// android_start.py beim Bau vom DWD holt.
export default defineConfig(({ mode }) => {
  const android = mode === "android";
  return {
    plugins: [svelte(), viteSingleFile()],
    base: "./",
    publicDir: android ? "public-android" : false,
    define: { __APP_VERSION__: JSON.stringify(process.env.VERSION || "v1.0") },
    // JSON als Text mit JSON.parse: die Ortsliste (3 MB) kostet so beim Start
    // fast nichts und wird erst beim Öffnen der Ortswahl gelesen
    json: { stringify: true },
    build: {
      outDir: android ? "../webdist-android" : "../webdist",
      emptyOutDir: true,
      target: "es2022",
      reportCompressedSize: false,
      // auch das Symbol in die eine Datei - nichts nachzuladen
      assetsInlineLimit: 100000,
    },
    server: {
      port: 5174,
      // Im Entwicklungsbetrieb beantwortet `python wetter.py --dienst`
      // die Aufrufe der Seite.
      proxy: { "/api": "http://127.0.0.1:8766" },
    },
  };
});

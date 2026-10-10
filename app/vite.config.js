import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwind from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";
import { version } from "./package.json";

// Eine Codebasis, zwei Ziele (Umgebungsvariable HB_TARGET):
//   server  (Standard)  Build nach ../pb_public, PocketBase liefert es aus,
//                       Daten ueber backend/pocketbase.js.
//   android             Build nach dist/, daraus macht "cap sync" die
//                       Android-Huelle (s. ANDROID.md), Daten lokal in SQLite
//                       ueber backend/sqlite.js.
// Die Screens importieren nur ../pb.js; "@backend" biegt dort aufs jeweilige
// Backend um. Im Dev-Modus laeuft die App auf 5173 und leitet /api an den
// Container weiter (nur fuer das Server-Ziel relevant).
const android = process.env.HB_TARGET === "android";
const backend = fileURLToPath(new URL(`./src/backend/${android ? "sqlite" : "pocketbase"}.js`, import.meta.url));

export default defineConfig({
  base: android ? "./" : "/",
  plugins: [react(), tailwind()],
  resolve: { alias: { "@backend": backend } },
  define: { __APP_VERSION__: JSON.stringify(version) },
  build: { outDir: android ? "dist" : "../pb_public", emptyOutDir: true },
  server: {
    proxy: {
      "/api": { target: process.env.PB_DEV_URL ?? "http://127.0.0.1:8090", changeOrigin: true },
    },
  },
});

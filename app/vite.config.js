import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwind from "@tailwindcss/vite";
import { version } from "./package.json";

// Das Build landet direkt in pb_public, von wo PocketBase es ausliefert.
// Im Dev-Modus laeuft die App auf 5173 und leitet /api an den Container weiter.
export default defineConfig({
  plugins: [react(), tailwind()],
  define: { __APP_VERSION__: JSON.stringify(version) },
  build: { outDir: "../pb_public", emptyOutDir: true },
  server: {
    proxy: {
      "/api": { target: process.env.PB_DEV_URL ?? "http://127.0.0.1:8090", changeOrigin: true },
    },
  },
});

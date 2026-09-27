import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwind from "@tailwindcss/vite";
import { version } from "./package.json";

// Eigenstaendiges Capacitor-Projekt: Build landet in dist/, von dort
// liest "npx cap sync" es in die Android-Huelle ein.
export default defineConfig({
  base: "./",
  plugins: [react(), tailwind()],
  define: { __APP_VERSION__: JSON.stringify(version) },
  build: { outDir: "dist", emptyOutDir: true },
});

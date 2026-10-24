import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// The control panel page; Electron loads it from dist/renderer (or the dev server in `pnpm dev`).
export default defineConfig({
  root: "src/renderer",
  base: "./",
  plugins: [react(), tailwindcss()],
  build: { outDir: "../../dist/renderer", emptyOutDir: true },
  server: { port: 5199, strictPort: true },
});

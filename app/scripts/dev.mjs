// `pnpm dev`: the panel from Vite's dev server (hot reload), the main process built once. Restart this
// script after changing src/main, src/preload or the bridge itself.
import { execFileSync, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

import electron from "electron";
import { createServer } from "vite";

const root = path.join(import.meta.dirname, "..");
const run = (script) => execFileSync(process.execPath, [path.join(root, "scripts", script)], { stdio: "inherit" });

if (!existsSync(path.join(root, "assets", "trayTemplate.png"))) run("render-icons.mjs");
run("build-main.mjs");

const server = await createServer({ root: path.join(root, "src/renderer"), configFile: path.join(root, "vite.config.ts") });
await server.listen();
const url = server.resolvedUrls?.local[0];

const app = spawn(electron, [root], { stdio: "inherit", env: { ...process.env, VITE_DEV_SERVER_URL: url } });
app.on("exit", (code) => {
  void server.close();
  process.exit(code ?? 0);
});

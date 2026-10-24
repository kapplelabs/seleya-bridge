#!/usr/bin/env node
/**
 * seleya-bridge: lets Seleya web (in this machine's browser) send requests to Claude Code here.
 *
 *   seleya-bridge [start] [--port <n>] [--allow-origin <origin>]...   run the bridge
 *   seleya-bridge revoke                                              forget every paired browser
 *   seleya-bridge config                                              print the config path
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";

import { bridgeHome, loadConfig } from "./config.ts";
import { discoverConnectors, EMPTY_CONNECTORS, wantsConnectors } from "./connectors.ts";
import { Pairing, TokenStore } from "./pairing.ts";
import { type Generation, startGeneration } from "./generation/main.ts";
import { type GenerationMount, mountGeneration } from "./generation/mount.ts";
import { ENGINE_VERSION } from "./generation/recipes.ts";
import { createBridgeServer } from "./server.ts";

const pkg: unknown = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const VERSION =
  typeof pkg === "object" && pkg !== null && "version" in pkg && typeof pkg.version === "string" ? pkg.version : "0.0.0";

const HELP = `seleya-bridge ${VERSION}

Usage:
  seleya-bridge [start] [--port <n>] [--allow-origin <origin>]...
  seleya-bridge revoke     forget every paired browser
  seleya-bridge config     print the config file path
`;

function announceCode(code: string, origin: string): void {
  const spaced = code.split("").join(" ");
  console.log(`\n  Pairing request from ${origin}\n\n      ${spaced}\n\n  Enter this code in Seleya. It expires in 2 minutes.\n`);
}

function start(port: number | undefined, allowOrigins: string[]): void {
  const config = loadConfig({ port, allowOrigins });
  const tokens = new TokenStore(config.home);
  const pairing = new Pairing(tokens, announceCode);
  let connectors = EMPTY_CONNECTORS;
  let generation: Generation | undefined;
  let mount: GenerationMount | undefined;
  const { server, runs } = createBridgeServer({
    config,
    version: VERSION,
    tokens,
    pairing,
    connectors: () => connectors,
    generation: () => mount,
  });

  server.on("error", (error: NodeJS.ErrnoException) => {
    console.error(
      error.code === "EADDRINUSE" ? `Port ${config.port} is in use: is another seleya-bridge running?` : error.message,
    );
    process.exit(1);
  });

  // Loopback only: the bridge is never reachable from another machine.
  server.listen(config.port, "127.0.0.1", () => {
    console.log(`seleya-bridge ${VERSION} listening on http://127.0.0.1:${config.port}`);
    console.log(`  allowed origins: ${config.allowedOrigins.join(", ")}`);
    console.log(`  workspace:       ${config.workspace}`);
    console.log(`  tools:           ${config.tools.join(", ") || "(none)"}`);
    console.log(`  config:          ${path.join(config.home, "config.json")}`);
    if (config.generation) {
      const keys = Object.keys(config.trustedRecipeKeys);
      void startGeneration({
        home: path.join(config.home, "generation"),
        trustedRecipeKeys: config.trustedRecipeKeys,
      })
        .then((started) => {
          generation = started;
          mount = mountGeneration({
            app: started.app,
            tokens,
            publicOrigin: `http://127.0.0.1:${config.port}`,
          });
          console.log(
            `  generation:      engine ${ENGINE_VERSION}, recipes from ${keys.length ? `key ${keys.join(", ")}` : "no trusted key yet (add trustedRecipeKeys)"}`,
          );
          if (started.interrupted)
            console.log(`  generation:      ${started.interrupted} run(s) from last time marked interrupted`);
        })
        .catch((error: unknown) =>
          console.error(
            `  generation:      could not start: ${error instanceof Error ? error.message : String(error)}`,
          ),
        );
    }
    if (!wantsConnectors(config)) return;
    console.log(
      config.connectors === "auto"
        ? "  connectors:      auto, looking up every connected claude.ai connector…"
        : "  connectors:      looking them up…",
    );
    void discoverConnectors(config, VERSION).then((found) => {
      connectors = found;
      if (found.connectors.length === 0) console.log("  connectors:      none connected in this claude.ai account");
      for (const item of found.connectors)
        console.log(
          item.state === "connected"
            ? `  connector ${item.id}: ${item.name}, read-only (${item.tools.join(", ") || "no read-only tools"})`
            : `  connector ${item.id}: ${item.name} unavailable, ${item.error}`,
        );
      if (found.skipped.length > 0)
        console.log(
          `  connectors:      skipped ${found.skipped.length} not connected here: ${found.skipped.join(", ")}`,
        );
    });
  });

  const shutdown = () => {
    runs.abortAll();
    void generation?.close();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 2000).unref();
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

function main(): void {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      port: { type: "string" },
      "allow-origin": { type: "string", multiple: true },
      help: { type: "boolean", short: "h" },
      version: { type: "boolean", short: "v" },
    },
  });
  if (values.help) return void console.log(HELP);
  if (values.version) return void console.log(VERSION);

  const command = positionals[0] ?? "start";
  switch (command) {
    case "start":
      return start(values.port ? Number(values.port) : undefined, values["allow-origin"] ?? []);
    case "revoke": {
      const count = new TokenStore(bridgeHome()).revokeAll();
      return void console.log(`Revoked ${count} paired ${count === 1 ? "browser" : "browsers"}.`);
    }
    case "config":
      return void console.log(path.join(bridgeHome(), "config.json"));
    default:
      console.error(`Unknown command "${command}"\n\n${HELP}`);
      process.exit(1);
  }
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}

#!/usr/bin/env node
/**
 * seleya-bridge: lets Seleya web (in this machine's browser) send requests to Claude Code here.
 *
 *   seleya-bridge [start] [--port <n>] [--allow-origin <origin>]...   run the bridge
 *   seleya-bridge revoke                                              forget every paired browser
 *   seleya-bridge config                                              print the config path
 */
import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";

import { startBridge } from "./bridge.ts";
import { bridgeHome, configPath, isLoopbackOrigin } from "./config.ts";
import type { ConnectorSet } from "./providers/claude/connectors.ts";
import { TokenStore, type PairingCode } from "./pairing.ts";

const pkg: unknown = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const VERSION =
  typeof pkg === "object" && pkg !== null && "version" in pkg && typeof pkg.version === "string" ? pkg.version : "0.0.0";

const HELP = `seleya-bridge ${VERSION}

Usage:
  seleya-bridge [start] [--port <n>] [--allow-origin <origin>]...
  seleya-bridge revoke     forget every paired browser
  seleya-bridge config     print the config file path
`;

function announceCode({ code, origin }: PairingCode): void {
  const spaced = code.split("").join(" ");
  console.log(`\n  Pairing request from ${origin}\n\n      ${spaced}\n\n  Enter this code in Seleya. It expires in 2 minutes.\n`);
}

function announceLocked(until: Date): void {
  console.log(
    `\n  Too many wrong pairing codes: pairing is paused until ${until.toLocaleTimeString()}. Restart the bridge to allow it sooner.\n`,
  );
}

function announceConnectors(found: ConnectorSet): void {
  if (found.connectors.length === 0) console.log("  connectors:      none connected in this claude.ai account");
  for (const item of found.connectors)
    console.log(
      item.state === "connected"
        ? `  connector ${item.id}: ${item.name}, read-only (${item.tools.join(", ") || "no read-only tools"})`
        : `  connector ${item.id}: ${item.name} unavailable, ${item.error}`,
    );
  if (found.skipped.length > 0)
    console.log(`  connectors:      skipped ${found.skipped.length} not connected here: ${found.skipped.join(", ")}`);
}

async function start(port: number | undefined, allowOrigins: string[]): Promise<void> {
  const bridge = await startBridge({
    version: VERSION,
    overrides: { port, allowOrigins },
    listener: { code: announceCode, locked: announceLocked, connectors: announceConnectors },
  }).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
  const { config } = bridge;
  console.log(`seleya-bridge ${VERSION} listening on http://127.0.0.1:${config.port}`);
  console.log(`  allowed origins: ${config.allowedOrigins.join(", ") || "(none: add Seleya's origin to config.json)"}`);
  const local = config.allowedOrigins.filter(isLoopbackOrigin);
  if (local.length > 0)
    console.log(`  warning:         ${local.join(", ")} trusted: any page served there can ask to pair`);
  console.log(`  workspace:       ${config.workspace}`);
  console.log(`  tools:           ${config.tools.join(", ") || "(none)"}`);
  console.log(`  config:          ${configPath(config.home)}`);
  if (bridge.discovering())
    console.log(
      config.connectors === "auto"
        ? "  connectors:      auto, looking up every connected claude.ai connector…"
        : "  connectors:      looking them up…",
    );

  const shutdown = () => {
    void bridge.stop().then(() => process.exit(0));
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
      return void start(values.port ? Number(values.port) : undefined, values["allow-origin"] ?? []);
    case "revoke": {
      const count = new TokenStore(bridgeHome()).revokeAll();
      return void console.log(`Revoked ${count} paired ${count === 1 ? "browser" : "browsers"}.`);
    }
    case "config":
      return void console.log(configPath());
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

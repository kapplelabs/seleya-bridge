/**
 * Bridge configuration: `<home>/config.json` (home is SELEYA_BRIDGE_HOME, else ~/.config/seleya-bridge),
 * written with defaults on first run. Env vars and CLI flags override it for one process:
 * SELEYA_BRIDGE_PORT / --port, SELEYA_BRIDGE_ALLOWED_ORIGINS (comma-separated) / --allow-origin.
 */
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

import { z } from "zod";

export const DEFAULT_PORT = 47821;

/** An origin is scheme://host[:port] with nothing after it; anything else never matches a browser's. */
const originSchema = z.url().refine((value) => new URL(value).origin === value, {
  message: "must be an origin like https://seleya.example.com (no path or trailing slash)",
});

const configSchema = z.object({
  port: z.number().int().min(1024).max(65535).default(DEFAULT_PORT),
  /** Seleya web origins allowed to call the bridge. The production origin is added here. */
  allowedOrigins: z.array(originSchema).default(["http://localhost:3000"]),
  /** Claude's working directory. Read-only tools stay inside it; anything else is denied. */
  workspace: z.string().default(path.join(homedir(), "seleya-workspace")),
  /** Built-in Claude Code tools Claude may use. Tools outside this list don't exist for it. */
  tools: z.array(z.string()).default(["Read", "Glob", "Grep"]),
  /** Model override; omit to use Claude Code's default. */
  model: z.string().optional(),
  /** Path to a `claude` executable; omit to use the one bundled with the Agent SDK. */
  claudeExecutable: z.string().optional(),
  /**
   * claude.ai connectors Claude may read from. `"auto"`: every connector connected in the claude.ai account
   * at startup. Or a map by Seleya connector id, e.g. `{ "calendar": "Google Calendar", "gmail": "Gmail" }`
   * (names as `claude mcp list` shows them, without "claude.ai "). Only their read-only tools exist for
   * Claude. Empty: no connectors.
   */
  connectors: z
    .union([
      z.literal("auto"),
      z.record(
        z.string().regex(/^[a-z][a-z0-9_-]*$/, "use a lowercase id such as gmail or calendar"),
        z.string().min(1),
      ),
    ])
    .default({}),
  /**
   * Keys whose signed recipes generation runs (spec 009): key id → Ed25519 public key, base64 SPKI
   * (Seleya's public/catalog/keys.json). Only recipes signed by one of these are run.
   */
  trustedRecipeKeys: z.record(z.string().regex(/^[0-9a-f]{16}$/), z.string().min(40)).default({}),
  /** Generation on or off (spec 009). */
  generation: z.boolean().default(true),
});

export type BridgeConfig = z.infer<typeof configSchema> & {
  /** Directory holding config.json and tokens.json. */
  home: string;
};

export interface ConfigOverrides {
  port?: number;
  allowOrigins?: string[];
}

export function bridgeHome(): string {
  return process.env.SELEYA_BRIDGE_HOME || path.join(homedir(), ".config", "seleya-bridge");
}

/** Writes a file only the current user can read: it may hold token hashes or local paths. */
export function writePrivateFile(file: string, content: string): void {
  writeFileSync(file, content, { mode: 0o600 });
  chmodSync(file, 0o600);
}

function readConfigFile(file: string): unknown {
  if (!existsSync(file)) return {};
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    throw new Error(`${file} is not valid JSON: ${(error as Error).message}`);
  }
}

function envOverrides(): ConfigOverrides {
  const port = process.env.SELEYA_BRIDGE_PORT;
  const origins = process.env.SELEYA_BRIDGE_ALLOWED_ORIGINS;
  return {
    port: port ? Number(port) : undefined,
    allowOrigins: origins
      ? origins
          .split(",")
          .map((origin) => origin.trim())
          .filter(Boolean)
      : undefined,
  };
}

export function loadConfig(flags: ConfigOverrides = {}): BridgeConfig {
  const home = bridgeHome();
  mkdirSync(home, { recursive: true, mode: 0o700 });
  const file = path.join(home, "config.json");
  const created = !existsSync(file);

  const parsed = configSchema.safeParse(readConfigFile(file));
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `  - ${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join("\n");
    throw new Error(`Invalid ${file}:\n${issues}`);
  }
  if (created) writePrivateFile(file, `${JSON.stringify(parsed.data, null, 2)}\n`);

  const env = envOverrides();
  const extraOrigins = [...(env.allowOrigins ?? []), ...(flags.allowOrigins ?? [])];
  for (const origin of extraOrigins) {
    const result = originSchema.safeParse(origin);
    if (!result.success) throw new Error(`Invalid allowed origin "${origin}": ${result.error.issues[0]?.message}`);
  }
  const port = flags.port ?? env.port ?? parsed.data.port;
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error(`Invalid port "${port}"`);

  const workspace = path.resolve(parsed.data.workspace.replace(/^~(?=$|\/)/, homedir()));
  mkdirSync(workspace, { recursive: true });

  return {
    ...parsed.data,
    port,
    allowedOrigins: [...new Set([...parsed.data.allowedOrigins, ...extraOrigins])],
    workspace,
    home,
  };
}

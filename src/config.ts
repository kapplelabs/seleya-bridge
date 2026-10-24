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

const LOOPBACK_HOSTNAMES = ["localhost", "127.0.0.1", "[::1]"];

/** A local development origin (http://localhost:3000): any program on this machine can serve one. */
export const isLoopbackOrigin = (origin: string) => LOOPBACK_HOSTNAMES.includes(new URL(origin).hostname);

/**
 * An origin is scheme://host[:port] with nothing after it; anything else never matches a browser's.
 * Plain http is only accepted on this machine: on the network anyone in between could serve the page.
 */
const originSchema = z
  .url()
  .refine((value) => new URL(value).origin === value, {
    message: "must be an origin like https://seleya.example.com (no path or trailing slash)",
  })
  .refine((value) => new URL(value).protocol === "https:" || isLoopbackOrigin(value), {
    message: "must use https (plain http only for localhost)",
  });

const configSchema = z.object({
  port: z.number().int().min(1024).max(65535).default(DEFAULT_PORT),
  /**
   * Seleya web origins allowed to call the bridge: the deployed Seleya, e.g. https://seleya.example.com.
   * None by default; a local Seleya (http://localhost:3000) only when added on purpose, since every dev
   * server on that port would be trusted too.
   */
  allowedOrigins: z.array(originSchema).default([]),
  /** Claude's working directory. Read-only tools stay inside it; anything else is denied. */
  workspace: z.string().default(path.join(homedir(), "seleya-workspace")),
  /** Built-in Claude Code tools Claude may use. Tools outside this list don't exist for it. */
  tools: z.array(z.string()).default(["Read", "Glob", "Grep"]),
  /** Model override; omit to use Claude Code's default. */
  model: z.string().optional(),
  /** The provider a run uses when the request names none. */
  defaultProvider: z.enum(["claude"]).default("claude"),
  /** Claude models Seleya may ask for besides `model`. */
  models: z.array(z.string().min(1)).default([]),
  /** Ceilings on what one run may ask for; a request asking for more gets these. */
  limits: z
    .object({
      maxTurns: z.number().int().min(1).max(500).default(60),
      maxToolOutputTokens: z.number().int().min(1000).max(500_000).default(100_000),
    })
    .default({ maxTurns: 60, maxToolOutputTokens: 100_000 }),
  /** Kept results of runs that asked for `store` (docs/server-link.md §6.2). */
  results: z
    .object({
      retentionDays: z.number().int().min(1).max(365).default(14),
      maxKeys: z.number().int().min(1).max(10_000).default(200),
    })
    .default({ retentionDays: 14, maxKeys: 200 }),
  /**
   * The link to a Seleya account (docs/server-link.md §6.5): whether this bridge polls the server and runs
   * its schedules, and the ceilings on what a scheduled run may do, below `connectors` and `limits`.
   */
  link: z
    .object({
      enabled: z.boolean().default(true),
      connectors: z
        .union([z.literal("all"), z.array(z.string().regex(/^[a-z][a-z0-9_-]*$/))])
        .default("all"),
      maxRunsPerDay: z.number().int().min(1).max(500).default(24),
      minIntervalMinutes: z.number().int().min(5).max(1440).default(30),
    })
    .default({ enabled: true, connectors: "all", maxRunsPerDay: 24, minIntervalMinutes: 30 }),
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
});

/** config.json as written, defaults filled in. */
export type ConfigFile = z.infer<typeof configSchema>;

export type BridgeConfig = ConfigFile & {
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

export const configPath = (home = bridgeHome()) => path.join(home, "config.json");

function readJsonFile(file: string): unknown {
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

function parseConfig(raw: unknown, file: string): ConfigFile {
  const parsed = configSchema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `  - ${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join("\n");
    throw new Error(`Invalid ${file}:\n${issues}`);
  }
  return parsed.data;
}

/** config.json with defaults, without env or flag overrides: what the app's settings show. */
export function readConfigFile(): ConfigFile {
  const file = configPath();
  return parseConfig(readJsonFile(file), file);
}

/**
 * Changes some keys of config.json and returns the result. Throws, leaving the file as it was, when the
 * result isn't valid. Keys the bridge doesn't know are kept. A running bridge needs a restart to use it.
 */
export function updateConfigFile(patch: Partial<ConfigFile>): ConfigFile {
  const home = bridgeHome();
  mkdirSync(home, { recursive: true, mode: 0o700 });
  const file = configPath(home);
  const current = readJsonFile(file);
  const merged = { ...(typeof current === "object" && current !== null ? current : {}), ...patch };
  const config = parseConfig(merged, file);
  writePrivateFile(file, `${JSON.stringify(merged, null, 2)}\n`);
  return config;
}

export function loadConfig(flags: ConfigOverrides = {}): BridgeConfig {
  const home = bridgeHome();
  mkdirSync(home, { recursive: true, mode: 0o700 });
  const file = configPath(home);
  const created = !existsSync(file);

  const stored = parseConfig(readJsonFile(file), file);
  if (created) writePrivateFile(file, `${JSON.stringify(stored, null, 2)}\n`);

  const env = envOverrides();
  const extraOrigins = [...(env.allowOrigins ?? []), ...(flags.allowOrigins ?? [])];
  for (const origin of extraOrigins) {
    const result = originSchema.safeParse(origin);
    if (!result.success) throw new Error(`Invalid allowed origin "${origin}": ${result.error.issues[0]?.message}`);
  }
  const port = flags.port ?? env.port ?? stored.port;
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error(`Invalid port "${port}"`);

  const workspace = path.resolve(stored.workspace.replace(/^~(?=$|\/)/, homedir()));
  mkdirSync(workspace, { recursive: true });

  return {
    ...stored,
    port,
    allowedOrigins: [...new Set([...stored.allowedOrigins, ...extraOrigins])],
    workspace,
    home,
  };
}

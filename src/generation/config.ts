import { homedir } from "node:os";
import path from "node:path";

/** Where everything Seleya Local needs lives, and the limits it runs with. */
export interface LocalConfig {
  /** Preferred port; 0 picks a free one (tests). */
  port: number;
  home: string;
  runsDir: string;
  dbFile: string;
  /** Built client served at `/` (absent when only the API runs). */
  distDir: string;
  skillsDir: string;
  /** Skills the user saved from runs (spec 007 FR-010); they sit beside the shipped ones. */
  userSkillsDir: string;
  /** Origins allowed to POST besides the runtime itself (the Vite dev server). */
  extraOrigins: string[];
  concurrency: number;
  defaultTimeLimitMs: number;
  stallMs: number;
  notRespondingMs: number;
  tailIntervalMs: number;
  /** Harness used when the request names none (spec 002 replaces this with detection). */
  defaultHarness: string;
  demoUser: { email: string; name: string; timezone: string };
}

/** The package root (holds `skills/`): two levels up from both src/generation and dist/generation. */
const PACKAGE_ROOT = path.resolve(import.meta.dirname, "..", "..");

/** Generation data lives under the bridge's home (spec 009 D9). */
export function generationHome(): string {
  const bridgeHome =
    process.env.SELEYA_BRIDGE_HOME || path.join(homedir(), ".config", "seleya-bridge");
  return path.join(bridgeHome, "generation");
}

export function loadLocalConfig(overrides: Partial<LocalConfig> = {}): LocalConfig {
  const env = process.env;
  const home = overrides.home ?? env.SELEYA_GENERATION_HOME ?? generationHome();
  return {
    port: Number(env.SELEYA_LOCAL_PORT ?? 4870),
    home,
    runsDir: path.join(home, "runs"),
    dbFile: path.join(home, "seleya.db"),
    // Only with `--serve-app <dir>` (spec 009 D10).
    distDir: "",
    skillsDir: path.join(PACKAGE_ROOT, "skills"),
    userSkillsDir: path.join(home, "skills"),
    extraOrigins: env.PUBLIC_ORIGIN ? [new URL(env.PUBLIC_ORIGIN).origin] : [],
    concurrency: Number(env.SELEYA_GENERATION_CONCURRENCY ?? 3),
    defaultTimeLimitMs: 15 * 60_000,
    stallMs: 60_000,
    notRespondingMs: 90_000,
    tailIntervalMs: 500,
    defaultHarness: env.SELEYA_GENERATION_HARNESS ?? "auto",
    demoUser: {
      email: env.MOCK_USER_EMAIL || "you@localhost",
      name: env.MOCK_USER_NAME || "Local User",
      timezone: env.USER_TIMEZONE || Intl.DateTimeFormat().resolvedOptions().timeZone,
    },
    ...overrides,
  };
}

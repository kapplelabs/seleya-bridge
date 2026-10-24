import { mkdtempSync, rmSync } from "node:fs";
import { request as httpRequest } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";

import { createApp, fixedHarness, type LocalApp } from "../../src/generation/app.ts";
import { FakeClock } from "../../src/generation/clock.ts";
import { loadLocalConfig, type LocalConfig } from "../../src/generation/config.ts";
import { ScriptedHarness } from "../../src/generation/harness/scripted.ts";
import type { Harness } from "../../src/generation/harness/types.ts";
import { TEST_KEYS } from "./recipes.ts";
import type { PostProcessor } from "../../src/generation/runs/runner.ts";
import type { StoredEvent } from "../../src/generation/runs/types.ts";

export interface TestApp {
  app: LocalApp;
  clock: FakeClock;
  harness: ScriptedHarness;
  home: string;
  config: LocalConfig;
  cleanup: () => Promise<void>;
}

/** An app on a temp home, a fake clock and the scripted harness; nothing touches ~/.seleya-local. */
export function makeTestApp(
  options: {
    home?: string;
    config?: Partial<LocalConfig>;
    postProcessors?: Map<string, PostProcessor>;
    mediaAgents?: (kind: string) => Promise<Harness[]>;
  } = {},
): TestApp {
  const home = options.home ?? mkdtempSync(path.join(tmpdir(), "seleya-local-test-"));
  const config = loadLocalConfig({
    home,
    runsDir: path.join(home, "runs"),
    dbFile: path.join(home, "seleya.db"),
    port: 0,
    extraOrigins: ["http://localhost:3000"],
    ...options.config,
  });
  const clock = new FakeClock();
  const harness = new ScriptedHarness(clock, 1000);
  const app = createApp({
    config,
    clock,
    pickHarness: fixedHarness(harness),
    apiOnly: true,
    postProcessors: options.postProcessors,
    mediaAgents: options.mediaAgents,
    trustedRecipeKeys: TEST_KEYS,
  });
  return {
    app,
    clock,
    harness,
    home,
    config,
    cleanup: async () => {
      await app.close().catch(() => undefined);
      if (!options.home) rmSync(home, { recursive: true, force: true });
    },
  };
}

/** Lets pending promise callbacks and I/O callbacks run (not a timed wait). */
export async function flush(times = 5): Promise<void> {
  for (let index = 0; index < times; index++) await new Promise((resolve) => setImmediate(resolve));
}

/** Advances the fake clock in ticks, flushing async work between ticks, until `done()` or the limit. */
export async function advanceUntil(
  clock: FakeClock,
  done: () => boolean,
  stepMs = 500,
  maxMs = 120_000,
): Promise<void> {
  for (let elapsed = 0; elapsed <= maxMs && !done(); elapsed += stepMs) {
    clock.advance(stepMs);
    await flush();
  }
  await flush();
}

export function eventsOf(app: LocalApp, runId: string): StoredEvent[] {
  return app.store.eventsAfter(runId, 0);
}

export const typesOf = (events: StoredEvent[]) => events.map((event) => event.type);

export interface RawResponse {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: string;
}

/** Raw HTTP (fetch would not let tests set Host or Sec-Fetch-Site). */
export function raw(
  port: number,
  options: {
    method?: string;
    path: string;
    headers?: Record<string, string>;
    body?: unknown;
    untilDone?: boolean;
  },
): Promise<RawResponse> {
  return new Promise((resolve, reject) => {
    const payload = options.body === undefined ? undefined : JSON.stringify(options.body);
    const req = httpRequest(
      {
        host: "127.0.0.1",
        port,
        method: options.method ?? "GET",
        path: options.path,
        headers: {
          host: `127.0.0.1:${port}`,
          ...(payload ? { "content-type": "application/json" } : {}),
          ...options.headers,
        },
      },
      (res) => {
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (chunk: string) => (body += chunk));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body }));
      },
    );
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

/** Gets a session cookie the way the Seleya page does. */
export async function session(port: number): Promise<string> {
  const response = await raw(port, {
    path: "/api/local/session",
    headers: { "sec-fetch-site": "same-origin" },
  });
  const cookie = response.headers["set-cookie"];
  const value = Array.isArray(cookie) ? cookie[0] : cookie;
  if (!value) throw new Error(`no session cookie (status ${response.status})`);
  return value.split(";")[0];
}

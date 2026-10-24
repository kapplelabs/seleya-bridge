import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { request, type Server } from "node:http";
import { createServer as createNetServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";

import type { BridgeConfig } from "./config.ts";
import type { AgentEvent, ProviderAdapter, ProviderId, ProviderStatus, RunSpec } from "./engine/types.ts";
import { Pairing, TokenStore } from "./pairing.ts";
import type { LinkService } from "./link/service.ts";
import { ResultStore } from "./results.ts";
import type { Run, RunRegistry } from "./runs.ts";
import { createBridgeServer } from "./server.ts";
import { SessionStore } from "./sessions.ts";

const ORIGIN = "https://seleya.example.com";
const OTHER_ORIGIN = "https://other.example.com";

/** A provider that answers at once, or (`hold`) only stops when the run is cancelled. */
class FakeAdapter implements ProviderAdapter {
  readonly id = "claude" as const;
  hold = false;
  specs: RunSpec[] = [];

  async start(): Promise<void> {}
  async stop(): Promise<void> {}

  status(): ProviderStatus {
    return {
      id: "claude",
      state: "ready",
      models: ["claude-opus-4-5"],
      features: { structuredOutput: true, resume: true, thinking: true, workspaceTools: ["read_file"] },
      connectorsState: "ready",
      connectors: [{ id: "gmail", name: "Gmail", state: "connected", tools: ["search_threads"] }],
    };
  }

  async *run(run: Run, spec: RunSpec): AsyncIterable<AgentEvent> {
    this.specs.push(spec);
    if (this.hold) {
      await new Promise((resolve) => run.abort.signal.addEventListener("abort", resolve, { once: true }));
      return;
    }
    yield { type: "text.start", key: "t0" };
    yield { type: "text.delta", key: "t0", text: "Done.\n" };
    yield { type: "text.end", key: "t0" };
    if (spec.prompt.includes("[fail]")) {
      yield { type: "failed", code: "provider_api_error", message: "Overloaded", retryable: true };
      return;
    }
    yield {
      type: "done",
      text: "Done.\n",
      ...(spec.outputSchema && { structured: { dueDate: "2026-10-24", openItems: 2 } }),
    };
  }
}

async function freePort(): Promise<number> {
  const probe = createNetServer();
  await new Promise<void>((resolve) => probe.listen(0, "127.0.0.1", resolve));
  const address = probe.address();
  await new Promise((resolve) => probe.close(resolve));
  assert.ok(address && typeof address === "object");
  return address.port;
}

interface Reply {
  status: number;
  body: any;
}

let port: number;
let server: Server;
let runs: RunRegistry;
let sessions: SessionStore;
let tokens: TokenStore;
let results: ResultStore;
const linkCalls: unknown[][] = [];
/** The parts of LinkService the server uses. */
const linkStub = {
  origin: () => ORIGIN,
  view: () => ({ linked: true, origin: ORIGIN, state: "online", schedules: [], activeRun: null }),
  link: async (...args: unknown[]) => {
    linkCalls.push(args);
    return { linked: true };
  },
  unlink: async () => {
    linkCalls.push(["unlink"]);
  },
} as unknown as LinkService;
let home: string;
const adapter = new FakeAdapter();
let token: string;
let otherToken: string;

function call(method: string, pathname: string, options: { body?: unknown; token?: string; origin?: string } = {}) {
  const { body, token: bearer = token, origin = ORIGIN } = options;
  return new Promise<Reply>((resolve, reject) => {
    const payload = body === undefined ? undefined : JSON.stringify(body);
    const req = request(
      {
        host: "127.0.0.1",
        port,
        method,
        path: pathname,
        headers: {
          Origin: origin,
          ...(bearer && { Authorization: `Bearer ${bearer}` }),
          ...(payload !== undefined && { "Content-Type": "application/json" }),
        },
      },
      (res) => {
        let text = "";
        res.setEncoding("utf8");
        res.on("data", (chunk: string) => (text += chunk));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, body: text ? JSON.parse(text) : undefined }));
      },
    );
    req.on("error", reject);
    req.end(payload);
  });
}

async function finished(runId: string, as = token): Promise<Reply> {
  for (let i = 0; i < 200; i++) {
    const reply = await call("GET", `/v1/runs/${runId}`, { token: as });
    if (reply.body?.status !== "running") return reply;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("run didn't finish");
}

before(async () => {
  home = mkdtempSync(path.join(tmpdir(), "seleya-bridge-server-"));
  port = await freePort();
  const config = {
    port,
    allowedOrigins: [ORIGIN, OTHER_ORIGIN],
    defaultProvider: "claude",
    models: [],
    limits: { maxTurns: 60, maxToolOutputTokens: 100_000 },
    home,
  } as unknown as BridgeConfig;
  tokens = new TokenStore(home);
  sessions = new SessionStore(home);
  token = tokens.issue(ORIGIN);
  otherToken = tokens.issue(OTHER_ORIGIN);
  const pairing = new Pairing(tokens, { code: () => {} });
  results = new ResultStore(home, { retentionDays: 14, maxKeys: 200 });
  ({ server, runs } = createBridgeServer({
    config,
    version: "9.9.9",
    distribution: "cli",
    tokens,
    pairing,
    sessions,
    providers: new Map<ProviderId, ProviderAdapter>([["claude", adapter]]),
    results,
    link: linkStub,
  }));
  await new Promise<void>((resolve) => server.listen(port, "127.0.0.1", resolve));
});

after(async () => {
  runs.abortAll();
  await new Promise((resolve) => server.close(resolve));
  rmSync(home, { recursive: true, force: true });
});

describe("server", () => {
  test("health has no connectors", async () => {
    const { status, body } = await call("GET", "/v1/health");
    assert.equal(status, 200);
    assert.deepEqual(body, { name: "seleya-bridge", version: "9.9.9", distribution: "cli", paired: true, busy: false });
  });

  test("capabilities need a token", async () => {
    assert.equal((await call("GET", "/v1/capabilities", { token: "" })).status, 401);
    const { status, body } = await call("GET", "/v1/capabilities");
    assert.equal(status, 200);
    assert.equal(body.bridge_version, "9.9.9");
    assert.equal(body.distribution, "cli");
    assert.equal(body.default_provider, "claude");
    assert.equal(body.time_zone, Intl.DateTimeFormat().resolvedOptions().timeZone);
    assert.deepEqual(body.limits, {
      max_turns: 60,
      max_tool_output_tokens: 100_000,
      max_prompt_chars: 100_000,
      max_system_prompt_chars: 20_000,
      max_output_schema_bytes: 65_536,
      max_store_meta_bytes: 8192,
    });
    assert.equal(body.features.results, true);
    assert.ok(body.features.template_vars.includes("week_start"));
    const [claude] = body.providers;
    assert.equal(claude.id, "claude");
    assert.equal(claude.detail, null);
    assert.equal(claude.connectors_state, "ready");
    assert.deepEqual(claude.features.workspace_tools, ["read_file"]);
    assert.equal(claude.features.structured_output, true);
  });

  test("a one-off run: no session id, output keys kept as written", async () => {
    const created = await call("POST", "/v1/runs", {
      body: { prompt: "Summarize", output_schema: { type: "object" }, unknown_field: 1 },
    });
    assert.equal(created.status, 201);
    assert.equal(created.body.session_id, null);
    assert.equal(created.body.provider, "claude");
    assert.equal(created.body.stream.stream_id, created.body.run_id);
    assert.ok(created.body.stream.ticket);
    assert.equal(created.body.stream.url, `http://127.0.0.1:${port}/v1/runs/${created.body.run_id}/stream`);

    const { status, body } = await finished(created.body.run_id);
    assert.equal(status, 200);
    assert.equal(body.status, "completed");
    assert.equal(body.session_id, null);
    assert.equal(body.text, "Done.\n");
    assert.deepEqual(body.output, { dueDate: "2026-10-24", openItems: 2 });
    assert.deepEqual(body.sources, []);
    assert.deepEqual(body.connector_errors, []);
    assert.equal(body.redactions, 0);
    assert.equal(body.error, null);
  });

  test("a persisted session is the bridge's, and only its browser can resume it", async () => {
    const created = await call("POST", "/v1/runs", { body: { prompt: "Hi", session: { persist: true } } });
    assert.equal(created.status, 201);
    const sessionId = created.body.session_id;
    assert.match(sessionId, /^[0-9a-f-]{36}$/);
    assert.equal(sessions.owns(sessionId, runs.get(created.body.run_id)!.ownerId, "claude"), true);
    await finished(created.body.run_id);

    const resumed = await call("POST", "/v1/runs", { body: { prompt: "More", session: { resume_id: sessionId } } });
    assert.equal(resumed.status, 201);
    assert.equal(resumed.body.session_id, sessionId);
    assert.equal(adapter.specs.at(-1)?.session.resume, true);
    await finished(resumed.body.run_id);

    const stolen = await call("POST", "/v1/runs", {
      body: { prompt: "More", session: { resume_id: sessionId } },
      token: otherToken,
      origin: OTHER_ORIGIN,
    });
    assert.equal(stolen.status, 404);
    assert.equal(stolen.body.error.code, "session_not_found");
  });

  test("another browser's run doesn't exist for it", async () => {
    const created = await call("POST", "/v1/runs", { body: { prompt: "Hi" } });
    await finished(created.body.run_id);
    const as = { token: otherToken, origin: OTHER_ORIGIN };
    const id = created.body.run_id;
    for (const [method, pathname] of [
      ["GET", `/v1/runs/${id}`],
      ["POST", `/v1/runs/${id}/tickets`],
      ["POST", `/v1/runs/${id}/cancel`],
    ] as const) {
      const reply = await call(method, pathname, as);
      assert.equal(reply.status, 404, `${method} ${pathname}`);
      assert.equal(reply.body.error.code, "run_not_found");
    }
  });

  test("errors carry details", async () => {
    const reply = await call("POST", "/v1/runs", { body: { prompt: "Hi", connectors: ["slack"] } });
    assert.equal(reply.status, 422);
    assert.deepEqual(reply.body.error.details, { connector: "slack" });
    assert.equal(reply.body.error.code, "connector_unavailable");
  });

  test("two runs at once: one is busy; cancel ends the first", async () => {
    adapter.hold = true;
    try {
      const [a, b] = await Promise.all([
        call("POST", "/v1/runs", { body: { prompt: "One" } }),
        call("POST", "/v1/runs", { body: { prompt: "Two" } }),
      ]);
      const statuses = [a.status, b.status].sort();
      assert.deepEqual(statuses, [201, 409]);
      const first = a.status === 201 ? a : b;
      const busy = a.status === 201 ? b : a;
      assert.equal(busy.body.error.code, "busy");

      assert.equal((await call("POST", `/v1/runs/${first.body.run_id}/cancel`)).status, 202);
      const { body } = await finished(first.body.run_id);
      assert.equal(body.status, "cancelled");
      assert.equal(body.error.code, "cancelled");
      assert.equal(runs.busy, false);
    } finally {
      adapter.hold = false;
    }
  });

  test("the old report endpoints are gone", async () => {
    for (const pathname of ["/v1/briefings", "/v1/calendar/weeks", "/v1/mail/triage"])
      assert.equal((await call("POST", pathname, { body: {} })).status, 404);
    const created = await call("POST", "/v1/runs", { body: { prompt: "Hi" } });
    await finished(created.body.run_id);
    assert.equal((await call("GET", `/v1/runs/${created.body.run_id}/result`)).status, 404);
  });

  test("a template is filled in on this machine's clock and shown in run.started", async () => {
    const created = await call("POST", "/v1/runs", {
      body: {
        prompt: "It is {{now_text}} ({{time_zone}}). Week {{week_start}} to {{week_start:+4}}. Read {{connectors}}.",
        system_prompt: "Today is {{today}}.",
        connectors: "all",
        template: { week_offset: 1 },
      },
    });
    assert.equal(created.status, 201);
    await finished(created.body.run_id);
    const spec = adapter.specs.at(-1)!;
    assert.doesNotMatch(spec.prompt, /\{\{/);
    assert.match(spec.prompt, /Read Gmail\.$/);
    assert.match(spec.systemPrompt, /Today is \d{4}-\d{2}-\d{2}\.$/);
    const vars = spec.templateVars!;
    assert.equal(vars.time_zone, Intl.DateTimeFormat().resolvedOptions().timeZone);
    assert.equal(new Date(`${vars.week_start}T00:00:00Z`).getUTCDay(), 1);
    const started = runs.get(created.body.run_id)!.events[0]!;
    assert.equal(started.type, "run.started");
    assert.deepEqual((started.data as { templateVars?: unknown }).templateVars, vars);
  });

  test("an unknown template variable is invalid_template; without template nothing is filled", async () => {
    const bad = await call("POST", "/v1/runs", { body: { prompt: "Hi {{user_email}}", template: {} } });
    assert.equal(bad.status, 400);
    assert.equal(bad.body.error.code, "invalid_template");
    assert.deepEqual(bad.body.error.details, { variable: "user_email" });

    const plain = await call("POST", "/v1/runs", { body: { prompt: "Keep {{now}} as is" } });
    assert.equal(plain.status, 201);
    await finished(plain.body.run_id);
    assert.equal(adapter.specs.at(-1)!.prompt, "Keep {{now}} as is");
  });

  test("a stored result is kept per origin, failures don't hide the latest result", async () => {
    const key = "u_1:briefing";
    const store = { key, meta: { task_id: "briefing", task_version: 3, input: { weekStart: "2026-10-19" } } };
    const created = await call("POST", "/v1/runs", {
      body: { prompt: "Brief {{today}}", output_schema: { type: "object" }, template: {}, store },
    });
    await finished(created.body.run_id);

    const listed = await call("GET", "/v1/results");
    assert.equal(listed.status, 200);
    const summary = listed.body.results.find((item: any) => item.key === key);
    assert.equal(summary.status, "completed");
    assert.equal(summary.trigger, "manual");
    assert.deepEqual(summary.meta, store.meta);

    const kept = await call("GET", `/v1/results/${encodeURIComponent(key)}`);
    assert.equal(kept.status, 200);
    assert.equal(kept.body.latest.run_id, created.body.run_id);
    assert.deepEqual(kept.body.latest.output, { dueDate: "2026-10-24", openItems: 2 });
    assert.deepEqual(kept.body.latest.meta, store.meta);
    assert.match(kept.body.latest.vars.today, /^\d{4}-\d{2}-\d{2}$/);
    assert.equal(kept.body.last_failure, null);

    const failed = await call("POST", "/v1/runs", { body: { prompt: "[fail]", store } });
    await finished(failed.body.run_id);
    const after = await call("GET", `/v1/results/${encodeURIComponent(key)}`);
    assert.equal(after.body.latest.run_id, created.body.run_id);
    assert.equal(after.body.last_failure.run_id, failed.body.run_id);
    assert.equal(after.body.last_failure.error.code, "provider_api_error");

    const other = { token: otherToken, origin: OTHER_ORIGIN };
    assert.equal((await call("GET", `/v1/results/${encodeURIComponent(key)}`, other)).status, 404);
    assert.equal((await call("GET", "/v1/results", other)).body.results.length, 0);

    assert.equal((await call("GET", "/v1/results/bad%20key")).body.error.code, "invalid_key");
    assert.equal((await call("DELETE", `/v1/results/${encodeURIComponent(key)}`)).status, 204);
    assert.equal((await call("GET", `/v1/results/${encodeURIComponent(key)}`)).status, 404);
  });

  test("store.meta has a size limit", async () => {
    const reply = await call("POST", "/v1/runs", {
      body: { prompt: "Hi", store: { key: "big", meta: { blob: "x".repeat(9000) } } },
    });
    assert.equal(reply.status, 400);
    assert.equal(reply.body.error.code, "invalid_request");
  });

  test("/v1/link links with the caller's origin", async () => {
    assert.equal((await call("GET", "/v1/link", { token: "" })).status, 401);
    const view = await call("GET", "/v1/link");
    assert.equal(view.status, 200);
    assert.equal(view.body.active_run, null);
    const linked = await call("POST", "/v1/link", { body: { enrollment_token: "abc", device_name: "Mac" } });
    assert.equal(linked.status, 200);
    assert.deepEqual(linkCalls.at(-1), [ORIGIN, "/api", "abc", "Mac"]);
    assert.equal((await call("DELETE", "/v1/link")).status, 204);
    assert.deepEqual(linkCalls.at(-1), ["unlink"]);
  });

  test("the link's runs are visible to browsers of the link's origin only", async () => {
    const run = runs.create({ sessionId: "s", persisted: false, ownerId: "link", origin: ORIGIN, provider: "claude" });
    try {
      assert.equal((await call("GET", `/v1/runs/${run.id}`)).status, 200);
      assert.equal((await call("POST", `/v1/runs/${run.id}/tickets`)).status, 200);
      const other = await call("GET", `/v1/runs/${run.id}`, { token: otherToken, origin: OTHER_ORIGIN });
      assert.equal(other.status, 404);
      assert.equal((await call("POST", `/v1/runs/${run.id}/cancel`)).status, 202);
    } finally {
      run.emit("stream.done", {});
    }
  });
});

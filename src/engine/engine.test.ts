import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { Run, type RunEvent } from "../runs.ts";
import { runOnce } from "./engine.ts";
import type { AgentEvent, ProviderAdapter, ProviderConnector, RunSpec } from "./types.ts";

const CONNECTORS: ProviderConnector[] = [
  { id: "gmail", name: "Gmail", state: "connected", tools: ["search_threads"] },
  { id: "calendar", name: "Google Calendar", state: "connected", tools: ["list_events"] },
  { id: "drive", name: "Google Drive", state: "connected", tools: ["search"] },
  { id: "slack", name: "Slack", state: "connected", tools: ["search"] },
];

/** Yields what `script` gives it; `script` sees the run, so it can abort it mid-stream. */
function fakeAdapter(script: (run: Run) => AsyncIterable<AgentEvent> | Iterable<AgentEvent>) {
  const adapter = {
    id: "claude" as const,
    calls: 0,
    async start() {},
    async stop() {},
    status: () => ({
      id: "claude" as const,
      state: "ready" as const,
      models: [],
      features: { structuredOutput: true, resume: true, thinking: true, workspaceTools: [] },
      connectorsState: "ready" as const,
      connectors: CONNECTORS,
    }),
    async *run(run: Run) {
      adapter.calls++;
      yield* script(run);
    },
  } satisfies ProviderAdapter & { calls: number };
  return adapter;
}

function newRun(persisted = false): Run {
  return new Run({ sessionId: "session-1", persisted, ownerId: "owner", provider: "claude" }, () => {});
}

function newSpec(extra: Partial<RunSpec> = {}): RunSpec {
  return {
    prompt: "hi",
    systemPrompt: "",
    session: { id: "session-1", resume: false, persist: false },
    connectorIds: ["gmail", "calendar"],
    workspaceTools: [],
    maxTurns: 24,
    ...extra,
  };
}

async function play(events: AgentEvent[], spec = newSpec(), run = newRun()) {
  const adapter = fakeAdapter(() => events);
  await runOnce(adapter, run, spec);
  return { run, events: run.events };
}

const types = (events: RunEvent[]) => events.map((event) => event.type);
const data = (events: RunEvent[], type: string) =>
  events.filter((event) => event.type === type).map((event) => event.data as Record<string, any>);
const one = (events: RunEvent[], type: string) => {
  const found = data(events, type);
  assert.equal(found.length, 1, `one ${type}`);
  return found[0]!;
};
const deltas = (events: RunEvent[], block = 0) =>
  data(events, "text.delta")
    .filter((item) => item.block === block)
    .map((item) => item.text as string);

/** One run.completed or run.failed, then stream.done as the very last event. */
function assertEnded(events: RunEvent[]) {
  const terminal = events.filter((event) => event.type === "run.completed" || event.type === "run.failed");
  assert.equal(terminal.length, 1);
  assert.equal(events.at(-2)?.type, terminal[0]!.type);
  assert.equal(events.at(-1)?.type, "stream.done");
  assert.equal(types(events).filter((type) => type === "run.started").length, 1);
  assert.equal(events[0]?.type, "run.started");
}

const done = (text = "", extra: Partial<Extract<AgentEvent, { type: "done" }>> = {}): AgentEvent => ({
  type: "done",
  text,
  ...extra,
});

describe("runOnce", () => {
  test("emits the events in order with the spec's real values", async () => {
    const { run, events } = await play(
      [
        { type: "thinking.start", key: "th" },
        { type: "thinking.delta", key: "th", text: "Reading Monday first." },
        { type: "thinking.end", key: "th" },
        { type: "tool.start", id: "t1", kind: "connector", connector: "calendar", name: "list_events", input: {} },
        { type: "tool.end", id: "t1", ok: true },
        { type: "text.start", key: "0" },
        { type: "text.delta", key: "0", text: "All clear.\n" },
        { type: "text.end", key: "0" },
        { type: "output.writing" },
        done("All clear.\n", { usage: { inputTokens: 10, outputTokens: 2, turns: 1 } }),
      ],
      newSpec({ model: "sonnet", maxToolOutputTokens: 5000 }),
    );
    assert.deepEqual(types(events), [
      "run.started",
      "thinking.started",
      "thinking.delta",
      "thinking.completed",
      "tool.started",
      "tool.completed",
      "text.started",
      "text.delta",
      "text.completed",
      "output.started",
      "run.completed",
      "stream.done",
    ]);
    assert.deepEqual(events[0]?.data, {
      runId: run.id,
      sessionId: null,
      provider: "claude",
      model: "sonnet",
      persist: false,
      connectors: ["gmail", "calendar"],
      workspaceTools: [],
      limits: { maxTurns: 24, maxToolOutputTokens: 5000 },
    });
    const completed = one(events, "run.completed");
    assert.equal(completed.text, "All clear.\n");
    assert.deepEqual(completed.sources, [{ id: "calendar", name: "Google Calendar" }]);
    assert.deepEqual(completed.connectorErrors, []);
    assert.deepEqual(completed.usage, { inputTokens: 10, outputTokens: 2, turns: 1 });
    assert.equal(typeof completed.durationMs, "number");
    assert.equal("output" in completed, false);
    assert.equal(run.status, "completed");
    assert.equal(run.text, "All clear.\n");
  });

  test("a persisted run shows its session id; unset limits are null", async () => {
    const { events } = await play([done("ok")], newSpec({ maxTurns: undefined }), newRun(true));
    const started = one(events, "run.started");
    assert.equal(started.sessionId, "session-1");
    assert.deepEqual(started.limits, { maxTurns: null, maxToolOutputTokens: null });
    assert.equal("model" in started, false);
  });

  test("an address split across two deltas is never sent unredacted", async () => {
    const { run, events } = await play([
      { type: "text.start", key: "0" },
      { type: "text.delta", key: "0", text: "Write to jane.d" },
      { type: "text.delta", key: "0", text: "oe@exam" },
      { type: "text.delta", key: "0", text: "ple.com today\nThen call" },
      { type: "text.delta", key: "0", text: " +84 912 345 678" },
      { type: "text.end", key: "0" },
      done("Write to jane.doe@example.com today\nThen call +84 912 345 678"),
    ]);
    const sent = deltas(events);
    for (const text of sent) assert.doesNotMatch(text, /jane|exam|ple\.com|912/);
    assert.equal(sent.join(""), "Write to [email] today\nThen call [phone]");
    // The first line goes out as soon as it ends, before the block does.
    assert.equal(sent[0], "Write to [email] today\n");
    assert.equal(run.text, "Write to [email] today\nThen call [phone]");
    assertEnded(events);
  });

  test("a line longer than 1000 characters is sent up to its last space", async () => {
    const long = "word ".repeat(250); // 1250 characters, no newline
    const { events } = await play([
      { type: "text.start", key: "0" },
      { type: "text.delta", key: "0", text: long },
      { type: "text.delta", key: "0", text: "tail" },
    ]);
    const sent = deltas(events);
    assert.equal(sent[0], long, "sent before the block ended");
    assert.equal(sent.join(""), `${long}tail`, "the rest goes out when the run ends");
    assert.equal(one(events, "run.failed").code, "no_result");
    assert.ok(types(events).includes("text.completed"), "open blocks are closed");
  });

  test("text blocks are numbered in order of first appearance", async () => {
    const { events } = await play([
      { type: "text.start", key: "a" },
      { type: "text.start", key: "b" },
      { type: "text.delta", key: "b", text: "second\n" },
      { type: "text.delta", key: "a", text: "first\n" },
      { type: "text.end", key: "a" },
      { type: "text.end", key: "b" },
      done("second\n"),
    ]);
    assert.deepEqual(data(events, "text.started"), [{ block: 0 }, { block: 1 }]);
    assert.deepEqual(deltas(events, 0), ["first\n"]);
    assert.deepEqual(deltas(events, 1), ["second\n"]);
  });

  test("a final answer without streamed text still streams as one block", async () => {
    const { run, events } = await play([done("Reach me at jane@example.com")]);
    assert.deepEqual(types(events).slice(1, 4), ["text.started", "text.delta", "text.completed"]);
    assert.equal(run.text, "Reach me at [email]");
    assert.equal(one(events, "run.completed").redactions, 1);
  });

  test("redactions count each block once", async () => {
    const { run, events } = await play([
      { type: "text.start", key: "0" },
      { type: "text.delta", key: "0", text: "Checking a@example.com\n" },
      { type: "text.end", key: "0" },
      { type: "text.start", key: "1" },
      { type: "text.delta", key: "1", text: "Found b@example.com" },
      { type: "text.end", key: "1" },
      { type: "thinking.start", key: "th" },
      { type: "thinking.delta", key: "th", text: "c@example.com wrote" },
      { type: "thinking.end", key: "th" },
      done("Found b@example.com"),
    ]);
    assert.equal(one(events, "run.completed").redactions, 3);
    assert.equal(run.redactor.total, 3);
    assert.equal(run.text, "Found [email]");
  });

  test("thinking: empty blocks emit nothing, others one redacted delta", async () => {
    const { events } = await play([
      { type: "thinking.start", key: "a" },
      { type: "thinking.delta", key: "a", text: "  \n " },
      { type: "thinking.end", key: "a" },
      { type: "thinking.start", key: "b" },
      { type: "thinking.delta", key: "b", text: " Mail from " },
      { type: "thinking.delta", key: "b", text: "jane@example.com first. " },
      { type: "thinking.end", key: "b" },
      done("ok"),
    ]);
    assert.deepEqual(data(events, "thinking.started"), [{ id: "thinking-1" }]);
    assert.deepEqual(data(events, "thinking.delta"), [{ id: "thinking-1", text: "Mail from [email] first." }]);
    const completed = one(events, "thinking.completed");
    assert.equal(completed.id, "thinking-1");
    assert.equal(typeof completed.durationMs, "number");
  });

  test("tool input is redacted (keys too) and truncated without counting", async () => {
    const { events } = await play([
      {
        type: "tool.start",
        id: "t1",
        kind: "connector",
        connector: "gmail",
        name: "search_threads",
        input: { query: "from:jane@example.com", body: "x".repeat(600), "bob@example.com": 1, api_key: "abc" },
      },
      { type: "tool.end", id: "t1", ok: true },
      done("ok"),
    ]);
    const started = one(events, "tool.started");
    assert.equal(started.kind, "connector");
    assert.equal(started.connector, "gmail");
    assert.equal(started.name, "search_threads");
    assert.equal(started.input.query, "from:[email]");
    assert.equal(started.input.body.length, 500);
    assert.ok(started.input.body.endsWith("…"));
    assert.equal(started.input["[email]"], 1);
    assert.equal(started.input.api_key, "[secret]");
    assert.equal("inputTruncated" in started, false);
    assert.equal(one(events, "run.completed").redactions, 0);
  });

  test("tool input over 4 KB keeps its leading fields", async () => {
    const input = Object.fromEntries(Array.from({ length: 20 }, (_, i) => [`f${i}`, "y".repeat(450)]));
    const { events } = await play([
      { type: "tool.start", id: "t1", kind: "workspace", name: "read_file", input },
      done("ok"),
    ]);
    const started = one(events, "tool.started");
    assert.equal(started.inputTruncated, true);
    assert.equal("connector" in started, false);
    const keys = Object.keys(started.input);
    assert.ok(keys.length > 0 && keys.length < 20);
    assert.deepEqual(keys, Object.keys(input).slice(0, keys.length));
    assert.ok(Buffer.byteLength(JSON.stringify(started.input)) <= 4096);
  });

  test("a tool error is redacted, counted and cut to 300 characters", async () => {
    const { events } = await play([
      { type: "tool.start", id: "t1", kind: "connector", connector: "gmail", name: "search_threads", input: {} },
      { type: "tool.end", id: "t1", ok: false, errorText: `No mailbox for jane@example.com. ${"z".repeat(400)}` },
      done("ok"),
    ]);
    const completed = one(events, "tool.completed");
    assert.equal(completed.ok, false);
    assert.ok(completed.error.startsWith("No mailbox for [email]."));
    assert.equal(completed.error.length, 300);
    const result = one(events, "run.completed");
    assert.equal(result.redactions, 1);
    assert.deepEqual(result.connectorErrors, [{ connector: "gmail", kind: "other", message: completed.error }]);
  });

  test("sources and connector errors", async () => {
    const call = (id: string, connector: string, ok: boolean, errorText?: string): AgentEvent[] => [
      { type: "tool.start", id, kind: "connector", connector, name: "search", input: {} },
      { type: "tool.end", id, ok, errorText },
    ];
    const { events } = await play([
      ...call("1", "gmail", false, "Error 403: insufficient_scope"),
      ...call("2", "gmail", false, "401 Unauthorized"),
      ...call("3", "calendar", true),
      ...call("4", "gmail", true),
      ...call("5", "drive", false, "invalid_grant: token expired"),
      ...call("6", "slack", false, "boom"),
      ...call("7", "unknown", true),
      { type: "tool.start", id: "8", kind: "workspace", name: "read_file", input: { path: "a" } },
      { type: "tool.end", id: "8", ok: false, errorText: "ENOENT" },
      done("ok"),
    ]);
    const completed = one(events, "run.completed");
    assert.deepEqual(completed.sources, [
      { id: "calendar", name: "Google Calendar" },
      { id: "gmail", name: "Gmail" },
      { id: "unknown", name: "unknown" },
    ]);
    assert.deepEqual(completed.connectorErrors, [
      { connector: "gmail", kind: "insufficient_scope", message: "Error 403: insufficient_scope" },
      { connector: "drive", kind: "auth_expired", message: "invalid_grant: token expired" },
      { connector: "slack", kind: "other", message: "boom" },
    ]);
  });

  test("a tool still open when the run ends is shown as failed", async () => {
    const { events } = await play([
      { type: "tool.start", id: "t1", kind: "other", name: "web_search", input: {} },
      done("ok"),
    ]);
    assert.deepEqual(one(events, "tool.completed"), { id: "t1", ok: false });
  });

  test("structured output: an object is redacted (keys and values) and counted", async () => {
    const { run, events } = await play(
      [
        { type: "output.writing" },
        done("", { structured: { "a@example.com": 2, "b@example.com": 3, note: "call +84 912 345 678", total: 5 } }),
      ],
      newSpec({ outputSchema: { type: "object" } }),
    );
    const output = { "[email]": 2, "[email] (2)": 3, note: "call [phone]", total: 5 };
    const completed = one(events, "run.completed");
    assert.deepEqual(completed.output, output);
    assert.equal(completed.text, "");
    assert.equal(completed.redactions, 3);
    assert.deepEqual(run.output, output);
  });

  for (const [label, structured] of [
    ["missing", undefined],
    ["an array", [1, 2]],
    ["a string", "{}"],
    ["null", null],
  ] as const) {
    test(`structured output ${label} fails with invalid_output`, async () => {
      const { run, events } = await play(
        [
          { type: "text.start", key: "0" },
          { type: "text.delta", key: "0", text: "partial" },
          done("partial", { structured }),
        ],
        newSpec({ outputSchema: { type: "object" } }),
      );
      const failed = one(events, "run.failed");
      assert.equal(failed.code, "invalid_output");
      assert.equal(failed.retryable, true);
      assert.equal(run.status, "failed");
      assert.equal(run.output, undefined);
      assert.deepEqual(deltas(events), ["partial"], "held text is flushed before failing");
      assertEnded(events);
    });
  }

  test("a provider failure is passed on after flushing held text", async () => {
    const { run, events } = await play([
      { type: "text.start", key: "0" },
      { type: "text.delta", key: "0", text: "half a line" },
      {
        type: "failed",
        code: "max_turns",
        message: "Hit the turn limit",
        retryable: false,
        details: { providerCode: "error_max_turns" },
      },
      { type: "text.delta", key: "0", text: "ignored" },
    ]);
    assert.deepEqual(deltas(events), ["half a line"]);
    assert.deepEqual(one(events, "run.failed"), {
      code: "max_turns",
      message: "Hit the turn limit",
      retryable: false,
      details: { providerCode: "error_max_turns" },
    });
    assert.deepEqual(run.error, { code: "max_turns", message: "Hit the turn limit", retryable: false });
    assertEnded(events);
  });

  test("cancelled before the run starts: the provider isn't called", async () => {
    const run = newRun();
    run.abort.abort();
    const adapter = fakeAdapter(() => [done("ok")]);
    await runOnce(adapter, run, newSpec());
    assert.equal(adapter.calls, 0);
    assert.deepEqual(types(run.events), ["run.started", "run.failed", "stream.done"]);
    assert.deepEqual(one(run.events, "run.failed"), { code: "cancelled", message: "Stopped.", retryable: false });
    assert.equal(run.status, "cancelled");
  });

  test("cancelled during the run: later events are dropped", async () => {
    const run = newRun();
    const adapter = fakeAdapter(async function* (current) {
      yield { type: "text.start", key: "0" };
      yield { type: "text.delta", key: "0", text: "Working on it" };
      current.abort.abort();
      yield done("Working on it, done");
    });
    await runOnce(adapter, run, newSpec());
    assert.equal(one(run.events, "run.failed").code, "cancelled");
    assert.deepEqual(deltas(run.events), ["Working on it"]);
    assert.equal(run.status, "cancelled");
    assertEnded(run.events);
  });

  test("cancelled during the run: a provider that throws on abort is still cancelled", async () => {
    const run = newRun();
    const adapter = fakeAdapter(async function* (current) {
      yield { type: "text.start", key: "0" };
      current.abort.abort();
      throw new Error("aborted by user");
    });
    await runOnce(adapter, run, newSpec());
    assert.equal(one(run.events, "run.failed").code, "cancelled");
    assertEnded(run.events);
  });

  test("a provider that throws fails with provider_error", async () => {
    const run = newRun();
    const adapter = fakeAdapter(async function* () {
      yield { type: "text.start", key: "0" };
      throw new Error("process exited for jane@example.com");
    });
    await runOnce(adapter, run, newSpec());
    const failed = one(run.events, "run.failed");
    assert.equal(failed.code, "provider_error");
    assert.equal(failed.retryable, true);
    assert.match(failed.message, /process exited for \[email\]/);
    assertEnded(run.events);
  });

  test("a provider that ends without a result fails with no_result", async () => {
    const { run, events } = await play([{ type: "output.writing" }, { type: "output.writing" }]);
    assert.equal(data(events, "output.started").length, 1);
    const failed = one(events, "run.failed");
    assert.equal(failed.code, "no_result");
    assert.equal(failed.retryable, true);
    assert.equal(run.status, "failed");
    assertEnded(events);
  });

  test("nothing is emitted once the run is finished", async () => {
    const { events } = await play([
      done("one"),
      done("two"),
      { type: "failed", code: "provider_error", message: "x", retryable: true },
    ]);
    assertEnded(events);
    assert.equal(one(events, "run.completed").text, "one");
  });
});

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { McpServerStatus, SDKMessage } from "@anthropic-ai/claude-agent-sdk";

import type { BridgeConfig } from "../../config.ts";
import type { AgentEvent, RunSpec } from "../../engine/types.ts";
import { Run } from "../../runs.ts";
import {
  assistantFailure,
  ClaudeAdapter,
  ClaudeEventMapper,
  claudeOptions,
  rateLimitFailure,
  resultFailure,
} from "./adapter.ts";
import { connectedConnectors, type ConnectorSet } from "./connectors.ts";

const msg = (value: object) => value as unknown as SDKMessage;
const stream = (event: object, parent: string | null = null) => msg({ type: "stream_event", event, parent_tool_use_id: parent });
const assistant = (content: object[], extra: object = {}) =>
  msg({ type: "assistant", message: { id: "msg", content }, parent_tool_use_id: null, ...extra });
const toolResult = (id: string, isError: boolean, content: unknown) =>
  msg({
    type: "user",
    message: { role: "user", content: [{ type: "tool_result", tool_use_id: id, is_error: isError, content }] },
    parent_tool_use_id: null,
  });
const success = (extra: object = {}) =>
  msg({
    type: "result",
    subtype: "success",
    is_error: false,
    result: "Done.",
    num_turns: 3,
    usage: { input_tokens: 100, cache_read_input_tokens: 50, cache_creation_input_tokens: 10, output_tokens: 20 },
    ...extra,
  });
const errorResult = (subtype: string, extra: object = {}) =>
  msg({ type: "result", subtype, is_error: true, errors: ["boom"], num_turns: 1, ...extra });

const feed = (mapper: ClaudeEventMapper, messages: SDKMessage[]) => messages.flatMap((m) => mapper.handle(m));
const last = (events: AgentEvent[]) => events.at(-1);

const textBlock = (index: number, deltas: string[]) => [
  stream({ type: "content_block_start", index, content_block: { type: "text", text: "" } }),
  ...deltas.map((text) => stream({ type: "content_block_delta", index, delta: { type: "text_delta", text } })),
  stream({ type: "content_block_stop", index }),
];

describe("ClaudeEventMapper", () => {
  it("streams text and thinking with keys unique across assistant messages", () => {
    const mapper = new ClaudeEventMapper();
    const events = feed(mapper, [
      stream({ type: "message_start", message: { id: "msg_1" } }),
      stream({ type: "content_block_start", index: 0, content_block: { type: "thinking", thinking: "" } }),
      stream({ type: "content_block_delta", index: 0, delta: { type: "thinking_delta", thinking: "Hmm" } }),
      stream({ type: "content_block_delta", index: 0, delta: { type: "signature_delta", signature: "x" } }),
      stream({ type: "content_block_stop", index: 0 }),
      ...textBlock(1, ["Hel", "lo"]),
      stream({ type: "message_start", message: { id: "msg_2" } }),
      ...textBlock(1, ["Again"]),
    ]);
    assert.deepEqual(events, [
      { type: "thinking.start", key: "msg_1:0" },
      { type: "thinking.delta", key: "msg_1:0", text: "Hmm" },
      { type: "thinking.end", key: "msg_1:0" },
      { type: "text.start", key: "msg_1:1" },
      { type: "text.delta", key: "msg_1:1", text: "Hel" },
      { type: "text.delta", key: "msg_1:1", text: "lo" },
      { type: "text.end", key: "msg_1:1" },
      { type: "text.start", key: "msg_2:1" },
      { type: "text.delta", key: "msg_2:1", text: "Again" },
      { type: "text.end", key: "msg_2:1" },
    ]);
  });

  it("keeps keys unique without message_start", () => {
    const events = feed(new ClaudeEventMapper(), [...textBlock(0, ["a"]), ...textBlock(0, ["b"])]);
    const keys = new Set(events.flatMap((event) => (event.type === "text.start" ? [event.key] : [])));
    assert.equal(keys.size, 2);
  });

  it("skips subagent messages", () => {
    const mapper = new ClaudeEventMapper();
    const events = feed(mapper, [
      stream({ type: "content_block_start", index: 0, content_block: { type: "text", text: "" } }, "toolu_parent"),
      msg({
        type: "assistant",
        message: { content: [{ type: "tool_use", id: "t9", name: "Read", input: {} }] },
        parent_tool_use_id: "toolu_parent",
      }),
    ]);
    assert.deepEqual(events, []);
  });

  it("maps tool calls by kind, once each, and their results", () => {
    const mapper = new ClaudeEventMapper();
    const events = feed(mapper, [
      assistant([
        { type: "text", text: "Looking" },
        { type: "tool_use", id: "t1", name: "mcp__gmail__search_threads", input: { query: "in:inbox" } },
      ]),
      assistant([{ type: "tool_use", id: "t1", name: "mcp__gmail__search_threads", input: { query: "in:inbox" } }]),
      assistant([{ type: "tool_use", id: "t2", name: "mcp__google_sheets_2__read_sheet", input: {} }]),
      assistant([{ type: "tool_use", id: "t3", name: "Read", input: { file_path: "/w/notes.md", limit: 10 } }]),
      assistant([{ type: "tool_use", id: "t4", name: "Glob", input: { pattern: "**/*.md", path: "/w" } }]),
      assistant([{ type: "tool_use", id: "t5", name: "Grep", input: { pattern: "todo", glob: "*.ts", output_mode: "x" } }]),
      assistant([{ type: "tool_use", id: "t6", name: "Grep", input: { pattern: "todo" } }]),
      assistant([{ type: "tool_use", id: "t7", name: "WebFetch", input: { url: "https://x" } }]),
      assistant([{ type: "tool_use", id: "t8", name: "StructuredOutput", input: { a: 1 } }]),
      toolResult("t1", false, [{ type: "text", text: "ok" }]),
      toolResult("t2", true, [{ type: "text", text: "403" }, { type: "text", text: "insufficient scope" }]),
      toolResult("t3", true, "no such file"),
      toolResult("t8", false, "ok"),
      toolResult("unknown", false, "ok"),
    ]);
    assert.deepEqual(events, [
      { type: "tool.start", id: "t1", kind: "connector", connector: "gmail", name: "search_threads", input: { query: "in:inbox" } },
      { type: "tool.start", id: "t2", kind: "connector", connector: "google_sheets_2", name: "read_sheet", input: {} },
      { type: "tool.start", id: "t3", kind: "workspace", name: "read_file", input: { path: "/w/notes.md" } },
      { type: "tool.start", id: "t4", kind: "workspace", name: "list_files", input: { pattern: "**/*.md" } },
      { type: "tool.start", id: "t5", kind: "workspace", name: "search_files", input: { pattern: "todo", glob: "*.ts" } },
      { type: "tool.start", id: "t6", kind: "workspace", name: "search_files", input: { pattern: "todo" } },
      { type: "tool.start", id: "t7", kind: "other", name: "WebFetch", input: { url: "https://x" } },
      { type: "output.writing" },
      { type: "tool.end", id: "t1", ok: true },
      { type: "tool.end", id: "t2", ok: false, errorText: "403 insufficient scope" },
      { type: "tool.end", id: "t3", ok: false, errorText: "no such file" },
    ]);
  });

  it("ends with done, usage and structured output", () => {
    const mapper = new ClaudeEventMapper();
    const events = feed(mapper, [...textBlock(0, ["Done."]), success({ structured_output: { a: 1 } })]);
    assert.deepEqual(last(events), {
      type: "done",
      text: "",
      structured: { a: 1 },
      usage: { inputTokens: 160, outputTokens: 20, turns: 3 },
    });
    assert.equal(events.filter((event) => event.type === "text.start").length, 1);
    assert.ok(mapper.finished);
    assert.deepEqual(mapper.handle(success()), []);
    assert.deepEqual(mapper.end(), []);
  });

  it("doesn't send structured output's JSON as text", () => {
    const events = feed(new ClaudeEventMapper(), [success({ result: '{"a":1}', structured_output: { a: 1 } })]);
    assert.deepEqual(
      events.map((event) => event.type),
      ["done"],
    );
  });

  it("sends the result text as a block when no partial text came through", () => {
    const events = feed(new ClaudeEventMapper(), [success()]);
    assert.deepEqual(events.slice(0, 3), [
      { type: "text.start", key: "result" },
      { type: "text.delta", key: "result", text: "Done." },
      { type: "text.end", key: "result" },
    ]);
    assert.equal(last(events)?.type, "done");
  });

  it("closes open blocks and fails with no_result when the stream ends without a result", () => {
    const mapper = new ClaudeEventMapper();
    feed(mapper, [stream({ type: "content_block_start", index: 0, content_block: { type: "text", text: "Hi" } })]);
    const events = mapper.end();
    assert.deepEqual(events[0], { type: "text.end", key: "m0:0" });
    assert.equal(last(events)?.type, "failed");
    assert.equal((last(events) as { code: string }).code, "no_result");
  });

  it("reports an assistant error when the result fails", () => {
    const mapper = new ClaudeEventMapper();
    const events = feed(mapper, [
      assistant([{ type: "text", text: "You've hit your limit" }], { error: "rate_limit" }),
      success({ is_error: true, result: "You've hit your limit" }),
    ]);
    assert.deepEqual(last(events), {
      type: "failed",
      code: "provider_usage_limit",
      message: "You've hit your limit",
      retryable: false,
      details: { provider: "claude", provider_code: "rate_limit" },
    });
  });

  it("forgets an earlier error when the turn recovers", () => {
    const mapper = new ClaudeEventMapper();
    const events = feed(mapper, [
      assistant([{ type: "text", text: "Output too long" }], { error: "max_output_tokens" }),
      success(),
    ]);
    assert.equal(last(events)?.type, "done");
  });

  it("reports a rejected rate limit when the stream ends", () => {
    const mapper = new ClaudeEventMapper();
    feed(mapper, [msg({ type: "rate_limit_event", rate_limit_info: { status: "rejected", resetsAt: 1_800_000_000 } })]);
    const event = last(mapper.end());
    assert.equal(event?.type === "failed" && event.code, "provider_usage_limit");
    assert.equal(event?.type === "failed" && event.details?.resets_at, new Date(1_800_000_000_000).toISOString());
  });

  it("ignores a rate limit that still allows the request", () => {
    const mapper = new ClaudeEventMapper();
    assert.deepEqual(mapper.handle(msg({ type: "rate_limit_event", rate_limit_info: { status: "allowed_warning" } })), []);
    const event = last(mapper.end());
    assert.equal(event?.type === "failed" && event.code, "no_result");
  });
});

describe("error mapping", () => {
  const code = (event: AgentEvent | undefined) => (event?.type === "failed" ? [event.code, event.retryable] : event);

  it("maps assistant errors", () => {
    const table: [Parameters<typeof assistantFailure>[0], string, string, boolean][] = [
      ["authentication_failed", "", "provider_auth_required", false],
      ["rate_limit", "", "provider_usage_limit", false],
      ["billing_error", "", "provider_usage_limit", false],
      ["max_output_tokens", "", "context_limit", false],
      ["invalid_request", "Prompt is too long: 210000 tokens > 200000 maximum", "context_limit", false],
      ["invalid_request", "messages.0: bad", "provider_api_error", true],
      ["overloaded", "", "provider_api_error", true],
      ["server_error", "", "provider_api_error", true],
      ["unknown", "", "provider_api_error", true],
    ];
    for (const [error, text, expected, retryable] of table) {
      const failed = assistantFailure(error, text);
      assert.deepEqual(code(failed), [expected, retryable], error);
      assert.equal(failed.details?.provider_code, error);
    }
  });

  it("maps result subtypes", () => {
    const table: [SDKMessage, string, boolean][] = [
      [errorResult("error_max_turns"), "max_turns", false],
      [errorResult("error_max_structured_output_retries"), "invalid_output", true],
      [errorResult("error_during_execution"), "provider_error", true],
      [errorResult("error_max_budget_usd"), "provider_error", true],
      [errorResult("error_during_execution", { terminal_reason: "prompt_too_long" }), "context_limit", false],
      [success({ is_error: true, api_error_status: 401, result: "Invalid API key" }), "provider_auth_required", false],
      [
        success({ is_error: true, result: 'Failed to authenticate. API Error: 401 {"message":"OAuth token has expired"}' }),
        "provider_auth_required",
        false,
      ],
      [success({ is_error: true, api_error_status: 529, result: "Overloaded" }), "provider_api_error", true],
      [success({ is_error: true, result: "Prompt is too long" }), "context_limit", false],
      [success({ is_error: true, result: "x", stop_reason: "model_context_window_exceeded" }), "context_limit", false],
    ];
    for (const [message, expected, retryable] of table) {
      const failed = resultFailure(message as Extract<SDKMessage, { type: "result" }>);
      assert.deepEqual(code(failed), [expected, retryable], JSON.stringify(message));
    }
    assert.equal(resultFailure(success() as Extract<SDKMessage, { type: "result" }>), undefined);
  });

  it("keeps the sign-in reason and original code", () => {
    const failed = resultFailure(
      success({
        is_error: true,
        result: 'Failed to authenticate. API Error: 401 {"message":"OAuth token has expired"}',
      }) as Extract<SDKMessage, { type: "result" }>,
    );
    assert.match(failed?.message ?? "", /\/login\. \(OAuth token has expired\)$/);
    assert.deepEqual(failed?.details, { provider: "claude", provider_code: "authentication_error" });
  });

  it("prefers sign-in over an earlier error, and an earlier error over a generic one", () => {
    const earlier = assistantFailure("overloaded", "Overloaded");
    const auth = success({ is_error: true, api_error_status: 401, result: "" }) as Extract<SDKMessage, { type: "result" }>;
    assert.equal(resultFailure(auth, earlier)?.code, "provider_auth_required");
    const generic = errorResult("error_during_execution") as Extract<SDKMessage, { type: "result" }>;
    assert.equal(resultFailure(generic, earlier), earlier);
    assert.equal(resultFailure(errorResult("error_max_turns") as Extract<SDKMessage, { type: "result" }>, earlier)?.code, "max_turns");
  });

  it("maps a rejected rate limit with its reset time", () => {
    const failed = rateLimitFailure({ status: "rejected", resetsAt: 1_800_000_000, rateLimitType: "five_hour" });
    assert.deepEqual(code(failed), ["provider_usage_limit", false]);
    assert.deepEqual(failed.details, {
      provider: "claude",
      provider_code: "rate_limit_rejected:five_hour",
      resets_at: "2027-01-15T08:00:00.000Z",
    });
  });
});

const config = {
  port: 47821,
  allowedOrigins: [],
  workspace: "/tmp/ws",
  tools: ["Read", "Glob", "Grep", "Bash"],
  model: "config-model",
  defaultProvider: "claude",
  models: ["claude-opus"],
  limits: { maxTurns: 60, maxToolOutputTokens: 100_000 },
  results: { retentionDays: 14, maxKeys: 200 },
  link: { enabled: true, connectors: "all", maxRunsPerDay: 24, minIntervalMinutes: 30 },
  claudeExecutable: "/bin/claude",
  connectors: "auto",
  trustedRecipeKeys: {},
  generation: false,
  home: "/tmp/home",
} satisfies BridgeConfig;

const connectors: ConnectorSet = {
  connectors: [
    { id: "gmail", name: "Gmail", state: "connected", tools: ["search_threads"] },
    { id: "calendar", name: "Google Calendar", state: "connected", tools: ["list_events"] },
  ],
  mcpServers: {
    gmail: { type: "claudeai-proxy", url: "https://g", id: "g" },
    calendar: { type: "claudeai-proxy", url: "https://c", id: "c" },
  } as unknown as ConnectorSet["mcpServers"],
  readOnlyTools: ["mcp__gmail__search_threads", "mcp__calendar__list_events"],
  writeTools: ["mcp__gmail__send_message", "mcp__calendar__create_event"],
  skipped: [],
};

const newRun = () =>
  new Run(
    { sessionId: "s1", persisted: false, origin: "https://seleya.example.com", ownerId: "o1", provider: "claude" },
    () => {},
  );

const baseSpec: RunSpec = {
  prompt: "hi",
  systemPrompt: "SYSTEM",
  session: { id: "s1", resume: false, persist: false },
  connectorIds: ["calendar"],
  workspaceTools: [],
};

describe("claudeOptions", () => {
  it("isolates the run and narrows connectors", () => {
    const run = newRun();
    const options = claudeOptions(run, baseSpec, config, "1.2.3", connectors);
    assert.deepEqual(options.tools, []);
    assert.deepEqual(options.settingSources, []);
    assert.equal(options.strictMcpConfig, true);
    assert.deepEqual(options.skills, []);
    assert.equal(options.includePartialMessages, true);
    assert.equal(options.abortController, run.abort);
    assert.equal(options.cwd, "/tmp/ws");
    assert.equal(options.systemPrompt, "SYSTEM");
    assert.deepEqual(Object.keys(options.mcpServers ?? {}), ["calendar"]);
    assert.deepEqual(options.allowedTools, ["mcp__calendar__list_events"]);
    assert.deepEqual(options.disallowedTools, ["mcp__gmail__send_message", "mcp__calendar__create_event"]);
    assert.equal(options.model, "config-model");
    assert.equal(options.pathToClaudeCodeExecutable, "/bin/claude");
    assert.equal(options.env?.CLAUDE_AGENT_SDK_CLIENT_APP, "seleya-bridge/1.2.3");
    assert.equal(options.env?.MAX_MCP_OUTPUT_TOKENS, process.env.MAX_MCP_OUTPUT_TOKENS);
    assert.equal("maxTurns" in options, false);
    assert.equal("outputFormat" in options, false);
  });

  it("starts a new session, persisted or not", () => {
    const options = claudeOptions(newRun(), baseSpec, config, "1", connectors);
    assert.equal(options.sessionId, "s1");
    assert.equal(options.persistSession, false);
    assert.equal("resume" in options, false);
    assert.equal("title" in options, false);
    const titled = claudeOptions(
      newRun(),
      { ...baseSpec, session: { id: "s2", resume: false, persist: true, title: "Plan" } },
      config,
      "1",
      connectors,
    );
    assert.equal(titled.sessionId, "s2");
    assert.equal(titled.title, "Plan");
    assert.equal(titled.persistSession, true);
  });

  it("resumes a session", () => {
    const options = claudeOptions(
      newRun(),
      { ...baseSpec, session: { id: "s3", resume: true, persist: true, title: "ignored" } },
      config,
      "1",
      connectors,
    );
    assert.equal(options.resume, "s3");
    assert.equal("sessionId" in options, false);
    assert.equal("title" in options, false);
    assert.equal(options.persistSession, true);
  });

  it("maps the spec's limits, model, workspace tools and output schema", () => {
    const schema = { type: "object", properties: {} };
    const options = claudeOptions(
      newRun(),
      {
        ...baseSpec,
        model: "spec-model",
        workspaceTools: ["read_file", "search_files"],
        outputSchema: schema,
        maxTurns: 7,
        maxToolOutputTokens: 50_000,
      },
      config,
      "1",
      connectors,
    );
    assert.deepEqual(options.tools, ["Read", "Grep"]);
    assert.equal(options.model, "spec-model");
    assert.equal(options.maxTurns, 7);
    assert.equal(options.env?.MAX_MCP_OUTPUT_TOKENS, "50000");
    assert.deepEqual(options.outputFormat, { type: "json_schema", schema });
  });

  it("redacts connector results with the run's redactor", async () => {
    const run = newRun();
    const hook = claudeOptions(run, baseSpec, config, "1", connectors).hooks?.PostToolUse?.[0]?.hooks[0];
    assert.ok(hook);
    const result = await hook(
      {
        hook_event_name: "PostToolUse",
        tool_name: "mcp__calendar__list_events",
        tool_input: {},
        tool_response: { organizer: "alice@example.com" },
      } as unknown as Parameters<typeof hook>[0],
      undefined,
      { signal: new AbortController().signal },
    );
    assert.equal(run.redactor.total, 1);
    assert.deepEqual(result, {
      hookSpecificOutput: { hookEventName: "PostToolUse", updatedToolOutput: { organizer: "[email]" } },
    });
  });
});

describe("connectedConnectors", () => {
  const status = (name: string, state = "connected") => ({ name, status: state, scope: "claudeai" }) as McpServerStatus;

  it("assigns the same ids whatever the discovery order", () => {
    const statuses = [
      status("claude.ai Outlook"),
      status("claude.ai Google Sheets"),
      status("claude.ai Microsoft Outlook"),
      status("claude.ai Gmail", "needs-auth"),
      { name: "local", status: "connected", scope: "user" } as McpServerStatus,
    ];
    const expected = [
      ["google_sheets", "Google Sheets"],
      ["outlook", "Microsoft Outlook"],
      ["outlook_2", "Outlook"],
    ];
    assert.deepEqual(connectedConnectors(statuses), expected);
    assert.deepEqual(connectedConnectors([...statuses].reverse()), expected);
  });
});

describe("ClaudeAdapter.status", () => {
  it("reports Claude as ready with the config's models and workspace tools", async () => {
    const adapter = new ClaudeAdapter({ ...config, connectors: {} }, "1");
    await adapter.start();
    const status = adapter.status();
    assert.equal(status.state, "ready");
    assert.deepEqual(status.models, ["claude-opus"]);
    assert.deepEqual(status.features, {
      structuredOutput: true,
      resume: true,
      thinking: true,
      workspaceTools: ["read_file", "list_files", "search_files"],
    });
    assert.equal(status.connectorsState, "ready");
    assert.equal(adapter.discovering(), false);
    assert.deepEqual(status.connectors, []);
  });
});

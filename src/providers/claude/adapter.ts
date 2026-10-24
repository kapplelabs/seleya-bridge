/**
 * The Claude provider: runs a RunSpec as one Claude Code turn through the Agent SDK and translates its
 * messages into AgentEvents (docs/gateway.md §10.3).
 *
 * Isolation: no filesystem settings, skills or MCP servers of the user's are loaded, so the user's own
 * ~/.claude permission rules and hooks never apply to requests coming from a web page. Only the spec's
 * workspace tools and the read-only tools of its connectors (connectors.ts) exist, and any call that would
 * need approval is denied. What a connector returns loses personal and secret data (redact.ts) before
 * Claude reads it; everything Claude writes is redacted by the engine on its way out.
 */
import {
  query,
  type CanUseTool,
  type HookCallback,
  type Options,
  type SDKAssistantMessageError,
  type SDKMessage,
  type SDKRateLimitInfo,
  type SDKResultMessage,
} from "@anthropic-ai/claude-agent-sdk";

import type { BridgeConfig } from "../../config.ts";
import type {
  AgentEvent,
  ProviderAdapter,
  ProviderId,
  ProviderStatus,
  RunFailureCode,
  RunSpec,
  WorkspaceTool,
} from "../../engine/types.ts";
import type { Redactor } from "../../redact.ts";
import type { Run } from "../../runs.ts";
import {
  discoverConnectors,
  EMPTY_CONNECTORS,
  onlyConnectors,
  wantsConnectors,
  type ConnectorSet,
} from "./connectors.ts";

const MAX_REASON_LENGTH = 160;
/** The tool Claude Code gives Claude for structured output: the answer, not a step worth showing. */
const STRUCTURED_OUTPUT_TOOL = "StructuredOutput";

/** Neutral workspace tool names ↔ Claude Code's built-in tools. */
const CLAUDE_TOOLS: Record<WorkspaceTool, string> = {
  read_file: "Read",
  list_files: "Glob",
  search_files: "Grep",
};
const WORKSPACE_NAMES = new Map(Object.entries(CLAUDE_TOOLS).map(([neutral, claude]) => [claude, neutral]));

/** config.tools as neutral names; tools without one (Bash, WebFetch…) are never offered to a run. */
export const workspaceToolsOf = (tools: string[]): WorkspaceTool[] =>
  tools.flatMap((tool) => (WORKSPACE_NAMES.get(tool) as WorkspaceTool | undefined) ?? []);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const truncate = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

/** Denies every call that would need approval: there is no approval surface yet. */
export const denyUnapproved: CanUseTool = async (toolName) => ({
  behavior: "deny",
  message: `${toolName} needs approval, and this bridge can't ask for it yet. Answer without it.`,
});

/**
 * Connector results lose personal and secret data before Claude reads them. Built-in tools (Read, Grep…)
 * read the user's own workspace and are left as they are.
 */
export const redactConnectorOutput =
  (redactor: Redactor): HookCallback =>
  async (input) => {
    if (input.hook_event_name !== "PostToolUse" || !input.tool_name.startsWith("mcp__")) return {};
    const before = redactor.total;
    const output = redactor.value(input.tool_response);
    if (redactor.total === before) return {};
    return { hookSpecificOutput: { hookEventName: "PostToolUse", updatedToolOutput: output } };
  };

/** What every run shares: isolation, the connectors' read-only tools and redaction of their results. */
function isolatedOptions(run: Run, config: BridgeConfig, version: string, connectors: ConnectorSet): Options {
  return {
    abortController: run.abort,
    cwd: config.workspace,
    permissionMode: "default",
    canUseTool: denyUnapproved,
    settingSources: [],
    strictMcpConfig: true,
    // Options types mcpServers without `claudeai-proxy`, but Claude Code accepts the config that
    // mcpServerStatus() reports for a claude.ai connector, and connects it.
    mcpServers: connectors.mcpServers as Options["mcpServers"],
    // Read-only connector tools run without asking; every other connector tool doesn't exist for Claude.
    allowedTools: connectors.readOnlyTools,
    disallowedTools: connectors.writeTools,
    // The run's redactor: what it removes counts in run.completed.
    hooks: { PostToolUse: [{ hooks: [redactConnectorOutput(run.redactor)] }] },
    skills: [],
    includePartialMessages: true,
    pathToClaudeCodeExecutable: config.claudeExecutable,
    env: { ...process.env, CLAUDE_AGENT_SDK_CLIENT_APP: `seleya-bridge/${version}` },
  };
}

/** The SDK options for one spec (§10.3); `connectors` is everything discovery found. */
export function claudeOptions(
  run: Run,
  spec: RunSpec,
  config: BridgeConfig,
  version: string,
  connectors: ConnectorSet,
): Options {
  const base = isolatedOptions(run, config, version, onlyConnectors(connectors, spec.connectorIds));
  const { id, resume, persist, title } = spec.session;
  return {
    ...base,
    // Always the spec's, [] included: config.tools is only the ceiling policy already applied.
    tools: spec.workspaceTools.map((tool) => CLAUDE_TOOLS[tool]),
    systemPrompt: spec.systemPrompt,
    ...(resume ? { resume: id } : { sessionId: id, ...(title === undefined ? {} : { title }) }),
    persistSession: persist,
    ...(spec.outputSchema
      ? { outputFormat: { type: "json_schema", schema: spec.outputSchema as Record<string, unknown> } }
      : {}),
    ...(spec.maxTurns === undefined ? {} : { maxTurns: spec.maxTurns }),
    model: spec.model ?? config.model,
    env:
      spec.maxToolOutputTokens === undefined
        ? base.env
        : { ...base.env, MAX_MCP_OUTPUT_TOKENS: String(spec.maxToolOutputTokens) },
  };
}

type Failure = Extract<AgentEvent, { type: "failed" }>;

const RETRYABLE: Record<RunFailureCode, boolean> = {
  provider_auth_required: false,
  provider_usage_limit: false,
  provider_api_error: true,
  context_limit: false,
  max_turns: false,
  invalid_output: true,
  no_result: true,
  policy_violation: false,
  cancelled: false,
  provider_error: true,
};

export function failure(
  code: RunFailureCode,
  message: string,
  providerCode: string,
  details: Record<string, unknown> = {},
): Failure {
  return {
    type: "failed",
    code,
    message,
    retryable: RETRYABLE[code],
    details: { provider: "claude", provider_code: providerCode, ...details },
  };
}

/** The API refusing a request because the conversation no longer fits. */
const CONTEXT_OVERFLOW = /prompt is too long|context.?(window|length)|too many (input )?tokens/i;

/**
 * The API's own reason in an auth failure ("OAuth access token has expired…"), as a suffix. `claude auth
 * status` reports a stored credential as signed in even when its token no longer works, so the reason is
 * what tells an expired sign-in apart from a missing one.
 */
function authReason(text: string): string {
  const reason = text.match(/"message"\s*:\s*"([^"]+)"/)?.[1];
  return reason ? ` (${truncate(reason, MAX_REASON_LENGTH)})` : "";
}

const authFailure = (text: string, providerCode: string) =>
  failure(
    "provider_auth_required",
    `Claude Code on this machine needs you to sign in again: run \`claude\` in a terminal, then /login.${authReason(text)}`,
    providerCode,
  );

/** An `error` on an assistant message: the API call behind it failed. `text` is that message's text. */
export function assistantFailure(error: SDKAssistantMessageError, text: string): Failure {
  const message = text || `Claude's API call failed (${error}).`;
  switch (error) {
    case "authentication_failed":
    case "oauth_org_not_allowed":
    case "cloud_credential_error":
      return authFailure(text, error);
    case "rate_limit":
    case "billing_error":
    case "account_on_hold":
      return failure("provider_usage_limit", message, error);
    case "max_output_tokens":
      return failure("context_limit", message, error);
    case "invalid_request":
      return failure(CONTEXT_OVERFLOW.test(text) ? "context_limit" : "provider_api_error", message, error);
    default:
      return failure("provider_api_error", message, error);
  }
}

/** A rejected rate limit: the account's Claude usage is used up until `resetsAt`. */
export function rateLimitFailure(info: SDKRateLimitInfo): Failure {
  // Seconds since the epoch; milliseconds tolerated.
  const resetsAt =
    info.resetsAt === undefined
      ? undefined
      : new Date(info.resetsAt < 1e12 ? info.resetsAt * 1000 : info.resetsAt).toISOString();
  return failure(
    "provider_usage_limit",
    `Claude's usage limit is reached${resetsAt ? ` until ${resetsAt}` : ""}.`,
    `rate_limit_rejected${info.rateLimitType ? `:${info.rateLimitType}` : ""}`,
    resetsAt ? { resets_at: resetsAt } : {},
  );
}

/**
 * Why a turn's result is a failure, or undefined when it succeeded. `earlier` is what an assistant message
 * or rate limit event already said went wrong: a result only says that something did.
 */
export function resultFailure(message: SDKResultMessage, earlier?: Failure): Failure | undefined {
  switch (message.subtype) {
    case "success":
      break;
    case "error_max_turns":
      return failure("max_turns", "Claude used every turn it was allowed without finishing.", message.subtype);
    case "error_max_structured_output_retries":
      return failure("invalid_output", "Claude couldn't produce output matching the schema.", message.subtype);
    default:
      return (
        earlier ??
        failure(
          message.terminal_reason === "prompt_too_long" ? "context_limit" : "provider_error",
          message.errors.join("\n") || "Claude stopped with an error.",
          message.subtype,
        )
      );
  }
  if (!message.is_error) return undefined;
  // A "success" that is_error is an API failure (auth, overload…) reported as the result text.
  // The CLI doesn't always set api_error_status, so the result text is checked too.
  if (message.api_error_status === 401 || /authentication_error|Failed to authenticate/i.test(message.result))
    return authFailure(message.result, message.api_error_status === 401 ? "401" : "authentication_error");
  if (earlier) return earlier;
  const providerCode = message.api_error_status ? String(message.api_error_status) : "api_error";
  if (
    message.terminal_reason === "prompt_too_long" ||
    message.stop_reason === "model_context_window_exceeded" ||
    CONTEXT_OVERFLOW.test(message.result)
  )
    return failure(
      "context_limit",
      message.result || "The conversation no longer fits Claude's context.",
      providerCode,
    );
  return failure("provider_api_error", message.result || "Claude couldn't reach the API.", providerCode);
}

/** Claude's built-in workspace tool calls, in the neutral shape (§6.3). */
function workspaceInput(name: string, input: unknown): unknown {
  const field = (key: string) => (isRecord(input) && typeof input[key] === "string" ? input[key] : undefined);
  switch (name) {
    case "Read":
      return { path: field("file_path") };
    case "Glob":
      return { pattern: field("pattern") };
    default: {
      const glob = field("glob");
      return glob === undefined ? { pattern: field("pattern") } : { pattern: field("pattern"), glob };
    }
  }
}

/** The text of a tool result, e.g. a connector's error message. */
function resultText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((block: unknown) => (isRecord(block) && typeof block.text === "string" ? block.text : ""))
    .join(" ");
}

type StreamEvent = Extract<SDKMessage, { type: "stream_event" }>["event"];

/**
 * Folds SDK messages into AgentEvents for one run. Pure: no I/O, so a recorded stream can be replayed.
 * After the first `done` or `failed` everything else is ignored.
 */
export class ClaudeEventMapper {
  /** Prefix of the current API message's block keys. */
  private message = "m0";
  private messages = 0;
  /** API content-block index of the current message → its open block. */
  private readonly open = new Map<number, { key: string; kind: "text" | "thinking" }>();
  private readonly usedKeys = new Set<string>();
  /** Tool call ids seen: a call is reported once, however many messages repeat it. */
  private readonly seenTools = new Set<string>();
  /** Tool calls started and not ended yet. */
  private readonly tools = new Set<string>();
  private sawText = false;
  /** What an assistant message or rate limit event said went wrong, for the result to report. */
  private earlier: Failure | undefined;
  private ended = false;

  get finished(): boolean {
    return this.ended;
  }

  handle(message: SDKMessage): AgentEvent[] {
    if (this.ended) return [];
    // Subagent frames carry a parent tool_use id; only the main conversation counts.
    if ("parent_tool_use_id" in message && message.parent_tool_use_id) return [];
    switch (message.type) {
      case "stream_event":
        return this.onStreamEvent(message.event);
      case "assistant": {
        const events: AgentEvent[] = [];
        for (const block of message.message.content)
          if (block.type === "tool_use") events.push(...this.onToolUse(block.id, block.name, block.input));
        if (message.error) {
          const text = message.message.content
            .map((block) => (block.type === "text" ? block.text : ""))
            .join("\n")
            .trim();
          this.earlier = assistantFailure(message.error, text);
        }
        return events;
      }
      case "user": {
        const events: AgentEvent[] = [];
        if (Array.isArray(message.message.content))
          for (const block of message.message.content)
            if (block.type === "tool_result" && this.tools.delete(block.tool_use_id))
              events.push(
                block.is_error === true
                  ? { type: "tool.end", id: block.tool_use_id, ok: false, errorText: resultText(block.content) }
                  : { type: "tool.end", id: block.tool_use_id, ok: true },
              );
        return events;
      }
      case "rate_limit_event":
        if (message.rate_limit_info.status === "rejected") this.earlier = rateLimitFailure(message.rate_limit_info);
        return [];
      case "result":
        return this.onResult(message);
      default:
        return [];
    }
  }

  /** The SDK stream ended; adds the terminal event when no result came. */
  end(): AgentEvent[] {
    if (this.ended) return [];
    return this.finish(this.earlier ?? failure("no_result", "Claude ended without an answer.", "no_result"));
  }

  private onStreamEvent(event: StreamEvent): AgentEvent[] {
    switch (event.type) {
      case "message_start":
        this.open.clear();
        this.message = event.message.id || `m${++this.messages}`;
        return [];
      case "content_block_start": {
        const block = event.content_block;
        if (block.type !== "text" && block.type !== "thinking") return [];
        let key = `${this.message}:${event.index}`;
        // No message_start (or a reused id): keys still never repeat within a run.
        while (this.usedKeys.has(key)) key = `${(this.message = `m${++this.messages}`)}:${event.index}`;
        this.usedKeys.add(key);
        this.open.set(event.index, { key, kind: block.type });
        const initial = block.type === "text" ? block.text : block.thinking;
        if (block.type === "text") this.sawText = true;
        const events: AgentEvent[] = [{ type: `${block.type}.start`, key }];
        if (initial) events.push({ type: `${block.type}.delta`, key, text: initial });
        return events;
      }
      case "content_block_delta": {
        const open = this.open.get(event.index);
        if (open?.kind === "text" && event.delta.type === "text_delta")
          return [{ type: "text.delta", key: open.key, text: event.delta.text }];
        if (open?.kind === "thinking" && event.delta.type === "thinking_delta")
          return [{ type: "thinking.delta", key: open.key, text: event.delta.thinking }];
        return [];
      }
      case "content_block_stop": {
        const open = this.open.get(event.index);
        if (!open) return [];
        this.open.delete(event.index);
        return [{ type: `${open.kind}.end`, key: open.key }];
      }
      default:
        return [];
    }
  }

  private onToolUse(id: string, name: string, input: unknown): AgentEvent[] {
    if (this.seenTools.has(id)) return [];
    this.seenTools.add(id);
    if (name === STRUCTURED_OUTPUT_TOOL) return [{ type: "output.writing" }];
    this.tools.add(id);
    const mcp = name.match(/^mcp__(.+?)__(.+)$/);
    if (mcp?.[1] && mcp[2])
      return [{ type: "tool.start", id, kind: "connector", connector: mcp[1], name: mcp[2], input }];
    const neutral = WORKSPACE_NAMES.get(name);
    if (neutral)
      return [{ type: "tool.start", id, kind: "workspace", name: neutral, input: workspaceInput(name, input) }];
    return [{ type: "tool.start", id, kind: "other", name, input }];
  }

  private onResult(message: SDKResultMessage): AgentEvent[] {
    const failed = resultFailure(message, this.earlier);
    if (failed || message.subtype !== "success")
      return this.finish(failed ?? failure("provider_error", "Claude stopped with an error.", message.subtype));
    const events: AgentEvent[] = [];
    // With structured output, the result text is that output as JSON: the answer is `structured`, not text.
    const text = message.structured_output === undefined ? message.result : "";
    // No partial messages came through (older CLI): the final text as one block.
    if (!this.sawText && text) {
      const key = "result";
      events.push(
        { type: "text.start", key },
        { type: "text.delta", key, text },
        { type: "text.end", key },
      );
    }
    const usage = message.usage;
    const done: AgentEvent = {
      type: "done",
      text,
      ...(message.structured_output === undefined ? {} : { structured: message.structured_output }),
      usage: {
        // Cached input is still input the turn read.
        inputTokens:
          (usage.input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0),
        outputTokens: usage.output_tokens ?? 0,
        turns: message.num_turns,
      },
    };
    return this.finish(done, events);
  }

  /** Closes blocks still open (a cut-off stream), then the terminal event. */
  private finish(terminal: AgentEvent, before: AgentEvent[] = []): AgentEvent[] {
    this.ended = true;
    const closing: AgentEvent[] = [...this.open.values()].map(({ key, kind }) => ({ type: `${kind}.end`, key }));
    this.open.clear();
    return [...closing, ...before, terminal];
  }
}

export interface ClaudeAdapterOptions {
  /** Connector discovery finished; only called when the config asks for connectors. */
  onConnectors?: (set: ConnectorSet) => void;
}

export class ClaudeAdapter implements ProviderAdapter {
  readonly id: ProviderId = "claude";
  private readonly config: BridgeConfig;
  private readonly version: string;
  private readonly options: ClaudeAdapterOptions;
  private connectorSet = EMPTY_CONNECTORS;
  private discoveringNow = false;
  private stopped = false;

  constructor(config: BridgeConfig, version: string, options: ClaudeAdapterOptions = {}) {
    this.config = config;
    this.version = version;
    this.options = options;
  }

  async start(): Promise<void> {
    if (!wantsConnectors(this.config)) return;
    this.discoveringNow = true;
    void discoverConnectors(this.config, this.version)
      .catch((error: unknown) => {
        // E.g. no `claude` binary: runs still work, without connectors.
        console.error("Couldn't look up connectors:", error instanceof Error ? error.message : error);
        return EMPTY_CONNECTORS;
      })
      .then((found) => {
        this.discoveringNow = false;
        if (this.stopped) return;
        this.connectorSet = found;
        this.options.onConnectors?.(found);
      });
  }

  /** Everything discovery found (the desktop app lists it). */
  connectors(): ConnectorSet {
    return this.connectorSet;
  }

  /** Connector discovery is still running. */
  discovering(): boolean {
    return this.discoveringNow;
  }

  status(): ProviderStatus {
    return {
      id: this.id,
      // Claude Code has no cheap sign-in probe: a signed-out run fails with provider_auth_required.
      state: "ready",
      models: this.config.models,
      features: {
        structuredOutput: true,
        resume: true,
        thinking: true,
        workspaceTools: workspaceToolsOf(this.config.tools),
      },
      connectorsState: this.discoveringNow ? "discovering" : "ready",
      connectors: this.connectorSet.connectors.map(({ id, name, state, tools }) => ({ id, name, state, tools })),
    };
  }

  async *run(run: Run, spec: RunSpec): AsyncGenerator<AgentEvent> {
    if (run.abort.signal.aborted) return;
    const mapper = new ClaudeEventMapper();
    let conversation: ReturnType<typeof query> | undefined;
    let drained = false;
    try {
      conversation = query({
        prompt: spec.prompt,
        options: claudeOptions(run, spec, this.config, this.version, this.connectorSet),
      });
      for await (const message of conversation) {
        // A cancel can land before the CLI is listening for it: stop reading and end the process.
        if (run.abort.signal.aborted) return;
        yield* mapper.handle(message);
      }
      drained = true;
      if (run.abort.signal.aborted) return;
      yield* mapper.end();
    } catch (error) {
      if (run.abort.signal.aborted || mapper.finished) return;
      yield failure("provider_error", error instanceof Error ? error.message : String(error), "exception");
    } finally {
      // Cancelled, or the engine stopped reading: the CLI process must not outlive the run.
      if (!drained) conversation?.close();
    }
  }

  async stop(): Promise<void> {
    this.stopped = true;
  }
}

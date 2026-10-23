/**
 * Runs one Claude Code turn through the Agent SDK and translates its messages into Seleya's answer
 * stream events (`seleya.*`, the contract in seleya's src/types/chat/stream.ts):
 * text blocks → seleya.block.started / seleya.block.delta, tool calls → seleya.trace.*,
 * the result → seleya.message.completed or seleya.error, then stream.done.
 *
 * Isolation: no filesystem settings, skills or MCP servers of the user's are loaded, so the user's own
 * ~/.claude permission rules and hooks never apply to requests coming from a web page. Only the
 * configured tools and the read-only tools of the configured connectors (connectors.ts) exist, and any
 * call that would need approval is denied. What a connector returns loses personal and secret data
 * (redact.ts) before Claude reads it, so it can't end up in an answer.
 */
import path from "node:path";

import {
  query,
  type CanUseTool,
  type HookCallback,
  type Options,
  type SDKMessage,
  type SDKResultMessage,
} from "@anthropic-ai/claude-agent-sdk";

import type { BridgeConfig } from "./config.ts";
import type { ConnectorSet } from "./connectors.ts";
import { Redactor } from "./redact.ts";
import type { Run } from "./runs.ts";

const MAX_DETAIL_LENGTH = 160;

/** Input fields worth showing under a connector step, first match wins. */
const CONNECTOR_DETAIL_FIELDS = [
  "query",
  "q",
  "search",
  "jql",
  "cql",
  "issueIdOrKey",
  "time_min",
  "timeMin",
  "channel_id",
  "thread_id",
];

type StepStatus = "done" | "active" | "pending" | "failed";

export interface TraceStep {
  id: string;
  label: string;
  detail?: string;
  /** Seleya connector id, for the connector's name and icon. */
  connector?: string;
  status: StepStatus;
}

interface TextBlock {
  type: "text";
  text: string;
}

export interface ClaudeTurn {
  prompt: string;
  /** Continue this Claude Code session; otherwise start a new one with the run's session id. */
  resume: boolean;
  title: string;
}

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export const truncate = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

/**
 * The API's own reason in an auth failure ("OAuth access token has expired…"), as a suffix. `claude auth
 * status` reports a stored credential as signed in even when its token no longer works, so the reason is
 * what tells an expired sign-in apart from a missing one.
 */
function authReason(result: string): string {
  const reason = result.match(/"message"\s*:\s*"([^"]+)"/)?.[1];
  return reason ? ` (${truncate(reason, MAX_DETAIL_LENGTH)})` : "";
}

export interface RunFailure {
  code: string;
  message: string;
  retryable: boolean;
}

/** Why a turn's result is a failure, or undefined when it succeeded. */
export function resultFailure(message: SDKResultMessage): RunFailure | undefined {
  if (message.subtype !== "success")
    return {
      code: message.subtype,
      message: message.errors.join("\n") || "Claude stopped with an error.",
      retryable: false,
    };
  if (!message.is_error) return undefined;
  // A "success" that is_error is an API failure (auth, overload…) reported as the result text.
  // The CLI doesn't always set api_error_status, so the result text is checked too.
  if (message.api_error_status === 401 || /authentication_error|Failed to authenticate/i.test(message.result))
    return {
      code: "claude_auth_required",
      message: `Claude Code on this machine needs you to sign in again: run \`claude\` in a terminal, then /login.${authReason(message.result)}`,
      retryable: false,
    };
  return { code: "claude_api_error", message: message.result || "Claude couldn't reach the API.", retryable: true };
}

/** search_threads → "search threads". */
const humanize = (tool: string) => tool.replace(/[_-]+/g, " ").trim();

/** A short, human label for a tool call, shown as a trace step. */
export function describeTool(
  name: string,
  input: unknown,
  connectors: ConnectorSet,
): { label: string; detail?: string; connector?: string } {
  const field = (key: string) => {
    const value = isRecord(input) ? input[key] : undefined;
    return typeof value === "string" ? truncate(value, MAX_DETAIL_LENGTH) : undefined;
  };
  const mcp = name.match(/^mcp__([^_]+(?:_[^_]+)*?)__(.+)$/);
  if (mcp?.[1] && mcp[2]) {
    const connector = connectors.connectors.find((item) => item.id === mcp[1]);
    const detail = CONNECTOR_DETAIL_FIELDS.map(field).find((value) => value !== undefined);
    return { label: `${connector?.name ?? mcp[1]}: ${humanize(mcp[2])}`, detail, connector: connector?.id };
  }
  switch (name) {
    case "Read": {
      const file = field("file_path");
      return { label: file ? `Read ${path.basename(file)}` : "Read a file", detail: file };
    }
    case "Glob":
      return { label: "Find files", detail: field("pattern") };
    case "Grep":
      return { label: "Search files", detail: field("pattern") };
    case "Bash":
      return { label: "Run a command", detail: field("command") };
    case "WebFetch":
      return { label: "Fetch a page", detail: field("url") };
    case "WebSearch":
      return { label: "Search the web", detail: field("query") };
    default:
      return { label: name };
  }
}

/** Folds SDK messages into stream events for one run; keeps what message.completed needs. */
export class AnswerMapper {
  private readonly run: Run;
  private readonly blocks: TextBlock[] = [];
  /** API content-block index of the current assistant message → Seleya block index. */
  private readonly openBlocks = new Map<number, number>();
  private readonly steps = new Map<string, TraceStep>();
  private traceStartedAt: number | undefined;
  private readonly connectors: ConnectorSet;
  private readonly redactor: Redactor;

  constructor(run: Run, connectors: ConnectorSet, redactor: Redactor) {
    this.run = run;
    this.connectors = connectors;
    this.redactor = redactor;
  }

  handle(message: SDKMessage): void {
    // Subagent frames carry a parent tool_use id; only the main conversation is the answer.
    if ("parent_tool_use_id" in message && message.parent_tool_use_id) return;
    switch (message.type) {
      case "stream_event":
        return this.onStreamEvent(message.event);
      case "assistant":
        for (const block of message.message.content)
          if (block.type === "tool_use") this.onToolUse(block.id, block.name, block.input);
        return;
      case "user":
        if (Array.isArray(message.message.content))
          for (const block of message.message.content)
            if (block.type === "tool_result") this.onToolResult(block.tool_use_id, block.is_error === true);
        return;
      case "result": {
        const failure = resultFailure(message);
        if (!failure && message.subtype === "success") return this.complete(message.result);
        if (failure) return this.fail(failure.code, failure.message, failure.retryable);
      }
    }
  }

  private onStreamEvent(event: Extract<SDKMessage, { type: "stream_event" }>["event"]): void {
    switch (event.type) {
      case "message_start":
        this.openBlocks.clear();
        return;
      case "content_block_start":
        if (event.content_block.type !== "text") return;
        this.openBlocks.set(event.index, this.startBlock());
        if (event.content_block.text) this.appendText(this.blocks.length - 1, event.content_block.text);
        return;
      case "content_block_delta": {
        const index = this.openBlocks.get(event.index);
        if (index !== undefined && event.delta.type === "text_delta") this.appendText(index, event.delta.text);
        return;
      }
    }
  }

  private startBlock(): number {
    const index = this.blocks.length;
    this.blocks.push({ type: "text", text: "" });
    this.run.emit("seleya.block.started", { index, type: "text" });
    return index;
  }

  private appendText(index: number, text: string): void {
    const block = this.blocks[index];
    if (!block || !text) return;
    block.text += text;
    this.run.emit("seleya.block.delta", { index, text });
  }

  private onToolUse(id: string, name: string, input: unknown): void {
    if (this.steps.has(id)) return;
    if (this.traceStartedAt === undefined) {
      this.traceStartedAt = Date.now();
      this.run.emit("seleya.trace.started", { title: "Working on it…", steps: [] });
    }
    const described = describeTool(name, input, this.connectors);
    // A search query can hold an address or a code: the step shows it redacted.
    const detail = described.detail === undefined ? undefined : this.redactor.text(described.detail);
    const step: TraceStep = { id, ...described, detail, status: "active" };
    this.steps.set(id, step);
    // Events are kept for replay, so each one gets its own copy of the step.
    this.run.emit("seleya.trace.step", { ...step });
  }

  private onToolResult(id: string, isError: boolean): void {
    const step = this.steps.get(id);
    if (!step) return;
    step.status = isError ? "failed" : "done";
    this.run.emit("seleya.trace.step", { ...step });
  }

  /** The trace as the completed message carries it, closing it on the stream first. */
  private closeTrace() {
    if (this.traceStartedAt === undefined) return undefined;
    const steps = [...this.steps.values()].map((step) =>
      step.status === "active" ? { ...step, status: "failed" as const } : step,
    );
    const doneTitle = `Used ${steps.length} ${steps.length === 1 ? "tool" : "tools"}`;
    const durationMs = Date.now() - this.traceStartedAt;
    this.run.emit("seleya.trace.completed", { doneTitle, durationMs });
    return { title: "Working on it…", doneTitle, steps, durationMs };
  }

  private complete(resultText: string): void {
    // No partial messages came through (older CLI): show the final text in one block.
    if (this.blocks.length === 0 && resultText) this.appendText(this.startBlock(), resultText);
    const trace = this.closeTrace();
    this.run.emit("seleya.message.completed", {
      message: {
        id: this.run.assistantMessageId,
        role: "assistant",
        createdAt: this.run.createdAt.toISOString(),
        blocks: this.blocks,
        trace,
        agentIds: [],
        status: "complete",
      },
    });
    this.run.emit("stream.done");
  }

  fail(code: string, message: string, retryable: boolean): void {
    if (this.run.finished) return;
    this.closeTrace();
    this.run.emit("seleya.error", { code, message, retryable });
    this.run.emit("stream.done");
  }

  /** The SDK stream ended without a result message. */
  finish(): void {
    this.fail("no_result", "Claude ended without an answer.", true);
  }
}

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

/** Told to every run that reads connectors; redact.ts removes what slips through. */
export const PRIVACY_RULES =
  "Never repeat email addresses, phone numbers, street addresses, passwords, keys, tokens, sign-in codes, card, bank or ID numbers, or links that grant access. Values shown as [email], [phone], [secret], [card], [id], [ip] or [link] were removed on purpose: don't try to recover them.";

/** Today's date and the connectors' rules: Claude needs the date to ask a calendar for "today". */
export function systemPrompt(connectors: ConnectorSet): string {
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const today = new Date().toLocaleDateString("en-US", {
    timeZone,
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  const usable = connectors.connectors.filter((item) => item.state === "connected").map((item) => item.name);
  return [
    "You are Seleya's assistant, running in Claude Code on the user's own computer.",
    `Today is ${today}; the user's time zone is ${timeZone}.`,
    usable.length > 0
      ? `You can read the user's ${usable.join(", ")} through connectors. They are read-only: you can search and read, but you can't send, create, change or delete anything. If asked to, say so. ${PRIVACY_RULES}`
      : "No connectors are available.",
    "Answer in the user's language, concisely.",
  ].join("\n");
}

/** What every run shares: isolation, the connectors' read-only tools and redaction of their results. */
export function isolatedOptions(
  run: Run,
  config: BridgeConfig,
  version: string,
  connectors: ConnectorSet,
  redactor: Redactor,
): Options {
  return {
    abortController: run.abort,
    cwd: config.workspace,
    tools: config.tools,
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
    hooks: { PostToolUse: [{ hooks: [redactConnectorOutput(redactor)] }] },
    skills: [],
    includePartialMessages: true,
    model: config.model,
    pathToClaudeCodeExecutable: config.claudeExecutable,
    env: { ...process.env, CLAUDE_AGENT_SDK_CLIENT_APP: `seleya-bridge/${version}` },
  };
}

function claudeOptions(
  run: Run,
  turn: ClaudeTurn,
  config: BridgeConfig,
  version: string,
  connectors: ConnectorSet,
  redactor: Redactor,
): Options {
  return {
    ...isolatedOptions(run, config, version, connectors, redactor),
    systemPrompt: systemPrompt(connectors),
    ...(turn.resume ? { resume: run.sessionId } : { sessionId: run.sessionId, title: turn.title }),
  };
}

/** Runs the turn to the end; every outcome, including a crash or cancel, ends the run's stream. */
export async function runClaude(
  run: Run,
  turn: ClaudeTurn,
  config: BridgeConfig,
  version: string,
  connectors: ConnectorSet,
): Promise<void> {
  const redactor = new Redactor();
  const mapper = new AnswerMapper(run, connectors, redactor);
  run.emit("seleya.message.started", {
    conversationId: run.sessionId,
    conversationTitle: turn.title,
    assistantMessageId: run.assistantMessageId,
    agentIds: [],
  });
  const cancelled = () => mapper.fail("cancelled", "Stopped.", false);
  try {
    if (run.abort.signal.aborted) return cancelled();
    const conversation = query({
      prompt: turn.prompt,
      options: claudeOptions(run, turn, config, version, connectors, redactor),
    });
    for await (const message of conversation) {
      // A cancel can land before the CLI is listening for it: stop reading and end the process.
      if (run.abort.signal.aborted) {
        conversation.close();
        return cancelled();
      }
      mapper.handle(message);
    }
    mapper.finish();
  } catch (error) {
    if (run.abort.signal.aborted) cancelled();
    else mapper.fail("claude_error", error instanceof Error ? error.message : String(error), true);
  }
}

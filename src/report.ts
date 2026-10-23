/**
 * Report runs: one Claude turn with the bridge's own prompt and only the connectors' read-only tools, that
 * returns structured output (a JSON schema, validated here) instead of a chat answer. The Daily Briefing
 * and the Calendar Assistant's week are report runs.
 *
 * They stream Seleya's agent run events (`seleya.run.*`, `seleya.thought.*`, `seleya.trace.step`; the
 * contract in seleya's src/types/agent/runStream.ts) so Seleya shows the agent working, and keep the
 * result on the run for GET /v1/runs/:id/result. The web only asks for a report: it can't change what
 * Claude is told to read.
 *
 * Privacy: connector results are redacted before Claude reads them (claude.ts), each prompt tells Claude
 * to leave personal and secret data out, and the result is redacted once more before it is kept.
 */
import { query, type SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";

import { describeTool, isolatedOptions, resultFailure, truncate, type TraceStep } from "./claude.ts";
import type { BridgeConfig } from "./config.ts";
import type { ConnectorSet } from "./connectors.ts";
import { Redactor } from "./redact.ts";
import type { Run } from "./runs.ts";

const THOUGHT_TITLE_LENGTH = 64;
const FAILURE_REASON_LENGTH = 300;
/** The tool Claude Code gives Claude for structured output: the answer, not a step worth showing. */
const STRUCTURED_OUTPUT_TOOL = "StructuredOutput";

export interface ReportSource {
  id: string;
  name: string;
}

export interface ReportSpec<T> {
  agentId: string;
  /** The run's title, e.g. "Creating today's briefing". */
  title: string;
  /** Phase labels while Claude plans, writes its reasoning and fills in the output. */
  planningLabel: string;
  reasoningLabel: string;
  writingLabel: string;
  prompt: string;
  systemPrompt: string;
  maxTurns: number;
  /**
   * Raises Claude Code's limit on one connector result (MAX_MCP_OUTPUT_TOKENS). A result over the limit
   * is saved to a file, which a report run can't read (it has no file tools).
   */
  maxToolOutputTokens?: number;
  /** What Claude must return; checked after redaction. */
  output: z.ZodType<T>;
  /** `GET /v1/runs/:id/result` answers `{ [resultKey]: result }`. */
  resultKey: string;
  /** The error a run without a valid output ends with, e.g. `invalid_briefing`. */
  invalidCode: string;
  invalidMessage: string;
  noResultMessage: string;
  /** Why a checked output still can't be used (e.g. part of it couldn't be read); ends the run as failed. */
  problem?: (output: T) => { code: string; message: string } | undefined;
  /** Turns the checked output into what Seleya gets, plus the run's completion summary. */
  finish: (output: T, sources: ReportSource[], redactions: number) => { result: object; summary: string };
}

/** "Read 2 sources · removed 3 private details" */
export function readSummary(sources: number, redactions: number): string {
  const read = `Read ${sources} ${sources === 1 ? "source" : "sources"}`;
  return redactions > 0 ? `${read} · removed ${redactions} private details` : read;
}

/** The text of a tool result, e.g. a connector's error message. */
function resultText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((block: unknown) =>
      typeof block === "object" && block !== null && "text" in block && typeof block.text === "string" ? block.text : "",
    )
    .join(" ");
}

/**
 * Why no connector could be read, in words the user can act on. A claude.ai connector can be connected
 * without the permission it needs (Google's consent screen lets the user untick "read your email").
 */
function unreadMessage(names: string[], reason: string): string {
  const which = names.join(", ") || "The connectors";
  if (/insufficient.?scope|insufficient.?permission|access_denied|forbidden|403/i.test(reason))
    return `${which} is connected in Claude without permission to read it. Disconnect it at claude.ai/settings/connectors, connect it again and allow every requested permission, then restart seleya-bridge.`;
  if (/unauthori[sz]ed|401|expired|invalid_grant|re-?auth/i.test(reason))
    return `${which} needs to be connected again in Claude (claude.ai/settings/connectors), then restart seleya-bridge.`;
  return `${which} couldn't be read${reason ? `: ${reason}` : "."}`;
}

/** Folds SDK messages into agent run events; keeps the steps and sources the report needs. */
class ReportMapper<T> {
  private readonly startedAt = Date.now();
  private readonly steps = new Map<string, TraceStep>();
  /** Connector ids that answered without an error. */
  private readonly read = new Set<string>();
  /** The first error a connector call returned, redacted: why nothing could be read. */
  private failureReason = "";
  /** The text or thinking block being written: shown as one thought when it ends, redacted. */
  private open: { kind: "thinking" | "reasoning"; text: string; startedAt: number } | undefined;
  private thoughts = 0;

  private readonly run: Run;
  private readonly connectors: ConnectorSet;
  private readonly redactor: Redactor;
  private readonly spec: ReportSpec<T>;

  constructor(run: Run, connectors: ConnectorSet, redactor: Redactor, spec: ReportSpec<T>) {
    this.run = run;
    this.connectors = connectors;
    this.redactor = redactor;
    this.spec = spec;
  }

  start(): void {
    this.run.emit("seleya.run.started", { runId: this.run.id, agentId: this.spec.agentId, title: this.spec.title });
    this.phase("processing", this.spec.planningLabel);
  }

  private phase(phase: string, label: string): void {
    this.run.emit("seleya.run.phase", { phase, label });
  }

  handle(message: SDKMessage): void {
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
            if (block.type === "tool_result")
              this.onToolResult(block.tool_use_id, block.is_error === true, block.content);
        return;
      case "result": {
        const failure = resultFailure(message);
        if (failure) return this.fail(failure.code, failure.message, failure.retryable);
        if (message.subtype === "success") return this.complete(message.structured_output);
      }
    }
  }

  private onStreamEvent(event: Extract<SDKMessage, { type: "stream_event" }>["event"]): void {
    switch (event.type) {
      case "content_block_start":
        if (event.content_block.type === "thinking") this.openThought("thinking", "Thinking it through");
        else if (event.content_block.type === "text") this.openThought("reasoning", this.spec.reasoningLabel);
        return;
      case "content_block_delta":
        if (!this.open) return;
        if (event.delta.type === "thinking_delta") this.open.text += event.delta.thinking;
        else if (event.delta.type === "text_delta") this.open.text += event.delta.text;
        return;
      case "content_block_stop":
        return this.closeThought();
    }
  }

  private openThought(kind: "thinking" | "reasoning", label: string): void {
    this.closeThought();
    this.open = { kind, text: "", startedAt: Date.now() };
    this.phase(kind, label);
  }

  /** Emits the finished block as one thought; never token by token, so redaction sees whole values. */
  private closeThought(): void {
    const block = this.open;
    this.open = undefined;
    const text = block ? this.redactor.text(block.text).trim() : "";
    if (!block || !text) return;
    const id = `thought-${++this.thoughts}`;
    const title = truncate(text.split(/(?<=[.!?])\s|\n/, 1)[0] ?? text, THOUGHT_TITLE_LENGTH);
    this.run.emit("seleya.thought.started", { id, kind: block.kind, title });
    this.run.emit("seleya.thought.delta", { id, text });
    this.run.emit("seleya.thought.completed", { id, durationMs: Date.now() - block.startedAt });
  }

  private onToolUse(id: string, name: string, input: unknown): void {
    this.closeThought();
    if (name === STRUCTURED_OUTPUT_TOOL) return this.phase("writing", this.spec.writingLabel);
    if (this.steps.has(id)) return;
    const described = describeTool(name, input, this.connectors);
    const detail = described.detail === undefined ? undefined : this.redactor.text(described.detail);
    const step: TraceStep = { id, ...described, detail, status: "active" };
    this.steps.set(id, step);
    this.phase("tool", described.label);
    this.run.emit("seleya.trace.step", { ...step });
  }

  private onToolResult(id: string, isError: boolean, content: unknown): void {
    const step = this.steps.get(id);
    if (!step) return;
    step.status = isError ? "failed" : "done";
    if (isError && step.connector && !this.failureReason)
      this.failureReason = truncate(this.redactor.text(resultText(content)).trim(), FAILURE_REASON_LENGTH);
    if (!isError && step.connector) this.read.add(step.connector);
    this.run.emit("seleya.trace.step", { ...step });
  }

  private complete(structured: unknown): void {
    this.closeThought();
    // Redacted before it is validated, so nothing below sees the raw values.
    const parsed = this.spec.output.safeParse(this.redactor.value(structured));
    // Every connector call failed: an empty report would look like "nothing new" when nothing was read.
    const connectorSteps = [...this.steps.values()].filter((step) => step.connector);
    if (connectorSteps.length > 0 && this.read.size === 0) {
      const names = [
        ...new Set(
          connectorSteps.flatMap(
            (step) => this.connectors.connectors.find((item) => item.id === step.connector)?.name ?? [],
          ),
        ),
      ];
      return this.fail("connector_failed", unreadMessage(names, this.failureReason), true);
    }
    if (!parsed.success) return this.fail(this.spec.invalidCode, this.spec.invalidMessage, true);
    const problem = this.spec.problem?.(parsed.data);
    if (problem) return this.fail(problem.code, problem.message, true);
    const sources = this.connectors.connectors
      .filter((item) => this.read.has(item.id))
      .map(({ id, name }) => ({ id, name }));
    const { result, summary } = this.spec.finish(parsed.data, sources, this.redactor.total);
    this.run.result = { key: this.spec.resultKey, value: result };
    this.run.emit("seleya.run.completed", { durationMs: Date.now() - this.startedAt, summary, artifactIds: [] });
    this.run.emit("stream.done");
  }

  fail(code: string, message: string, retryable: boolean): void {
    if (this.run.finished) return;
    this.closeThought();
    for (const step of this.steps.values())
      if (step.status === "active") this.run.emit("seleya.trace.step", { ...step, status: "failed" });
    this.run.emit("seleya.error", { code, message, retryable });
    this.run.emit("stream.done");
  }

  finish(): void {
    this.fail("no_result", this.spec.noResultMessage, true);
  }
}

/** Runs the report to the end; every outcome, including a crash or cancel, ends the run's stream. */
export async function runReport<T>(
  run: Run,
  config: BridgeConfig,
  version: string,
  connectors: ConnectorSet,
  spec: ReportSpec<T>,
): Promise<void> {
  const redactor = new Redactor();
  const mapper = new ReportMapper(run, connectors, redactor, spec);
  mapper.start();
  // Seleya shows a "stopped" run as stopped, not failed.
  const stopped = () => mapper.fail("stopped", "Stopped.", false);
  try {
    if (run.abort.signal.aborted) return stopped();
    const base = isolatedOptions(run, config, version, connectors, redactor);
    const conversation = query({
      prompt: spec.prompt,
      options: {
        ...base,
        env:
          spec.maxToolOutputTokens === undefined
            ? base.env
            : { ...base.env, MAX_MCP_OUTPUT_TOKENS: String(spec.maxToolOutputTokens) },
        // Connectors only: a report has no reason to read the workspace.
        tools: [],
        systemPrompt: spec.systemPrompt,
        outputFormat: { type: "json_schema", schema: z.toJSONSchema(spec.output, { target: "draft-7" }) },
        maxTurns: spec.maxTurns,
        sessionId: run.sessionId,
        persistSession: false,
      },
    });
    for await (const message of conversation) {
      if (run.abort.signal.aborted) {
        conversation.close();
        return stopped();
      }
      mapper.handle(message);
    }
    mapper.finish();
  } catch (error) {
    if (run.abort.signal.aborted) stopped();
    else mapper.fail("claude_error", error instanceof Error ? error.message : String(error), true);
  }
}

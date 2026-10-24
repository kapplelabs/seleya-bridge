/**
 * Runs one RunSpec through a provider adapter and writes the wire events of docs/gateway.md §6 to the Run.
 * The adapter yields raw, provider-neutral AgentEvents; everything that leaves here is redacted (§6.5):
 * text line by line, thinking and tool errors per block, tool input with a scratch redactor, the output
 * keys and values. Every outcome ends with exactly one run.completed or run.failed, then stream.done.
 */
import { Redactor } from "../redact.ts";
import type { Run } from "../runs.ts";
import { TextStream, truncate } from "./text.ts";
import type { AgentEvent, ProviderAdapter, RunFailureCode, RunSpec, ToolKind } from "./types.ts";

/** Each string of a tool's input as tool.started shows it. */
const MAX_INPUT_STRING = 500;
/** The whole input, as JSON; past it only the leading fields are kept. */
const MAX_INPUT_BYTES = 4096;
/** tool.completed.error, connector_errors[].message, and the debug text of run.failed. */
const MAX_ERROR_LENGTH = 300;

export type ConnectorErrorKind = "insufficient_scope" | "auth_expired" | "other";

export interface ConnectorError {
  connector: string;
  kind: ConnectorErrorKind;
  message: string;
}

/** Why a connector call failed, from its error text; Seleya writes what the user should do about it. */
export function connectorErrorKind(reason: string): ConnectorErrorKind {
  if (/insufficient.?scope|insufficient.?permission|access_denied|forbidden|403/i.test(reason))
    return "insufficient_scope";
  if (/unauthori[sz]ed|401|expired|invalid_grant|re-?auth/i.test(reason)) return "auth_expired";
  return "other";
}

const byteLength = (value: unknown) => Buffer.byteLength(JSON.stringify(value) ?? "");

/** Cuts every string (not keys) to MAX_INPUT_STRING. */
function clipStrings(value: unknown): unknown {
  if (typeof value === "string") return truncate(value, MAX_INPUT_STRING);
  if (Array.isArray(value)) return value.map(clipStrings);
  if (typeof value !== "object" || value === null) return value;
  return Object.fromEntries(Object.entries(value).map(([key, field]) => [key, clipStrings(field)]));
}

/** Keeps the leading fields (or items) that fit in MAX_INPUT_BYTES. */
function limitSize(value: unknown): { input: unknown; truncated: boolean } {
  if (byteLength(value) <= MAX_INPUT_BYTES) return { input: value, truncated: false };
  if (Array.isArray(value)) {
    const kept: unknown[] = [];
    for (const item of value) {
      if (byteLength([...kept, item]) > MAX_INPUT_BYTES) break;
      kept.push(item);
    }
    return { input: kept, truncated: true };
  }
  if (typeof value === "object" && value !== null) {
    const kept: [string, unknown][] = [];
    for (const entry of Object.entries(value)) {
      if (byteLength(Object.fromEntries([...kept, entry])) > MAX_INPUT_BYTES) break;
      kept.push(entry);
    }
    return { input: Object.fromEntries(kept), truncated: true };
  }
  // Clipped scalars always fit; this is only a backstop.
  return { input: null, truncated: true };
}

/**
 * A tool's input as the stream shows it: redacted (keys and values) by a scratch redactor, since the
 * model wrote it and it isn't data removed from the answer, so it doesn't count in `redactions`.
 */
export function toolInput(input: unknown): { input: unknown; truncated: boolean } {
  return limitSize(clipStrings(new Redactor().value(input ?? {})));
}

const isPlainObject = (value: unknown): value is Record<string, unknown> => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
};

const describe = (error: unknown) => (error instanceof Error ? error.message : String(error));

interface TextBlock {
  block: number;
  stream: TextStream;
}

interface ThinkingBlock {
  text: string;
  startedAt: number;
}

interface Tool {
  kind: ToolKind;
  connector: string | undefined;
  open: boolean;
}

/** Folds one run's AgentEvents into wire events; each method is a no-op once the run is finished. */
class EventMapper {
  private readonly startedAt = Date.now();
  private readonly adapter: ProviderAdapter;
  private readonly run: Run;
  private readonly spec: RunSpec;
  /** Every text block in order of first appearance; its index is the wire `block`. */
  private readonly textBlocks: TextStream[] = [];
  private readonly openText = new Map<string, TextBlock>();
  private readonly openThinking = new Map<string, ThinkingBlock>();
  private thoughts = 0;
  private readonly tools = new Map<string, Tool>();
  /** Connector ids that answered without an error at least once, in the order they first did. */
  private readonly sources = new Set<string>();
  /** The first error each connector returned. */
  private readonly connectorErrors = new Map<string, ConnectorError>();
  private outputStarted = false;

  constructor(adapter: ProviderAdapter, run: Run, spec: RunSpec) {
    this.adapter = adapter;
    this.run = run;
    this.spec = spec;
  }

  start(): void {
    const { run, spec } = this;
    run.emit("run.started", {
      runId: run.id,
      // A one-off run keeps no transcript: its session id would resume nothing.
      sessionId: run.persisted ? run.sessionId : null,
      provider: this.adapter.id,
      ...(spec.model === undefined ? {} : { model: spec.model }),
      persist: spec.session.persist,
      connectors: spec.connectorIds,
      workspaceTools: spec.workspaceTools,
      // null: the provider's own limit.
      limits: { maxTurns: spec.maxTurns ?? null, maxToolOutputTokens: spec.maxToolOutputTokens ?? null },
    });
  }

  handle(event: AgentEvent): void {
    if (this.run.finished) return;
    switch (event.type) {
      case "text.start":
        return void this.textBlock(event.key);
      case "text.delta":
        return this.textBlock(event.key).stream.append(event.text);
      case "text.end":
        return this.endText(event.key);
      case "thinking.start":
        return void this.thinkingBlock(event.key);
      case "thinking.delta":
        this.thinkingBlock(event.key).text += event.text;
        return;
      case "thinking.end":
        return this.endThinking(event.key);
      case "tool.start":
        return this.startTool(event);
      case "tool.end":
        return this.endTool(event.id, event.ok, event.errorText);
      case "output.writing":
        if (this.outputStarted) return;
        this.outputStarted = true;
        return this.run.emit("output.started", {});
      case "done":
        return this.complete(event);
      case "failed":
        return this.fail(event.code, event.message, event.retryable, event.details);
    }
  }

  /** The open block for `key`, started on first sight (a delta without its start still shows). */
  private textBlock(key: string): TextBlock {
    const open = this.openText.get(key);
    if (open) return open;
    const block = this.textBlocks.length;
    const stream = new TextStream((text) => this.run.emit("text.delta", { block, text }));
    this.textBlocks.push(stream);
    const created = { block, stream };
    this.openText.set(key, created);
    this.run.emit("text.started", { block });
    return created;
  }

  private endText(key: string): void {
    const open = this.openText.get(key);
    if (!open) return;
    this.openText.delete(key);
    open.stream.end(this.run.redactor);
    this.run.emit("text.completed", { block: open.block });
  }

  private thinkingBlock(key: string): ThinkingBlock {
    let open = this.openThinking.get(key);
    if (!open) {
      open = { text: "", startedAt: Date.now() };
      this.openThinking.set(key, open);
    }
    return open;
  }

  /** Emits the finished block as one delta, never token by token, so redaction sees whole values. */
  private endThinking(key: string): void {
    const open = this.openThinking.get(key);
    if (!open) return;
    this.openThinking.delete(key);
    const text = this.run.redactor.text(open.text).trim();
    if (!text) return;
    const id = `thinking-${++this.thoughts}`;
    this.run.emit("thinking.started", { id });
    this.run.emit("thinking.delta", { id, text });
    this.run.emit("thinking.completed", { id, durationMs: Date.now() - open.startedAt });
  }

  private startTool(event: Extract<AgentEvent, { type: "tool.start" }>): void {
    if (this.tools.has(event.id)) return;
    const connector = event.kind === "connector" ? event.connector : undefined;
    this.tools.set(event.id, { kind: event.kind, connector, open: true });
    const { input, truncated } = toolInput(event.input);
    this.run.emit("tool.started", {
      id: event.id,
      kind: event.kind,
      ...(connector === undefined ? {} : { connector }),
      name: event.name,
      input,
      ...(truncated ? { inputTruncated: true } : {}),
    });
  }

  private endTool(id: string, ok: boolean, errorText: string | undefined): void {
    const tool = this.tools.get(id);
    if (!tool?.open) return;
    tool.open = false;
    // Counted: an error can quote what the connector holds (an address it couldn't reach).
    const error = errorText ? truncate(this.run.redactor.text(errorText), MAX_ERROR_LENGTH) : undefined;
    this.run.emit("tool.completed", { id, ok, ...(error === undefined ? {} : { error }) });
    if (!tool.connector) return;
    if (ok) this.sources.add(tool.connector);
    else if (!this.connectorErrors.has(tool.connector))
      this.connectorErrors.set(tool.connector, {
        connector: tool.connector,
        kind: connectorErrorKind(errorText ?? ""),
        message: error ?? "",
      });
  }

  /** Before the run ends: held text and thinking go out, calls still open are shown as failed. */
  private closeOpen(): void {
    for (const key of [...this.openThinking.keys()]) this.endThinking(key);
    for (const key of [...this.openText.keys()]) this.endText(key);
    for (const [id, tool] of this.tools) if (tool.open) this.endTool(id, false, undefined);
  }

  private complete(event: Extract<AgentEvent, { type: "done" }>): void {
    // No partial text came through: the answer still streams, as one block.
    if (this.textBlocks.length === 0 && event.text) this.textBlock("done").stream.append(event.text);
    this.closeOpen();
    if (this.spec.outputSchema && !isPlainObject(event.structured))
      return this.fail("invalid_output", "The provider's answer has no JSON object output.", true);
    // Every block was counted once when it ended; the answer repeats them, so it isn't counted again.
    const text = new Redactor().text(event.text);
    const output = this.spec.outputSchema ? (this.run.redactor.value(event.structured) as object) : undefined;
    const names = new Map(this.adapter.status().connectors.map(({ id, name }) => [id, name]));
    this.run.text = text;
    this.run.output = output;
    this.run.emit("run.completed", {
      text,
      ...(output === undefined ? {} : { output }),
      sources: [...this.sources].map((id) => ({ id, name: names.get(id) ?? id })),
      connectorErrors: [...this.connectorErrors.values()],
      redactions: this.run.redactor.total,
      ...(event.usage === undefined ? {} : { usage: event.usage }),
      durationMs: Date.now() - this.startedAt,
    });
    this.run.emit("stream.done", {});
  }

  fail(code: RunFailureCode, message: string, retryable: boolean, details?: Record<string, unknown>): void {
    if (this.run.finished) return;
    this.closeOpen();
    // Debug text from the provider can quote anything; scratch, since it isn't part of the answer.
    const scratch = new Redactor();
    const safeMessage = truncate(scratch.text(message), MAX_ERROR_LENGTH);
    this.run.error = { code, message: safeMessage, retryable };
    this.run.emit("run.failed", {
      code,
      message: safeMessage,
      retryable,
      ...(details === undefined ? {} : { details: scratch.value(details) }),
    });
    this.run.emit("stream.done", {});
  }

  cancel(): void {
    this.fail("cancelled", "Stopped.", false);
  }
}

/**
 * Runs `spec` with `adapter`, writing every wire event to `run`. Never throws: a provider that throws
 * becomes provider_error, one that ends without a result no_result, and an aborted run cancelled.
 */
export async function runOnce(adapter: ProviderAdapter, run: Run, spec: RunSpec): Promise<void> {
  if (run.finished) return;
  const mapper = new EventMapper(adapter, run, spec);
  mapper.start();
  if (run.abort.signal.aborted) return mapper.cancel();
  try {
    for await (const event of adapter.run(run, spec)) {
      // Stopped: whatever the provider still sends is dropped; leaving the loop asks it to end.
      if (run.abort.signal.aborted || run.finished) break;
      mapper.handle(event);
      if (run.finished) break;
    }
  } catch (error) {
    if (!run.abort.signal.aborted)
      return mapper.fail("provider_error", `The provider failed: ${describe(error)}`, true);
  }
  if (run.finished) return;
  if (run.abort.signal.aborted) return mapper.cancel();
  mapper.fail("no_result", "The provider ended without an answer.", true);
}

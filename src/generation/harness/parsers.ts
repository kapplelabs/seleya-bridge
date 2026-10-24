/**
 * Pure parsers for each harness's JSON stream (research R3). Each turns one stdout line into
 * normalized activity and, at the end, an outcome. Unknown lines are ignored.
 */
import type { HarnessActivity } from "./types.ts";

export interface ParsedLine {
  activity: HarnessActivity[];
  /** Set by the line that ends the run (a result or a fatal error). */
  outcome?: { ok: boolean; text?: string };
  /** An error the harness reported along the way (used to classify a failed exit). */
  error?: string;
  /** An action the harness's own permission check refused, e.g. `read_file(/abs/path)`. */
  denied?: string;
  /** The agent's conversation id, to continue it later (a correction resumes it warm). */
  session?: string;
}

export type StreamKind = "antigravity" | "claude" | "codex" | "lines";

type Json = Record<string, unknown>;

const isObject = (value: unknown): value is Json =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const str = (value: unknown) => (typeof value === "string" ? value : undefined);

function json(line: string): Json | undefined {
  try {
    const value: unknown = JSON.parse(line);
    return isObject(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

const empty = (): ParsedLine => ({ activity: [] });

/** `{"event":"step_update","step_update":{step_type,state,tool_name,text_delta,duration_seconds}}`. */
export function parseAntigravity(line: string): ParsedLine {
  // Headless Antigravity refuses what would need approval (e.g. a read outside the run folder);
  // the agent often stops right after, so the refusal explains the run's end.
  const denied = /denied permission for ([a-z_]+\([^)]*\))/.exec(line)?.[1];
  if (denied) return { activity: [], denied };
  const value = json(line);
  if (!value) return empty();
  if (value.event === "step_update" && isObject(value.step_update)) {
    const step = value.step_update;
    if (step.step_type === "tool" && typeof step.tool_name === "string") {
      const finished = step.state === "DONE" || step.state === "ERROR";
      const seconds = Number(step.duration_seconds);
      const info = isObject(step.tool_info) ? step.tool_info : {};
      return {
        activity: [
          {
            kind: "tool",
            tool: step.tool_name,
            state: finished ? "finished" : "started",
            durationMs:
              finished && Number.isFinite(seconds) ? Math.round(seconds * 1000) : undefined,
            callId: step.step_index === undefined ? undefined : String(step.step_index),
            input: isObject(info.parameters) ? info.parameters : undefined,
          },
        ],
      };
    }
    if (
      step.step_type === "agent_response" &&
      typeof step.text_delta === "string" &&
      step.text_delta
    )
      return { activity: [{ kind: "text", text: step.text_delta }] };
    return empty();
  }
  if (value.event === "init") return { activity: [], session: str(value.conversation_id) };
  if (value.event === "result" && isObject(value.result)) {
    const status = str(value.result.status) ?? "";
    return {
      session: str(value.result.conversation_id),
      activity: [],
      outcome: { ok: /success|ok/i.test(status), text: str(value.result.response) ?? status },
    };
  }
  if (value.event === "error") return { activity: [], error: str(value.message) ?? line };
  return empty();
}

/** `claude -p --output-format stream-json --verbose --include-partial-messages`. */
export function parseClaude(line: string): ParsedLine {
  const value = json(line);
  if (!value) return empty();
  if (value.type === "stream_event" && isObject(value.event)) {
    const event = value.event;
    if (
      event.type === "content_block_delta" &&
      isObject(event.delta) &&
      event.delta.type === "text_delta"
    )
      return {
        activity: [{ kind: "text", text: str(event.delta.text) ?? "" }].filter(
          (item) => item.text,
        ) as HarnessActivity[],
      };
    return empty();
  }
  // A whole assistant message carries each tool call with its full input (the stream only has it
  // in pieces), so calls start here; their results arrive in the next user message.
  if (
    value.type === "assistant" &&
    isObject(value.message) &&
    Array.isArray(value.message.content)
  )
    return {
      activity: value.message.content
        .filter((item): item is Json => isObject(item) && item.type === "tool_use")
        .map(
          (item): HarnessActivity => ({
            kind: "tool",
            tool: str(item.name) ?? "tool",
            state: "started",
            callId: str(item.id),
            input: isObject(item.input) ? item.input : undefined,
          }),
        ),
    };
  if (value.type === "user" && isObject(value.message) && Array.isArray(value.message.content)) {
    const results = value.message.content.filter(
      (item): item is Json => isObject(item) && item.type === "tool_result",
    );
    return {
      activity: results.map(
        (item): HarnessActivity => ({
          kind: "tool",
          tool: "tool",
          state: "finished",
          callId: str(item.tool_use_id),
        }),
      ),
    };
  }
  if (value.type === "system" && value.subtype === "init")
    return { activity: [], session: str(value.session_id) };
  if (value.type === "result") {
    const text = str(value.result) ?? str(value.subtype) ?? "";
    return {
      session: str(value.session_id),
      activity: [],
      outcome: { ok: value.is_error !== true, text },
      error: value.is_error === true ? text : undefined,
    };
  }
  return empty();
}

/** `codex exec --json`: thread/turn/item events. */
export function parseCodex(line: string): ParsedLine {
  const value = json(line);
  if (!value) return empty();
  const type = str(value.type) ?? "";
  if ((type === "item.started" || type === "item.completed") && isObject(value.item)) {
    const item = value.item;
    const itemType = str(item.type) ?? "";
    if (itemType === "agent_message" && type === "item.completed")
      return { activity: [{ kind: "text", text: str(item.text) ?? "" }] };
    if (itemType === "reasoning" && type === "item.completed" && str(item.text))
      return { activity: [{ kind: "text", text: str(item.text) ?? "" }] };
    if (itemType === "error") return empty(); // config warnings arrive as error items; not fatal
    if (itemType && itemType !== "agent_message" && itemType !== "reasoning") {
      // command_execution has `command`; file_change lists `changes[{path}]`.
      const changes = Array.isArray(item.changes) ? item.changes.filter(isObject) : [];
      const input: Json = { ...item };
      if (!str(item.command) && changes[0] && str(changes[0].path)) input.path = changes[0].path;
      return {
        activity: [
          {
            kind: "tool",
            tool: itemType === "file_change" ? "write_file" : itemType,
            state: type === "item.started" ? "started" : "finished",
            callId: str(item.id),
            input,
          },
        ],
      };
    }
    return empty();
  }
  if (type === "error") return { activity: [], error: str(value.message) ?? line };
  if (type === "turn.failed") {
    const error = isObject(value.error) ? str(value.error.message) : undefined;
    return { activity: [], outcome: { ok: false, text: error }, error };
  }
  if (type === "turn.completed") return { activity: [], outcome: { ok: true } };
  return empty();
}

/** Any program: each stdout line is narration. */
export function parseLines(line: string): ParsedLine {
  return { activity: [{ kind: "text", text: `${line}\n` }] };
}

export const PARSERS: Record<StreamKind, (line: string) => ParsedLine> = {
  antigravity: parseAntigravity,
  claude: parseClaude,
  codex: parseCodex,
  lines: parseLines,
};

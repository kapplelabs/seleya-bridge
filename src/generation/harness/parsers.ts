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
  const value = json(line);
  if (!value) return empty();
  if (value.event === "step_update" && isObject(value.step_update)) {
    const step = value.step_update;
    if (step.step_type === "tool" && typeof step.tool_name === "string") {
      const finished = step.state === "DONE";
      const seconds = Number(step.duration_seconds);
      return {
        activity: [
          {
            kind: "tool",
            tool: step.tool_name,
            state: finished ? "finished" : "started",
            durationMs:
              finished && Number.isFinite(seconds) ? Math.round(seconds * 1000) : undefined,
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
  if (value.event === "result" && isObject(value.result)) {
    const status = str(value.result.status) ?? "";
    return {
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
    if (
      event.type === "content_block_start" &&
      isObject(event.content_block) &&
      event.content_block.type === "tool_use"
    )
      return {
        activity: [
          { kind: "tool", tool: str(event.content_block.name) ?? "tool", state: "started" },
        ],
      };
    return empty();
  }
  if (value.type === "user" && isObject(value.message) && Array.isArray(value.message.content)) {
    const results = value.message.content.filter(
      (item) => isObject(item) && item.type === "tool_result",
    );
    return {
      activity: results.map(
        () => ({ kind: "tool", tool: "tool", state: "finished" }) as HarnessActivity,
      ),
    };
  }
  if (value.type === "result") {
    const text = str(value.result) ?? str(value.subtype) ?? "";
    return {
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
    if (itemType && itemType !== "agent_message" && itemType !== "reasoning")
      return {
        activity: [
          { kind: "tool", tool: itemType, state: type === "item.started" ? "started" : "finished" },
        ],
      };
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

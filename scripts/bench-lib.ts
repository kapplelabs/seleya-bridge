/**
 * Shared by the benchmark scripts (docs/generation-performance.md): what one finished run cost, from
 * its steps in the store and its harness log.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

export interface Step {
  label: string;
  status: string;
  startedAt?: number;
  finishedAt?: number;
}

interface Session {
  seconds: number;
  turns: number;
  input: number;
  output: number;
  thinking: number;
  cacheRead: number;
}

export interface RunMeasure {
  id: string;
  skill: string;
  status: string;
  edit: boolean;
  wallS: number;
  /** Seconds from start to the first step the agent reported (agent start-up and reading). */
  startupS: number;
  /** Seconds the main agent spent on its own steps, start-up included. */
  agentS: number;
  /** Seconds of correction rounds ("Fixing what the checks found"). */
  fixS: number;
  /** Seconds making delegated media. */
  mediaS: number;
  /** Seconds Seleya spent rendering and checking. */
  renderS: number;
  sessions: Session[];
  tools: Record<string, number>;
  reads: number;
  tokens: { input: number; output: number; thinking: number; cacheRead: number };
  passed: boolean | undefined;
}

const seconds = (from?: number, to?: number) => (from && to ? (to - from) / 1000 : 0);

/** Usage and tool calls from a stream-json harness log (one JSON object per line). */
export function readLog(file: string) {
  const sessions: Session[] = [];
  const tools: Record<string, number> = {};
  if (!existsSync(file)) return { sessions, tools };
  for (const line of readFileSync(file, "utf8").split("\n")) {
    if (!line.startsWith("{")) continue;
    let event: Record<string, any>;
    try {
      event = JSON.parse(line);
    } catch {
      continue;
    }
    // Antigravity
    const step = event.step_update;
    if (step?.state === "DONE" && step.step_type === "tool" && step.tool_name)
      tools[step.tool_name] = (tools[step.tool_name] ?? 0) + 1;
    if (event.event === "result") {
      const usage = event.result?.usage ?? {};
      sessions.push({
        seconds: event.result?.duration_seconds ?? 0,
        turns: event.result?.num_turns ?? 0,
        input: usage.input_tokens ?? 0,
        output: usage.output_tokens ?? 0,
        thinking: usage.thinking_tokens ?? 0,
        cacheRead: usage.cache_read_tokens ?? 0,
      });
    }
    // Claude Code
    if (event.type === "assistant")
      for (const block of event.message?.content ?? [])
        if (block.type === "tool_use") tools[block.name] = (tools[block.name] ?? 0) + 1;
    if (event.type === "result" && event.usage)
      sessions.push({
        seconds: (event.duration_ms ?? 0) / 1000,
        turns: event.num_turns ?? 0,
        input: (event.usage.input_tokens ?? 0) + (event.usage.cache_creation_input_tokens ?? 0),
        output: event.usage.output_tokens ?? 0,
        thinking: 0,
        cacheRead: event.usage.cache_read_input_tokens ?? 0,
      });
  }
  return { sessions, tools };
}

export function measure(home: string, row: Record<string, unknown>): RunMeasure {
  const steps = JSON.parse(String(row.steps)) as Step[];
  const request = JSON.parse(String(row.request)) as Record<string, unknown>;
  const started = Number(row.started_at) || undefined;
  const finished = Number(row.finished_at) || undefined;
  const sum = (match: (label: string) => boolean) =>
    steps
      .filter((step) => match(step.label))
      .reduce((total, step) => total + seconds(step.startedAt, step.finishedAt), 0);
  const isSeleya = (label: string) => /^(Rendering|Checking)/.test(label);
  const isFix = (label: string) => /^Fixing what the checks found/.test(label);
  const isMedia = (label: string) => /^Making|^Picture|^Image/.test(label);
  const agentSteps = steps.filter((step) => !isSeleya(step.label) && !isFix(step.label) && !isMedia(step.label));
  const firstAgent = Math.min(...agentSteps.map((step) => step.startedAt ?? Infinity));
  const lastAgent = Math.max(...agentSteps.map((step) => step.finishedAt ?? 0));
  const moved = path.join(home, "logs", `${String(row.id)}.log`);
  const { sessions, tools } = readLog(
    existsSync(moved) ? moved : path.join(home, "runs", String(row.id), "harness.log"),
  );
  const tokens = sessions.reduce(
    (total, session) => ({
      input: total.input + session.input,
      output: total.output + session.output,
      thinking: total.thinking + session.thinking,
      cacheRead: total.cacheRead + session.cacheRead,
    }),
    { input: 0, output: 0, thinking: 0, cacheRead: 0 },
  );
  const checks = JSON.parse(String(row.checks)) as { passed: boolean }[];
  return {
    id: String(row.id),
    skill: String(row.skill),
    status: String(row.local_status),
    edit: Boolean(request.edit_instruction || request.resize_from || request.instruction),
    wallS: seconds(started, finished),
    startupS: Number.isFinite(firstAgent) ? seconds(started, firstAgent) : 0,
    agentS: lastAgent ? seconds(started, lastAgent) : 0,
    fixS: sum(isFix),
    mediaS: sum(isMedia),
    renderS: sum(isSeleya),
    sessions,
    tools,
    reads: (tools.read_file ?? 0) + (tools.view_file ?? 0) + (tools.Read ?? 0),
    tokens,
    passed: checks.length ? checks.every((check) => check.passed) : undefined,
  };
}


/** The measures as a tab-separated table (pipe through `column -t -s $'\t'`). */
export function table(measures: RunMeasure[]): string {
  const k = (n: number) => `${Math.round(n / 1000)}k`;
  const lines = [
    ["run", "skill", "status", "wall s", "startup", "agent", "fix", "media", "render", "sessions", "reads", "tools", "in", "out+think", "cache"].join("\t"),
  ];
  for (const m of measures)
    lines.push(
      [
        m.id.slice(-8) + (m.edit ? "*" : ""),
        m.skill,
        m.status + (m.passed === undefined ? "" : m.passed ? " ✓" : " ✗"),
        m.wallS.toFixed(0),
        m.startupS.toFixed(0),
        m.agentS.toFixed(0),
        m.fixS.toFixed(0),
        m.mediaS.toFixed(0),
        m.renderS.toFixed(0),
        m.sessions.length,
        m.reads,
        Object.values(m.tools).reduce((a, b) => a + b, 0),
        k(m.tokens.input),
        k(m.tokens.output + m.tokens.thinking),
        k(m.tokens.cacheRead),
      ].join("\t"),
    );
  return lines.join("\n");
}

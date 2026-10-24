import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import type { Clock, Timer } from "../clock.ts";
import type {
  Harness,
  HarnessActivity,
  HarnessExit,
  HarnessHandle,
  HarnessStartInput,
} from "./types.ts";

/**
 * A harness with no AI behind it: it plays a script of file writes, exactly as a skill would, one
 * action per tick. Tests and `SELEYA_LOCAL_HARNESS=scripted` use it to exercise the runtime.
 */
export type ScriptAction =
  | { plan: string[] }
  | { step: string; status: "active" | "done" | "failed"; detail?: string }
  | { draft: string; slot: string; content?: string }
  | { write: string; content: string }
  | { manifest: Record<string, unknown> }
  | { activity: HarnessActivity }
  | { exit: "ok" | "fail"; code?: string; message?: string }
  /** Says this text (as the agent's words) and ends with it as the answer (the pipeline's JSON). */
  | { answer: string }
  /** Do nothing this tick (a pause in the agent's work). */
  | { idle: true }
  /** Never act again until stopped (a hung agent). */
  | { hang: true };

export const DEFAULT_SCRIPT: ScriptAction[] = [
  { activity: { kind: "tool", tool: "read_file", state: "started" } },
  { activity: { kind: "tool", tool: "read_file", state: "finished", durationMs: 20 } },
  { activity: { kind: "text", text: "Reading the request and planning the work." } },
  { step: "Preparing", status: "active" },
  { step: "Preparing", status: "done", detail: "Read the request" },
  { step: "Producing", status: "active" },
  { draft: "out/draft.txt", slot: "output", content: "draft" },
  { write: "out/result.txt", content: "result" },
  { step: "Producing", status: "done", detail: "Wrote out/result.txt" },
  { manifest: { skill: "_scripted", outputs: [{ path: "out/result.txt" }] } },
  { idle: true },
  { idle: true },
  { exit: "ok" },
];

/** `request.scripts[n]` plays on the n-th start in the same run (corrections); else `request.script`. */
function scriptFrom(request: Record<string, unknown>, start: number): ScriptAction[] {
  if (Array.isArray(request.scripts) && Array.isArray(request.scripts[start]))
    return request.scripts[start] as ScriptAction[];
  return Array.isArray(request.script) ? (request.script as ScriptAction[]) : DEFAULT_SCRIPT;
}

export class ScriptedHarness implements Harness {
  id = "scripted";
  name = "Scripted (test)";
  /** Every handle started, so tests can reach a run's handle. */
  readonly handles: ScriptedHandle[] = [];

  private clock: Clock;
  private tickMs: number;

  constructor(clock: Clock, tickMs = 1000) {
    this.clock = clock;
    this.tickMs = tickMs;
  }

  async check() {
    return { installed: true, signedIn: true, canGenerateImages: false, version: "test" };
  }

  start(input: HarnessStartInput): HarnessHandle {
    const start = this.handles.filter((item) => item.runId === input.runId).length;
    const handle = new ScriptedHandle(
      input,
      scriptFrom(input.request, start),
      this.clock,
      this.tickMs,
    );
    this.handles.push(handle);
    return handle;
  }
}

export class ScriptedHandle implements HarnessHandle {
  private listeners: ((activity: HarnessActivity) => void)[] = [];
  private index = 0;
  private timer: Timer;
  private settle!: (exit: HarnessExit) => void;
  private done = false;
  readonly exited: Promise<HarnessExit>;
  readonly runId: string;
  stopped = false;

  private input: HarnessStartInput;
  private script: ScriptAction[];

  constructor(input: HarnessStartInput, script: ScriptAction[], clock: Clock, tickMs: number) {
    this.input = input;
    this.runId = input.runId;
    this.script = script;
    this.exited = new Promise((resolve) => (this.settle = resolve));
    this.timer = clock.setInterval(() => this.tick(), tickMs);
  }

  onActivity(listener: (activity: HarnessActivity) => void): void {
    this.listeners.push(listener);
  }

  async stop(): Promise<void> {
    this.stopped = true;
    this.finish({ ok: false, code: "stopped", message: "Stopped" });
  }

  private finish(exit: HarnessExit) {
    if (this.done) return;
    this.done = true;
    this.timer.cancel();
    this.settle(exit);
  }

  private file(relative: string) {
    const full = path.join(this.input.folder, relative);
    mkdirSync(path.dirname(full), { recursive: true });
    return full;
  }

  private progress(record: Record<string, unknown>) {
    appendFileSync(this.file("progress.jsonl"), `${JSON.stringify(record)}\n`);
  }

  /** Plays the next action. */
  tick(): void {
    if (this.done) return;
    const action = this.script[this.index];
    if (!action) return this.finish({ ok: true });
    if ("hang" in action) return;
    this.index += 1;
    if ("plan" in action) this.progress({ type: "plan", steps: action.plan });
    else if ("step" in action)
      this.progress({
        type: "step",
        label: action.step,
        status: action.status,
        detail: action.detail,
      });
    else if ("draft" in action) {
      writeFileSync(this.file(action.draft), action.content ?? "draft");
      this.progress({ type: "draft", path: action.draft, slot: action.slot });
    } else if ("write" in action) writeFileSync(this.file(action.write), action.content);
    else if ("manifest" in action)
      writeFileSync(this.file("out/result.json"), JSON.stringify(action.manifest));
    else if ("activity" in action) for (const listener of this.listeners) listener(action.activity);
    else if ("answer" in action) {
      for (const listener of this.listeners) listener({ kind: "text", text: action.answer });
      this.finish({ ok: true, text: action.answer });
    } else if ("exit" in action)
      this.finish({ ok: action.exit === "ok", code: action.code, message: action.message });
  }
}

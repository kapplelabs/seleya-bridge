import type { SkillMeta } from "../skills.ts";

/** Something the agent did or said, normalized across harnesses (spec 002 FR-005). */
export type HarnessActivity =
  | {
      kind: "tool";
      tool: string;
      state: "started" | "finished";
      durationMs?: number;
      /** Pairs a call's "started" with its "finished" when one tool runs many times. */
      callId?: string;
      /** The call's input (file, command, prompt…), turned into words by describe.ts. */
      input?: Record<string, unknown>;
    }
  | { kind: "text"; text: string };

export interface HarnessExit {
  ok: boolean;
  /** The agent's final answer, when its stream reports one (the pipeline reads it as JSON). */
  text?: string;
  /** The conversation this agent had, when its harness can continue one (`HarnessStartInput.resume`). */
  session?: string;
  /** Plain-language cause for the user (spec 002 FR-012): not_signed_in, usage_limit, crashed… */
  code?: string;
  message?: string;
}

export interface HarnessStartInput {
  runId: string;
  /** The run's folder; the agent must stay inside it. */
  folder: string;
  /** Short instruction: which skill file to read and the request. */
  prompt: string;
  skill: SkillMeta;
  request: Record<string, unknown>;
  /** Media kinds this task must make (spec 008); a multi-agent harness picks a worker by it. */
  needs?: string[];
  /**
   * A conversation to continue instead of starting cold: the agent already knows the procedure and
   * what it made, so a correction needs no reading (docs/generation-performance.md).
   */
  resume?: string;
  /** Reasoning effort, where the harness has the setting: small follow-ups need little. */
  effort?: "low" | "medium" | "high";
  /** Where the raw output goes; default `harness.log` in the folder. */
  logFile?: string;
}

export interface HarnessHandle {
  onActivity(listener: (activity: HarnessActivity) => void): void;
  /** Settles once the harness process is gone, whatever the reason. */
  exited: Promise<HarnessExit>;
  /**
   * Asks the harness to stop; resolves when it has. `finished`: the result is already there, so
   * only stop spending (a queue like Agent Fabric lets its task end on its own); `cancelled`: the
   * user or a time limit stopped the run.
   */
  stop(reason?: "finished" | "cancelled"): Promise<void>;
}

export interface HarnessStatus {
  installed: boolean;
  signedIn: boolean;
  version?: string;
  canGenerateImages: boolean;
  /** Media kinds it can make (spec 008: image, video, audio…); absent: image if canGenerateImages. */
  capabilities?: string[];
  /** Workers behind a multi-agent harness (Agent Fabric) and what each makes. */
  workers?: { id: string; capabilities: string[] }[];
  /** Command the user runs to sign in, shown when signedIn is false. */
  signInCommand?: string;
  detail?: string;
}

/** One way to run an agent: Antigravity, Claude Code, Codex, Agent Fabric, or the scripted test one. */
export interface Harness {
  id: string;
  name: string;
  check(): Promise<HarnessStatus>;
  start(input: HarnessStartInput): HarnessHandle;
}

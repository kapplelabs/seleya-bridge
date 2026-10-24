import { randomBytes } from "node:crypto";
import { cpSync, existsSync, rmSync } from "node:fs";
import path from "node:path";

import type { Clock } from "../clock.ts";
import type { LocalConfig } from "../config.ts";
import type { Harness } from "../harness/types.ts";
import type { SkillMeta } from "../skills.ts";
import { historyOf } from "./estimate.ts";
import { applyPlan } from "./events.ts";
import { defaultPostProcess, type DraftRenderer, type PostProcessor, RunRunner } from "./runner.ts";
import type { Store } from "./store.ts";
import { type RunRow, type StoredEvent, TERMINAL_STATUSES } from "./types.ts";

export class RunError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status = 400) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

/** Picks the harness for a run; throws RunError("no_harness") when none can do it (spec 002). */
export type HarnessPicker = (
  skill: SkillMeta,
  requested?: string,
) => Promise<{ harness: Harness; note?: string; media?: Record<string, Harness[]> }>;

export interface ManagerDeps {
  store: Store;
  config: LocalConfig;
  clock: Clock;
  skills: () => Map<string, SkillMeta>;
  /**
   * The skills a run with this request may use: the base skills plus the signed recipes the
   * request carries (spec 009). Default: the base skills.
   */
  skillsFor?: (request: Record<string, unknown>) => Map<string, SkillMeta>;
  /** Folders of the recipes a request carries, copied into its run folder's skills/ (spec 009). */
  recipeDirsFor?: (request: Record<string, unknown>) => string[];
  pickHarness: HarnessPicker;
  /** Post-processing per skill name (specs 004/005); default lists out/ files. */
  postProcessors?: Map<string, PostProcessor>;
  /** Draft renderers per skill name (spec 005: slides become images as they are written). */
  draftRenderers?: Map<string, DraftRenderer>;
  /** Agents that can make a media kind, best first (spec 008); for kinds the skill did not declare. */
  mediaAgents?: (kind: string) => Promise<Harness[]>;
  /** Names of the agents that can make each kind, for the skills index (spec 008 FR-007). */
  mediaAvailability?: () => Promise<Record<string, string[]>>;
}

export interface CreateRunInput {
  skill?: string;
  title: string;
  request: Record<string, unknown>;
  harness?: string;
}

type Listener = (event: StoredEvent) => void;

/**
 * Owns every run: creates them, queues them under the concurrency limit, starts their runners,
 * records their events and fans them out to stream subscribers.
 */
export class RunManager {
  private queue: string[] = [];
  private active = new Map<string, RunRunner>();
  private harnessFor = new Map<string, string | undefined>();
  private listeners = new Map<string, Set<Listener>>();
  private globalListeners = new Set<Listener>();

  private deps: ManagerDeps;

  constructor(deps: ManagerDeps) {
    this.deps = deps;
  }

  private newId(): string {
    const time = this.deps.clock.now().toString(36);
    return `run_${this.deps.store.machineId()}_${time}${randomBytes(2).toString("hex")}`;
  }

  /** Records an event for a run and hands it to its subscribers. */
  emit(runId: string, type: string, data: Record<string, unknown>): void {
    const event = this.deps.store.appendEvent(runId, type, data, this.deps.clock.now());
    for (const listener of this.listeners.get(runId) ?? []) listener(event);
    for (const listener of this.globalListeners) listener(event);
  }

  subscribe(runId: string, listener: Listener): () => void {
    const set = this.listeners.get(runId) ?? new Set<Listener>();
    set.add(listener);
    this.listeners.set(runId, set);
    return () => set.delete(listener);
  }

  /** Every event of every run (the tray, notifications, sync). */
  subscribeAll(listener: Listener): () => void {
    this.globalListeners.add(listener);
    return () => this.globalListeners.delete(listener);
  }

  skill(name: string, request: Record<string, unknown> = {}): SkillMeta {
    const skill = this.skillsOf(request).get(name);
    if (!skill) throw new RunError("unknown_skill", `There is no skill named "${name}".`, 400);
    return skill;
  }

  /** Every skill a run with this request may use (base skills + its recipes). */
  skillsOf(request: Record<string, unknown>): Map<string, SkillMeta> {
    return this.deps.skillsFor?.(request) ?? this.deps.skills();
  }

  /**
   * `retry`: a new attempt of a failed run. `from`: a new version built on another run's outputs
   * (Studio edits and resizes, spec 004 US5); its out/ folder is copied in before the agent starts.
   */
  create(input: CreateRunInput, retry?: RunRow, from?: RunRow): RunRow {
    const skill = this.skill(input.skill ?? "orchestrator", input.request);
    const { planned, steps } = applyPlan(skill.plannedSteps, []);
    const run: RunRow = {
      id: this.newId(),
      title: input.title.trim() || skill.title,
      skill: skill.name,
      skillVersion: skill.version,
      request: input.request,
      harness: null,
      localStatus: "queued",
      phase: "queued",
      error: null,
      createdAt: this.deps.clock.now(),
      startedAt: null,
      finishedAt: null,
      attempt: retry ? retry.attempt + 1 : from ? from.attempt + 1 : 1,
      retryOf: retry?.id ?? from?.id ?? null,
      plannedSteps: planned,
      steps,
      outputs: [],
      checks: [],
      summary: null,
      timeLimitMs: skill.timeLimitMs,
    };
    this.deps.store.insertRun(run);
    this.harnessFor.set(run.id, input.harness);
    const source = from ?? (retry && skill.resumable ? retry : undefined);
    if (source) {
      const sourceOut = path.join(this.deps.config.runsDir, source.id, "out");
      const out = path.join(this.deps.config.runsDir, run.id, "out");
      if (existsSync(sourceOut)) cpSync(sourceOut, out, { recursive: true });
      // The source's manifest would end the new run before the agent starts.
      rmSync(path.join(out, "result.json"), { force: true });
    }
    this.emit(run.id, "seleya.run.started", { run_id: run.id, agent_id: "", title: run.title });
    this.emit(run.id, "seleya.run.plan", { steps: planned });
    this.emit(run.id, "seleya.run.estimate", { remaining_ms: skill.typicalMs, basis: "typical" });
    this.queue.push(run.id);
    this.emitQueue();
    this.pump();
    return this.deps.store.getRun(run.id) ?? run;
  }

  queuePosition(runId: string): number | null {
    const index = this.queue.indexOf(runId);
    return index < 0 ? null : index + 1;
  }

  private emitQueue() {
    this.queue.forEach((runId, index) =>
      this.emit(runId, "seleya.run.status", { local_status: "queued", queue_position: index + 1 }),
    );
  }

  private pump() {
    while (this.active.size < this.deps.config.concurrency && this.queue.length > 0) {
      const runId = this.queue.shift();
      if (!runId) break;
      void this.startRun(runId);
      if (this.queue.length) this.emitQueue();
    }
  }

  /** Ends a run that has no runner (still queued, or failed or cancelled while starting). */
  private endWithoutRunner(
    runId: string,
    status: "failed" | "cancelled",
    error: { code: string; message: string; retryable: boolean },
  ) {
    const run = this.deps.store.getRun(runId);
    if (run && !TERMINAL_STATUSES.includes(run.localStatus)) {
      this.deps.store.updateRun(runId, {
        localStatus: status,
        phase: status === "cancelled" ? "stopped" : "failed",
        finishedAt: this.deps.clock.now(),
        error,
        outputs: run.outputs.map((output) => ({ ...output, state: "incomplete" })),
      });
      const phase = status === "cancelled" ? "stopped" : "failed";
      this.emit(runId, "seleya.run.phase", { phase, label: error.message });
      this.emit(runId, "seleya.run.status", { local_status: status });
      this.emit(runId, "seleya.error", error);
      this.emit(runId, "stream.done", {});
    }
    if (this.active.get(runId) && !(this.active.get(runId) instanceof RunRunner))
      this.active.delete(runId);
    this.pump();
  }

  /** True once the run reached a terminal status (e.g. cancelled while its harness was being picked). */
  private isOver(runId: string): boolean {
    const run = this.deps.store.getRun(runId);
    return !run || TERMINAL_STATUSES.includes(run.localStatus);
  }

  private async startRun(runId: string) {
    const run = this.deps.store.getRun(runId);
    if (!run) return;
    // Reserve the slot before the async pick so pump() never over-starts. Cancelling in this window
    // ends the run at once; the start below then notices and backs out.
    const placeholder = {
      stopWith: async (
        status: "cancelled" | "timed_out",
        error: { code: string; message: string; retryable: boolean },
      ) => this.endWithoutRunner(runId, status === "cancelled" ? "cancelled" : "failed", error),
    } as unknown as RunRunner;
    this.active.set(runId, placeholder);
    try {
      await this.startPicked(run, runId);
    } catch (error) {
      // Anything unexpected while starting (unknown skill, disk full, a harness that throws) must
      // not leave the run running forever or keep its slot.
      if (this.active.get(runId) instanceof RunRunner) this.active.delete(runId);
      this.endWithoutRunner(runId, "failed", {
        code: error instanceof RunError ? error.code : "start_failed",
        message: `The run could not start: ${error instanceof Error ? error.message : String(error)}`,
        retryable: true,
      });
    }
  }

  private async startPicked(run: RunRow, runId: string) {
    const skill = this.skill(run.skill, run.request);
    const runSkills = this.skillsOf(run.request);
    const emit = (type: string, data: Record<string, unknown>) => this.emit(runId, type, data);
    let harness: Harness;
    let media: Record<string, Harness[]> = {};
    try {
      const pick = await this.deps.pickHarness(skill, this.harnessFor.get(runId));
      if (this.isOver(runId)) return;
      harness = pick.harness;
      media = pick.media ?? {};
      if (pick.note) emit("seleya.run.notice", { message: pick.note });
      emit("seleya.run.route", {
        agent: harness.name,
        media: Object.fromEntries(
          Object.entries(media).map(([kind, agents]) => [kind, agents.map((agent) => agent.name)]),
        ),
      });
    } catch (error) {
      if (this.isOver(runId)) return;
      const code = error instanceof RunError ? error.code : "no_harness";
      const message = error instanceof Error ? error.message : "No agent is available.";
      this.endWithoutRunner(runId, "failed", { code, message, retryable: true });
      return;
    }
    const mediaIndex = await this.deps.mediaAvailability?.().catch(() => undefined);
    if (this.isOver(runId)) return;
    const runner = new RunRunner(run, {
      config: this.deps.config,
      clock: this.deps.clock,
      harness,
      skill,
      emit,
      save: (patch) => {
        this.deps.store.updateRun(runId, patch);
        return this.deps.store.getRun(runId) ?? run;
      },
      postProcess:
        this.deps.postProcessors?.get(skill.name) ??
        this.deps.postProcessors?.get("*") ??
        defaultPostProcess,
      renderDraft: this.deps.draftRenderers?.get(skill.name) ?? this.deps.draftRenderers?.get("*"),
      skills: () => runSkills,
      recipeDirs: this.deps.recipeDirsFor?.(run.request) ?? [],
      media: async (kind) => media[kind] ?? (await this.deps.mediaAgents?.(kind)) ?? [],
      mediaIndex,
      history: historyOf(
        this.deps.store.listRuns({ status: ["completed", "completed_with_issues"], limit: 200 }),
        skill.name,
        harness.id,
      ),
      onEnd: () => {
        this.active.delete(runId);
        this.pump();
      },
    });
    this.active.set(runId, runner);
    runner.start();
  }

  async cancel(runId: string): Promise<RunRow> {
    const run = this.get(runId);
    if (TERMINAL_STATUSES.includes(run.localStatus)) return run;
    const queued = this.queue.indexOf(runId);
    if (queued >= 0) {
      this.queue.splice(queued, 1);
      this.endWithoutRunner(runId, "cancelled", {
        code: "cancelled",
        message: "Cancelled before it started.",
        retryable: true,
      });
      this.emitQueue();
      return this.get(runId);
    }
    await this.active.get(runId)?.stopWith("cancelled", {
      code: "cancelled",
      message: "Cancelled. Anything already produced is kept, marked incomplete.",
      retryable: true,
    });
    return this.get(runId);
  }

  retry(runId: string): RunRow {
    const run = this.get(runId);
    if (!["failed", "cancelled", "interrupted", "timed_out"].includes(run.localStatus))
      throw new RunError(
        "not_retryable",
        "Only failed, cancelled, interrupted or timed-out runs can be retried.",
        409,
      );
    return this.create(
      {
        skill: run.skill,
        title: run.title,
        request: run.request,
        harness: run.harness ?? undefined,
      },
      run,
    );
  }

  get(runId: string): RunRow {
    const run = this.deps.store.getRun(runId);
    if (!run) throw new RunError("not_found", "No such run.", 404);
    return run;
  }

  /** At startup: runs left queued or running by a previous process are marked interrupted. */
  recover(): number {
    const stale = this.deps.store.listRuns({ status: ["queued", "running"], limit: 1000 });
    for (const run of stale) {
      const message = "Seleya Local stopped while this run was in progress.";
      this.deps.store.updateRun(run.id, {
        localStatus: "interrupted",
        phase: "failed",
        finishedAt: this.deps.clock.now(),
        error: { code: "interrupted", message, retryable: true },
        outputs: run.outputs.map((output) => ({ ...output, state: "incomplete" })),
        steps: run.steps.map((step) =>
          step.status === "active" ? { ...step, status: "failed" } : step,
        ),
      });
      this.emit(run.id, "seleya.run.phase", { phase: "failed", label: message });
      this.emit(run.id, "seleya.run.status", { local_status: "interrupted" });
      this.emit(run.id, "seleya.error", { code: "interrupted", message, retryable: true });
      this.emit(run.id, "stream.done", {});
    }
    return stale.length;
  }

  activeCount(): number {
    return this.active.size;
  }
}

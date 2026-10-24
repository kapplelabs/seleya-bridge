import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

import type { Clock, Timer } from "../clock.ts";
import type { LocalConfig } from "../config.ts";
import { toolLabel } from "../harness/labels.ts";
import type { Harness, HarnessActivity, HarnessExit, HarnessHandle } from "../harness/types.ts";
import { makeMedia, readJobs } from "../media/broker.ts";
import { containedPath } from "../paths.ts";
import { type MediaAvailability, skillIndex, type SkillMeta } from "../skills.ts";
import { estimate } from "./estimate.ts";
import {
  applyPlan,
  applyStep,
  hasActiveStep,
  kindOf,
  outputJson,
  progressOf,
  stepJson,
} from "./events.ts";
import { parseProgressLine } from "./progress.ts";
import { LineTailer } from "./tail.ts";
import type { CheckResult, LocalStatus, RunError, RunOutput, RunRow } from "./types.ts";

/** What post-processing (render and checks, specs 004/005) gets and returns. */
export interface PostProcessContext {
  run: RunRow;
  folder: string;
  manifest: Record<string, unknown>;
  skill: SkillMeta;
  /** Every skill this run may use, by name (a routed run's chosen recipe is among them, spec 009). */
  skills: Map<string, SkillMeta>;
  emit: (type: string, data: Record<string, unknown>) => void;
  /** Starts a step shown in the timeline; returns a function that ends it. */
  step: (label: string) => (status: "done" | "failed", detail?: string) => void;
  /** Runs the harness again in the same folder (a correction), resolving when it exits. */
  runAgain: (prompt: string) => Promise<HarnessExit>;
}

export interface PostProcessResult {
  outputs: RunOutput[];
  checks: CheckResult[];
  summary?: string;
}

export type PostProcessor = (context: PostProcessContext) => Promise<PostProcessResult>;

export interface RunnerDeps {
  config: LocalConfig;
  clock: Clock;
  harness: Harness;
  skill: SkillMeta;
  emit: (type: string, data: Record<string, unknown>) => void;
  save: (patch: Partial<RunRow>) => RunRow;
  postProcess: PostProcessor;
  onEnd: () => void;
  /** Every skill available (the orchestrator's index). */
  skills: () => Map<string, SkillMeta>;
  /** Durations (ms) of earlier completed runs of this skill on this harness, for estimates. */
  history?: number[];
  /** Turns a draft the agent announced into something showable (a slide's JSON → its image). */
  renderDraft?: DraftRenderer;
  /** Agents that can make a media kind, best first (spec 008); used for `out/media/jobs.json`. */
  media?: (kind: string) => Promise<Harness[]>;
  /** Signed recipes this run uses (spec 009), copied into its skills/ folder. */
  recipeDirs?: string[];
  /** What this computer can make, for the skills index the orchestrator reads (spec 008 FR-007). */
  mediaIndex?: MediaAvailability;
}

export type DraftRenderer = (
  draft: { path: string; slot: string },
  folder: string,
  run: RunRow,
) => Promise<RunOutput | undefined>;

/** Every file under out/ except the manifest, as final outputs (default post-processing). */
export function listOutputs(folder: string): RunOutput[] {
  const out = path.join(folder, "out");
  if (!existsSync(out)) return [];
  const files: RunOutput[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      // Symlinks are never outputs: they could point outside the run folder.
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) walk(full);
      else if (entry.name !== "result.json" && statSync(full).size > 0) {
        const relative = path.relative(folder, full);
        files.push({ path: relative, kind: kindOf(relative), state: "final" });
      }
    }
  };
  walk(out);
  return files;
}

export const defaultPostProcess: PostProcessor = async ({ folder }) => ({
  outputs: listOutputs(folder),
  checks: [],
});

/** Builds the instruction a harness receives; the skill files carry the real procedure. */
export function promptFor(skill: SkillMeta, request: Record<string, unknown>): string {
  const brief = typeof request.prompt === "string" ? request.prompt : JSON.stringify(request);
  return [
    `Read skills/${skill.name}/SKILL.md and follow it exactly, together with skills/PROGRESS.md.`,
    "Work only inside the current folder. The full request is in request.json.",
    `Request: ${brief}`,
  ].join("\n");
}

/**
 * Runs one generation: prepares its folder, starts the harness, turns progress lines and harness
 * activity into events, finishes as soon as the result manifest is there, then post-processes.
 */
export class RunRunner {
  private run: RunRow;
  private handle: HarnessHandle | undefined;
  private tailer: LineTailer | undefined;
  private ticker: Timer | undefined;
  /** The main agent's part is over (manifest, exit or stop); post-processing may still run. */
  private agentDone = false;
  /** The run reached a terminal status; nothing more is emitted. */
  private ended = false;
  /** Time limit for the whole run, post-processing included (FR-011). */
  private deadline: Timer | undefined;
  private lastSignalAt: number;
  private stallLevel: 0 | 1 | 2 = 0;
  private thought: { id: string; startedAt: number } | undefined;
  private thoughts = 0;
  private toolStarts = new Map<string, number>();
  readonly folder: string;

  private deps: RunnerDeps;

  constructor(run: RunRow, deps: RunnerDeps) {
    this.deps = deps;
    this.run = run;
    this.folder = path.join(deps.config.runsDir, run.id);
    this.lastSignalAt = deps.clock.now();
  }

  private save(patch: Partial<RunRow>) {
    this.run = this.deps.save(patch);
  }

  private emit(type: string, data: Record<string, unknown>) {
    this.deps.emit(type, data);
  }

  private prepareFolder() {
    mkdirSync(path.join(this.folder, "out"), { recursive: true });
    // Retries of a resumable skill keep the earlier attempt's outputs (copied in by the manager).
    cpSync(this.deps.config.skillsDir, path.join(this.folder, "skills"), { recursive: true });
    if (existsSync(this.deps.config.userSkillsDir))
      cpSync(this.deps.config.userSkillsDir, path.join(this.folder, "skills"), {
        recursive: true,
        force: false,
      });
    // The run's recipes win over a saved skill of the same name: Seleya sent them for this run.
    for (const dir of this.deps.recipeDirs ?? [])
      cpSync(dir, path.join(this.folder, "skills"), {
        recursive: true,
        filter: (source) => path.basename(source) !== ".verified",
      });
    writeFileSync(
      path.join(this.folder, "skills", "INDEX.md"),
      skillIndex(this.deps.skills(), this.deps.mediaIndex),
    );
    writeFileSync(
      path.join(this.folder, "request.json"),
      JSON.stringify(this.run.request, null, 2),
    );
    this.copyEarlierMedia();
    if (!existsSync(path.join(this.folder, "progress.jsonl")))
      writeFileSync(path.join(this.folder, "progress.jsonl"), "");
  }

  /**
   * `request.media_from`: the run this one refines; its pictures come along so unchanged ones are
   * not made again (spec 008).
   */
  private copyEarlierMedia() {
    const from = this.run.request.media_from;
    if (typeof from !== "string" || !/^[A-Za-z0-9_-]+$/.test(from) || from === this.run.id) return;
    const source = path.join(this.deps.config.runsDir, from, "out", "media");
    if (!existsSync(source)) return;
    const target = path.join(this.folder, "out", "media");
    mkdirSync(target, { recursive: true });
    for (const name of readdirSync(source))
      if (!/^(jobs|results)/.test(name) && !name.endsWith(".error.txt"))
        cpSync(path.join(source, name), path.join(target, name), { force: false });
  }

  start(): void {
    const { clock, config, harness, skill } = this.deps;
    this.prepareFolder();
    this.save({
      localStatus: "running",
      startedAt: clock.now(),
      harness: harness.id,
      phase: "processing",
    });
    this.emit("seleya.run.status", {
      local_status: "running",
      harness: harness.id,
      agent_name: harness.name,
    });
    this.emit("seleya.run.phase", { phase: "processing", label: `Starting ${harness.name}` });

    this.tailer = new LineTailer(path.join(this.folder, "progress.jsonl"), (line) =>
      this.onProgress(line),
    );
    this.handle = harness.start({
      runId: this.run.id,
      folder: this.folder,
      prompt: promptFor(skill, this.run.request),
      skill,
      request: this.run.request,
    });
    this.handle.onActivity((activity) => this.onActivity(activity));
    void this.handle.exited.then((exit) => this.onExit(exit));
    this.ticker = clock.setInterval(() => this.tick(), config.tailIntervalMs);
    this.deadline = clock.setTimeout(
      () =>
        void this.stopWith("timed_out", {
          code: "timed_out",
          message: `Stopped after ${Math.round(this.run.timeLimitMs / 60_000)} min, the time limit for this kind of run.`,
          retryable: true,
        }),
      this.run.timeLimitMs,
    );
    this.emitEstimate();
  }

  private emitEstimate() {
    const now = this.deps.clock.now();
    const result = estimate({
      history: this.deps.history ?? [],
      typicalMs: this.deps.skill.typicalMs,
      elapsedMs: now - (this.run.startedAt ?? now),
      doneSteps: this.run.plannedSteps.filter(
        (plan) => this.run.steps.find((step) => step.label === plan.label)?.status === "done",
      ).length,
      plannedSteps: this.run.plannedSteps.length,
    });
    this.emit("seleya.run.estimate", { remaining_ms: result.remainingMs, basis: result.basis });
  }

  private signal() {
    this.lastSignalAt = this.deps.clock.now();
    if (this.stallLevel > 0) {
      this.stallLevel = 0;
      this.emit("seleya.run.stall", { silent_ms: 0, not_responding: false, cleared: true });
    }
  }

  private onProgress(line: string) {
    if (this.ended) return;
    const now = this.deps.clock.now();
    const record = parseProgressLine(line);
    this.signal();
    if (record.kind === "plan") {
      const { planned, steps } = applyPlan(record.steps, this.run.steps);
      this.save({ plannedSteps: planned, steps });
      this.emit("seleya.run.plan", { steps: planned });
    } else if (record.kind === "step") {
      this.closeThought();
      const { step, steps } = applyStep(record, this.run.steps, now);
      const before = progressOf(this.run.plannedSteps, this.run.steps);
      this.save({ steps });
      this.emit("seleya.trace.step", stepJson(step));
      if (record.status === "active")
        this.emit("seleya.run.phase", { phase: "writing", label: record.label });
      const after = progressOf(this.run.plannedSteps, steps, before);
      if (after !== before) this.emit("seleya.run.progress", { progress: after });
      if (record.status === "done") this.emitEstimate();
    } else if (record.kind === "draft") {
      const full = containedPath(this.folder, record.path);
      if (!full || !existsSync(full)) return;
      const output: RunOutput = {
        path: record.path,
        kind: kindOf(record.path),
        slot: record.slot,
        state: "draft",
      };
      const outputs = [...this.run.outputs.filter((item) => item.path !== record.path), output];
      this.save({ outputs });
      this.emit("seleya.output.draft", outputJson(this.run.id, output));
      const render = this.deps.renderDraft;
      if (render)
        void render({ path: record.path, slot: record.slot }, this.folder, this.run)
          .then((shown) => {
            if (!shown || this.run.localStatus !== "running") return;
            this.save({
              outputs: [...this.run.outputs.filter((item) => item.path !== shown.path), shown],
            });
            this.emit("seleya.output.draft", outputJson(this.run.id, shown));
          })
          .catch(() => undefined); // a draft that cannot be shown yet is simply not shown
    } else {
      this.emit("seleya.trace.step", {
        id: `bad${now}`,
        label: "Unreadable progress line",
        detail: record.raw,
        status: "failed",
      });
    }
  }

  private closeThought() {
    if (!this.thought) return;
    this.emit("seleya.thought.completed", {
      id: this.thought.id,
      duration_ms: this.deps.clock.now() - this.thought.startedAt,
    });
    this.thought = undefined;
  }

  private onActivity(activity: HarnessActivity) {
    if (this.ended) return;
    this.signal();
    const now = this.deps.clock.now();
    if (activity.kind === "text") {
      if (!this.thought) {
        this.thoughts += 1;
        this.thought = { id: `t${this.thoughts}`, startedAt: now };
        this.emit("seleya.thought.started", { id: this.thought.id, kind: "reasoning" });
      }
      this.emit("seleya.thought.delta", { id: this.thought.id, text: activity.text });
      this.emit("seleya.activity", { kind: "text", text: activity.text });
      return;
    }
    this.closeThought();
    const label = toolLabel(activity.tool);
    let durationMs = activity.durationMs;
    if (activity.state === "started") this.toolStarts.set(activity.tool, now);
    else if (durationMs === undefined && this.toolStarts.has(activity.tool))
      durationMs = now - (this.toolStarts.get(activity.tool) ?? now);
    this.emit("seleya.activity", {
      kind: "tool",
      tool: activity.tool,
      label,
      state: activity.state,
      duration_ms: durationMs,
    });
    if (activity.state === "started") this.emit("seleya.run.phase", { phase: "tool", label });
  }

  private manifest(): Record<string, unknown> | undefined {
    const file = path.join(this.folder, "out", "result.json");
    if (!existsSync(file)) return undefined;
    try {
      return JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
    } catch {
      return undefined; // still being written
    }
  }

  private tick() {
    if (this.agentDone) return;
    this.tailer?.poll();
    const { clock, config } = this.deps;
    if (this.manifest() && !hasActiveStep(this.run.steps)) return void this.finishAgent();
    const silent = clock.now() - this.lastSignalAt;
    if (silent >= config.notRespondingMs && this.stallLevel < 2) {
      this.stallLevel = 2;
      this.emit("seleya.run.stall", { silent_ms: silent, not_responding: true });
    } else if (silent >= config.stallMs && this.stallLevel < 1) {
      this.stallLevel = 1;
      this.emit("seleya.run.stall", { silent_ms: silent, not_responding: false });
    }
  }

  private stopTimers() {
    this.ticker?.cancel();
    this.ticker = undefined;
    this.tailer?.stop();
    this.closeThought();
  }

  /** The agent's part is done (manifest present): stop it and post-process. */
  private async finishAgent() {
    if (this.agentDone || this.ended) return;
    this.agentDone = true;
    this.stopTimers();
    await this.handle?.stop("finished");
    if (this.ended) return; // cancelled or timed out meanwhile
    const manifest = this.manifest() ?? {};
    try {
      const media = await this.makeMedia();
      if (this.ended) return;
      this.emit("seleya.run.phase", { phase: "processing", label: "Checking the result" });
      const result = await this.deps.postProcess({
        run: this.run,
        folder: this.folder,
        manifest,
        skill: this.deps.skill,
        skills: this.deps.skills(),
        emit: (type, data) => this.emit(type, data),
        step: (label) => this.timelineStep(label),
        runAgain: (prompt) => this.runAgain(prompt),
      });
      if (this.ended) return;
      const checks = media ? [...result.checks, media] : result.checks;
      const issues = checks.some((check) => !check.passed);
      const drafts = this.run.outputs.filter(
        (draft) => !result.outputs.some((output) => output.path === draft.path),
      );
      this.save({
        outputs: [
          ...drafts.map((draft) => ({ ...draft, state: "final" as const })),
          // A file shown earlier keeps its slot (a media file relisted by the post-processor).
          ...result.outputs.map((output) => ({
            ...output,
            slot: output.slot ?? this.run.outputs.find((draft) => draft.path === output.path)?.slot,
          })),
        ],
        checks,
        summary: result.summary ?? null,
      });
      this.emit("seleya.output.final", {
        files: result.outputs.map((output) => outputJson(this.run.id, output)),
      });
      this.complete(issues ? "completed_with_issues" : "completed");
    } catch (error) {
      if (this.ended) return;
      if (error instanceof Error && error.name === "DeclinedError")
        return this.fail("failed", {
          code: "not_supported",
          message: error.message,
          retryable: false,
        });
      this.fail("failed", {
        code: "post_process_failed",
        message: `The result could not be finished: ${error instanceof Error ? error.message : String(error)}`,
        retryable: true,
      });
    }
  }

  private timelineStep(label: string) {
    const now = this.deps.clock.now();
    const { step, steps } = applyStep(
      { kind: "step", label, status: "active" },
      this.run.steps,
      now,
    );
    this.save({ steps });
    this.emit("seleya.trace.step", stepJson(step));
    return (status: "done" | "failed", detail?: string) => {
      const ended = applyStep(
        { kind: "step", label, status, detail },
        this.run.steps,
        this.deps.clock.now(),
      );
      this.save({ steps: ended.steps });
      this.emit("seleya.trace.step", stepJson(ended.step));
    };
  }

  private async runAgain(prompt: string): Promise<HarnessExit> {
    return this.startAfter(this.deps.harness, prompt, this.deps.skill).exited;
  }

  /** Starts an agent once the main one is done (a correction, a media task); its activity shows. */
  private startAfter(
    harness: Harness,
    prompt: string,
    skill: SkillMeta,
    needs?: string[],
  ): HarnessHandle {
    // A cancelled or timed-out run starts no more agents (corrections, media).
    if (this.ended)
      return {
        onActivity: () => undefined,
        exited: Promise.resolve({ ok: false, code: "cancelled", message: "The run was stopped." }),
        stop: async () => undefined,
      };
    const handle = harness.start({
      runId: this.run.id,
      folder: this.folder,
      prompt,
      skill,
      request: this.run.request,
      needs,
    });
    this.handle = handle;
    handle.onActivity((activity) => this.onActivity(activity));
    return handle;
  }

  /**
   * Media the skill delegated (spec 008 FR-005): each kind goes to agents that can make it. Returns
   * the media check, or undefined when the skill asked for none.
   */
  private async makeMedia(): Promise<CheckResult | undefined> {
    const jobs = readJobs(this.folder);
    if (jobs.length === 0) return undefined;
    this.emit("seleya.run.phase", { phase: "processing", label: "Making media" });
    const mediaSkill = this.deps.skills().get("_media") ?? this.deps.skill;
    const { check } = await makeMedia(
      {
        folder: this.folder,
        clock: this.deps.clock,
        pollMs: this.deps.config.tailIntervalMs,
        agentsFor: this.deps.media ?? (async () => []),
        start: (harness, prompt, needs) => this.startAfter(harness, prompt, mediaSkill, needs),
        step: (label) => this.timelineStep(label),
        draft: (output) => {
          this.save({
            outputs: [...this.run.outputs.filter((item) => item.path !== output.path), output],
          });
          this.emit("seleya.output.draft", outputJson(this.run.id, output));
        },
      },
      jobs,
    );
    this.emit("seleya.check.result", {
      name: check.name,
      passed: check.passed,
      findings: check.findings,
      attempt: 0,
    });
    return check;
  }

  private onExit(exit: HarnessExit) {
    if (this.agentDone || this.ended) return;
    this.tailer?.poll();
    if (this.manifest()) return void this.finishAgent();
    this.agentDone = true;
    this.stopTimers();
    this.fail(
      "failed",
      exit.ok
        ? {
            code: "no_result",
            message: "The agent finished without producing a result.",
            retryable: true,
          }
        : {
            code: exit.code ?? "harness_failed",
            message: exit.message ?? "The agent stopped with an error.",
            retryable: true,
          },
    );
  }

  /** Stops the run on the user's request or the time limit. */
  async stopWith(status: "cancelled" | "timed_out", error: RunError): Promise<void> {
    if (this.ended) return;
    // Works at any stage, post-processing included: whatever agent is running now (the main one,
    // a correction or a media task) is stopped, and no further agent is started.
    this.agentDone = true;
    this.stopTimers();
    const handle = this.handle;
    this.fail(status, error);
    await handle?.stop("cancelled");
  }

  private complete(status: "completed" | "completed_with_issues") {
    if (this.ended) return;
    this.ended = true;
    this.deadline?.cancel();
    const finishedAt = this.deps.clock.now();
    this.save({ localStatus: status, phase: "completed", finishedAt });
    this.emit("seleya.run.phase", {
      phase: "completed",
      label: status === "completed" ? "Done" : "Done, with issues",
    });
    this.emit("seleya.run.status", { local_status: status });
    this.emit("seleya.run.completed", {
      duration_ms: finishedAt - (this.run.startedAt ?? finishedAt),
      summary: this.run.summary ?? undefined,
      artifact_ids: [],
    });
    this.emit("stream.done", {});
    this.deps.onEnd();
  }

  private fail(
    status: Exclude<LocalStatus, "queued" | "running" | "completed" | "completed_with_issues">,
    error: RunError,
  ) {
    if (this.ended) return;
    this.ended = true;
    this.deadline?.cancel();
    const finishedAt = this.deps.clock.now();
    const outputs = this.run.outputs.map((output) => ({ ...output, state: "incomplete" as const }));
    const steps = this.run.steps.map((step) =>
      step.status === "active" ? { ...step, status: "failed" as const, finishedAt } : step,
    );
    this.save({
      localStatus: status,
      phase: status === "cancelled" ? "stopped" : "failed",
      finishedAt,
      error,
      outputs,
      steps,
    });
    this.emit("seleya.run.phase", {
      phase: status === "cancelled" ? "stopped" : "failed",
      label: error.message,
    });
    this.emit("seleya.run.status", { local_status: status });
    this.emit("seleya.error", {
      code: error.code,
      message: error.message,
      retryable: error.retryable,
    });
    this.emit("stream.done", {});
    this.deps.onEnd();
  }
}

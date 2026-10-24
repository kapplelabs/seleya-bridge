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
import { type Described, describeTool } from "../harness/describe.ts";
import type { Harness, HarnessActivity, HarnessExit, HarnessHandle } from "../harness/types.ts";
import { makeMedia, readJobs, readResults } from "../media/broker.ts";
import { editContext } from "../creative/edit.ts";
import { answerJson, isPipeline, runCreativePipeline } from "../creative/pipeline.ts";
import { expectedSize } from "../creative/postprocess.ts";
import { usecaseFor } from "../creative/usecases.ts";
import { readDeck } from "../slides/deck.ts";
import { runSlidesPipeline } from "../slides/pipeline.ts";
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
  /**
   * Runs the harness again in the same folder (a correction), resolving when it exits. It continues
   * the agent's own conversation when the harness can, so the agent needs to read nothing again.
   */
  runAgain: (prompt: string, options?: { effort?: "low" | "medium" | "high" }) => Promise<HarnessExit>;
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
      else if (entry.name !== "result.json" && !entry.name.startsWith(".") && statSync(full).size > 0) {
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

/** A skill file without its front matter. */
const bodyOf = (text: string) => text.replace(/^---\n[\s\S]*?\n---\n?/, "").trim();

/**
 * The procedure a skill follows, written out in full: its SKILL.md, the shared procedures it names
 * (`skills/CREATIVE.md`…) and the progress protocol. Agents read these files first anyway, one turn
 * each (docs/generation-performance.md); in the prompt they cost no turn and stay a stable prefix.
 */
function procedureOf(skill: SkillMeta, folder: string): string | undefined {
  const skills = path.join(folder, "skills");
  const own = path.join(skills, skill.name, "SKILL.md");
  if (!existsSync(own)) return undefined;
  const main = bodyOf(readFileSync(own, "utf8"));
  const shared = [...new Set([...main.matchAll(/skills\/([A-Z][A-Z_-]*\.md)/g)].map((match) => match[1]!))];
  if (!shared.includes("PROGRESS.md")) shared.push("PROGRESS.md");
  const parts = [`# skills/${skill.name}/SKILL.md\n\n${main}`];
  for (const name of shared) {
    const file = path.join(skills, name);
    if (existsSync(file)) parts.push(`# skills/${name}\n\n${bodyOf(readFileSync(file, "utf8"))}`);
  }
  return parts.join("\n\n");
}

/**
 * Builds the instruction a harness receives. With the run's folder, the skill's procedure and the
 * request are in it, so the agent starts on the first step instead of reading files; the
 * orchestrator still reads its index and the skill it picks.
 */
export function promptFor(skill: SkillMeta, request: Record<string, unknown>, folder?: string): string {
  const procedure = folder && skill.name !== "orchestrator" ? procedureOf(skill, folder) : undefined;
  if (procedure)
    // The procedure first and what changes per run last: a stable prefix is what prompt caches reuse.
    return [
      "You are making something for a person. Follow the procedure below exactly; it is complete.",
      "Everything you need is in this message: do not open, list or search the skills folder or",
      "request.json. Work only inside the current folder. Start with the first step right away.",
      "",
      "## The procedure",
      "",
      procedure,
      "",
      "## The request (request.json)",
      "",
      // Recipe ids and digests are Seleya's bookkeeping, not part of what the person asked.
      JSON.stringify(
        Object.fromEntries(Object.entries(request).filter(([key]) => !key.startsWith("recipe_"))),
        null,
        2,
      ),
      ...[folder ? editContext(folder, request) : undefined].flatMap((text) => (text ? ["", text] : [])),
    ].join("\n");
  const brief = typeof request.prompt === "string" ? request.prompt : JSON.stringify(request);
  return [
    `Read skills/${skill.name}/SKILL.md and follow it exactly, together with skills/PROGRESS.md.`,
    "Work only inside the current folder. The full request is in request.json.",
    `Request: ${brief}`,
  ].join("\n");
}

/** Files shown as drafts while the agent works (pictures, pages, structured content). */
const DRAFT_FILE = /\.(json|png|jpe?g|webp|svg|html)$/i;

/** At most this many "carry on" turns when the agent stops before its result. */
const MAX_CONTINUES = 1;

/** Continuing the agent's own conversation after it stopped early. */
const CARRY_ON =
  "You stopped before finishing. Carry on from where you left off, in this folder, following the same procedure. Do not redo finished steps, and do not read anything outside this folder. Finish with out/result.json.";

/** The instruction for an agent that stopped early: same skill, same folder, from where it was. */
export function continuePrompt(
  skill: SkillMeta,
  request: Record<string, unknown>,
  folder?: string,
): string {
  return [
    "You stopped before finishing. Carry on from where you left off: everything you already made is",
    "in this folder, and progress.jsonl lists the steps you reported. Do not redo finished steps.",
    "Do not read, list or search anything outside this folder. Finish with out/result.json.",
    promptFor(skill, request, folder),
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
  private continues = 0;
  /** The main agent's conversation, continued by corrections. */
  private session: string | undefined;
  /** Made by the creative pipeline (one answer, picture alongside), not an agent loop. */
  private pipeline = false;
  /** Completed, and adding its pictures (agents may still start). */
  private followingUp = false;
  /** Every agent running for this run (a pipeline runs its answer and its picture at once). */
  private live = new Set<HarnessHandle>();
  /** What each running call was described as, by call id (a "finished" may carry no input). */
  private toolCalls = new Map<string, Described>();
  /** Files shown as drafts, with the modification time shown. */
  private drafted = new Map<string, number>();
  /** Files seen changing on the last tick (size and time), not yet shown. */
  private settling = new Map<string, string>();
  readonly folder: string;
  /** The agents' raw output; kept outside the run folder, where the agent would read it back. */
  readonly logFile: string;

  private deps: RunnerDeps;

  constructor(run: RunRow, deps: RunnerDeps) {
    this.deps = deps;
    this.run = run;
    this.folder = path.join(deps.config.runsDir, run.id);
    this.logFile = path.join(deps.config.home, "logs", `${run.id}.log`);
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
    mkdirSync(path.dirname(this.logFile), { recursive: true });
    const skills = path.join(this.folder, "skills");
    // Only what this run reads: every skill it does not use is something the agent would open and
    // read before starting (measured: ~90 s and ~20 reads per poster, docs/generation-performance.md).
    // The orchestrator chooses among all skills, so it gets them all and the index.
    const all = this.deps.skill.name === "orchestrator";
    const wanted = (source: string, root: string) => {
      const relative = path.relative(root, source);
      if (relative === "" || all) return true;
      const top = relative.split(path.sep)[0] ?? "";
      // Shared procedures (PROGRESS.md, CREATIVE.md…), this skill, and the media helper.
      return top.endsWith(".md") ? top !== "INDEX.md" : top === this.deps.skill.name || top === "_media";
    };
    // Retries of a resumable skill keep the earlier attempt's outputs (copied in by the manager).
    cpSync(this.deps.config.skillsDir, skills, {
      recursive: true,
      filter: (source) => wanted(source, this.deps.config.skillsDir),
    });
    if (existsSync(this.deps.config.userSkillsDir))
      cpSync(this.deps.config.userSkillsDir, skills, {
        recursive: true,
        force: false,
        filter: (source) => wanted(source, this.deps.config.userSkillsDir),
      });
    // The run's recipes win over a saved skill of the same name: Seleya sent them for this run.
    for (const dir of this.deps.recipeDirs ?? [])
      cpSync(dir, skills, {
        recursive: true,
        filter: (source) => path.basename(source) !== ".verified",
      });
    if (all)
      writeFileSync(path.join(skills, "INDEX.md"), skillIndex(this.deps.skills(), this.deps.mediaIndex));
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
    this.findDrafts(true);
    this.pipeline = isPipeline(skill, this.folder);
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
    // An edit is a small change to a finished design: little reasoning needed.
    const edit = typeof this.run.request.edit_instruction === "string";
    if (this.pipeline) void this.runPipeline();
    else
      this.startAgent(promptFor(skill, this.run.request, this.folder), undefined, edit ? "low" : undefined);
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
      this.showDraft(record.path, record.slot);
    } else {
      this.emit("seleya.trace.step", {
        id: `bad${now}`,
        label: "Unreadable progress line",
        detail: record.raw,
        status: "failed",
      });
    }
  }

  /** Shows a file the agent made as a draft (and its rendering, for a slide). */
  private showDraft(file: string, slot: string) {
    const full = containedPath(this.folder, file);
    if (!full || !existsSync(full)) return;
    this.drafted.set(file, statSync(full).mtimeMs);
    const output: RunOutput = { path: file, kind: kindOf(file), slot, state: "draft" };
    const outputs = [...this.run.outputs.filter((item) => item.path !== file), output];
    this.save({ outputs });
    this.emit("seleya.output.draft", outputJson(this.run.id, output));
    const render = this.deps.renderDraft;
    if (render)
      void render({ path: file, slot }, this.folder, this.run)
        .then((shown) => {
          if (!shown || this.run.localStatus !== "running") return;
          this.save({
            outputs: [...this.run.outputs.filter((item) => item.path !== shown.path), shown],
          });
          this.emit("seleya.output.draft", outputJson(this.run.id, shown));
        })
        .catch(() => undefined); // a draft that cannot be shown yet is simply not shown
  }

  /**
   * Drafts without announcements: a file the agent writes in out/ (or out/slides/) is shown once it
   * has stopped changing for a tick, and shown again when rewritten. Announcing each one cost the
   * agent a turn (docs/generation-performance.md). Files from an earlier version are not drafts.
   */
  private findDrafts(baseline = false) {
    for (const dir of ["out", path.join("out", "slides")]) {
      const full = path.join(this.folder, dir);
      if (!existsSync(full)) continue;
      for (const entry of readdirSync(full, { withFileTypes: true })) {
        if (!entry.isFile() || !DRAFT_FILE.test(entry.name) || entry.name === "result.json") continue;
        if (entry.name.startsWith(".")) continue; // Seleya's own bookkeeping
        if (/\.draft\./.test(entry.name)) continue; // Seleya's own slide renderings
        const file = `${dir.split(path.sep).join("/")}/${entry.name}`;
        const stat = statSync(path.join(full, entry.name));
        // At the start, files already there (an earlier version's) count as shown.
        if (baseline) this.drafted.set(file, stat.mtimeMs);
        if (stat.size === 0 || this.drafted.get(file) === stat.mtimeMs) continue;
        // Shown on the second tick that sees the same size and time: the agent finished writing it.
        const key = `${stat.size}:${stat.mtimeMs}`;
        if (this.settling.get(file) !== key) {
          this.settling.set(file, key);
          continue;
        }
        const slide = /^out\/slides\/(\d+)\.json$/.exec(file);
        this.showDraft(file, slide ? `slide-${Number(slide[1])}` : entry.name.replace(/\.[^.]+$/, ""));
      }
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
    // Spec 003 FR-006a: the call in the run's own words, with its file, command or prompt.
    const key = activity.callId ?? activity.tool;
    const described =
      (activity.input ? describeTool(activity.tool, activity.input, this.folder) : undefined) ??
      this.toolCalls.get(key) ??
      describeTool(activity.tool, undefined, this.folder);
    let durationMs = activity.durationMs;
    if (activity.state === "started") {
      this.toolStarts.set(key, now);
      this.toolCalls.set(key, described);
    } else {
      if (durationMs === undefined && this.toolStarts.has(key))
        durationMs = now - (this.toolStarts.get(key) ?? now);
      this.toolStarts.delete(key);
      this.toolCalls.delete(key);
    }
    this.emit("seleya.activity", {
      kind: "tool",
      tool: activity.tool,
      label: described.label,
      detail: described.detail,
      call_id: activity.callId,
      state: activity.state,
      duration_ms: durationMs,
    });
    if (activity.state === "started")
      this.emit("seleya.run.phase", { phase: "tool", label: described.label });
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
    this.findDrafts();
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
  /**
   * The agent's part is done (manifest present): stop it and post-process. `later` (the pipeline):
   * the run completes now and `later` adds the pictures afterwards, then the result is processed
   * again (docs/generation-perf-log.md, p5).
   */
  private async finishAgent(later?: () => Promise<{ changed: boolean; check?: CheckResult }>) {
    if (this.agentDone || this.ended) return;
    this.agentDone = true;
    this.stopTimers();
    // The pipeline's answers have all ended; its last handle may be the picture's, still at work.
    if (!this.pipeline) {
      await this.handle?.stop("finished");
      this.session = (await this.handle?.exited)?.session ?? this.session;
    }
    if (this.ended) return; // cancelled or timed out meanwhile
    try {
      const media = later ? undefined : await this.makeMedia();
      if (this.ended) return;
      const issues = await this.processResult(media);
      if (this.ended) return;
      this.complete(issues ? "completed_with_issues" : "completed", later ? "picture" : "completed");
      if (later) void this.addLater(later);
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

  /** Renders, checks and publishes what the agent left; true when a check did not pass. */
  private async processResult(extra?: CheckResult): Promise<boolean> {
    this.emit("seleya.run.phase", { phase: "processing", label: "Checking the result" });
    const result = await this.deps.postProcess({
      run: this.run,
      folder: this.folder,
      manifest: this.manifest() ?? {},
      skill: this.deps.skill,
      skills: this.deps.skills(),
      emit: (type, data) => this.emit(type, data),
      step: (label) => this.timelineStep(label),
      runAgain: (prompt, options) => this.runAgain(prompt, options),
    });
    const checks = extra ? [...result.checks, extra] : result.checks;
    // Seleya's own previews (`*.draft.png`) are never results: a design's preview showed instead of
    // its final picture.
    const drafts = this.run.outputs.filter(
      (draft) =>
        !result.outputs.some((output) => output.path === draft.path) && !/\.draft\./.test(draft.path),
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
    return checks.some((check) => !check.passed);
  }

  /** After completing: makes the pictures, then renders and checks the result again with them. */
  private async addLater(later: () => Promise<{ changed: boolean; check?: CheckResult }>) {
    this.followingUp = true;
    try {
      const { changed, check } = await later();
      let issues: boolean | undefined;
      if (changed) issues = await this.processResult(check);
      else if (check) {
        this.save({ checks: [...this.run.checks, check] });
        issues = this.run.checks.some((item) => !item.passed);
      }
      if (issues !== undefined) {
        const status = issues ? "completed_with_issues" : "completed";
        this.save({ localStatus: status, finishedAt: this.deps.clock.now() });
        this.emit("seleya.run.status", { local_status: status });
      }
    } catch (error) {
      this.emit("seleya.run.notice", {
        message: `The picture could not be added: ${error instanceof Error ? error.message : String(error)}`,
      });
    } finally {
      this.followingUp = false;
      this.save({ phase: "completed" });
      this.emit("seleya.run.phase", { phase: "completed", label: "Done" });
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

  private async runAgain(
    prompt: string,
    options: { effort?: "low" | "medium" | "high" } = {},
  ): Promise<HarnessExit> {
    if (this.pipeline) return this.correctInOneAnswer(prompt);
    const exit = await this.startAfter(this.deps.harness, prompt, this.deps.skill, undefined, {
      resume: this.session,
      effort: options.effort,
    }).exited;
    if (exit.session) this.session = exit.session;
    return exit;
  }

  /** Starts an agent once the main one is done (a correction, a media task); its activity shows. */
  private startAfter(
    harness: Harness,
    prompt: string,
    skill: SkillMeta,
    needs?: string[],
    continuing: { resume?: string; effort?: "low" | "medium" | "high" } = {},
  ): HarnessHandle {
    // A cancelled or timed-out run starts no more agents (corrections, media); a completed one
    // still does while it adds its pictures.
    if (this.ended && !this.followingUp)
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
      logFile: this.logFile,
      ...continuing,
    });
    this.handle = handle;
    this.track(handle);
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

  private track(handle: HarnessHandle) {
    this.live.add(handle);
    void handle.exited.then(() => this.live.delete(handle));
  }

  /** One answer from the run's agent (pipeline); its words show as the agent's thinking. */
  private ask(prompt: string, onText: (partial: string) => void = () => undefined): Promise<string> {
    if (this.ended && !this.followingUp) return Promise.reject(new Error("The run was stopped."));
    const effort = this.deps.skill.settings?.effort;
    const handle = this.deps.harness.start({
      runId: this.run.id,
      folder: this.folder,
      prompt,
      skill: this.deps.skill,
      request: this.run.request,
      logFile: this.logFile,
      resume: this.session,
      effort: effort === "low" || effort === "medium" || effort === "high" ? effort : undefined,
    });
    this.handle = handle;
    this.track(handle);
    let text = "";
    handle.onActivity((activity) => {
      this.onActivity(activity);
      if (activity.kind === "text") {
        text += activity.text;
        onText(text);
      }
    });
    return handle.exited.then((exit) => {
      if (exit.session) this.session = exit.session;
      if (!exit.ok) throw new Error(exit.message ?? "The agent stopped with an error.");
      return exit.text || text;
    });
  }

  /** A correction in the pipeline: the same conversation answers with the fixed pages or deck. */
  private async correctInOneAnswer(findings: string): Promise<HarnessExit> {
    if (this.deps.skill.settings?.result === "deck")
      try {
        const deck = readDeck(
          answerJson(
            await this.ask(
              `${findings}\n\nDo not use tools. Answer with the whole fixed deck as one JSON object, in the same shape as before.`,
            ),
          ),
        );
        if (deck.slides.length === 0) throw new Error("the fixed deck has no slides");
        writeFileSync(path.join(this.folder, "out", "deck.json"), JSON.stringify(deck, null, 2));
        return { ok: true, session: this.session };
      } catch (error) {
        return { ok: false, message: error instanceof Error ? error.message : String(error) };
      }
    try {
      const answer = answerJson(
        await this.ask(
          `${findings}\n\nDo not use tools. Answer with one JSON object {"pages":[{"name":"<page>","html":"<the whole fixed page>"}]} with every page, fixed.`,
        ),
      );
      const manifest = JSON.parse(readFileSync(path.join(this.folder, "out", "result.json"), "utf8")) as {
        pages?: { name: string; html: string }[];
      };
      for (const page of Array.isArray(answer.pages) ? answer.pages : []) {
        const value = (page ?? {}) as { name?: unknown; html?: unknown };
        const target = manifest.pages?.find((item) => item.name === value.name) ?? manifest.pages?.[0];
        if (target && typeof value.html === "string")
          writeFileSync(path.join(this.folder, target.html), value.html);
      }
      return { ok: true, session: this.session };
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : String(error) };
    }
  }

  /** The creative pipeline: one answer and the picture at once, then the usual render and checks. */
  private async runPipeline() {
    const usecase = usecaseFor(this.deps.skills(), this.deps.skill.name);
    try {
      let later: (() => Promise<{ changed: boolean; check?: CheckResult }>) | undefined;
      if (this.deps.skill.settings?.result === "deck") {
        await runSlidesPipeline({
          folder: this.folder,
          skill: this.deps.skill,
          request: this.run.request,
          ask: (prompt, onText) => this.ask(prompt, onText),
          step: (label) => this.timelineStep(label),
          draft: (file, slot) => this.showDraft(file, slot),
        });
        // The deck is finished on its theme's artwork; its pictures follow.
        if (readJobs(this.folder).length)
          later = async () => {
            const check = await this.makeMedia();
            return { changed: Boolean(check && readResults(this.folder).some((item) => item.status === "made")), check };
          };
      } else {
        const { attachPicture } = await runCreativePipeline({
          folder: this.folder,
          skill: this.deps.skill,
          request: this.run.request,
          size: expectedSize(this.run.request, usecase),
          ask: (prompt, onText) => this.ask(prompt, onText),
          makeImage: async (prompt, aspect) => {
            const { results } = await makeMedia(
              {
                folder: this.folder,
                clock: this.deps.clock,
                pollMs: this.deps.config.tailIntervalMs,
                agentsFor: this.deps.media ?? (async () => []),
                start: (harness, text, needs) =>
                  this.startAfter(harness, text, this.deps.skills().get("_media") ?? this.deps.skill, needs),
                step: () => () => undefined,
                draft: () => undefined,
              },
              [{ id: "visual", kind: "image", prompt, aspect, purpose: "background" }],
            );
            const result = results[0];
            return result?.status === "made" && result.path
              ? { file: path.join(this.folder, result.path) }
              : { reason: result?.reason };
          },
          step: (label) => this.timelineStep(label),
          draft: (file, slot) => this.showDraft(file, slot),
          // Its own conversation: the agent knows the layout and palette it chose.
          drawPicture: (instruction) => this.ask(instruction),
        });
        // A picture that could not be made is said, not hidden: the result has issues and the reason.
        if (attachPicture)
          later = async () => {
            const { placed, drawn, reason } = await attachPicture();
            return placed
              ? {
                  changed: true,
                  check: drawn
                    ? {
                        name: "picture",
                        passed: true,
                        findings: [`Drawn as artwork: no picture could be made (${reason}).`],
                        attempt: 0,
                      }
                    : undefined,
                }
              : {
                  changed: false,
                  check: {
                    name: "picture",
                    passed: false,
                    findings: [`No picture was made (${reason}). The design keeps its colours; try again later.`],
                    attempt: 0,
                  },
                };
          };
      }
      await this.finishAgent(later);
    } catch (error) {
      if (this.ended) return;
      this.agentDone = true;
      this.stopTimers();
      this.fail("failed", {
        code: "pipeline_failed",
        message: `The design could not be made: ${error instanceof Error ? error.message : String(error)}`,
        retryable: true,
      });
    }
  }

  /** Starts (or restarts, to carry on) the run's own agent in its folder. */
  private startAgent(prompt: string, resume?: string, effort?: "low" | "medium" | "high") {
    const handle = this.deps.harness.start({
      resume,
      effort,
      runId: this.run.id,
      folder: this.folder,
      prompt,
      skill: this.deps.skill,
      request: this.run.request,
      logFile: this.logFile,
    });
    this.handle = handle;
    this.track(handle);
    handle.onActivity((activity) => this.onActivity(activity));
    void handle.exited.then((exit) => {
      if (this.handle === handle) this.onExit(exit);
    });
  }

  private onExit(exit: HarnessExit) {
    if (exit.session) this.session = exit.session;
    if (this.agentDone || this.ended) return;
    this.tailer?.poll();
    if (this.manifest()) return void this.finishAgent();
    // The agent ended its turn before the result (often right after a refused action): ask it once
    // to carry on from what it already made in this folder.
    if (exit.ok && this.continues < MAX_CONTINUES) {
      this.continues += 1;
      this.emit("seleya.run.notice", {
        message: exit.message
          ? `${exit.message} Asking it to carry on.`
          : "The agent stopped before finishing. Asking it to carry on.",
      });
      // In its own conversation the agent remembers the procedure and what it did.
      return this.session
        ? this.startAgent(CARRY_ON, this.session)
        : this.startAgent(continuePrompt(this.deps.skill, this.run.request, this.folder));
    }
    this.agentDone = true;
    this.stopTimers();
    this.fail(
      "failed",
      exit.ok
        ? {
            code: "no_result",
            message: exit.message ?? "The agent finished without producing a result.",
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
    const handles = new Set([...this.live, ...(this.handle ? [this.handle] : [])]);
    this.fail(status, error);
    await Promise.all([...handles].map((handle) => handle.stop("cancelled")));
  }

  /** `phase` "picture": the result is ready and its pictures are still being made (addLater). */
  private complete(status: "completed" | "completed_with_issues", phase = "completed") {
    if (this.ended) return;
    this.ended = true;
    this.deadline?.cancel();
    const finishedAt = this.deps.clock.now();
    this.save({ localStatus: status, phase, finishedAt });
    this.emit("seleya.run.phase", {
      phase,
      label:
        phase === "picture"
          ? "Ready · adding the pictures"
          : status === "completed"
            ? "Done"
            : "Done, with issues",
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

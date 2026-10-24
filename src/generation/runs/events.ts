/**
 * Turns progress records into run state and run state into the JSON the client reads
 * (contracts/run-stream.md, contracts/local-api.md). Pure functions, shared by runner and routes.
 */
import type { ProgressRecord } from "./progress.ts";
import type { LocalStatus, RunOutput, RunRow, RunStep } from "./types.ts";

export interface PlannedStep {
  id: string;
  label: string;
}

/** A plan replaces the planned steps but keeps steps already reported, in plan order. */
export function applyPlan(
  steps: string[],
  current: RunStep[],
): { planned: PlannedStep[]; steps: RunStep[] } {
  const planned = steps.map((label, index) => ({ id: `s${index + 1}`, label }));
  const byLabel = new Map(current.map((step) => [step.label, step]));
  const ordered: RunStep[] = planned.map(
    (plan) => byLabel.get(plan.label) ?? { id: plan.id, label: plan.label, status: "pending" },
  );
  const extra = current.filter((step) => !planned.some((plan) => plan.label === step.label));
  return { planned, steps: [...ordered, ...extra] };
}

/** Applies a step record: start, finish or fail a step, adding it when no plan named it. */
export function applyStep(
  record: Extract<ProgressRecord, { kind: "step" }>,
  steps: RunStep[],
  at: number,
): { step: RunStep; steps: RunStep[] } {
  const existing = steps.find((step) => step.label === record.label);
  const base: RunStep = existing ?? {
    id: `x${steps.length + 1}`,
    label: record.label,
    status: "pending",
  };
  const step: RunStep = {
    ...base,
    status: record.status,
    detail: record.detail ?? base.detail,
    startedAt: record.status === "active" ? (base.startedAt ?? at) : (base.startedAt ?? at),
    finishedAt: record.status === "active" ? undefined : at,
  };
  const next = existing ? steps.map((item) => (item === existing ? step : item)) : [...steps, step];
  return { step, steps: next };
}

/** Done planned steps over all planned steps, never below what was already shown. */
export function progressOf(planned: PlannedStep[], steps: RunStep[], previous = 0): number {
  if (planned.length === 0) return previous;
  const done = planned.filter(
    (plan) => steps.find((step) => step.label === plan.label)?.status === "done",
  ).length;
  return Math.max(previous, Math.round((done / planned.length) * 100));
}

export const hasActiveStep = (steps: RunStep[]) => steps.some((step) => step.status === "active");

export function stepJson(step: RunStep) {
  return {
    id: step.id,
    label: step.label,
    detail: step.detail,
    status: step.status,
    started_at: step.startedAt ? new Date(step.startedAt).toISOString() : undefined,
    finished_at: step.finishedAt ? new Date(step.finishedAt).toISOString() : undefined,
  };
}

/** Where a run's file is fetched from; seleya-bridge swaps in absolute URLs with a file ticket. */
let fileUrlBuilder = (runId: string, encodedPath: string) =>
  `/api/runs/${encodeURIComponent(runId)}/files/${encodedPath}`;

export function setFileUrlBuilder(build: (runId: string, encodedPath: string) => string): void {
  fileUrlBuilder = build;
}

export const fileUrl = (runId: string, filePath: string) =>
  fileUrlBuilder(runId, filePath.split("/").map(encodeURIComponent).join("/"));

export function outputJson(runId: string, output: RunOutput) {
  return {
    path: output.path,
    kind: output.kind,
    slot: output.slot,
    state: output.state,
    url: fileUrl(runId, output.path),
  };
}

const WORK_STATUS: Record<LocalStatus, "running" | "completed" | "failed"> = {
  queued: "running",
  running: "running",
  completed: "completed",
  completed_with_issues: "completed",
  failed: "failed",
  cancelled: "failed",
  interrupted: "failed",
  timed_out: "failed",
};

/** The agent a skill belongs to in Seleya's agent list (local-api.md). */
export function agentIdFor(skill: string): string {
  if (skill === "slides") return "writing";
  if (skill === "orchestrator" || skill.startsWith("_")) return "smart";
  return "creative-studio";
}

const iso = (ms: number | null) => (ms ? new Date(ms).toISOString() : undefined);

/** Seleya's Run shape (server-api-spec §3.3) plus the local fields. */
export function runJson(run: RunRow, extra: { queuePosition?: number | null } = {}) {
  const progress = progressOf(run.plannedSteps, run.steps);
  return {
    id: run.id,
    title: run.title,
    agent_id: agentIdFor(run.skill),
    status: WORK_STATUS[run.localStatus],
    trigger: "manual",
    started_at: iso(run.startedAt ?? run.createdAt),
    finished_at: iso(run.finishedAt),
    duration_ms: run.finishedAt && run.startedAt ? run.finishedAt - run.startedAt : undefined,
    progress: run.localStatus === "running" || run.localStatus === "queued" ? progress : undefined,
    summary: run.summary ?? undefined,
    error: run.error?.message,
    steps: run.steps.map(stepJson),
    tools: [],
    data_accessed: [],
    artifact_ids: [],
    approval_ids: [],
    local_status: run.localStatus,
    phase: run.phase,
    error_detail: run.error ?? undefined,
    skill: run.skill,
    skill_version: run.skillVersion,
    harness: run.harness ?? undefined,
    request: run.request,
    planned_steps: run.plannedSteps,
    outputs: run.outputs.map((output) => outputJson(run.id, output)),
    checks: run.checks,
    attempt: run.attempt,
    retry_of: run.retryOf ?? undefined,
    queue_position: extra.queuePosition ?? undefined,
    time_limit_ms: run.timeLimitMs,
  };
}

export function kindOf(filePath: string): string {
  const ext = filePath.split(".").pop()?.toLowerCase() ?? "";
  return ext || "file";
}

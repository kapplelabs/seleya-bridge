/**
 * Remaining-time estimates (spec 003 FR-004): from how long the same skill took on the same agent
 * before, refined by how far the run is; the skill's typical duration when there is no history.
 */
import type { RunRow } from "./types.ts";

export interface Estimate {
  remainingMs: [number, number];
  basis: "history" | "typical";
}

const quantile = (sorted: number[], q: number) =>
  sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];

/** Durations (ms) of recent completed runs of this skill on this harness, oldest dropped. */
export function historyOf(runs: RunRow[], skill: string, harness: string | null): number[] {
  return runs
    .filter(
      (run) =>
        run.skill === skill &&
        (harness === null || run.harness === harness) &&
        (run.localStatus === "completed" || run.localStatus === "completed_with_issues") &&
        run.startedAt &&
        run.finishedAt,
    )
    .slice(0, 10)
    .map((run) => (run.finishedAt ?? 0) - (run.startedAt ?? 0))
    .filter((ms) => ms > 0)
    .sort((a, b) => a - b);
}

/** A run with steps left is never "about to finish": at least this much per remaining step. */
const MIN_PER_STEP_MS = 15_000;

/**
 * Remaining time as a range. Starts from the usual total (history, else the skill's typical time)
 * and moves toward the run's own pace as planned steps complete: after half the steps the pace
 * weighs half. A run past its usual time is estimated from its pace alone, and a run with steps
 * left never reads as zero (spec 003 FR-004, refined after every step).
 */
export function estimate(options: {
  history: number[];
  typicalMs: [number, number];
  elapsedMs: number;
  doneSteps: number;
  plannedSteps: number;
}): Estimate {
  const { history, typicalMs, elapsedMs, doneSteps, plannedSteps } = options;
  const basis = history.length > 0 ? "history" : "typical";
  const usual: [number, number] =
    history.length > 0 ? [quantile(history, 0.25)!, quantile(history, 0.75)!] : typicalMs;
  const left = Math.max(0, plannedSteps - doneSteps);
  const fraction = plannedSteps > 0 ? Math.min(1, doneSteps / plannedSteps) : 0;
  const clamp = (ms: number) => Math.max(0, Math.round(ms));
  const floor = left * MIN_PER_STEP_MS;

  let low: number;
  let high: number;
  if (doneSteps > 0 && fraction < 1) {
    // What the steps left would take at this run's pace so far, with a margin either way.
    const paceLeft = (elapsedMs / doneSteps) * left;
    const overdue = elapsedMs >= usual[1];
    const weight = overdue ? 1 : fraction;
    low = (1 - weight) * Math.max(0, usual[0] - elapsedMs) + weight * paceLeft * 0.8;
    high = (1 - weight) * Math.max(0, usual[1] - elapsedMs) + weight * paceLeft * 1.3;
  } else {
    low = usual[0] - elapsedMs;
    high = usual[1] - elapsedMs;
  }
  if (left > 0) {
    low = Math.max(low, floor);
    high = Math.max(high, low * 1.3, floor * 1.5);
  }
  return { basis, remainingMs: [clamp(low), clamp(Math.max(low, high))] };
}

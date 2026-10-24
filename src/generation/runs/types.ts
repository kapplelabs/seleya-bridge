/** Domain types of a local run (data-model.md). JSON on the wire is snake_case; these stay camelCase. */

export type LocalStatus =
  | "queued"
  | "running"
  | "completed"
  | "completed_with_issues"
  | "failed"
  | "cancelled"
  | "interrupted"
  | "timed_out";

export const TERMINAL_STATUSES: readonly LocalStatus[] = [
  "completed",
  "completed_with_issues",
  "failed",
  "cancelled",
  "interrupted",
  "timed_out",
];

export type StepStatus = "pending" | "active" | "done" | "failed";

export interface RunStep {
  id: string;
  label: string;
  detail?: string;
  status: StepStatus;
  startedAt?: number;
  finishedAt?: number;
}

export type OutputState = "draft" | "final" | "incomplete";

export interface RunOutput {
  path: string;
  kind: string;
  slot?: string;
  state: OutputState;
}

export interface CheckResult {
  name: string;
  passed: boolean;
  findings: string[];
  attempt: number;
}

export interface RunError {
  code: string;
  message: string;
  retryable: boolean;
}

export interface RunRow {
  id: string;
  title: string;
  skill: string;
  skillVersion: string;
  request: Record<string, unknown>;
  harness: string | null;
  localStatus: LocalStatus;
  phase: string;
  error: RunError | null;
  createdAt: number;
  startedAt: number | null;
  finishedAt: number | null;
  attempt: number;
  retryOf: string | null;
  plannedSteps: { id: string; label: string }[];
  steps: RunStep[];
  outputs: RunOutput[];
  checks: CheckResult[];
  summary: string | null;
  timeLimitMs: number;
}

export interface StoredEvent {
  runId: string;
  seq: number;
  type: string;
  data: Record<string, unknown>;
  at: number;
}

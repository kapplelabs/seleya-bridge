/** Parses one line of a skill's progress.jsonl (contracts/progress-protocol.md). */

export type ProgressRecord =
  | { kind: "plan"; steps: string[] }
  | { kind: "step"; label: string; status: "active" | "done" | "failed"; detail?: string }
  | { kind: "draft"; path: string; slot: string }
  | { kind: "invalid"; raw: string };

const STEP_STATUSES = ["active", "done", "failed"] as const;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export function parseProgressLine(line: string): ProgressRecord {
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    return { kind: "invalid", raw: line.slice(0, 200) };
  }
  if (!isRecord(value)) return { kind: "invalid", raw: line.slice(0, 200) };

  const type = typeof value.type === "string" ? value.type : "step";
  if (type === "plan" && Array.isArray(value.steps)) {
    const steps = value.steps.filter(
      (step): step is string => typeof step === "string" && step.trim() !== "",
    );
    return { kind: "plan", steps };
  }
  if (type === "draft" && typeof value.path === "string") {
    return {
      kind: "draft",
      path: value.path,
      slot: typeof value.slot === "string" ? value.slot : "output",
    };
  }
  if (type === "step" && typeof value.label === "string") {
    const status = STEP_STATUSES.find((item) => item === value.status);
    if (status) {
      const detail =
        typeof value.detail === "string" && value.detail.trim() ? value.detail : undefined;
      return { kind: "step", label: value.label, status, detail };
    }
  }
  return { kind: "invalid", raw: line.slice(0, 200) };
}

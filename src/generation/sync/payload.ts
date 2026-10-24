/**
 * What a synced run may contain (spec 006 FR-004/FR-005), and nothing else: no keys, tokens,
 * harness settings, raw logs, narration or absolute paths.
 */
import path from "node:path";

import type { RunRow } from "../runs/types.ts";

/** Absolute paths (macOS, Linux, Windows) in free text become their file name. */
export function stripPaths(text: string): string {
  return text
    .replace(/(?:\/(?:Users|home|private|tmp|var|Volumes|opt)\/[^\s"'`)]+)/g, (match) =>
      path.basename(match),
    )
    .replace(/[A-Za-z]:\\[^\s"'`)]+/g, (match) => match.split("\\").pop() ?? match);
}

/** Request fields the user typed or chose; internal fields (scripts, harness hints) never leave. */
const REQUEST_FIELDS = [
  "prompt",
  "brief",
  "fields",
  "items",
  "contact_lines",
  "cta",
  "brand_name",
  "style",
  "size",
  "width",
  "height",
  "variation",
  "of",
  "audience",
  "tone",
  "language",
  "length",
  "count",
  "instruction",
];

export function sanitizeRequest(request: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    REQUEST_FIELDS.filter((key) => key in request).map((key) => [key, request[key]]),
  );
}

export interface SyncPayload {
  run_id: string;
  computer_id: string;
  skill: string;
  skill_version: string;
  request: Record<string, unknown>;
  title: string;
  agent: string | null;
  status: string;
  started_at: string | null;
  finished_at: string | null;
  steps: {
    label: string;
    status: string;
    detail?: string;
    started_at?: string;
    finished_at?: string;
  }[];
  checks: { name: string; passed: boolean; findings: string[]; attempt: number }[];
  files: { name: string; kind: string; slot?: string; bytes: number }[];
}

export function buildPayload(
  run: RunRow,
  computerId: string,
  fileSizes: Map<string, number>,
): SyncPayload {
  const iso = (ms: number | null) => (ms ? new Date(ms).toISOString() : null);
  return {
    run_id: run.id,
    computer_id: computerId,
    skill: run.skill,
    skill_version: run.skillVersion,
    request: sanitizeRequest(run.request),
    title: run.title,
    agent: run.harness,
    status: run.localStatus,
    started_at: iso(run.startedAt),
    finished_at: iso(run.finishedAt),
    steps: run.steps.map((step) => ({
      label: step.label,
      status: step.status,
      detail: step.detail ? stripPaths(step.detail) : undefined,
      started_at: step.startedAt ? new Date(step.startedAt).toISOString() : undefined,
      finished_at: step.finishedAt ? new Date(step.finishedAt).toISOString() : undefined,
    })),
    checks: run.checks.map((check) => ({ ...check, findings: check.findings.map(stripPaths) })),
    files: run.outputs
      .filter((output) => output.state === "final")
      .map((output) => ({
        name: output.path.replace(/^out\//, ""),
        kind: output.kind,
        slot: output.slot,
        bytes: fileSizes.get(output.path) ?? 0,
      })),
  };
}

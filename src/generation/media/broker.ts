import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

import type { Clock } from "../clock.ts";
import type { Harness, HarnessExit, HarnessHandle } from "../harness/types.ts";
import type { CheckResult, RunOutput } from "../runs/types.ts";
import { findDelivered, isMediaKind, MEDIA_KINDS, normalizeMedia, pluralOf } from "./catalog.ts";

/**
 * Media jobs (spec 008 FR-005): a skill that delegates its media writes `out/media/jobs.json`; the
 * broker has agents that can make each kind do it, one task per kind (D3), checks every file
 * arrived, brings it to its normal form and tries the next capable agent for what is missing.
 */
export interface MediaJob {
  id: string;
  kind: string;
  prompt: string;
  aspect?: string;
  purpose?: string;
}

export interface MediaResult {
  id: string;
  kind: string;
  status: "made" | "skipped" | "failed";
  path?: string;
  agent?: string;
  reason?: string;
}

export const MEDIA_DIR = path.join("out", "media");
/** At most this many agents try one kind. */
const MAX_AGENTS = 2;
const BASE_MS = 3 * 60_000;
const PER_JOB_MS = 90_000;
const MAX_MS = 12 * 60_000;

export function readJobs(folder: string): MediaJob[] {
  const file = path.join(folder, MEDIA_DIR, "jobs.json");
  if (!existsSync(file)) return [];
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return [];
  }
  const items = Array.isArray(raw) ? raw : ((raw as { jobs?: unknown })?.jobs ?? []);
  if (!Array.isArray(items)) return [];
  const seen = new Set<string>();
  return items.flatMap((item): MediaJob[] => {
    const value = (item ?? {}) as Record<string, unknown>;
    const id = typeof value.id === "string" ? value.id.trim() : "";
    const prompt = typeof value.prompt === "string" ? value.prompt.trim() : "";
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(id) || !prompt || seen.has(id)) return [];
    seen.add(id);
    return [
      {
        id,
        kind: typeof value.kind === "string" ? value.kind : "image",
        prompt,
        aspect: typeof value.aspect === "string" ? value.aspect : undefined,
        purpose: typeof value.purpose === "string" ? value.purpose : undefined,
      },
    ];
  });
}

export function readResults(folder: string): MediaResult[] {
  const file = path.join(folder, MEDIA_DIR, "results.json");
  if (!existsSync(file)) return [];
  try {
    return JSON.parse(readFileSync(file, "utf8")) as MediaResult[];
  } catch {
    return [];
  }
}

export interface BrokerContext {
  folder: string;
  clock: Clock;
  pollMs: number;
  /** Agents that can make a kind now, best first. */
  agentsFor: (kind: string) => Promise<Harness[]>;
  /** Starts an agent on a media task in the run folder (the runner forwards its activity). */
  start: (harness: Harness, prompt: string, needs: string[]) => HarnessHandle;
  step: (label: string) => (status: "done" | "failed", detail?: string) => void;
  /** A finished file, shown as soon as it arrives. */
  draft: (output: RunOutput) => void;
}

export function mediaPrompt(kind: string): string {
  return [
    "Read skills/_media/SKILL.md and follow it exactly.",
    `Kind: ${kind}. Your jobs are in out/media/jobs-${kind}.json.`,
    "Work only inside the current folder. Do not change any other file.",
  ].join("\n");
}

/** Makes every job; never throws. Writes out/media/results.json and returns the media check. */
export async function makeMedia(
  context: BrokerContext,
  jobs: MediaJob[],
): Promise<{ results: MediaResult[]; check: CheckResult }> {
  const dir = path.join(context.folder, MEDIA_DIR);
  mkdirSync(dir, { recursive: true });
  const results = new Map<string, MediaResult>();
  for (const job of jobs.filter((item) => !isMediaKind(item.kind)))
    results.set(job.id, {
      id: job.id,
      kind: job.kind,
      status: "failed",
      reason: `Seleya does not know the media kind "${job.kind}".`,
    });

  const kinds = [...new Set(jobs.map((job) => job.kind).filter(isMediaKind))];
  for (const kind of kinds) {
    const ofKind = jobs.filter((job) => job.kind === kind);
    const agents = (await context.agentsFor(kind)).slice(0, MAX_AGENTS);
    if (agents.length === 0) {
      for (const job of ofKind)
        results.set(job.id, {
          id: job.id,
          kind,
          status: "skipped",
          reason: `No agent on this computer can make ${pluralOf(kind)}.`,
        });
      continue;
    }
    for (const agent of agents) {
      const pending = ofKind.filter((job) => results.get(job.id)?.status !== "made");
      if (pending.length === 0) break;
      const made = await runAgent(context, agent, kind, pending);
      for (const job of pending) {
        const file = made.get(job.id);
        results.set(
          job.id,
          file
            ? { id: job.id, kind, status: "made", path: file, agent: agent.name }
            : {
                id: job.id,
                kind,
                status: "failed",
                agent: agent.name,
                reason: errorNote(dir, job.id) ?? `${agent.name} did not deliver it.`,
              },
        );
      }
    }
  }

  const list = jobs.map(
    (job) => results.get(job.id) ?? { id: job.id, kind: job.kind, status: "failed" as const },
  );
  writeFileSync(path.join(dir, "results.json"), JSON.stringify(list, null, 2));
  const failed = list.filter((result) => result.status === "failed");
  const skipped = list.filter((result) => result.status === "skipped");
  return {
    results: list,
    check: {
      name: "media",
      passed: failed.length === 0,
      findings: [
        ...failed.map((result) => `${result.id} (${result.kind}) was not made: ${result.reason}`),
        ...skipped.map((result) => `Skipped ${result.id}: ${result.reason}`),
      ],
      attempt: 0,
    },
  };
}

function errorNote(dir: string, id: string): string | undefined {
  const file = path.join(dir, `${id}.error.txt`);
  return existsSync(file) ? readFileSync(file, "utf8").trim().slice(0, 200) : undefined;
}

/** One task on one agent: waits for the files, stops the agent once all are there. */
async function runAgent(
  context: BrokerContext,
  agent: Harness,
  kind: string,
  jobs: MediaJob[],
): Promise<Map<string, string>> {
  const dir = path.join(context.folder, MEDIA_DIR);
  const extensions = MEDIA_KINDS[kind]?.extensions ?? [];
  writeFileSync(
    path.join(dir, `jobs-${kind}.json`),
    JSON.stringify(
      jobs.map((job) => ({
        ...job,
        save_as: `out/media/${job.id}.${extensions[0]}`,
      })),
      null,
      2,
    ),
  );
  // A job means "make it anew": an older file of the same id must not count as delivered.
  for (const job of jobs) {
    for (const extension of extensions)
      rmSync(path.join(dir, `${job.id}.${extension}`), { force: true });
    rmSync(path.join(dir, `${job.id}.error.txt`), { force: true });
  }
  const label = `Making ${pluralOf(kind)} with ${agent.name}`;
  const end = context.step(label);
  const made = new Map<string, string>();
  const sizes = new Map<string, number>();
  let handle: HarnessHandle;
  try {
    handle = context.start(agent, mediaPrompt(kind), [kind]);
  } catch (error) {
    end("failed", error instanceof Error ? error.message : String(error));
    return made;
  }

  const collect = async () => {
    for (const job of jobs) {
      if (made.has(job.id)) continue;
      const file = findDelivered(dir, job.id, kind);
      if (!file) continue;
      const size = statSync(file).size;
      // A file still being written grows; take it once two polls agree.
      if (size === 0 || sizes.get(job.id) !== size) {
        sizes.set(job.id, size);
        continue;
      }
      const normal = await normalizeMedia(file, kind);
      if (!normal) continue;
      const relative = path.relative(context.folder, normal);
      made.set(job.id, relative);
      context.draft({ path: relative, kind, slot: `media-${job.id}`, state: "final" });
    }
  };

  const limit = Math.min(MAX_MS, BASE_MS + PER_JOB_MS * jobs.length);
  const exit = await new Promise<HarnessExit | "timed_out" | "all_made">((resolve) => {
    let busy = false;
    const poll = context.clock.setInterval(() => {
      if (busy) return;
      busy = true;
      void collect().finally(() => {
        busy = false;
        if (made.size === jobs.length) finish("all_made");
      });
    }, context.pollMs);
    const timer = context.clock.setTimeout(() => finish("timed_out"), limit);
    let settled = false;
    function finish(value: HarnessExit | "timed_out" | "all_made") {
      if (settled) return;
      settled = true;
      poll.cancel();
      timer.cancel();
      resolve(value);
    }
    void handle.exited.then((value) => finish(value));
  });
  if (exit === "all_made") await handle.stop("finished");
  else if (exit === "timed_out") await handle.stop("cancelled");
  // The agent is gone: whatever it left is final now, even on the first sighting.
  sizes.clear();
  for (const job of jobs) {
    const file = findDelivered(dir, job.id, kind);
    if (file) sizes.set(job.id, statSync(file).size);
  }
  await collect();
  const detail =
    exit === "timed_out"
      ? `Stopped after ${Math.round(limit / 60_000)} min; ${made.size} of ${jobs.length} made`
      : `${made.size} of ${jobs.length} made`;
  // The agent's own reasons for what it could not make; the next agent's try clears the notes.
  const reasons = jobs
    .filter((job) => !made.has(job.id))
    .map((job) => errorNote(dir, job.id))
    .filter((reason): reason is string => Boolean(reason));
  end(
    made.size === jobs.length ? "done" : "failed",
    reasons.length ? `${detail}: ${[...new Set(reasons)].join("; ").slice(0, 300)}` : detail,
  );
  return made;
}

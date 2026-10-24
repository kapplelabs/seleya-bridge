/**
 * Results (docs/server-link.md §6.2): the outcome of a run that asked for `store`, kept on this machine so
 * Seleya can read it later from any paired browser, including the outcome of a run the server link
 * started while no tab was open. Nothing here leaves the machine.
 *
 * One file per key in `<home>/results/` (mode 600, directory 700), written atomically. Each key keeps the
 * latest completed run and, when it is newer, the last failure. Results are per origin: a result is only
 * readable from the origin of the run that wrote it (the server link's runs write with its origin).
 */
import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync } from "node:fs";
import path from "node:path";

import { z } from "zod";

import { writePrivateFile } from "./config.ts";
import type { Run, RunTrigger } from "./runs.ts";

export const RESULT_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9:._-]{0,119}$/;
/** A result larger than this isn't kept: the run still completes, and says the result wasn't stored. */
export const MAX_RESULT_BYTES = 2 * 1024 * 1024;

const attemptSchema = z.object({
  runId: z.string(),
  finishedAt: z.string(),
  trigger: z.string(),
  scheduleId: z.string().nullable(),
  meta: z.record(z.string(), z.unknown()),
  vars: z.record(z.string(), z.string()).nullable(),
});

const completedSchema = attemptSchema.extend({
  output: z.unknown().nullable(),
  text: z.string(),
  sources: z.array(z.object({ id: z.string(), name: z.string() })),
  connectorErrors: z.array(z.object({ connector: z.string(), kind: z.string(), message: z.string() })),
  redactions: z.number(),
});

const failureSchema = attemptSchema.extend({
  error: z.object({ code: z.string(), message: z.string(), retryable: z.boolean() }),
});

const entrySchema = z.object({
  key: z.string(),
  origin: z.string(),
  latest: completedSchema.nullable(),
  lastFailure: failureSchema.nullable(),
  updatedAt: z.string(),
});

export type ResultEntry = z.infer<typeof entrySchema>;
export type CompletedAttempt = z.infer<typeof completedSchema>;
export type FailedAttempt = z.infer<typeof failureSchema>;

export interface ResultSummary {
  key: string;
  status: "completed" | "failed";
  finishedAt: string;
  trigger: RunTrigger;
  scheduleId: string | null;
  meta: Record<string, unknown>;
  hasFailure: boolean;
}

export interface ResultStoreOptions {
  retentionDays: number;
  maxKeys: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;

export class ResultStore {
  private readonly dir: string;
  private readonly options: ResultStoreOptions;

  constructor(home: string, options: ResultStoreOptions) {
    this.dir = path.join(home, "results");
    this.options = options;
    mkdirSync(this.dir, { recursive: true, mode: 0o700 });
    chmodSync(this.dir, 0o700);
    this.prune();
  }

  /** One file per origin and key, so two origins using the same key never meet. */
  private file(origin: string, key: string): string {
    const name = createHash("sha256").update(`${origin}\n${key}`).digest("hex");
    return path.join(this.dir, `${name}.json`);
  }

  private read(file: string): ResultEntry | undefined {
    if (!existsSync(file)) return undefined;
    try {
      const parsed = entrySchema.safeParse(JSON.parse(readFileSync(file, "utf8")));
      return parsed.success ? parsed.data : undefined;
    } catch {
      return undefined;
    }
  }

  private write(file: string, entry: ResultEntry): boolean {
    const json = `${JSON.stringify(entry)}\n`;
    if (Buffer.byteLength(json) > MAX_RESULT_BYTES) return false;
    const temporary = `${file}.${process.pid}.tmp`;
    writePrivateFile(temporary, json);
    renameSync(temporary, file);
    return true;
  }

  private entries(): { file: string; entry: ResultEntry }[] {
    return readdirSync(this.dir)
      .filter((name) => name.endsWith(".json"))
      .flatMap((name) => {
        const file = path.join(this.dir, name);
        const entry = this.read(file);
        return entry ? [{ file, entry }] : [];
      });
  }

  /**
   * Keeps the outcome of a run that asked for `store`, as it ends (before its last event, so a client that
   * sees the run end can already read it). Cancelled runs aren't kept: the user stopped them, which says
   * nothing about the result. Returns what run.completed / run.failed report.
   */
  record(run: Run, status: "completed" | "failed" | "cancelled"): { key: string; ok: boolean } | undefined {
    const store = run.store;
    if (!store || status === "cancelled") return undefined;
    const file = this.file(run.origin, store.key);
    const previous = this.read(file);
    const attempt = {
      runId: run.id,
      finishedAt: new Date().toISOString(),
      trigger: run.trigger,
      scheduleId: run.scheduleId ?? null,
      meta: store.meta,
      vars: run.templateVars ?? null,
    };
    const entry: ResultEntry =
      status === "completed"
        ? {
            key: store.key,
            origin: run.origin,
            latest: {
              ...attempt,
              output: run.output ?? null,
              text: run.text ?? "",
              sources: run.summary?.sources ?? [],
              connectorErrors: run.summary?.connectorErrors ?? [],
              redactions: run.summary?.redactions ?? 0,
            },
            // A completed run supersedes every earlier failure.
            lastFailure: null,
            updatedAt: attempt.finishedAt,
          }
        : {
            key: store.key,
            origin: run.origin,
            latest: previous?.latest ?? null,
            lastFailure: {
              ...attempt,
              error: run.error ?? { code: "provider_error", message: "", retryable: true },
            },
            updatedAt: attempt.finishedAt,
          };
    let ok = false;
    try {
      ok = this.write(file, entry);
    } catch (error) {
      console.error(error);
    }
    if (ok) this.prune();
    return { key: store.key, ok };
  }

  list(origin: string): ResultSummary[] {
    return this.entries()
      .filter(({ entry }) => entry.origin === origin)
      .map(({ entry }) => {
        const failed = entry.lastFailure !== null;
        const shown = (entry.lastFailure ?? entry.latest) as FailedAttempt | CompletedAttempt;
        return {
          key: entry.key,
          status: failed ? ("failed" as const) : ("completed" as const),
          finishedAt: shown.finishedAt,
          trigger: shown.trigger as RunTrigger,
          scheduleId: shown.scheduleId,
          meta: shown.meta,
          hasFailure: failed,
        };
      })
      .sort((a, b) => b.finishedAt.localeCompare(a.finishedAt));
  }

  get(origin: string, key: string): ResultEntry | undefined {
    const entry = this.read(this.file(origin, key));
    return entry?.origin === origin && entry.key === key ? entry : undefined;
  }

  delete(origin: string, key: string): boolean {
    const file = this.file(origin, key);
    if (!this.get(origin, key)) return false;
    rmSync(file, { force: true });
    return true;
  }

  /** Drops results past their retention, then the oldest beyond maxKeys, and leftover temporary files. */
  prune(now = Date.now()): void {
    for (const name of readdirSync(this.dir))
      if (name.endsWith(".tmp")) {
        const file = path.join(this.dir, name);
        // Another process may be writing it this very moment; a minute old is surely abandoned.
        if (now - statSync(file).mtimeMs > 60_000) rmSync(file, { force: true });
      }
    const cutoff = now - this.options.retentionDays * DAY_MS;
    const kept = this.entries().filter(({ file, entry }) => {
      if (Date.parse(entry.updatedAt) >= cutoff) return true;
      rmSync(file, { force: true });
      return false;
    });
    kept
      .sort((a, b) => b.entry.updatedAt.localeCompare(a.entry.updatedAt))
      .slice(this.options.maxKeys)
      .forEach(({ file }) => rmSync(file, { force: true }));
  }
}

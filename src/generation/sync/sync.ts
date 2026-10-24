import { existsSync, lstatSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import type { Clock, Timer } from "../clock.ts";
import type { LocalConfig } from "../config.ts";
import { containedPath } from "../paths.ts";
import type { RunManager } from "../runs/manager.ts";
import type { Store } from "../runs/store.ts";
import { buildPayload } from "./payload.ts";

/**
 * Sends finished runs to the Seleya server for history (spec 006): off by default; only completed
 * runs; at most once in effect (the server is idempotent on run id); queued while the server is
 * unreachable and sent in finish order; files uploaded one by one so an interruption resumes.
 */
export type SyncState = "waiting" | "uploading" | "synced" | "failed" | "removed";

export interface SyncRecord {
  runId: string;
  state: SyncState;
  attempts: number;
  lastError: string | null;
  uploaded: string[];
  filesTotal: number;
  nextAttemptAt: number;
  updatedAt: number;
}

export interface SyncSettings {
  enabled: boolean;
  includeEarlier: boolean;
  /** When sync was turned on; runs finished earlier are only sent with includeEarlier. */
  enabledAt: number | null;
}

const SETTINGS_KEY = "sync_settings";
const RECORDS_KEY = "sync_records";
const MAX_ATTEMPTS = 8;
const SYNCABLE = ["completed", "completed_with_issues"];

export class SyncManager {
  private timer: Timer | undefined;
  private busy = false;
  private store: Store;
  private manager: RunManager;
  private clock: Clock;
  private config: LocalConfig;
  private endpoint: string;

  constructor(options: {
    store: Store;
    manager: RunManager;
    clock: Clock;
    config: LocalConfig;
    endpoint: string;
  }) {
    this.store = options.store;
    this.manager = options.manager;
    this.clock = options.clock;
    this.config = options.config;
    this.endpoint = options.endpoint.replace(/\/$/, "");
  }

  settings(): SyncSettings {
    return JSON.parse(
      this.store.meta(SETTINGS_KEY, () =>
        JSON.stringify({ enabled: false, includeEarlier: false, enabledAt: null }),
      ),
    ) as SyncSettings;
  }

  setSettings(patch: Partial<Pick<SyncSettings, "enabled" | "includeEarlier">>): SyncSettings {
    const current = this.settings();
    const enabled = patch.enabled ?? current.enabled;
    const next: SyncSettings = {
      enabled,
      includeEarlier: patch.includeEarlier ?? current.includeEarlier,
      enabledAt: enabled ? (current.enabledAt ?? this.clock.now()) : null,
    };
    this.store.setMeta(SETTINGS_KEY, JSON.stringify(next));
    if (next.enabled && next.includeEarlier) this.enqueueEarlier();
    return next;
  }

  records(): Record<string, SyncRecord> {
    return JSON.parse(this.store.meta(RECORDS_KEY, () => "{}")) as Record<string, SyncRecord>;
  }

  private save(record: SyncRecord) {
    const all = this.records();
    all[record.runId] = { ...record, updatedAt: this.clock.now() };
    this.store.setMeta(RECORDS_KEY, JSON.stringify(all));
  }

  /** FR-001: only completed runs, only while sync is on. */
  enqueue(runId: string): void {
    const settings = this.settings();
    if (!settings.enabled) return;
    const run = this.store.getRun(runId);
    if (!run || !SYNCABLE.includes(run.localStatus)) return;
    const existing = this.records()[runId];
    if (existing && existing.state !== "failed") return;
    this.save({
      runId,
      state: "waiting",
      attempts: 0,
      lastError: null,
      uploaded: existing?.uploaded ?? [],
      filesTotal: 0,
      nextAttemptAt: this.clock.now(),
      updatedAt: this.clock.now(),
    });
  }

  /** A finished run changed after it was sent (a deck edit): send it again, every file anew. */
  resend(runId: string): void {
    const existing = this.records()[runId];
    if (!existing || existing.state === "removed") return this.enqueue(runId);
    if (!this.settings().enabled) return;
    this.save({
      ...existing,
      state: "waiting",
      attempts: 0,
      lastError: null,
      uploaded: [],
      nextAttemptAt: this.clock.now(),
    });
  }

  private enqueueEarlier() {
    for (const run of this.store.listRuns({
      status: ["completed", "completed_with_issues"],
      limit: 500,
    }))
      this.enqueue(run.id);
  }

  start(): void {
    this.manager.subscribeAll((event) => {
      if (event.type === "seleya.run.completed") this.enqueue(event.runId);
      if (event.type === "seleya.run.updated") this.resend(event.runId);
    });
    this.timer = this.clock.setInterval(() => void this.tick(), 2_000);
  }

  stop(): void {
    this.timer?.cancel();
  }

  /** Sends the next waiting run (finish order), one at a time. */
  async tick(): Promise<void> {
    if (this.busy || !this.settings().enabled) return;
    const now = this.clock.now();
    const next = Object.values(this.records())
      .filter(
        (record) =>
          (record.state === "waiting" || record.state === "uploading") &&
          record.nextAttemptAt <= now,
      )
      .map((record) => ({ record, run: this.store.getRun(record.runId) }))
      .filter((item) => item.run)
      .sort((a, b) => (a.run?.finishedAt ?? 0) - (b.run?.finishedAt ?? 0))[0];
    if (!next?.run) return;
    this.busy = true;
    try {
      await this.send(next.record);
    } finally {
      this.busy = false;
    }
  }

  private async send(record: SyncRecord): Promise<void> {
    const run = this.store.getRun(record.runId);
    if (!run) return;
    const folder = path.join(this.config.runsDir, run.id);
    // Only real files inside the run folder leave the computer (never a symlink to elsewhere).
    const files = run.outputs.filter((output) => {
      if (output.state !== "final") return false;
      const file = containedPath(folder, output.path);
      return file !== undefined && existsSync(file) && !lstatSync(file).isSymbolicLink();
    });
    const sizes = new Map(
      files.map((output) => [output.path, statSync(path.join(folder, output.path)).size]),
    );
    const payload = buildPayload(run, this.store.machineId(), sizes);
    let current: SyncRecord = { ...record, state: "uploading", filesTotal: files.length };
    this.save(current);
    try {
      const base = `${this.endpoint}/sync/runs/${encodeURIComponent(run.id)}`;
      const meta = await fetch(base, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(15_000),
      });
      if (meta.status >= 400) throw new Error(`the server answered ${meta.status}`);
      for (const output of files) {
        const name = output.path.replace(/^out\//, "");
        if (current.uploaded.includes(name)) continue; // resume after an interruption (FR-007)
        const put = await fetch(`${base}/files/${encodeURIComponent(name)}`, {
          method: "PUT",
          headers: { "content-type": "application/octet-stream" },
          body: readFileSync(path.join(folder, output.path)),
          signal: AbortSignal.timeout(60_000),
        });
        if (put.status >= 400)
          throw new Error(`uploading ${name}: the server answered ${put.status}`);
        current = { ...current, uploaded: [...current.uploaded, name] };
        this.save(current);
      }
      const done = await fetch(`${base}/complete`, {
        method: "POST",
        signal: AbortSignal.timeout(15_000),
      });
      if (done.status >= 400) throw new Error(`the server answered ${done.status}`);
      this.save({ ...current, state: "synced", lastError: null });
    } catch (error) {
      const attempts = current.attempts + 1;
      const message = error instanceof Error ? error.message : String(error);
      this.save({
        ...current,
        state: attempts >= MAX_ATTEMPTS ? "failed" : "waiting",
        attempts,
        lastError: message.includes("fetch failed")
          ? "The Seleya server could not be reached."
          : message,
        nextAttemptAt: this.clock.now() + Math.min(60_000, 2_000 * 2 ** attempts),
      });
    }
  }

  retry(runId: string): SyncRecord | undefined {
    const record = this.records()[runId];
    if (!record) return undefined;
    const next = {
      ...record,
      state: "waiting" as const,
      attempts: 0,
      nextAttemptAt: this.clock.now(),
    };
    this.save(next);
    return next;
  }

  /** FR-008: removes the server copy; the local run stays. */
  async remove(runId: string): Promise<SyncRecord | undefined> {
    const record = this.records()[runId];
    if (!record) return undefined;
    const response = await fetch(`${this.endpoint}/sync/runs/${encodeURIComponent(runId)}`, {
      method: "DELETE",
      signal: AbortSignal.timeout(15_000),
    });
    if (response.status >= 400) throw new Error(`the server answered ${response.status}`);
    const next = { ...record, state: "removed" as const, uploaded: [] };
    this.save(next);
    return next;
  }
}

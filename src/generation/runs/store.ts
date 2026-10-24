import { randomBytes } from "node:crypto";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import type { LocalStatus, RunRow, StoredEvent } from "./types.ts";

/** A Creative Studio generation: one request, one run per variation (spec 004 FR-008). */
export interface GenerationRow {
  id: string;
  title: string;
  request: Record<string, unknown>;
  runIds: string[];
  createdAt: number;
}

type Row = Record<string, string | number | null>;

const JSON_COLUMNS = ["request", "error", "planned_steps", "steps", "outputs", "checks"] as const;

/** Columns of `runs`, in RunRow order: camelCase field → snake_case column. */
const COLUMNS: Record<keyof RunRow, string> = {
  id: "id",
  title: "title",
  skill: "skill",
  skillVersion: "skill_version",
  request: "request",
  harness: "harness",
  localStatus: "local_status",
  phase: "phase",
  error: "error",
  createdAt: "created_at",
  startedAt: "started_at",
  finishedAt: "finished_at",
  attempt: "attempt",
  retryOf: "retry_of",
  plannedSteps: "planned_steps",
  steps: "steps",
  outputs: "outputs",
  checks: "checks",
  summary: "summary",
  timeLimitMs: "time_limit_ms",
};

const isJsonColumn = (column: string) => (JSON_COLUMNS as readonly string[]).includes(column);

function toRow(run: Partial<RunRow>): Row {
  const row: Row = {};
  for (const [field, column] of Object.entries(COLUMNS)) {
    if (!(field in run)) continue;
    const value = run[field as keyof RunRow];
    row[column] = isJsonColumn(column)
      ? JSON.stringify(value ?? null)
      : (value as string | number | null);
  }
  return row;
}

function fromRow(row: Row): RunRow {
  const run: Record<string, unknown> = {};
  for (const [field, column] of Object.entries(COLUMNS)) {
    const value = row[column];
    run[field] = isJsonColumn(column) && typeof value === "string" ? JSON.parse(value) : value;
  }
  return run as unknown as RunRow;
}

/** Runs, their events and the machine id, in one SQLite file (WAL; survives restarts). */
export class Store {
  private db: DatabaseSync;

  constructor(file: string) {
    mkdirSync(path.dirname(file), { recursive: true });
    this.db = new DatabaseSync(file);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS runs (
        id TEXT PRIMARY KEY, title TEXT NOT NULL, skill TEXT NOT NULL, skill_version TEXT NOT NULL,
        request TEXT NOT NULL, harness TEXT, local_status TEXT NOT NULL, phase TEXT NOT NULL,
        error TEXT, created_at INTEGER NOT NULL, started_at INTEGER, finished_at INTEGER,
        attempt INTEGER NOT NULL, retry_of TEXT, planned_steps TEXT NOT NULL, steps TEXT NOT NULL,
        outputs TEXT NOT NULL, checks TEXT NOT NULL, summary TEXT, time_limit_ms INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS runs_created ON runs (created_at DESC);
      CREATE TABLE IF NOT EXISTS generations (
        id TEXT PRIMARY KEY, title TEXT NOT NULL, request TEXT NOT NULL, run_ids TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS events (
        run_id TEXT NOT NULL, seq INTEGER NOT NULL, type TEXT NOT NULL, data TEXT NOT NULL,
        at INTEGER NOT NULL, PRIMARY KEY (run_id, seq)
      );
    `);
  }

  /** A value created once per install and kept (machine id, session secret). */
  meta(key: string, create: () => string): string {
    const found = this.db.prepare("SELECT value FROM meta WHERE key = ?").get(key) as
      Row | undefined;
    if (found) return String(found.value);
    const value = create();
    this.db.prepare("INSERT INTO meta (key, value) VALUES (?, ?)").run(key, value);
    return value;
  }

  setMeta(key: string, value: string): void {
    this.db
      .prepare(
        "INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      )
      .run(key, value);
  }

  machineId(): string {
    return this.meta("machine_id", () => randomBytes(3).toString("hex"));
  }

  insertRun(run: RunRow): void {
    const row = toRow(run);
    const columns = Object.keys(row);
    this.db
      .prepare(
        `INSERT INTO runs (${columns.join(", ")}) VALUES (${columns.map(() => "?").join(", ")})`,
      )
      .run(...Object.values(row));
  }

  updateRun(id: string, patch: Partial<RunRow>): void {
    const row = toRow(patch);
    const columns = Object.keys(row);
    if (columns.length === 0) return;
    this.db
      .prepare(
        `UPDATE runs SET ${columns.map((column) => `${column} = ?`).join(", ")} WHERE id = ?`,
      )
      .run(...Object.values(row), id);
  }

  getRun(id: string): RunRow | undefined {
    const row = this.db.prepare("SELECT * FROM runs WHERE id = ?").get(id) as Row | undefined;
    return row ? fromRow(row) : undefined;
  }

  listRuns(options: { status?: LocalStatus[]; limit?: number; before?: number } = {}): RunRow[] {
    const where: string[] = [];
    const params: (string | number)[] = [];
    if (options.status?.length) {
      where.push(`local_status IN (${options.status.map(() => "?").join(", ")})`);
      params.push(...options.status);
    }
    if (options.before) {
      where.push("created_at < ?");
      params.push(options.before);
    }
    const sql = `SELECT * FROM runs ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY created_at DESC LIMIT ?`;
    params.push(options.limit ?? 50);
    return (this.db.prepare(sql).all(...params) as Row[]).map(fromRow);
  }

  appendEvent(runId: string, type: string, data: Record<string, unknown>, at: number): StoredEvent {
    const last = this.db
      .prepare("SELECT MAX(seq) AS seq FROM events WHERE run_id = ?")
      .get(runId) as Row;
    const seq = Number(last.seq ?? 0) + 1;
    this.db
      .prepare("INSERT INTO events (run_id, seq, type, data, at) VALUES (?, ?, ?, ?, ?)")
      .run(runId, seq, type, JSON.stringify(data), at);
    return { runId, seq, type, data, at };
  }

  eventsAfter(runId: string, seq: number): StoredEvent[] {
    const rows = this.db
      .prepare("SELECT * FROM events WHERE run_id = ? AND seq > ? ORDER BY seq")
      .all(runId, seq) as Row[];
    return rows.map((row) => ({
      runId: String(row.run_id),
      seq: Number(row.seq),
      type: String(row.type),
      data: JSON.parse(String(row.data)) as Record<string, unknown>,
      at: Number(row.at),
    }));
  }

  insertGeneration(generation: GenerationRow): void {
    this.db
      .prepare(
        "INSERT INTO generations (id, title, request, run_ids, created_at) VALUES (?, ?, ?, ?, ?)",
      )
      .run(
        generation.id,
        generation.title,
        JSON.stringify(generation.request),
        JSON.stringify(generation.runIds),
        generation.createdAt,
      );
  }

  listGenerations(limit = 50): GenerationRow[] {
    return (
      this.db
        .prepare("SELECT * FROM generations ORDER BY created_at DESC LIMIT ?")
        .all(limit) as Row[]
    ).map((row) => ({
      id: String(row.id),
      title: String(row.title),
      request: JSON.parse(String(row.request)) as Record<string, unknown>,
      runIds: JSON.parse(String(row.run_ids)) as string[],
      createdAt: Number(row.created_at),
    }));
  }

  /** Adds a version run (edit, resize) to the generation that holds `runId`. */
  addRunToGenerationOf(runId: string, newRunId: string): GenerationRow | undefined {
    const generation = this.listGenerations(500).find((item) => item.runIds.includes(runId));
    if (!generation) return undefined;
    const runIds = [...generation.runIds, newRunId];
    this.db
      .prepare("UPDATE generations SET run_ids = ? WHERE id = ?")
      .run(JSON.stringify(runIds), generation.id);
    return { ...generation, runIds };
  }

  getGeneration(id: string): GenerationRow | undefined {
    return this.listGenerations(500).find((generation) => generation.id === id);
  }

  close(): void {
    this.db.close();
  }
}

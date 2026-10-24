import { randomBytes } from "node:crypto";
import { existsSync, lstatSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import { containedPath } from "../paths.ts";
import { agentIdFor, fileUrl } from "../runs/events.ts";
import type { RunRow } from "../runs/types.ts";

/**
 * Artifacts saved from local runs (spec 001 FR-013: the local program owns what was made here).
 * Same shape as Seleya's Artifact (server-api-spec §3.7); the files stay in the run folder and are
 * served from there.
 */
export interface ArtifactRow {
  id: string;
  runId: string;
  title: string;
  type: "image" | "presentation" | "document";
  agentId: string;
  createdAt: number;
  summary: string;
  files: { name: string; kind: string; path: string; bytes: number }[];
  tags: string[];
  brief: string;
}

const SLIDE_SKILLS = new Set(["slides"]);

type Row = Record<string, string | number | null>;

export class ArtifactStore {
  private db: DatabaseSync;

  constructor(dbFile: string) {
    this.db = new DatabaseSync(dbFile);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS artifacts (
        id TEXT PRIMARY KEY, run_id TEXT NOT NULL UNIQUE, data TEXT NOT NULL, created_at INTEGER NOT NULL
      );
    `);
  }

  private read(row: Row | undefined): ArtifactRow | undefined {
    return row ? (JSON.parse(String(row.data)) as ArtifactRow) : undefined;
  }

  byRun(runId: string): ArtifactRow | undefined {
    return this.read(
      this.db.prepare("SELECT data FROM artifacts WHERE run_id = ?").get(runId) as Row | undefined,
    );
  }

  get(id: string): ArtifactRow | undefined {
    return this.read(
      this.db.prepare("SELECT data FROM artifacts WHERE id = ?").get(id) as Row | undefined,
    );
  }

  list(): ArtifactRow[] {
    return (
      this.db.prepare("SELECT data FROM artifacts ORDER BY created_at DESC").all() as Row[]
    ).map((row) => JSON.parse(String(row.data)) as ArtifactRow);
  }

  insert(artifact: ArtifactRow): void {
    this.db
      .prepare("INSERT INTO artifacts (id, run_id, data, created_at) VALUES (?, ?, ?, ?)")
      .run(artifact.id, artifact.runId, JSON.stringify(artifact), artifact.createdAt);
  }

  remove(id: string): void {
    this.db.prepare("DELETE FROM artifacts WHERE id = ?").run(id);
  }

  close(): void {
    this.db.close();
  }
}

const formatBytes = (bytes: number) =>
  bytes >= 1_000_000
    ? `${(bytes / 1_000_000).toFixed(1)} MB`
    : `${Math.max(1, Math.round(bytes / 1000))} KB`;

/** The brief the user gave, as one line for the artifact's "Brief" section. */
function briefOf(run: RunRow): string {
  const request = run.request;
  const text = [request.prompt, request.brief, request.edit_instruction]
    .filter((value): value is string => typeof value === "string" && value.trim() !== "")
    .join(" · ");
  return text || run.title;
}

/**
 * Builds the artifact for a finished run from its final outputs (spec 004 FR-015, spec 005 FR-010):
 * the design's PNG/PDF/SVG, or the deck's PDF and slide images. Only real files inside the run folder.
 */
export function artifactFromRun(
  run: RunRow,
  runsDir: string,
  machineId: string,
  now: number,
): ArtifactRow {
  const folder = path.join(runsDir, run.id);
  const presentation = SLIDE_SKILLS.has(run.skill);
  const files = run.outputs
    .filter((output) => output.state === "final" && output.slot !== "visual")
    .flatMap((output) => {
      const file = containedPath(folder, output.path);
      if (!file || !existsSync(file) || lstatSync(file).isSymbolicLink()) return [];
      return [
        {
          name: path.basename(output.path),
          kind: output.kind,
          path: output.path,
          bytes: lstatSync(file).size,
        },
      ];
    })
    // The deck's PDF (or a design's main PNG) first: it is what the artifact page opens.
    .sort((a, b) => rank(a.kind, presentation) - rank(b.kind, presentation));
  const skill = run.skill.replace(/^_/, "");
  return {
    id: `art_${machineId}_${now.toString(36)}${randomBytes(2).toString("hex")}`,
    runId: run.id,
    title: run.title,
    type: presentation ? "presentation" : "image",
    agentId: agentIdFor(run.skill),
    createdAt: now,
    summary: presentation
      ? `${files.filter((file) => file.kind === "png").length} slides · made on this computer${run.harness ? ` with ${run.harness}` : ""}.`
      : `${skill} · made on this computer${run.harness ? ` with ${run.harness}` : ""}${run.localStatus === "completed_with_issues" ? " · has check findings" : ""}.`,
    files,
    tags: ["local", presentation ? "slides" : "design", skill],
    brief: briefOf(run),
  };
}

function rank(kind: string, presentation: boolean): number {
  const order = presentation ? ["pdf", "png", "json"] : ["png", "svg", "pdf"];
  const index = order.indexOf(kind);
  return index < 0 ? order.length : index;
}

/** Seleya's Artifact JSON (snake_case on the wire), with file URLs the client can download. */
export function artifactJson(artifact: ArtifactRow) {
  return {
    id: artifact.id,
    title: artifact.title,
    type: artifact.type,
    agent_id: artifact.agentId,
    run_id: artifact.runId,
    created_at: new Date(artifact.createdAt).toISOString(),
    summary: artifact.summary,
    files: artifact.files.map((file) => ({
      name: file.name,
      kind: file.kind,
      size: formatBytes(file.bytes),
      url: fileUrl(artifact.runId, file.path),
    })),
    tags: artifact.tags,
    sections: [{ heading: "Brief", body: artifact.brief }],
  };
}

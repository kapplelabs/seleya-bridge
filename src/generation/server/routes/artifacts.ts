import { artifactFromRun, artifactJson, type ArtifactStore } from "../../artifacts/artifacts.ts";
import { RunError, type RunManager } from "../../runs/manager.ts";
import type { Store } from "../../runs/store.ts";
import { type Route, sendJson } from "../http.ts";

const ID = "([A-Za-z0-9_-]+)";

/** Artifacts saved from local runs: save (idempotent per run), list, read, delete. */
export function artifactRoutes(
  artifacts: ArtifactStore,
  store: Store,
  manager: RunManager,
  runsDir: string,
  now: () => number,
): Route[] {
  return [
    {
      method: "POST",
      pattern: /^\/artifacts$/,
      handle: async ({ body, response }) => {
        const input = await body();
        const runId = typeof input.run_id === "string" ? input.run_id : "";
        const run = manager.get(runId);
        if (!["completed", "completed_with_issues"].includes(run.localStatus))
          throw new RunError("not_finished", "Save a result once it has finished.", 409);
        const existing = artifacts.byRun(run.id);
        if (existing) return sendJson(response, 200, artifactJson(existing));
        const artifact = artifactFromRun(run, runsDir, store.machineId(), now());
        if (artifact.files.length === 0)
          throw new RunError("no_files", "This run produced no files to save.", 409);
        if (typeof input.title === "string" && input.title.trim())
          artifact.title = input.title.trim();
        artifacts.insert(artifact);
        return sendJson(response, 201, artifactJson(artifact));
      },
    },
    {
      method: "GET",
      pattern: /^\/artifacts$/,
      handle: () => ({ items: artifacts.list().map(artifactJson) }),
    },
    {
      method: "GET",
      pattern: new RegExp(`^/artifacts/${ID}$`),
      handle: ({ params: [id = ""] }) => {
        const artifact = artifacts.get(id);
        if (!artifact) throw new RunError("not_found", "No such artifact.", 404);
        return artifactJson(artifact);
      },
    },
    {
      method: "DELETE",
      pattern: new RegExp(`^/artifacts/${ID}$`),
      handle: ({ params: [id = ""], response }) => {
        artifacts.remove(id);
        response.writeHead(204).end();
        return undefined;
      },
    },
  ];
}

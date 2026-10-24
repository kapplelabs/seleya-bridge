import { existsSync, statSync } from "node:fs";
import path from "node:path";

import type { LocalConfig } from "../../config.ts";
import { runJson } from "../../runs/events.ts";
import { RunError, type RunManager } from "../../runs/manager.ts";
import type { Store } from "../../runs/store.ts";
import type { LocalStatus, RunRow } from "../../runs/types.ts";
import { type Route, sendError, sendFile, sendJson } from "../http.ts";
import { containedPath } from "../security.ts";
import { streamRun } from "../sse.ts";

export interface RunRouteDeps {
  config: LocalConfig;
  store: Store;
  manager: RunManager;
  /** Verifies and keeps a signed recipe sent with a run (spec 009). */
  acceptRecipe?: (raw: unknown) => { digest: string; id: string; version: string };
}

const ID = "([A-Za-z0-9_-]+)";

export function runResponse(manager: RunManager, run: RunRow) {
  return {
    run: runJson(run, { queuePosition: manager.queuePosition(run.id) }),
    stream: { stream_id: run.id, url: `/api/runs/${run.id}/stream` },
  };
}

export function runRoutes({ config, store, manager, acceptRecipe }: RunRouteDeps): Route[] {
  return [
    {
      method: "POST",
      pattern: /^\/local\/runs$/,
      handle: async ({ body, response }) => {
        const input = await body();
        const request = input.request;
        if (typeof request !== "object" || request === null || Array.isArray(request))
          throw new RunError("invalid_request", "`request` must be an object.");
        // Signed recipes sent with the run (spec 009): `recipe` for one usecase (its id is the
        // skill), `recipes` for a free-text request the orchestrator routes among them.
        const recipeFields: Record<string, unknown> = {};
        let skill = typeof input.skill === "string" ? input.skill : undefined;
        if (input.recipe || Array.isArray(input.recipes)) {
          if (!acceptRecipe)
            throw new RunError("no_recipes", "This runtime does not take recipes.", 400);
          if (input.recipe) {
            const accepted = acceptRecipe(input.recipe);
            Object.assign(recipeFields, {
              recipe_digest: accepted.digest,
              recipe_id: accepted.id,
              recipe_version: accepted.version,
            });
            skill ??= accepted.id;
          }
          if (Array.isArray(input.recipes))
            recipeFields.recipe_digests = input.recipes.map((raw) => acceptRecipe(raw).digest);
        }
        const run = manager.create({
          skill,
          title: typeof input.title === "string" ? input.title : "",
          request: { ...(request as Record<string, unknown>), ...recipeFields },
          harness: typeof input.harness === "string" ? input.harness : undefined,
        });
        return sendJson(response, 202, runResponse(manager, run));
      },
    },
    {
      method: "GET",
      pattern: /^\/runs$/,
      handle: ({ query }) => {
        const status = query.get("status")?.split(",").filter(Boolean) as LocalStatus[] | undefined;
        const limit = Math.min(Number(query.get("limit") ?? 50) || 50, 200);
        const before = Number(query.get("cursor") ?? 0) || undefined;
        const runs = store.listRuns({ status, limit, before });
        return {
          items: runs.map((run) => runJson(run, { queuePosition: manager.queuePosition(run.id) })),
          next_cursor: runs.length === limit ? String(runs[runs.length - 1]!.createdAt) : null,
        };
      },
    },
    {
      method: "GET",
      pattern: new RegExp(`^/runs/${ID}$`),
      handle: ({ params: [id = ""] }) =>
        runJson(manager.get(id), { queuePosition: manager.queuePosition(id) }),
    },
    {
      method: "GET",
      pattern: new RegExp(`^/runs/${ID}/stream$`),
      handle: ({ request, response, params: [id = ""] }) => {
        manager.get(id);
        streamRun(request, response, id, store, manager);
        return undefined;
      },
    },
    {
      method: "POST",
      pattern: new RegExp(`^/runs/${ID}/cancel$`),
      handle: async ({ params: [id = ""] }) => runJson(await manager.cancel(id)),
    },
    {
      method: "POST",
      pattern: new RegExp(`^/runs/${ID}/retry$`),
      handle: ({ params: [id = ""], response }) =>
        sendJson(response, 202, runResponse(manager, manager.retry(id))),
    },
    {
      method: "GET",
      pattern: new RegExp(`^/runs/${ID}/files/(.+)$`),
      handle: ({ params: [id = "", relative = ""], response }) => {
        manager.get(id);
        const folder = path.join(config.runsDir, id);
        const file = containedPath(folder, relative);
        if (!file || !existsSync(file) || !statSync(file).isFile())
          return sendError(response, 404, "not_found", "No such file in this run.");
        sendFile(response, file, { "cache-control": "no-cache" });
        return undefined;
      },
    },
  ];
}

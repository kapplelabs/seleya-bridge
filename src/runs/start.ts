/**
 * Starting a run, shared by POST /v1/runs and the server link's scheduler (docs/server-link.md §6.4), so
 * both go through the same policy, the same one-run-at-a-time check and the same engine.
 */
import { randomUUID } from "node:crypto";

import type { BridgeConfig } from "../config.ts";
import { runOnce } from "../engine/engine.ts";
import { buildRunSpec, type RunRequest } from "../engine/policy.ts";
import type { ProviderAdapter, ProviderId } from "../engine/types.ts";
import { HttpError } from "../http.ts";
import type { ResultStore } from "../results.ts";
import type { Run, RunRegistry, RunTrigger } from "../runs.ts";
import type { SessionStore } from "../sessions.ts";

export interface StartDeps {
  config: Pick<BridgeConfig, "defaultProvider" | "limits">;
  providers: ReadonlyMap<ProviderId, ProviderAdapter>;
  sessions: SessionStore;
  runs: RunRegistry;
  results: ResultStore;
  /** Template variables' clock; tests set it. */
  now?: () => Date;
}

export interface Caller {
  /** A paired browser's token record id, or the server link's owner id. */
  ownerId: string;
  origin: string;
  trigger?: RunTrigger;
  scheduleId?: string;
}

/**
 * The engine finishes every run itself; this only catches a bug in it, so a run that threw still ends
 * and the bridge doesn't stay busy forever.
 */
function finishCrashed(run: Run, error: unknown): void {
  console.error(error);
  if (run.finished) return;
  run.error = { code: "provider_error", message: "The bridge failed while running this request", retryable: true };
  run.emit("run.failed", run.error);
  run.emit("stream.done", {});
}

/** Checks `body` and starts the run, or throws HttpError (`busy` included). Never awaits before the run exists. */
export function startRun(body: RunRequest, caller: Caller, deps: StartDeps): { run: Run; persisted: boolean } {
  const { runs, sessions, results } = deps;
  // From here to runs.create nothing is awaited, so two requests can't both pass the busy check (§8.4).
  const { spec, provider, adapter, persisted, store } = buildRunSpec(body, {
    config: deps.config,
    providers: deps.providers,
    sessions,
    ownerId: caller.ownerId,
    newId: randomUUID,
    ...(deps.now !== undefined && { now: deps.now }),
  });
  if (runs.busy) throw new HttpError(409, "busy", "Another request is still running");
  // Recorded before the run exists: if writing sessions.json throws, no run is left holding `busy`.
  if (persisted && !spec.session.resume) sessions.add(spec.session.id, caller.ownerId, provider);
  const run = runs.create({
    sessionId: spec.session.id,
    persisted,
    ownerId: caller.ownerId,
    origin: caller.origin,
    provider,
    ...(caller.trigger !== undefined && { trigger: caller.trigger }),
    ...(caller.scheduleId !== undefined && { scheduleId: caller.scheduleId }),
    ...(store !== undefined && { store }),
    ...(spec.templateVars !== undefined && { templateVars: spec.templateVars }),
  });
  const settle = (finished: Run, status: "completed" | "failed" | "cancelled") => {
    const stored = results.record(finished, status);
    return stored === undefined ? undefined : { store: stored };
  };
  runOnce(adapter, run, spec, settle).catch((error: unknown) => finishCrashed(run, error));
  return { run, persisted };
}

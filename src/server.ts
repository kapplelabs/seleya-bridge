/**
 * HTTP API (docs/gateway.md §5; all JSON is snake_case on the wire):
 *   GET    /v1/health                    → { name, version, paired, busy }
 *   POST   /v1/pair/start                → { expires_at }       shows a code in the terminal or app
 *   POST   /v1/pair/confirm  { code }    → { token }
 *   DELETE /v1/pair                      → 204                  revokes the caller's token
 *   GET    /v1/capabilities              → { bridge_version, time_zone, default_provider, providers, limits }
 *   POST   /v1/runs  { prompt, provider?, model?, system_prompt?, session?, connectors?, workspace_tools?,
 *                      output_schema?, limits? }  → { run_id, session_id, provider, stream }
 *   GET    /v1/runs/:id                  → { run_id, session_id, provider, status, output, text, error }
 *   POST   /v1/runs/:id/tickets          → stream               a fresh ticket for the same run
 *   POST   /v1/runs/:id/cancel           → 202
 *   GET    /v1/runs/:id/stream?ticket=   → text/event-stream    the run's events (§6)
 * `stream` is Seleya's ChatStream: { stream_id, ticket, expires_at, url }. Every endpoint but health, pairing
 * and stream needs `Authorization: Bearer <token>`; a run or session of another paired browser looks like it
 * doesn't exist.
 */
import { randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";

import { z } from "zod";

import { verbatim } from "./case.ts";
import type { BridgeConfig } from "./config.ts";
import { runOnce } from "./engine/engine.ts";
import {
  buildRunSpec,
  MAX_OUTPUT_SCHEMA_BYTES,
  MAX_PROMPT_CHARS,
  MAX_SYSTEM_PROMPT_CHARS,
  runRequestSchema,
} from "./engine/policy.ts";
import type { ProviderAdapter, ProviderId } from "./engine/types.ts";
import { HttpError, readJson, sendEmpty, sendError, sendJson } from "./http.ts";
import type { Pairing, TokenStore } from "./pairing.ts";
import { RunRegistry, type Run } from "./runs.ts";
import type { SessionStore } from "./sessions.ts";
import {
  bearerToken,
  isAllowedHost,
  isAllowedOrigin,
  requestOrigin,
  sendPreflight,
  setCorsHeaders,
} from "./security.ts";
import { streamRun } from "./sse.ts";
import { TicketStore } from "./tickets.ts";

const confirmSchema = z.object({ code: z.string().regex(/^\d{6}$/, "must be 6 digits") });

export interface BridgeDeps {
  config: BridgeConfig;
  version: string;
  tokens: TokenStore;
  pairing: Pairing;
  /** Which paired browser started each persisted conversation, with which provider. */
  sessions: SessionStore;
  /** The providers runs may use, by id; their status() is what /v1/capabilities shows. */
  providers: Map<ProviderId, ProviderAdapter>;
  /** A provider started or finished answering a request. */
  onBusyChange?: (busy: boolean) => void;
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

export function createBridgeServer({
  config,
  version,
  tokens,
  pairing,
  sessions,
  providers,
  onBusyChange,
}: BridgeDeps): {
  server: Server;
  runs: RunRegistry;
} {
  const runs = new RunRegistry(onBusyChange);
  const tickets = new TicketStore();
  const publicOrigin = `http://127.0.0.1:${config.port}`;

  const streamFor = (run: Run) => {
    const { ticket, expiresAt } = tickets.issue(run.id);
    return {
      streamId: run.id,
      ticket,
      expiresAt: expiresAt.toISOString(),
      url: `${publicOrigin}/v1/runs/${run.id}/stream`,
    };
  };

  /** The caller's token record; throws 401 without a valid one. */
  const authorize = (req: IncomingMessage, origin: string | undefined) => {
    const token = bearerToken(req);
    const record = token ? tokens.find(token, origin) : undefined;
    if (!record) throw new HttpError(401, "unauthorized", "Pair Seleya with this bridge first");
    return record;
  };

  /** The run, if the caller started it: another paired browser's runs look like they don't exist. */
  const runOr404 = (id: string, ownerId: string) => {
    const run = runs.get(id);
    if (!run || run.ownerId !== ownerId)
      throw new HttpError(404, "run_not_found", "No such run (finished runs are kept 10 minutes)");
    return run;
  };

  const requireOrigin = (origin: string | undefined) => {
    if (!origin) throw new HttpError(400, "origin_required", "Pairing must come from Seleya in a browser");
    return origin;
  };

  async function route(req: IncomingMessage, res: ServerResponse, origin: string | undefined): Promise<void> {
    const url = new URL(req.url ?? "/", publicOrigin);
    const method = req.method ?? "GET";
    const parts = url.pathname.split("/").filter(Boolean);

    if (method === "GET" && url.pathname === "/v1/health") {
      const token = bearerToken(req);
      return sendJson(res, 200, {
        name: "seleya-bridge",
        version,
        paired: token !== undefined && tokens.find(token, origin) !== undefined,
        busy: runs.busy,
      });
    }

    if (method === "POST" && url.pathname === "/v1/pair/start") {
      const pairingOrigin = requireOrigin(origin);
      if (pairing.locked())
        throw new HttpError(
          429,
          "pairing_locked",
          "Too many wrong codes. Pairing is paused for a while; restart the bridge to allow it again.",
        );
      const expiresAt = pairing.start(pairingOrigin);
      if (!expiresAt) throw new HttpError(429, "too_many_requests", "Wait a few seconds before asking again");
      return sendJson(res, 200, { expiresAt: expiresAt.toISOString() });
    }

    if (method === "POST" && url.pathname === "/v1/pair/confirm") {
      const { code } = await readJson(req, confirmSchema);
      const token = pairing.confirm(requireOrigin(origin), code);
      if (!token) throw new HttpError(401, "invalid_code", "Wrong or expired code");
      return sendJson(res, 200, { token });
    }

    if (method === "DELETE" && url.pathname === "/v1/pair") {
      tokens.revoke(authorize(req, origin).id);
      sessions.keepOwners(tokens.list().map((record) => record.id));
      return sendEmpty(res, 204);
    }

    // Needs a token: unlike health, it shows tools and models.
    if (method === "GET" && url.pathname === "/v1/capabilities") {
      authorize(req, origin);
      return sendJson(res, 200, {
        bridgeVersion: version,
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        defaultProvider: config.defaultProvider,
        providers: [...providers.values()].map((adapter) => {
          const status = adapter.status();
          return { ...status, detail: status.detail ?? null };
        }),
        limits: {
          maxTurns: config.limits.maxTurns,
          maxToolOutputTokens: config.limits.maxToolOutputTokens,
          maxPromptChars: MAX_PROMPT_CHARS,
          maxSystemPromptChars: MAX_SYSTEM_PROMPT_CHARS,
          maxOutputSchemaBytes: MAX_OUTPUT_SCHEMA_BYTES,
        },
      });
    }

    if (method === "POST" && url.pathname === "/v1/runs") {
      const owner = authorize(req, origin).id;
      const body = await readJson(req, runRequestSchema);
      // From here to runs.create nothing is awaited, so two requests can't both pass the busy check (§8.4).
      const { spec, provider, adapter, persisted } = buildRunSpec(body, {
        config,
        providers,
        sessions,
        ownerId: owner,
        newId: randomUUID,
      });
      if (runs.busy) throw new HttpError(409, "busy", "Another request is still running");
      // Recorded before the run exists: if writing sessions.json throws, no run is left holding `busy`.
      if (persisted && !spec.session.resume) sessions.add(spec.session.id, owner, provider);
      const run = runs.create({ sessionId: spec.session.id, persisted, ownerId: owner, provider });
      runOnce(adapter, run, spec).catch((error: unknown) => finishCrashed(run, error));
      return sendJson(res, 201, {
        runId: run.id,
        sessionId: persisted ? run.sessionId : null,
        provider,
        stream: streamFor(run),
      });
    }

    if (method === "GET" && parts[0] === "v1" && parts[1] === "runs" && parts[2] && parts.length === 3) {
      const run = runOr404(parts[2], authorize(req, origin).id);
      return sendJson(res, 200, {
        runId: run.id,
        sessionId: run.persisted ? run.sessionId : null,
        provider: run.provider,
        status: run.status,
        output: verbatim(run.output ?? null),
        text: run.text ?? null,
        error: run.error ?? null,
      });
    }

    if (parts[0] === "v1" && parts[1] === "runs" && parts[2] && parts.length === 4) {
      const runId = parts[2];
      const action = parts[3];

      // Credentials before lookup, so an unauthenticated caller can't probe which runs exist.
      if (method === "GET" && action === "stream") {
        const ticket = url.searchParams.get("ticket");
        if (!ticket || !tickets.use(ticket, runId))
          throw new HttpError(401, "invalid_ticket", "Missing or expired stream ticket");
        const run = runs.get(runId);
        if (!run) throw new HttpError(404, "run_not_found", "No such run (finished runs are kept 10 minutes)");
        return streamRun(req, res, run);
      }
      if (method === "POST" && action === "tickets") {
        return sendJson(res, 200, streamFor(runOr404(runId, authorize(req, origin).id)));
      }
      if (method === "POST" && action === "cancel") {
        runOr404(runId, authorize(req, origin).id).abort.abort();
        return sendEmpty(res, 202);
      }
    }

    throw new HttpError(404, "not_found", "Not found");
  }

  const server = createServer((req, res) => {
    if (!isAllowedHost(req, config.port)) return sendError(res, new HttpError(403, "invalid_host", "Invalid Host"));

    // A browser always sends Origin on cross-origin requests; refuse unknown sites outright.
    const origin = requestOrigin(req);
    if (origin !== undefined) {
      if (!isAllowedOrigin(origin, config))
        return sendError(res, new HttpError(403, "origin_not_allowed", `Origin ${origin} is not allowed`));
      setCorsHeaders(res, origin);
    }
    if (req.method === "OPTIONS") return sendPreflight(req, res);

    route(req, res, origin).catch((error: unknown) => {
      const httpError =
        error instanceof HttpError ? error : new HttpError(500, "internal_error", "Something went wrong in the bridge");
      if (!(error instanceof HttpError)) console.error(error);
      if (res.headersSent) res.end();
      else sendError(res, httpError);
    });
  });

  return { server, runs };
}

/**
 * HTTP API (docs/gateway.md §5; all JSON is snake_case on the wire):
 *   GET    /v1/health                    → { name, version, distribution, paired, busy }
 *   POST   /v1/pair/start                → { expires_at }       shows a code in the terminal or app
 *   POST   /v1/pair/confirm  { code }    → { token }
 *   DELETE /v1/pair                      → 204                  revokes the caller's token
 *   GET    /v1/capabilities              → { bridge_version, distribution, time_zone, default_provider, providers,
 *                                           limits }
 *   POST   /v1/runs  { prompt, provider?, model?, system_prompt?, session?, connectors?, workspace_tools?,
 *                      output_schema?, limits? }  → { run_id, session_id, provider, stream }
 *                      template?, store? }  (docs/server-link.md §5)
 *   GET    /v1/runs/:id                  → { run_id, session_id, provider, status, output, text, error }
 *   POST   /v1/runs/:id/tickets          → stream               a fresh ticket for the same run
 *   POST   /v1/runs/:id/cancel           → 202
 *   GET    /v1/runs/:id/stream?ticket=   → text/event-stream    the run's events (§6)
 *   GET    /v1/results                   → { results }          kept results of this origin (server-link.md §6.2)
 *   GET    /v1/results/:key              → { key, latest, last_failure }
 *   DELETE /v1/results/:key              → 204
 *   GET    /v1/link                      → the server link, its schedules and active run (server-link.md §6.1)
 *   POST   /v1/link  { enrollment_token, server_path?, device_name? }  → same as GET
 *   DELETE /v1/link                      → 204
 * `stream` is Seleya's ChatStream: { stream_id, ticket, expires_at, url }. Every endpoint but health, pairing
 * and stream needs `Authorization: Bearer <token>`; a run or session of another paired browser looks like it
 * doesn't exist, except the server link's runs, which browsers of the link's origin may watch and stop.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";

import { z } from "zod";

import { verbatim } from "./case.ts";
import type { BridgeConfig } from "./config.ts";
import {
  MAX_OUTPUT_SCHEMA_BYTES,
  MAX_PROMPT_CHARS,
  MAX_STORE_META_BYTES,
  MAX_SYSTEM_PROMPT_CHARS,
  runRequestSchema,
} from "./engine/policy.ts";
import { TEMPLATE_VARS } from "./engine/template.ts";
import type { ProviderAdapter, ProviderId } from "./engine/types.ts";
import { type GenerationMount, GENERATION_PREFIX } from "./generation/mount.ts";
import { ENGINE_VERSION } from "./generation/recipes.ts";
import { HttpError, readJson, sendEmpty, sendError, sendJson } from "./http.ts";
import { LINK_OWNER } from "./link/policy.ts";
import type { LinkService } from "./link/service.ts";
import type { Pairing, TokenStore } from "./pairing.ts";
import { PROVIDERS_CATALOG, getProviderMeta } from "./providers/catalog.ts";
import { runProviderStream } from "./providers/runner.ts";
import { ProviderStore, sanitizeConnection, type StoredConnection } from "./providers/store.ts";
import { RESULT_KEY_PATTERN, type ResultEntry, type ResultStore } from "./results.ts";
import { RunRegistry, type Run } from "./runs.ts";
import { startRun } from "./runs/start.ts";
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
const linkSchema = z.object({
  enrollment_token: z.string().min(1).max(200),
  server_path: z.string().max(101).default("/api"),
  device_name: z.string().trim().min(1).max(100).optional(),
});

const testKeySchema = z.object({
  provider_id: z.string().min(1),
  api_key: z.string().min(1),
  custom_base_url: z.string().optional(),
});

const createConnectionSchema = z.object({
  provider_id: z.string().min(1),
  name: z.string().optional(),
  api_key: z.string().min(1),
  priority: z.number().int().optional(),
  custom_base_url: z.string().optional(),
});

const updateConnectionSchema = z.object({
  name: z.string().optional(),
  priority: z.number().int().optional(),
  is_active: z.boolean().optional(),
  api_key: z.string().optional(),
});

/** How this bridge was installed, so Seleya can say how to update it: the macOS app, or the CLI. */
export type BridgeDistribution = "app" | "cli";

export interface BridgeDeps {
  config: BridgeConfig;
  version: string;
  distribution: BridgeDistribution;
  tokens: TokenStore;
  pairing: Pairing;
  /** Which paired browser started each persisted conversation, with which provider. */
  sessions: SessionStore;
  /** The providers runs may use, by id; their status() is what /v1/capabilities shows. */
  providers: Map<ProviderId, ProviderAdapter>;
  /** Kept outcomes of runs that asked for `store`. */
  results: ResultStore;
  /** The link to a Seleya account; absent, /v1/link answers 404. */
  link?: LinkService;
  /** A provider started or finished answering a request. */
  onBusyChange?: (busy: boolean) => void;
  /** Generation (spec 009), served under /v1/generation; absent while it starts or when off. */
  generation?: () => GenerationMount | undefined;
}

/** A kept result as the wire shows it: the output and meta keep the keys Seleya wrote. */
function resultBody(entry: ResultEntry) {
  const attempt = <T extends { meta: Record<string, unknown> }>(value: T | null) =>
    value && { ...value, meta: verbatim(value.meta) };
  const latest = attempt(entry.latest);
  return {
    key: entry.key,
    latest: latest && { ...latest, output: verbatim(latest.output) },
    lastFailure: attempt(entry.lastFailure),
  };
}

export function createBridgeServer(deps: BridgeDeps): {
  server: Server;
  runs: RunRegistry;
} {
  const { config, version, distribution, tokens, pairing, sessions, providers, results, onBusyChange, generation } =
    deps;
  // Read on each request: the bridge creates the link after the server (it needs the run registry).
  const linkService = () => deps.link;
  const runs = new RunRegistry(onBusyChange);
  const tickets = new TicketStore();
  const providerStore = new ProviderStore();
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

  /**
   * The run, if the caller started it, or if it is the server link's and the caller is a browser of the
   * link's origin (server-link.md §6.5): another paired browser's runs look like they don't exist.
   */
  const runOr404 = (id: string, caller: { id: string; origin: string }) => {
    const run = runs.get(id);
    const visible =
      run !== undefined &&
      (run.ownerId === caller.id || (run.ownerId === LINK_OWNER && linkService()?.origin() === caller.origin));
    if (!visible) throw new HttpError(404, "run_not_found", "No such run (finished runs are kept 10 minutes)");
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
        distribution,
        paired: token !== undefined && tokens.find(token, origin) !== undefined,
        busy: runs.busy,
        // Recipes name the engine they need (spec 009); the page compares before starting one.
        engine: ENGINE_VERSION,
        generation: generation?.() !== undefined,
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
        distribution,
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
          maxStoreMetaBytes: MAX_STORE_META_BYTES,
        },
        features: { templateVars: TEMPLATE_VARS, results: true, link: linkService() !== undefined },
      });
    }

    /* ---------- API Key Providers Catalog & Management ---------- */
    if (method === "GET" && url.pathname === "/v1/providers") {
      return sendJson(res, 200, {
        providers: PROVIDERS_CATALOG,
        connections: providerStore.getSanitizedConnections(),
      });
    }

    if (method === "POST" && url.pathname === "/v1/providers/test") {
      const body = await readJson(req, testKeySchema);
      const result = await providerStore.testKey(body.provider_id, body.api_key, body.custom_base_url);
      return sendJson(res, 200, result);
    }

    if (method === "POST" && url.pathname === "/v1/providers/connections") {
      const body = await readJson(req, createConnectionSchema);
      const connection = await providerStore.addConnection({
        providerId: body.provider_id,
        name: body.name,
        apiKey: body.api_key,
        priority: body.priority,
        customBaseUrl: body.custom_base_url,
      });
      return sendJson(res, 201, { connection: sanitizeConnection(connection) });
    }

    if (parts[0] === "v1" && parts[1] === "providers" && parts[2] === "connections" && parts[3]) {
      const connId = parts[3];
      if (method === "PATCH") {
        const body = await readJson(req, updateConnectionSchema);
        const updated = providerStore.updateConnection(connId, {
          name: body.name,
          priority: body.priority,
          isActive: body.is_active,
          apiKey: body.api_key,
        });
        if (!updated) throw new HttpError(404, "not_found", "Connection not found");
        return sendJson(res, 200, { connection: sanitizeConnection(updated) });
      }
      if (method === "DELETE") {
        const ok = providerStore.deleteConnection(connId);
        if (!ok) throw new HttpError(404, "not_found", "Connection not found");
        return sendEmpty(res, 204);
      }
    }

    if (method === "GET" && url.pathname === "/v1/models") {
      const activeConns = providerStore.getConnections().filter((c) => c.isActive);
      const modelsList: unknown[] = [];
      for (const conn of activeConns) {
        const meta = getProviderMeta(conn.providerId);
        for (const mId of conn.modelIds) {
          const catModel = meta?.models.find((m) => m.id === mId);
          modelsList.push({
            id: `${conn.providerId}/${mId}`,
            modelId: mId,
            name: catModel?.name || mId,
            provider: conn.providerId,
            connectionId: conn.id,
            contextLength: catModel?.contextLength,
            maxOutputTokens: catModel?.maxOutputTokens,
          });
        }
      }
      return sendJson(res, 200, { data: modelsList });
    }

    if (method === "POST" && url.pathname === "/v1/runs") {
      const record = authorize(req, origin);
      const raw = await readJson(req, z.record(z.string(), z.unknown()));

      // Check if this run is targeting an API Key provider connection
      const requestedModel =
        typeof raw.model_id === "string"
          ? raw.model_id
          : typeof raw.model === "string"
            ? raw.model
            : undefined;

      let providerConn: StoredConnection | undefined;
      let actualModelId = requestedModel;

      if (requestedModel) {
        const allActive = providerStore.getConnections().filter((c) => c.isActive);
        for (const conn of allActive) {
          if (requestedModel.startsWith(`${conn.providerId}/`)) {
            providerConn = conn;
            actualModelId = requestedModel.slice(conn.providerId.length + 1);
            break;
          }
          if (conn.modelIds.includes(requestedModel)) {
            providerConn = conn;
            break;
          }
        }
      }

      if (providerConn && actualModelId && typeof raw.prompt === "string") {
        if (runs.busy) throw new HttpError(409, "busy", "Another request is still running");
        const sessionId = typeof raw.session_id === "string" ? raw.session_id : crypto.randomUUID();
        const run = runs.create({
          sessionId,
          persisted: false,
          ownerId: record.id,
          origin: record.origin,
          provider: "claude",
        });
        void runProviderStream(run, {
          prompt: raw.prompt,
          modelId: actualModelId,
          connection: providerConn,
        });
        return sendJson(res, 201, {
          runId: run.id,
          sessionId: run.sessionId,
          provider: providerConn.providerId,
          stream: streamFor(run),
        });
      }

      const body = runRequestSchema.parse(raw);
      const { run, persisted } = startRun(
        body,
        { ownerId: record.id, origin: record.origin },
        { config, providers, sessions, runs, results },
      );
      return sendJson(res, 201, {
        runId: run.id,
        sessionId: persisted ? run.sessionId : null,
        provider: run.provider,
        stream: streamFor(run),
      });
    }

    if (url.pathname === "/v1/link") {
      const record = authorize(req, origin);
      const link = linkService();
      if (!link) throw new HttpError(404, "not_found", "Not found");
      if (method === "GET") return sendJson(res, 200, link.view());
      if (method === "POST") {
        const body = await readJson(req, linkSchema);
        return sendJson(
          res,
          200,
          await link.link(record.origin, body.server_path, body.enrollment_token, body.device_name),
        );
      }
      if (method === "DELETE") {
        await link.unlink();
        return sendEmpty(res, 204);
      }
    }

    if (method === "GET" && url.pathname === "/v1/results") {
      return sendJson(res, 200, {
        results: results
          .list(authorize(req, origin).origin)
          .map((summary) => ({ ...summary, meta: verbatim(summary.meta) })),
      });
    }

    if (parts[0] === "v1" && parts[1] === "results" && parts[2] && parts.length === 3) {
      const record = authorize(req, origin);
      const key = decodeURIComponent(parts[2]);
      if (!RESULT_KEY_PATTERN.test(key)) throw new HttpError(400, "invalid_key", "Not a result key");
      if (method === "GET") {
        const entry = results.get(record.origin, key);
        if (!entry) throw new HttpError(404, "result_not_found", "No result is kept under this key");
        return sendJson(res, 200, resultBody(entry));
      }
      if (method === "DELETE") {
        if (!results.delete(record.origin, key))
          throw new HttpError(404, "result_not_found", "No result is kept under this key");
        return sendEmpty(res, 204);
      }
    }

    if (method === "GET" && parts[0] === "v1" && parts[1] === "runs" && parts[2] && parts.length === 3) {
      const run = runOr404(parts[2], authorize(req, origin));
      return sendJson(res, 200, {
        runId: run.id,
        sessionId: run.persisted ? run.sessionId : null,
        provider: run.provider,
        status: run.status,
        output: verbatim(run.output ?? null),
        text: run.text ?? null,
        sources: run.summary?.sources ?? null,
        connectorErrors: run.summary?.connectorErrors ?? null,
        redactions: run.summary?.redactions ?? null,
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
        return sendJson(res, 200, streamFor(runOr404(runId, authorize(req, origin))));
      }
      if (method === "POST" && action === "cancel") {
        runOr404(runId, authorize(req, origin)).abort.abort();
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

    // Generation has its own queue and routes (spec 009); chat's one-at-a-time rule doesn't apply.
    const url = req.url ?? "/";
    const generationMount = generation?.();
    const handled =
      url === GENERATION_PREFIX || url.startsWith(`${GENERATION_PREFIX}/`)
        ? generationMount
          ? generationMount.handle(req, res, origin)
          : Promise.reject(
              new HttpError(503, "generation_starting", "Generation is still starting, try again"),
            )
        : route(req, res, origin);
    handled.catch((error: unknown) => {
      const httpError =
        error instanceof HttpError ? error : new HttpError(500, "internal_error", "Something went wrong in the bridge");
      if (!(error instanceof HttpError)) console.error(error);
      if (res.headersSent) res.end();
      else sendError(res, httpError);
    });
  });

  return { server, runs };
}

/**
 * HTTP API (all JSON is snake_case on the wire):
 *   GET    /v1/health                    → { name, version, paired, busy, connectors }
 *   POST   /v1/pair/start                → { expires_at }       prints a code in the terminal
 *   POST   /v1/pair/confirm  { code }    → { token }
 *   DELETE /v1/pair                      → 204                  revokes the caller's token
 *   POST   /v1/runs  { prompt, session_id?, title? }  → { run_id, session_id, assistant_message_id, stream }
 *   POST   /v1/briefings                 → { run_id, stream }   today's Daily Briefing, as an agent run
 *   POST   /v1/calendar/weeks  { week_start }  → { run_id, stream }   one Mon–Fri week of Google Calendar
 *   POST   /v1/mail/triage  { days? }    → { run_id, stream }   the last days of Gmail, triaged
 *   GET    /v1/runs/:id/result           → { briefing } | { week } | { triage }  what a finished report run produced
 *   POST   /v1/runs/:id/tickets          → stream               a fresh ticket for the same run
 *   POST   /v1/runs/:id/cancel           → 202
 *   GET    /v1/runs/:id/stream?ticket=   → text/event-stream
 * `stream` is Seleya's ChatStream: { stream_id, ticket, expires_at, url }.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";

import { z } from "zod";

import { canBrief, runBriefing } from "./briefing.ts";
import { canReadCalendar, parseWeekStart, runCalendarWeek } from "./calendar.ts";
import { runClaude } from "./claude.ts";
import type { BridgeConfig } from "./config.ts";
import type { ConnectorSet } from "./connectors.ts";
import { type GenerationMount, GENERATION_PREFIX } from "./generation/mount.ts";
import { ENGINE_VERSION } from "./generation/recipes.ts";
import { HttpError, readJson, sendEmpty, sendError, sendJson } from "./http.ts";
import { canReadMail, DEFAULT_DAYS, MAX_DAYS, MIN_DAYS, runMailTriage } from "./mail.ts";
import type { Pairing, TokenStore } from "./pairing.ts";
import { RunRegistry, type Run } from "./runs.ts";
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

const MAX_PROMPT_LENGTH = 100_000;
const TITLE_LENGTH = 60;

const confirmSchema = z.object({ code: z.string().regex(/^\d{6}$/, "must be 6 digits") });
const runSchema = z.object({
  prompt: z.string().trim().min(1).max(MAX_PROMPT_LENGTH),
  /** An earlier run's session_id continues that conversation; omit to start a new one. */
  session_id: z.uuid().optional(),
  title: z.string().trim().min(1).max(200).optional(),
});

const calendarWeekSchema = z.object({ week_start: z.string() });
const mailTriageSchema = z.object({ days: z.number().int().min(MIN_DAYS).max(MAX_DAYS).default(DEFAULT_DAYS) });

export interface BridgeDeps {
  config: BridgeConfig;
  version: string;
  tokens: TokenStore;
  pairing: Pairing;
  /** The connectors runs may read from; empty until discovery finishes. */
  connectors: () => ConnectorSet;
  /** Generation (spec 009), served under /v1/generation; absent while it starts or when off. */
  generation?: () => GenerationMount | undefined;
}

const titleFrom = (prompt: string) => {
  const line = prompt.split("\n", 1)[0]?.trim() ?? "";
  return line.length > TITLE_LENGTH ? `${line.slice(0, TITLE_LENGTH - 1)}…` : line || "New chat";
};

export function createBridgeServer({
  config,
  version,
  tokens,
  pairing,
  connectors,
  generation,
}: BridgeDeps): {
  server: Server;
  runs: RunRegistry;
} {
  const runs = new RunRegistry();
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

  const runOr404 = (id: string) => {
    const run = runs.get(id);
    if (!run) throw new HttpError(404, "run_not_found", "No such run (finished runs are kept 10 minutes)");
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
        // Recipes name the engine they need (spec 009); the page compares before starting one.
        engine: ENGINE_VERSION,
        generation: generation?.() !== undefined,
        // Which connectors Claude can read from; tools and errors stay in the bridge's terminal.
        connectors: connectors().connectors.map(({ id, name, state }) => ({ id, name, state })),
      });
    }

    if (method === "POST" && url.pathname === "/v1/pair/start") {
      const expiresAt = pairing.start(requireOrigin(origin));
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
      return sendEmpty(res, 204);
    }

    if (method === "POST" && url.pathname === "/v1/runs") {
      authorize(req, origin);
      const body = await readJson(req, runSchema);
      if (runs.busy) throw new HttpError(409, "busy", "Claude is still answering another request");
      const run = runs.create(body.session_id ?? crypto.randomUUID());
      void runClaude(
        run,
        { prompt: body.prompt, resume: body.session_id !== undefined, title: body.title ?? titleFrom(body.prompt) },
        config,
        version,
        connectors(),
      );
      return sendJson(res, 201, {
        runId: run.id,
        sessionId: run.sessionId,
        assistantMessageId: run.assistantMessageId,
        stream: streamFor(run),
      });
    }

    if (method === "POST" && url.pathname === "/v1/briefings") {
      authorize(req, origin);
      if (runs.busy) throw new HttpError(409, "busy", "Claude is still answering another request");
      const available = connectors();
      if (!canBrief(available))
        throw new HttpError(
          409,
          "no_connectors",
          "No connectors to read yet. Connect Gmail, Google Calendar, Slack or GitHub in Claude, set connectors in the bridge's config.json, then restart it.",
        );
      const run = runs.create(crypto.randomUUID());
      void runBriefing(run, config, version, available);
      return sendJson(res, 201, { runId: run.id, stream: streamFor(run) });
    }

    if (method === "POST" && url.pathname === "/v1/calendar/weeks") {
      authorize(req, origin);
      const week = parseWeekStart((await readJson(req, calendarWeekSchema)).week_start);
      if ("error" in week) throw new HttpError(400, "invalid_week", week.error);
      if (runs.busy) throw new HttpError(409, "busy", "Claude is still answering another request");
      const available = connectors();
      if (!canReadCalendar(available))
        throw new HttpError(
          409,
          "no_calendar",
          "Google Calendar isn't connected. Connect it in Claude, add it to connectors in the bridge's config.json, then restart it.",
        );
      const run = runs.create(crypto.randomUUID());
      void runCalendarWeek(run, config, version, available, week.monday);
      return sendJson(res, 201, { runId: run.id, stream: streamFor(run) });
    }

    if (method === "POST" && url.pathname === "/v1/mail/triage") {
      authorize(req, origin);
      const { days } = await readJson(req, mailTriageSchema);
      if (runs.busy) throw new HttpError(409, "busy", "Claude is still answering another request");
      const available = connectors();
      if (!canReadMail(available))
        throw new HttpError(
          409,
          "no_gmail",
          "Gmail isn't connected. Connect it in Claude, add it to connectors in the bridge's config.json, then restart it.",
        );
      const run = runs.create(crypto.randomUUID());
      void runMailTriage(run, config, version, available, days);
      return sendJson(res, 201, { runId: run.id, stream: streamFor(run) });
    }

    if (parts[0] === "v1" && parts[1] === "runs" && parts[2] && parts.length === 4) {
      const runId = parts[2];
      const action = parts[3];

      // Credentials before lookup, so an unauthenticated caller can't probe which runs exist.
      if (method === "GET" && action === "stream") {
        const ticket = url.searchParams.get("ticket");
        if (!ticket || !tickets.isValid(ticket, runId))
          throw new HttpError(401, "invalid_ticket", "Missing or expired stream ticket");
        return streamRun(req, res, runOr404(runId));
      }
      if (method === "POST" && action === "tickets") {
        authorize(req, origin);
        return sendJson(res, 200, streamFor(runOr404(runId)));
      }
      if (method === "GET" && action === "result") {
        authorize(req, origin);
        const run = runOr404(runId);
        if (!run.result)
          throw run.finished
            ? new HttpError(404, "no_result", "This run ended without a result")
            : new HttpError(409, "not_ready", "Still running");
        return sendJson(res, 200, { [run.result.key]: run.result.value });
      }
      if (method === "POST" && action === "cancel") {
        authorize(req, origin);
        runOr404(runId).abort.abort();
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

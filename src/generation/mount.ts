/**
 * Generation behind the bridge's gates (spec 009): every request under /v1/generation/ has already
 * passed the Host and origin checks in server.ts; here it needs the paired Bearer token, or, for a
 * run's live stream and its files, a short-lived ticket bound to that run (EventSource and <img>
 * can't send headers). Below the prefix, paths are generation's own (Seleya Local's /api/...).
 */
import { statSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import path from "node:path";

import { HttpError, sendJson } from "../http.ts";
import type { TokenStore } from "../pairing.ts";
import { bearerToken } from "../security.ts";
import { TicketStore } from "../tickets.ts";
import type { LocalApp } from "./app.ts";
import { setFileUrlBuilder } from "./runs/events.ts";
import { answerError } from "./server/http.ts";
import { setFrameTransform, useGatewayEnvelope } from "./server/sse.ts";

export const GENERATION_PREFIX = "/v1/generation";
/** Files: 10 min, reused while more than 5 min remain so image URLs stay stable (D8). */
const FILE_TICKET_MS = 10 * 60 * 1000;
const FILE_TICKET_REUSE_MS = 5 * 60 * 1000;
/** The run-list stream (tray) is not one run: its tickets are bound to this id. */
const EVENTS_ID = "events";

const ID = "[A-Za-z0-9_-]+";
const RUN_STREAM = new RegExp(`^/runs/(${ID})/stream$`);
const RUN_FILE = new RegExp(`^/runs/(${ID})/files/.+$`);
const RUN_TICKETS = new RegExp(`^/runs/(${ID})/tickets$`);

export interface GenerationMount {
  handle: (req: IncomingMessage, res: ServerResponse, origin: string | undefined) => Promise<void>;
}

export function mountGeneration(options: {
  app: LocalApp;
  tokens: TokenStore;
  /** This bridge as the browser reaches it, e.g. http://127.0.0.1:47821. */
  publicOrigin: string;
}): GenerationMount {
  const { app, tokens, publicOrigin } = options;
  const streamTickets = new TicketStore();
  const fileTickets = new TicketStore(FILE_TICKET_MS);
  const lastFileTicket = new Map<string, { ticket: string; expiresAt: number }>();

  const fileTicket = (runId: string) => {
    const last = lastFileTicket.get(runId);
    if (last && last.expiresAt - Date.now() > FILE_TICKET_REUSE_MS) return last.ticket;
    const { ticket, expiresAt } = fileTickets.issue(runId);
    lastFileTicket.set(runId, { ticket, expiresAt: expiresAt.getTime() });
    return ticket;
  };

  // Result files: absolute bridge URLs carrying a file ticket; run streams: the bridge's envelope.
  // The file's change time joins the URL: a re-rendered file (a text edit) gets a new URL, so the
  // browser never shows its cached copy while the reused ticket keeps the rest stable.
  const versionOf = (runId: string, encodedPath: string) => {
    try {
      const file = path.join(app.config.runsDir, runId, decodeURIComponent(encodedPath));
      return Math.floor(statSync(file).mtimeMs).toString(36);
    } catch {
      return "0";
    }
  };
  setFileUrlBuilder(
    (runId, encodedPath) =>
      `${publicOrigin}${GENERATION_PREFIX}/runs/${encodeURIComponent(runId)}/files/${encodedPath}?ticket=${fileTicket(runId)}&v=${versionOf(runId, encodedPath)}`,
  );
  useGatewayEnvelope(true);
  // Events are stored with the file URLs of their time; a replay (a reload, 10 min later, after a
  // bridge restart) gets a fresh ticket for each, so drafts never show as broken images.
  setFrameTransform((text) =>
    text.replace(
      /(\/v1\/generation\/runs\/([A-Za-z0-9_-]+)\/files\/[^"?]*\?ticket=)[A-Za-z0-9_-]+/g,
      (_, prefix: string, runId: string) => `${prefix}${fileTicket(runId)}`,
    ),
  );

  const paired = (req: IncomingMessage, origin: string | undefined) => {
    const token = bearerToken(req);
    return token !== undefined && tokens.find(token, origin) !== undefined;
  };

  const streamFor = (id: string, path: string) => {
    const { ticket, expiresAt } = streamTickets.issue(id);
    return {
      streamId: id,
      ticket,
      expiresAt: expiresAt.toISOString(),
      url: `${publicOrigin}${GENERATION_PREFIX}${path}`,
    };
  };

  async function handle(req: IncomingMessage, res: ServerResponse, origin: string | undefined) {
    const url = new URL(req.url ?? "/", publicOrigin);
    const rest = url.pathname.slice(GENERATION_PREFIX.length) || "/";
    const method = req.method ?? "GET";
    const ticket = url.searchParams.get("ticket") ?? "";

    // Tickets for a run's stream, or for the run-list stream.
    const forRun = RUN_TICKETS.exec(rest)?.[1];
    if (method === "POST" && (forRun || rest === "/events/tickets")) {
      if (!paired(req, origin))
        throw new HttpError(401, "unauthorized", "Pair Seleya with this bridge first");
      if (forRun) app.manager.get(forRun); // 404 for a run that doesn't exist
      return sendJson(
        res,
        200,
        forRun
          ? streamFor(forRun, `/runs/${forRun}/stream`)
          : streamFor(EVENTS_ID, "/local/events"),
      );
    }

    // A run's stream and files take a ticket bound to that run; everything else the token.
    const streamRun = method === "GET" ? RUN_STREAM.exec(rest)?.[1] : undefined;
    const fileRun = method === "GET" ? RUN_FILE.exec(rest)?.[1] : undefined;
    const ticketOk =
      (streamRun !== undefined && streamTickets.isValid(ticket, streamRun)) ||
      (fileRun !== undefined && fileTickets.isValid(ticket, fileRun)) ||
      (method === "GET" && rest === "/local/events" && streamTickets.isValid(ticket, EVENTS_ID));
    if (!ticketOk && !paired(req, origin))
      throw streamRun || fileRun || rest === "/local/events"
        ? new HttpError(401, "invalid_ticket", "Missing or expired ticket")
        : new HttpError(401, "unauthorized", "Pair Seleya with this bridge first");

    try {
      const handled = await app.handleTrusted(req, res, rest, url.searchParams);
      if (!handled) throw new HttpError(404, "not_found", "Not found");
    } catch (error) {
      if (error instanceof HttpError) throw error;
      answerError(res, error);
    }
  }

  return { handle };
}

import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import path from "node:path";

import { RunError } from "../runs/manager.ts";
import {
  containedPath,
  hasSession,
  hostAllowed,
  mayIssueSession,
  originAllowed,
  type SecurityPolicy,
  sessionCookie,
} from "./security.ts";

export interface RouteContext {
  request: IncomingMessage;
  response: ServerResponse;
  params: string[];
  query: URLSearchParams;
  /** Parsed JSON body (empty object when none). */
  body: () => Promise<Record<string, unknown>>;
}

export interface Route {
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  /** Matched against the path with any `/api` prefix removed. */
  pattern: RegExp;
  /** Routes that a page may call before it has a session. */
  public?: boolean;
  handle: (context: RouteContext) => unknown;
}

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".pdf": "application/pdf",
  ".woff2": "font/woff2",
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8",
};

export const mimeOf = (file: string) =>
  MIME[path.extname(file).toLowerCase()] ?? "application/octet-stream";

export function sendJson(response: ServerResponse, status: number, value: unknown): void {
  const body = status === 204 ? "" : JSON.stringify(value);
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  response.end(body);
}

/** Seleya's error shape (server-api-spec §1.6). */
export function sendError(
  response: ServerResponse,
  status: number,
  code: string,
  message: string,
): void {
  sendJson(response, status, { error: { code, message } });
}

export function sendFile(
  response: ServerResponse,
  file: string,
  headers: Record<string, string> = {},
): void {
  response.writeHead(200, {
    "content-type": mimeOf(file),
    "content-length": statSync(file).size,
    ...headers,
  });
  createReadStream(file).pipe(response);
}

async function readBody(request: IncomingMessage): Promise<Record<string, unknown>> {
  let raw = "";
  for await (const chunk of request) {
    raw += chunk;
    if (raw.length > 5_000_000) throw new RunError("too_large", "Request body is too large.", 413);
  }
  if (!raw.trim()) return {};
  const value: unknown = JSON.parse(raw);
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new RunError("invalid_body", "Expected a JSON object.", 400);
  return value as Record<string, unknown>;
}

export interface ServerOptions {
  policy: () => SecurityPolicy;
  routes: Route[];
  /** Built client to serve at `/`; absent in API-only mode. */
  distDir?: string;
}

/** The runtime's one HTTP server: security checks, routes, then the static client. */
export function createLocalServer(options: ServerOptions): Server {
  return createServer((request, response) => {
    void handle(request, response, options).catch((error: unknown) =>
      answerError(response, error),
    );
  });
}

async function handle(request: IncomingMessage, response: ServerResponse, options: ServerOptions) {
  const policy = options.policy();
  if (!hostAllowed(request, policy))
    return sendError(response, 403, "forbidden_host", "Unknown host.");

  const url = new URL(request.url ?? "/", "http://local");
  const apiPath = url.pathname.startsWith("/api/") ? url.pathname.slice(4) : url.pathname;
  const method = request.method ?? "GET";

  const handled = await dispatch(request, response, options.routes, apiPath, url.searchParams, {
    session: (route) => route.public === true || hasSession(request, policy),
    origin: () => method === "GET" || originAllowed(request, policy),
  });
  if (handled) return;

  if (url.pathname.startsWith("/api/") || method !== "GET")
    return sendError(response, 404, "not_found", "No such endpoint.");
  return serveClient(request, response, url.pathname, policy, options.distDir);
}

interface Gate {
  /** False: answered 401 (no session). */
  session: (route: Route) => boolean;
  /** False: answered 403 (foreign origin). */
  origin: () => boolean;
}

/** Already checked by the caller (seleya-bridge's pairing token or ticket, spec 009 FR-002). */
const TRUSTED: Gate = { session: () => true, origin: () => true };

/**
 * Finds the route for `apiPath` and runs it; false when no route matches. The standalone server
 * gates it with the session cookie; seleya-bridge calls it after its own checks.
 */
export async function dispatch(
  request: IncomingMessage,
  response: ServerResponse,
  routes: Route[],
  apiPath: string,
  query: URLSearchParams,
  gate: Gate = TRUSTED,
): Promise<boolean> {
  const method = request.method ?? "GET";
  for (const route of routes) {
    if (route.method !== method) continue;
    const match = route.pattern.exec(apiPath);
    if (!match) continue;
    if (!gate.session(route)) {
      sendError(response, 401, "no_session", "Open Seleya from Seleya Local to use this.");
      return true;
    }
    if (!gate.origin()) {
      sendError(response, 403, "forbidden_origin", "Requests from other sites are not allowed.");
      return true;
    }
    const result = await route.handle({
      request,
      response,
      params: match.slice(1).map(decodeURIComponent),
      query,
      body: () => readBody(request),
    });
    if (!response.headersSent && result !== undefined) sendJson(response, 200, result);
    return true;
  }
  return false;
}

/** Errors from a route as JSON answers (shared by the standalone server and seleya-bridge). */
export function answerError(response: ServerResponse, error: unknown): void {
  if (response.headersSent) return void response.end();
  if (error instanceof RunError) return sendError(response, error.status, error.code, error.message);
  if (error instanceof SyntaxError)
    return sendError(response, 400, "invalid_json", "The request body is not valid JSON.");
  console.error("generation:", error);
  sendError(response, 500, "internal", "Something went wrong while generating.");
}

/** Serves the built client; unknown paths get index.html (SPA routes), which also hands out the session. */
function serveClient(
  request: IncomingMessage,
  response: ServerResponse,
  pathname: string,
  policy: SecurityPolicy,
  distDir?: string,
) {
  if (!distDir || !existsSync(path.join(distDir, "index.html")))
    return sendError(
      response,
      404,
      "no_client",
      "The Seleya client is not built. Run `pnpm local` (it builds first).",
    );
  const file = containedPath(distDir, `.${decodeURIComponent(pathname)}`);
  if (file && existsSync(file) && statSync(file).isFile())
    return sendFile(response, file, {
      "cache-control": pathname.startsWith("/assets/")
        ? "public, max-age=31536000, immutable"
        : "no-cache",
    });
  const headers: Record<string, string> = { "cache-control": "no-cache" };
  if (mayIssueSession(request)) headers["set-cookie"] = sessionCookie(policy);
  return sendFile(response, path.join(distDir, "index.html"), headers);
}

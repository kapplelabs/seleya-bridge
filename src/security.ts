/**
 * Every web page the user opens can send requests to 127.0.0.1, and Claude Code can act on this
 * machine, so each request passes three gates before it reaches a route:
 * - Host: only 127.0.0.1 / localhost / [::1] on our port (blocks DNS rebinding).
 * - Origin: a browser request must come from an allowed Seleya origin; others get no CORS headers.
 * - Credentials: routes that act need the paired Bearer token (or a stream ticket for SSE).
 */
import type { IncomingMessage, ServerResponse } from "node:http";

import type { BridgeConfig } from "./config.ts";

const LOOPBACK_HOSTS = ["127.0.0.1", "localhost", "[::1]"];

export function isAllowedHost(req: IncomingMessage, port: number): boolean {
  const host = req.headers.host?.toLowerCase();
  return host !== undefined && LOOPBACK_HOSTS.some((name) => host === `${name}:${port}`);
}

/** The request's Origin header, if a browser sent one. */
export function requestOrigin(req: IncomingMessage): string | undefined {
  const origin = req.headers.origin;
  return origin && origin !== "null" ? origin : undefined;
}

export function isAllowedOrigin(origin: string, config: BridgeConfig): boolean {
  return config.allowedOrigins.includes(origin);
}

/** CORS headers for an allowed origin. No cookies are involved, so no Allow-Credentials. */
export function setCorsHeaders(res: ServerResponse, origin: string): void {
  res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Vary", "Origin");
}

/** Answers a CORS preflight from an allowed origin. */
export function sendPreflight(req: IncomingMessage, res: ServerResponse): void {
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type, Last-Event-ID");
  res.setHeader("Access-Control-Max-Age", "600");
  // Chrome's Private Network Access: a public https page reaching loopback asks for this first.
  if (req.headers["access-control-request-private-network"] === "true")
    res.setHeader("Access-Control-Allow-Private-Network", "true");
  res.writeHead(204, { "Content-Length": 0 });
  res.end();
}

export function bearerToken(req: IncomingMessage): string | undefined {
  const header = req.headers.authorization;
  const match = header?.match(/^Bearer\s+(\S+)$/i);
  return match?.[1];
}

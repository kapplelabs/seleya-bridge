import { timingSafeEqual } from "node:crypto";
import type { IncomingMessage } from "node:http";

/** Name of the session cookie that proves a request comes from the Seleya page this runtime served. */
export const SESSION_COOKIE = "seleya_local";

export interface SecurityPolicy {
  /** `127.0.0.1:<port>` and `localhost:<port>` of the running server. */
  hosts: Set<string>;
  /** Origins allowed to make state-changing requests (the runtime itself + the dev UI). */
  origins: Set<string>;
  session: string;
}

export function policyFor(port: number, extraOrigins: string[], session: string): SecurityPolicy {
  const hosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`]);
  return {
    hosts,
    origins: new Set([...[...hosts].map((host) => `http://${host}`), ...extraOrigins]),
    session,
  };
}

export function hostAllowed(request: IncomingMessage, policy: SecurityPolicy): boolean {
  return policy.hosts.has(request.headers.host ?? "");
}

/** A cross-site page must never get a session: only same-origin navigations and local tools may. */
export function mayIssueSession(request: IncomingMessage): boolean {
  const site = request.headers["sec-fetch-site"];
  return site === undefined || site === "same-origin" || site === "none";
}

export function readCookie(request: IncomingMessage, name: string): string | undefined {
  for (const part of (request.headers.cookie ?? "").split(";")) {
    const [key, ...value] = part.trim().split("=");
    if (key === name) return decodeURIComponent(value.join("="));
  }
  return undefined;
}

export function hasSession(request: IncomingMessage, policy: SecurityPolicy): boolean {
  const value = readCookie(request, SESSION_COOKIE);
  if (!value || value.length !== policy.session.length) return false;
  return timingSafeEqual(Buffer.from(value), Buffer.from(policy.session));
}

/** State-changing requests that name an Origin must come from an allowed one. */
export function originAllowed(request: IncomingMessage, policy: SecurityPolicy): boolean {
  const origin = request.headers.origin;
  return origin === undefined || policy.origins.has(origin);
}

export function sessionCookie(policy: SecurityPolicy): string {
  return `${SESSION_COOKIE}=${encodeURIComponent(policy.session)}; HttpOnly; SameSite=Strict; Path=/`;
}

export { containedPath } from "../paths.ts";

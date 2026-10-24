/**
 * Stream tickets: EventSource can't send an Authorization header, so the SSE URL carries a short-lived
 * ticket bound to one run (the same scheme as ms-agent-gateway). It stays valid until it expires so
 * the browser's own reconnect (same URL + Last-Event-ID) can resume; after that Seleya asks for a new one.
 */
import { randomBytes } from "node:crypto";

const TICKET_TTL_MS = 60 * 1000;

interface Ticket {
  runId: string;
  expiresAt: number;
}

export class TicketStore {
  private readonly tickets = new Map<string, Ticket>();
  private readonly ttlMs: number;

  /** `ttlMs`: how long a ticket stays valid (streams 60 s; generation files 10 min, spec 009 D8). */
  constructor(ttlMs = TICKET_TTL_MS) {
    this.ttlMs = ttlMs;
  }

  issue(runId: string): { ticket: string; expiresAt: Date } {
    this.prune();
    const ticket = randomBytes(24).toString("base64url");
    const expiresAt = Date.now() + this.ttlMs;
    this.tickets.set(ticket, { runId, expiresAt });
    return { ticket, expiresAt: new Date(expiresAt) };
  }

  isValid(ticket: string, runId: string): boolean {
    const entry = this.tickets.get(ticket);
    return entry !== undefined && entry.runId === runId && Date.now() <= entry.expiresAt;
  }

  private prune(): void {
    const now = Date.now();
    for (const [ticket, entry] of this.tickets) if (now > entry.expiresAt) this.tickets.delete(ticket);
  }
}

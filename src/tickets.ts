/**
 * Stream tickets: EventSource can't send an Authorization header, so the SSE URL carries a short-lived
 * ticket bound to one run (the same scheme as ms-agent-gateway). It stays valid until it expires so
 * the browser's own reconnect (same URL + Last-Event-ID) can resume; after that Seleya asks for a new one.
 * A ticket opens the stream a few times at most, so one that leaks (a log, a proxy) is of little use.
 */
import { randomBytes } from "node:crypto";

const TICKET_TTL_MS = 60 * 1000;
/** The first connection plus the browser's reconnects within the TTL. */
const MAX_USES = 5;

interface Ticket {
  runId: string;
  expiresAt: number;
  uses: number;
}

export class TicketStore {
  private readonly tickets = new Map<string, Ticket>();

  issue(runId: string): { ticket: string; expiresAt: Date } {
    this.prune();
    const ticket = randomBytes(24).toString("base64url");
    const expiresAt = Date.now() + TICKET_TTL_MS;
    this.tickets.set(ticket, { runId, expiresAt, uses: 0 });
    return { ticket, expiresAt: new Date(expiresAt) };
  }

  /** Checks the ticket for `runId` and counts one use of it. */
  use(ticket: string, runId: string): boolean {
    const entry = this.tickets.get(ticket);
    if (entry === undefined || entry.runId !== runId || Date.now() > entry.expiresAt || entry.uses >= MAX_USES)
      return false;
    entry.uses += 1;
    return true;
  }

  private prune(): void {
    const now = Date.now();
    for (const [ticket, entry] of this.tickets) if (now > entry.expiresAt) this.tickets.delete(ticket);
  }
}

/**
 * Which paired browser started each persisted conversation (provider session), and with which provider, so
 * a session id alone never lets another caller resume it: neither another paired origin's conversation, nor
 * a session the user started themselves in the workspace, nor one made with another provider. Kept in
 * sessions.json (mode 600) next to tokens.json, so conversations survive a restart.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { z } from "zod";

import { writePrivateFile } from "./config.ts";
import type { ProviderId } from "./engine/types.ts";

/**
 * Entries written before the gateway have no provider: they were all Claude's. Kept as a plain string so a
 * provider this build doesn't know (a newer bridge's) makes its sessions unresumable, not the file corrupt.
 */
const sessionsSchema = z.record(
  z.string(),
  z.object({ ownerId: z.string(), provider: z.string().default("claude"), createdAt: z.string() }),
);
type Sessions = z.infer<typeof sessionsSchema>;

export class SessionStore {
  private readonly file: string;
  private sessions: Sessions;

  constructor(home: string) {
    this.file = path.join(home, "sessions.json");
    this.sessions = this.load();
  }

  private load(): Sessions {
    if (!existsSync(this.file)) return {};
    const parsed = sessionsSchema.safeParse(JSON.parse(readFileSync(this.file, "utf8")));
    if (!parsed.success) throw new Error(`${this.file} is corrupt; delete it (Seleya's conversations can't be continued)`);
    return parsed.data;
  }

  private save(): void {
    writePrivateFile(this.file, `${JSON.stringify(this.sessions, null, 2)}\n`);
  }

  /** Records a new session started by `ownerId` with `provider`. */
  add(sessionId: string, ownerId: string, provider: ProviderId): void {
    this.sessions[sessionId] = { ownerId, provider, createdAt: new Date().toISOString() };
    this.save();
  }

  /**
   * True when `ownerId` started this session with `provider`. A string, not a ProviderId: the request's
   * provider is checked against this before the provider itself is (docs/gateway.md §5.2).
   */
  owns(sessionId: string, ownerId: string, provider: string): boolean {
    if (!Object.hasOwn(this.sessions, sessionId)) return false;
    const session = this.sessions[sessionId];
    return session?.ownerId === ownerId && session.provider === provider;
  }

  /** Forgets the sessions of paired browsers that no longer exist. */
  keepOwners(ownerIds: string[]): void {
    const keep = new Set(ownerIds);
    const entries = Object.entries(this.sessions);
    const kept = entries.filter(([, session]) => keep.has(session.ownerId));
    if (kept.length === entries.length) return;
    this.sessions = Object.fromEntries(kept);
    this.save();
  }
}

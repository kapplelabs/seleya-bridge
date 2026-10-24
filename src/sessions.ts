/**
 * Which paired browser started each chat conversation (Claude Code session), so a session id alone never
 * lets another caller resume it: neither another paired origin's conversation nor a Claude Code session the
 * user started themselves in the workspace. Kept in sessions.json (mode 600) next to tokens.json, so
 * conversations survive a restart.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { z } from "zod";

import { writePrivateFile } from "./config.ts";

const sessionsSchema = z.record(z.string(), z.object({ ownerId: z.string(), createdAt: z.string() }));
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

  /** Records a new session started by `ownerId`. */
  add(sessionId: string, ownerId: string): void {
    this.sessions[sessionId] = { ownerId, createdAt: new Date().toISOString() };
    this.save();
  }

  /** True when `ownerId` started this session. */
  owns(sessionId: string, ownerId: string): boolean {
    return Object.hasOwn(this.sessions, sessionId) && this.sessions[sessionId]?.ownerId === ownerId;
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

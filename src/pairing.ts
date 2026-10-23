/**
 * Pairing: Seleya asks for a code (POST /v1/pair/start), the bridge prints a 6-digit code in its
 * terminal, the user types it into Seleya (POST /v1/pair/confirm) and gets a long random token.
 * Only the token's SHA-256 is stored (tokens.json, mode 600), bound to the origin that paired it.
 */
import { createHash, randomBytes, randomInt, randomUUID, timingSafeEqual } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { z } from "zod";

import { writePrivateFile } from "./config.ts";

const CODE_TTL_MS = 2 * 60 * 1000;
const MAX_CODE_ATTEMPTS = 5;
/** Minimum gap between two pairing codes, so a page can't flood the terminal. */
const CODE_COOLDOWN_MS = 3000;

const tokenRecordSchema = z.object({
  id: z.string(),
  hash: z.string(),
  origin: z.string(),
  createdAt: z.string(),
});
type TokenRecord = z.infer<typeof tokenRecordSchema>;

const sha256 = (value: string) => createHash("sha256").update(value).digest();

/** Constant-time comparison of two strings of possibly different lengths. */
function safeEqual(a: string, b: string): boolean {
  return timingSafeEqual(sha256(a), sha256(b));
}

export class TokenStore {
  private readonly file: string;
  private records: TokenRecord[];

  constructor(home: string) {
    this.file = path.join(home, "tokens.json");
    this.records = this.load();
  }

  private load(): TokenRecord[] {
    if (!existsSync(this.file)) return [];
    const parsed = z.array(tokenRecordSchema).safeParse(JSON.parse(readFileSync(this.file, "utf8")));
    if (!parsed.success) throw new Error(`${this.file} is corrupt; delete it and pair again`);
    return parsed.data;
  }

  private save(): void {
    writePrivateFile(this.file, `${JSON.stringify(this.records, null, 2)}\n`);
  }

  /** Issues a token for `origin` and returns it; only its hash is kept. */
  issue(origin: string): string {
    const token = randomBytes(32).toString("base64url");
    this.records.push({
      id: randomUUID(),
      hash: sha256(token).toString("hex"),
      origin,
      createdAt: new Date().toISOString(),
    });
    this.save();
    return token;
  }

  /** The record for `token`, if it was issued to `origin` (any origin when the caller sent none). */
  find(token: string, origin: string | undefined): TokenRecord | undefined {
    const hash = sha256(token);
    return this.records.find(
      (record) =>
        timingSafeEqual(Buffer.from(record.hash, "hex"), hash) &&
        (origin === undefined || record.origin === origin),
    );
  }

  revoke(id: string): void {
    this.records = this.records.filter((record) => record.id !== id);
    this.save();
  }

  revokeAll(): number {
    const count = this.records.length;
    this.records = [];
    this.save();
    return count;
  }
}

interface PendingCode {
  code: string;
  origin: string;
  expiresAt: number;
  attempts: number;
}

export class Pairing {
  private pending: PendingCode | undefined;
  private lastIssuedAt = 0;
  private readonly tokens: TokenStore;
  private readonly announce: (code: string, origin: string) => void;

  constructor(tokens: TokenStore, announce: (code: string, origin: string) => void) {
    this.tokens = tokens;
    this.announce = announce;
  }

  /** Starts pairing for `origin`: replaces any earlier code. Returns when the code expires, or undefined while cooling down. */
  start(origin: string): Date | undefined {
    const now = Date.now();
    if (now - this.lastIssuedAt < CODE_COOLDOWN_MS) return undefined;
    this.lastIssuedAt = now;
    const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
    this.pending = { code, origin, expiresAt: now + CODE_TTL_MS, attempts: 0 };
    this.announce(code, origin);
    return new Date(this.pending.expiresAt);
  }

  /** Trades a correct code for a token. A code is single-use and dies after a few wrong tries. */
  confirm(origin: string, code: string): string | undefined {
    const pending = this.pending;
    if (!pending || pending.origin !== origin || Date.now() > pending.expiresAt) return undefined;
    pending.attempts += 1;
    if (!safeEqual(pending.code, code)) {
      if (pending.attempts >= MAX_CODE_ATTEMPTS) this.pending = undefined;
      return undefined;
    }
    this.pending = undefined;
    return this.tokens.issue(origin);
  }
}

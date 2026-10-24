/**
 * Pairing: Seleya asks for a code (POST /v1/pair/start), the bridge shows a 6-digit code (in its
 * terminal, or in the Seleya Bridge app), the user types it into Seleya (POST /v1/pair/confirm) and gets a
 * long random token.
 * Only the token's SHA-256 is stored (tokens.json, mode 600), bound to the origin that paired it. A token
 * nobody used for TOKEN_IDLE_MS stops working.
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
/**
 * Wrong codes across every code and origin: a new code each few seconds would otherwise allow guessing
 * the 6 digits in a few days. Past the limit pairing stops for a while (or until the bridge restarts).
 */
const MAX_FAILURES = 10;
const FAILURE_WINDOW_MS = 60 * 60 * 1000;
const LOCKOUT_MS = 60 * 60 * 1000;
/** A paired browser that hasn't called the bridge for this long has to pair again. */
const TOKEN_IDLE_MS = 30 * 24 * 60 * 60 * 1000;
/** lastUsedAt is written at most this often, not on every request. */
const LAST_USED_RESOLUTION_MS = 60 * 60 * 1000;

const tokenRecordSchema = z.object({
  id: z.string(),
  hash: z.string(),
  origin: z.string(),
  createdAt: z.string(),
  lastUsedAt: z.string().optional(),
});
type TokenRecord = z.infer<typeof tokenRecordSchema>;

/** A paired browser, without its token hash. */
export type PairedBrowser = Omit<TokenRecord, "hash">;

const lastUsed = (record: TokenRecord) => Date.parse(record.lastUsedAt ?? record.createdAt);

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

  /**
   * The record for `token`, if it was issued to `origin` and is still in use. Callers without an Origin
   * (not a browser) get nothing: a token only works from the page that paired it.
   */
  find(token: string, origin: string | undefined): TokenRecord | undefined {
    if (origin === undefined) return undefined;
    this.forgetIdle();
    const hash = sha256(token);
    const record = this.records.find(
      (item) => timingSafeEqual(Buffer.from(item.hash, "hex"), hash) && item.origin === origin,
    );
    if (record && Date.now() - lastUsed(record) > LAST_USED_RESOLUTION_MS) {
      record.lastUsedAt = new Date().toISOString();
      this.save();
    }
    return record;
  }

  list(): PairedBrowser[] {
    return this.records.map(({ id, origin, createdAt, lastUsedAt }) => ({ id, origin, createdAt, lastUsedAt }));
  }

  /** Drops tokens nobody used for TOKEN_IDLE_MS. */
  private forgetIdle(): void {
    const now = Date.now();
    const active = this.records.filter((record) => now - lastUsed(record) <= TOKEN_IDLE_MS);
    if (active.length === this.records.length) return;
    this.records = active;
    this.save();
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

/** A code waiting to be typed into Seleya. */
export interface PairingCode {
  code: string;
  origin: string;
  expiresAt: Date;
}

export interface PairingListener {
  /** A new code to show the user; it replaces any earlier one. */
  code: (code: PairingCode) => void;
  /** The code was typed correctly, or died after too many wrong tries: stop showing it. */
  settled?: (outcome: "paired" | "failed", origin: string) => void;
  /** Too many wrong codes: pairing is refused until `until` or a restart. */
  locked?: (until: Date) => void;
}

export class Pairing {
  private pending: PendingCode | undefined;
  private lastIssuedAt = 0;
  /** When recent wrong codes were typed, oldest first. */
  private failures: number[] = [];
  private lockedUntil = 0;
  private readonly tokens: TokenStore;
  private readonly listener: PairingListener;

  constructor(tokens: TokenStore, listener: PairingListener) {
    this.tokens = tokens;
    this.listener = listener;
  }

  /** The code waiting to be typed, while it is still valid. */
  current(): PairingCode | undefined {
    const pending = this.pending;
    if (!pending || Date.now() > pending.expiresAt) return undefined;
    return { code: pending.code, origin: pending.origin, expiresAt: new Date(pending.expiresAt) };
  }

  /** While too many wrong codes were typed: when pairing works again. */
  locked(): Date | undefined {
    return Date.now() < this.lockedUntil ? new Date(this.lockedUntil) : undefined;
  }

  /** Starts pairing for `origin`: replaces any earlier code. Returns when the code expires, or undefined while cooling down or locked. */
  start(origin: string): Date | undefined {
    const now = Date.now();
    if (this.locked() || now - this.lastIssuedAt < CODE_COOLDOWN_MS) return undefined;
    this.lastIssuedAt = now;
    const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
    this.pending = { code, origin, expiresAt: now + CODE_TTL_MS, attempts: 0 };
    const expiresAt = new Date(this.pending.expiresAt);
    this.listener.code({ code, origin, expiresAt });
    return expiresAt;
  }

  /** Trades a correct code for a token. A code is single-use and dies after a few wrong tries. */
  confirm(origin: string, code: string): string | undefined {
    const pending = this.pending;
    if (this.locked() || !pending || pending.origin !== origin || Date.now() > pending.expiresAt) return undefined;
    pending.attempts += 1;
    if (!safeEqual(pending.code, code)) {
      if (this.recordFailure()) {
        this.pending = undefined;
        this.listener.settled?.("failed", origin);
        this.listener.locked?.(new Date(this.lockedUntil));
      } else if (pending.attempts >= MAX_CODE_ATTEMPTS) {
        this.pending = undefined;
        this.listener.settled?.("failed", origin);
      }
      return undefined;
    }
    this.pending = undefined;
    const token = this.tokens.issue(origin);
    this.listener.settled?.("paired", origin);
    return token;
  }

  /** Counts a wrong code; true when it locks pairing. */
  private recordFailure(): boolean {
    const now = Date.now();
    this.failures = [...this.failures.filter((at) => now - at < FAILURE_WINDOW_MS), now];
    if (this.failures.length < MAX_FAILURES) return false;
    this.failures = [];
    this.lockedUntil = now + LOCKOUT_MS;
    return true;
  }
}

/**
 * Recipes (spec 009): Seleya publishes each usecase (its skill, shared procedures and settings) as a
 * signed recipe and sends it with a run. The bridge runs a recipe only when its Ed25519 signature
 * verifies against a trusted key, before anything is written, and only when it fits this engine.
 * A verified recipe is kept once by digest as a small skills tree: <dir>/<digest>/<id>/SKILL.md…
 *
 * Digest (must match seleya's scripts/build-catalog.ts): SHA-256 hex of the JSON of
 * { id, version, engine, files: { <path>: <sha256 hex of its content>, … sorted by path } }.
 */
import { createHash, createPublicKey, verify } from "node:crypto";
import { existsSync, mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

import { RunError } from "./runs/manager.ts";

/** The engine version recipes depend on (semver; spec 009 D5). */
export const ENGINE_VERSION = "1.0.0";

export interface SignedRecipe {
  id: string;
  version: string;
  engine: string;
  files: Record<string, string>;
  digest: string;
  signature: string;
  key_id: string;
}

/** Recipe ids name a skill folder; internal skills and saved ones can't be shadowed. */
const ID = /^[a-z][a-z0-9-]{1,48}$/;
const RESERVED = new Set(["orchestrator"]);
/** `<id>/<file>` or a shared top-level file; no dot segments, no hidden files. */
const FILE = /^(?:[a-z][a-z0-9-]*\/)?[A-Za-z0-9][A-Za-z0-9_.-]*$/;
const MAX_BYTES = 1024 * 1024;

const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");

export function recipeDigest(recipe: Pick<SignedRecipe, "id" | "version" | "engine" | "files">) {
  const files = Object.fromEntries(
    Object.keys(recipe.files)
      .sort()
      .map((file) => [file, sha256(recipe.files[file] ?? "")]),
  );
  return sha256(
    JSON.stringify({ id: recipe.id, version: recipe.version, engine: recipe.engine, files }),
  );
}

/** `>=1.0.0`, `^1.2`, `1.0.0` against ENGINE_VERSION. */
export function engineSatisfies(range: string, version = ENGINE_VERSION): boolean {
  const parse = (text: string) => text.split(".").map((part) => Number(part) || 0);
  const compare = (a: number[], b: number[]) => {
    for (let index = 0; index < 3; index++) {
      const diff = (a[index] ?? 0) - (b[index] ?? 0);
      if (diff !== 0) return Math.sign(diff);
    }
    return 0;
  };
  const current = parse(version);
  const match = /^\s*(>=|\^)?\s*(\d+(?:\.\d+){0,2})\s*$/.exec(range);
  if (!match?.[2]) return false;
  const wanted = parse(match[2]);
  if (match[1] === ">=") return compare(current, wanted) >= 0;
  if (match[1] === "^") return current[0] === wanted[0] && compare(current, wanted) >= 0;
  return compare(current, wanted) === 0;
}

const str = (value: unknown) => (typeof value === "string" ? value : "");

/** Verified recipes on disk, by digest. */
export class RecipeStore {
  private dir: string;
  private keys: Record<string, string>;

  /** `keys`: key id → Ed25519 public key, base64 SPKI DER (seleya's public/catalog/keys.json). */
  constructor(dir: string, keys: Record<string, string>) {
    this.dir = dir;
    this.keys = keys;
  }

  /** The skills tree of a verified recipe. */
  dirFor(digest: string): string {
    return path.join(this.dir, digest);
  }

  has(digest: string): boolean {
    return /^[0-9a-f]{64}$/.test(digest) && existsSync(path.join(this.dirFor(digest), ".verified"));
  }

  /**
   * Checks a recipe as received with a run and keeps it; returns its digest, id and version.
   * Throws (nothing written) when it is malformed, tampered, signed by an unknown key or too new.
   */
  accept(raw: unknown): { digest: string; id: string; version: string } {
    // Pages send a recipe as its published JSON text, so no key conversion can touch its file paths.
    let parsed: unknown = raw;
    if (typeof raw === "string")
      try {
        parsed = JSON.parse(raw);
      } catch {
        throw new RunError("recipe_refused", "This recipe is not valid JSON.", 400);
      }
    const value = (parsed ?? {}) as Record<string, unknown>;
    const recipe: SignedRecipe = {
      id: str(value.id),
      version: str(value.version),
      engine: str(value.engine),
      files:
        value.files && typeof value.files === "object" && !Array.isArray(value.files)
          ? Object.fromEntries(
              Object.entries(value.files as Record<string, unknown>).map(([file, content]) => [
                file,
                str(content),
              ]),
            )
          : {},
      digest: str(value.digest),
      signature: str(value.signature),
      key_id: str(value.key_id),
    };
    const refuse = (message: string) => {
      throw new RunError("recipe_refused", message, 400);
    };
    if (!ID.test(recipe.id) || RESERVED.has(recipe.id)) refuse("This recipe has an invalid id.");
    if (!recipe.files[`${recipe.id}/SKILL.md`]) refuse("This recipe has no skill.");
    let bytes = 0;
    for (const [file, content] of Object.entries(recipe.files)) {
      if (!FILE.test(file) || (file.includes("/") && !file.startsWith(`${recipe.id}/`)))
        refuse(`This recipe has a file it may not have: ${file.slice(0, 80)}`);
      bytes += Buffer.byteLength(content);
    }
    if (bytes > MAX_BYTES) refuse("This recipe is too large.");

    const digest = recipeDigest(recipe);
    const key = this.keys[recipe.key_id];
    let signed = false;
    try {
      signed =
        key !== undefined &&
        digest === recipe.digest &&
        verify(
          null,
          Buffer.from(digest),
          createPublicKey({ key: Buffer.from(key, "base64"), format: "der", type: "spki" }),
          Buffer.from(recipe.signature, "base64"),
        );
    } catch {
      signed = false;
    }
    if (!signed)
      throw new RunError(
        "recipe_unsigned",
        "This recipe is not signed by Seleya, so it was not run.",
        403,
      );
    if (!engineSatisfies(recipe.engine))
      throw new RunError(
        "engine_too_old",
        `This needs seleya-bridge engine ${recipe.engine}; this bridge has ${ENGINE_VERSION}. Update seleya-bridge to use it.`,
        409,
      );

    if (!this.has(digest)) {
      // Written aside, then moved in whole: a half-written recipe is never used.
      const target = this.dirFor(digest);
      const temp = `${target}.tmp-${process.pid}`;
      rmSync(temp, { recursive: true, force: true });
      for (const [file, content] of Object.entries(recipe.files)) {
        const full = path.join(temp, file);
        mkdirSync(path.dirname(full), { recursive: true });
        writeFileSync(full, content);
      }
      writeFileSync(
        path.join(temp, ".verified"),
        JSON.stringify({ id: recipe.id, version: recipe.version, key_id: recipe.key_id }),
      );
      rmSync(target, { recursive: true, force: true });
      renameSync(temp, target);
    }
    return { digest, id: recipe.id, version: recipe.version };
  }
}

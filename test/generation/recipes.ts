/**
 * Signed recipes for tests (spec 009): the fixture catalog (a copy of Seleya's catalog/) signed with
 * a key made for this test process, as Seleya's build signs the real one.
 */
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import { recipeDigest, type SignedRecipe } from "../../src/generation/recipes.ts";
import { loadSkill, type SkillMeta } from "../../src/generation/skills.ts";

const CATALOG = path.join(import.meta.dirname, "fixtures", "catalog");
const { privateKey, publicKey } = generateKeyPairSync("ed25519");
const spki = publicKey.export({ type: "spki", format: "der" });
export const TEST_KEY_ID = createHash("sha256").update(spki).digest("hex").slice(0, 16);
export const TEST_KEYS: Record<string, string> = { [TEST_KEY_ID]: spki.toString("base64") };

function readTree(dir: string, base: string): Record<string, string> {
  const files: Record<string, string> = {};
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) Object.assign(files, readTree(full, base));
    else files[path.relative(base, full).split(path.sep).join("/")] = readFileSync(full, "utf8");
  }
  return files;
}

/** The fixture recipe `id`, signed; `change` edits it before signing (a new version, a new usecase). */
export function signedRecipe(
  id: string,
  change: (recipe: Omit<SignedRecipe, "digest" | "signature" | "key_id">) => void = () => {},
): SignedRecipe {
  const files = {
    ...readTree(path.join(CATALOG, "shared"), path.join(CATALOG, "shared")),
    ...readTree(path.join(CATALOG, "recipes", id), path.join(CATALOG, "recipes")),
  };
  const recipe = { id, version: "1.0.0", engine: ">=1.0.0", files };
  change(recipe);
  const digest = recipeDigest(recipe);
  return {
    ...recipe,
    digest,
    key_id: TEST_KEY_ID,
    signature: sign(null, Buffer.from(digest), privateKey).toString("base64"),
  };
}

/** The fixture recipe as the engine reads it once verified (settings included). */
export function recipeSkill(id: string): SkillMeta {
  const skill = loadSkill(path.join(CATALOG, "recipes", id), 60_000);
  if (!skill) throw new Error(`no fixture recipe ${id}`);
  return skill;
}

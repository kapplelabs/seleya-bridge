import { realpathSync } from "node:fs";
import path from "node:path";

/**
 * Resolves `relative` under `root`, or undefined if it would escape it, by its name or through a
 * symlink (an agent could plant `out/x -> ~/.ssh/...` to have it served or synced).
 */
export function containedPath(root: string, relative: string): string | undefined {
  const resolved = path.resolve(root, relative);
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) return undefined;
  let real: string;
  try {
    real = realpathSync(resolved);
  } catch {
    return resolved; // not created yet: nothing to follow
  }
  const realRoot = realpathSync(root);
  return real === realRoot || real.startsWith(`${realRoot}${path.sep}`) ? resolved : undefined;
}

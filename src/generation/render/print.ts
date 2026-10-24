/**
 * The page Chrome prints to PDF. Chrome's PDF writer stalls on large photographic PNGs (a 2.2 MB
 * poster visual hung printToPDF for over 5 minutes; the same page with a JPEG copy printed in 2.5 s,
 * docs/generation-performance.md), so the printed copy of a page points at JPEG copies of them.
 * The PNG outputs are untouched.
 */
import { execFile } from "node:child_process";
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

/** PNGs above this size are printed from a JPEG copy. */
const LARGE_PNG_BYTES = 400_000;

function toJpeg(source: string, target: string): Promise<boolean> {
  return new Promise((resolve) =>
    execFile(
      "sips",
      ["-s", "format", "jpeg", "-s", "formatOptions", "88", source, "--out", target],
      { timeout: 30_000 },
      (error) => resolve(!error && existsSync(target)),
    ),
  );
}

/**
 * A copy of `file` (beside it, `.print-<name>`) whose large local PNG images are JPEG copies, or
 * `file` itself when it has none or they cannot be converted (no `sips`: not macOS).
 */
export async function printCopy(file: string): Promise<string> {
  const dir = path.dirname(file);
  let html = readFileSync(file, "utf8");
  let changed = false;
  const references = new Set(
    [...html.matchAll(/["'(]([^"'()<>\s]+\.png)["')]/gi)].map((match) => match[1]!),
  );
  for (const reference of references) {
    if (/^[a-z]+:/i.test(reference) || reference.startsWith("/")) continue; // only files beside it
    const source = path.join(dir, reference);
    if (!source.startsWith(dir + path.sep) || !existsSync(source)) continue;
    if (statSync(source).size < LARGE_PNG_BYTES) continue;
    const name = `.print-${reference.replace(/[\\/]/g, "_").replace(/\.png$/i, ".jpg")}`;
    const target = path.join(dir, name);
    if (!existsSync(target) || statSync(target).mtimeMs < statSync(source).mtimeMs)
      if (!(await toJpeg(source, target))) continue;
    html = html.split(reference).join(name);
    changed = true;
  }
  if (!changed) return file;
  const copy = path.join(dir, `.print-${path.basename(file)}`);
  writeFileSync(copy, html);
  return copy;
}

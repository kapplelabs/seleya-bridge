/**
 * What an edit run is told about the design it changes (docs/generation-performance.md): the page
 * as it is, the direction it follows and, for a marked area, the texts inside it. Without this an
 * edit agent spent minutes reading files and working out what the area holds.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import type { TextBox } from "../render/chrome.ts";

/** Where a finished design's text boxes are kept for later edits (hidden: not an output). */
export const LAYOUT_FILE = path.join("out", ".layout.json");
/** The version's manifest, kept aside when a new version starts from its folder. */
export const PREVIOUS_RESULT = path.join("out", ".previous-result.json");

interface Layout {
  pages: { name: string; html: string; width: number; height: number; boxes: Pick<TextBox, "text" | "x" | "y" | "width" | "height">[] }[];
}

export function saveLayout(folder: string, layout: Layout): void {
  writeFileSync(path.join(folder, LAYOUT_FILE), JSON.stringify(layout));
}

function readJson<T>(file: string): T | undefined {
  try {
    return JSON.parse(readFileSync(file, "utf8")) as T;
  } catch {
    return undefined;
  }
}

/** Texts whose box lies mostly inside the region (fractions 0–1 of the page). */
export function textsInRegion(
  page: Layout["pages"][number],
  region: { x: number; y: number; width: number; height: number },
): string[] {
  const left = region.x * page.width;
  const top = region.y * page.height;
  const right = left + region.width * page.width;
  const bottom = top + region.height * page.height;
  return page.boxes
    .filter((box) => {
      const overlapX = Math.max(0, Math.min(box.x + box.width, right) - Math.max(box.x, left));
      const overlapY = Math.max(0, Math.min(box.y + box.height, bottom) - Math.max(box.y, top));
      return overlapX * overlapY >= 0.5 * box.width * box.height;
    })
    .map((box) => box.text);
}

const regionOf = (value: unknown) => {
  if (!value || typeof value !== "object") return undefined;
  const { x, y, width, height } = value as Record<string, unknown>;
  return [x, y, width, height].every((item) => typeof item === "number")
    ? { x: x as number, y: y as number, width: width as number, height: height as number }
    : undefined;
};

/** The extra prompt section for an edit, or undefined when the request is not an edit. */
export function editContext(folder: string, request: Record<string, unknown>): string | undefined {
  if (typeof request.edit_instruction !== "string") return undefined;
  const layout = readJson<Layout>(path.join(folder, LAYOUT_FILE));
  const region = regionOf(request.edit_region);
  const lines = [
    "## This run is an edit",
    "",
    `Instruction: ${request.edit_instruction}`,
    "The design below is already finished in this folder. Change only what the instruction asks, with as few edits as possible, then rewrite out/result.json. Do not write the brief or the direction again, and do not read other files: everything you need is here.",
  ];
  if (region && layout?.pages[0]) {
    const texts = textsInRegion(layout.pages[0], region);
    lines.push(
      texts.length
        ? `The marked area holds these texts: ${texts.map((text) => JSON.stringify(text)).join(", ")}. The instruction is about them.`
        : "The marked area holds no text: it is part of the picture or the background.",
    );
  }
  const concept = path.join(folder, "out", "concept.json");
  if (existsSync(concept)) lines.push("", "out/concept.json:", "```json", readFileSync(concept, "utf8").trim(), "```");
  for (const page of layout?.pages ?? []) {
    const file = path.join(folder, page.html);
    if (existsSync(file))
      lines.push("", `${page.html} (${page.width}×${page.height}):`, "```html", readFileSync(file, "utf8").trim(), "```");
  }
  const manifest = readJson<unknown>(path.join(folder, PREVIOUS_RESULT));
  if (manifest) lines.push("", "The previous out/result.json:", "```json", JSON.stringify(manifest), "```");
  return lines.join("\n");
}

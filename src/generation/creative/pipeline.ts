/**
 * The creative pipeline (docs/generation-perf-log.md, E4): a recipe that declares `"pipeline": "spec"`
 * and ships a SPEC.md is made by a fixed chain instead of an agent working turn by turn:
 *
 *   one answer with the whole design (image prompt first) ──┬─▶ pages written, preview shown
 *                                     picture made meanwhile ─┘─▶ picture placed → render, check
 *
 * Measured on the user's computer: a full spec in one answer took 18 s and passed every check,
 * where the agent loop took 31 turns and 246 s for the same poster.
 * An edit is one answer too: replaced words, a new page or a new picture.
 */
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import type { SkillMeta } from "../skills.ts";
import { editContext, PREVIOUS_RESULT } from "./edit.ts";
import { replaceText } from "./postprocess.ts";

/** The picture the pages show (`url('visual.jpg')`), beside them in out/. */
export const VISUAL = "visual.jpg";

/** Whether this skill is made by the pipeline (its recipe opts in and carries the prompt). */
export function isPipeline(skill: SkillMeta, folder: string): boolean {
  return (
    skill.settings?.pipeline === "spec" &&
    existsSync(path.join(folder, "skills", skill.name, "SPEC.md"))
  );
}

const bodyOf = (text: string) => text.replace(/^---\n[\s\S]*?\n---\n?/, "").trim();

/** The prompt: the shared contract and the format (stable), then the request (changes per run). */
export function pipelinePrompt(skill: SkillMeta, folder: string, request: Record<string, unknown>): string {
  const skills = path.join(folder, "skills");
  const own = bodyOf(readFileSync(path.join(skills, skill.name, "SPEC.md"), "utf8"));
  const shared = [...new Set([...own.matchAll(/skills\/([A-Z][A-Z_-]*\.md)/g)].map((match) => match[1]!))]
    .filter((name) => existsSync(path.join(skills, name)))
    .map((name) => bodyOf(readFileSync(path.join(skills, name), "utf8")));
  const asked = Object.fromEntries(Object.entries(request).filter(([key]) => !key.startsWith("recipe_")));
  return [
    ...shared,
    own,
    "## The request",
    JSON.stringify(asked, null, 2),
    editContext(folder, request) ?? "",
    correctedDefinition(folder, request),
    "Answer now with the JSON object only.",
  ]
    .filter(Boolean)
    .join("\n\n");
}

/** A custom design whose definition the person corrected (spec 007 FR-005): design from exactly it. */
function correctedDefinition(folder: string, request: Record<string, unknown>): string {
  const file = path.join(folder, "out", "definition.json");
  if (request.definition_edited !== true || !existsSync(file)) return "";
  return [
    "## The definition, corrected by the person",
    "Use it exactly (size, pages, content, required parts); do not answer a new `definition`.",
    "```json",
    readFileSync(file, "utf8").trim(),
    "```",
  ].join("\n");
}

/** A custom design's size as soon as its definition states it in a partial answer. */
export function earlySize(partial: string): { width: number; height: number } | undefined {
  const width = Number(/"width_px"\s*:\s*(\d+)/.exec(partial)?.[1]);
  const height = Number(/"height_px"\s*:\s*(\d+)/.exec(partial)?.[1]);
  return width > 0 && height > 0 ? { width: Math.min(6000, width), height: Math.min(6000, height) } : undefined;
}

/** The JSON object in an answer (fences and stray text around it are ignored). */
export function answerJson(text: string): Record<string, unknown> {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("the answer has no JSON object");
  return JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>;
}

/** `image_prompt` as soon as it is complete in a partial answer, so the picture starts early. */
export function earlyImagePrompt(partial: string): string | undefined {
  const match = /"image_prompt"\s*:\s*"((?:[^"\\]|\\.)*)"/.exec(partial);
  if (!match) return undefined;
  try {
    return JSON.parse(`"${match[1]}"`) as string;
  } catch {
    return undefined;
  }
}

export interface PipelineContext {
  folder: string;
  skill: SkillMeta;
  request: Record<string, unknown>;
  size: { width: number; height: number };
  /** One answer from the agent; `onText` sees the answer as it grows. */
  ask: (prompt: string, onText: (partial: string) => void) => Promise<string>;
  /** Makes the picture: its file in the run folder, or why none was made. */
  makeImage: (prompt: string, aspect: string) => Promise<{ file?: string; reason?: string }>;
  step: (label: string) => (status: "done" | "failed", detail?: string) => void;
  draft: (file: string, slot: string) => void;
  /**
   * The fallback when no agent can make the picture: the agent that made the design draws it as
   * SVG (every agent can write code; making images depends on the agent and its quota). Resolves to
   * its answer.
   */
  drawPicture?: (instruction: string) => Promise<string>;
}

/** The picture drawn as artwork, beside the pages (`url('visual.svg')`). */
export const DRAWN = "visual.svg";

/**
 * The SVG in an answer, safe to render: only the <svg> element, without scripts, embedded HTML,
 * event handlers or references outside the drawing. Undefined when there is none.
 */
export function cleanSvg(answer: string): string | undefined {
  let text = answer;
  try {
    const value = answerJson(answer).svg;
    if (typeof value === "string") text = value;
  } catch {
    // the SVG may be the whole answer
  }
  const start = text.indexOf("<svg");
  const end = text.lastIndexOf("</svg>");
  if (start < 0 || end <= start) return undefined;
  const svg = text
    .slice(start, end + "</svg>".length)
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<foreignObject[\s\S]*?<\/foreignObject>/gi, "")
    .replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*')/gi, "")
    .replace(/\s(?:xlink:)?href\s*=\s*("(?!#|data:image\/)[^"]*"|'(?!#|data:image\/)[^']*')/gi, "");
  return svg.length <= 400_000 ? svg : undefined;
}

/** Points the pages' picture (`visual.jpg`, or an older design's `visual.png` / `visual.svg`) at `name`. */
function showPicture(folder: string, pages: { html: string }[], name: string) {
  for (const page of pages) {
    const html = path.join(folder, page.html);
    if (existsSync(html))
      writeFileSync(html, readFileSync(html, "utf8").replace(/visual\.(?:png|jpg|svg)/g, name));
  }
}

/**
 * Draws the picture as SVG when it could not be made (CREATIVE.md: "build the visual from CSS/SVG
 * shapes, gradients and patterns"). True when the pages now show the drawing.
 */
async function drawInstead(
  context: PipelineContext,
  pages: { html: string }[],
  description: string,
  reason: string,
  size = context.size,
): Promise<boolean> {
  if (!context.drawPicture) return false;
  const { folder } = context;
  const concept = readJsonFile(path.join(folder, "out", "concept.json"));
  const palette = Array.isArray(concept?.palette) ? concept.palette.join(", ") : "the design's colours";
  const end = context.step("Drawing the picture");
  try {
    const svg = cleanSvg(
      await context.drawPicture(
        [
          `No picture could be made (${reason}). Draw it yourself as an SVG instead: ${description}`,
          `The SVG is the page's background: viewBox="0 0 ${size.width} ${size.height}", width="${size.width}" height="${size.height}".`,
          `Use shapes, gradients and patterns in the design's palette (${palette}): an illustration with depth and atmosphere, not a flat fill.`,
          "No text, letters, numbers or logos. Keep the areas where the text sits calm and simple. No scripts, no external images or fonts.",
          'Do not use tools. Answer with one JSON object: {"svg": "<svg …>…</svg>"}.',
        ].join("\n"),
      ),
    );
    if (!svg) throw new Error("the answer has no SVG");
    writeFileSync(path.join(folder, "out", DRAWN), svg);
    showPicture(folder, pages, DRAWN);
    end("done", "Drawn as artwork");
    return true;
  } catch (error) {
    end("failed", error instanceof Error ? error.message : String(error));
    return false;
  }
}

function sizeOfDefinition(definition: Record<string, unknown>): { width: number; height: number } | undefined {
  const value = (definition.size ?? {}) as Record<string, unknown>;
  const width = Math.min(6000, Number(value.width_px) || 0);
  const height = Math.min(6000, Number(value.height_px) || 0);
  return width && height ? { width, height } : undefined;
}

function readJsonFile(file: string): Record<string, unknown> | undefined {
  try {
    return JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

const str = (value: unknown) => (typeof value === "string" ? value : undefined);

function aspectOf({ width, height }: { width: number; height: number }): string {
  const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a);
  const divisor = gcd(width, height) || 1;
  return `${width / divisor}:${height / divisor}`;
}

function placeVisual(folder: string, file: string | undefined): boolean {
  if (!file || !existsSync(file)) return false;
  cpSync(file, path.join(folder, "out", VISUAL));
  return true;
}

/**
 * Makes a new design, or an edit of one, and writes out/result.json. A new design is finished on its
 * colours as soon as its pages are written; the returned `attachPicture` waits for the picture,
 * places it and adds it to the manifest (true when it did), so the person gets the design without
 * waiting for the picture (docs/generation-perf-log.md, p5).
 */
export async function runCreativePipeline(
  context: PipelineContext,
): Promise<{ attachPicture?: () => Promise<{ placed: boolean; drawn?: boolean; reason?: string }> }> {
  mkdirSync(path.join(context.folder, "out"), { recursive: true });
  if (typeof context.request.edit_instruction === "string") {
    await runEdit(context);
    return {};
  }
  const { folder } = context;
  const out = (name: string) => path.join(folder, "out", name);
  // A custom design sets its own size in its definition, unless the person chose one.
  const chosen = Number(context.request.width) > 0;
  const corrected = readJsonFile(out("definition.json"));
  let size = (!chosen && corrected && sizeOfDefinition(corrected)) || context.size;

  const endDesign = context.step("Designing");
  let picture: Promise<{ file?: string; reason?: string }> | undefined;
  const startPicture = (prompt: string) => {
    if (picture || !prompt.trim()) return;
    const endPicture = context.step("Making the picture");
    picture = context.makeImage(prompt, aspectOf(size)).then((made) => {
      // Not an alarm: the design's own agent draws the picture next (drawInstead).
      endPicture("done", made.file ? undefined : `Not available (${made.reason ?? "no agent made it"})`);
      return made;
    });
  };
  const answer = answerJson(
    await context.ask(pipelinePrompt(context.skill, folder, context.request), (partial) => {
      if (!chosen && !corrected) size = earlySize(partial) ?? size;
      const prompt = earlyImagePrompt(partial);
      if (prompt) startPicture(prompt);
    }),
  );
  // The definition (custom designs): what Seleya checks the design against.
  if (!corrected && answer.definition && typeof answer.definition === "object") {
    writeFileSync(out("definition.json"), JSON.stringify(answer.definition, null, 2));
    context.draft("out/definition.json", "definition");
    if (!chosen) size = sizeOfDefinition(answer.definition as Record<string, unknown>) ?? size;
  }
  startPicture(str(answer.image_prompt) ?? "");

  writeFileSync(out("brief.json"), JSON.stringify(answer.brief ?? {}, null, 2));
  writeFileSync(out("concept.json"), JSON.stringify(answer.concept ?? {}, null, 2));
  context.draft("out/brief.json", "brief");
  const pages = (Array.isArray(answer.pages) ? answer.pages : []).flatMap((page) => {
    const value = (page ?? {}) as Record<string, unknown>;
    const name = (str(value.name) ?? "design").replace(/[^A-Za-z0-9_-]/g, "") || "design";
    const html = str(value.html);
    // A page may have its own size (a custom design's panels); else the design's size.
    const width = Math.min(6000, Number(value.width) || size.width);
    const height = Math.min(6000, Number(value.height) || size.height);
    return html ? [{ name, html: `out/${name}.html`, content: html, width, height }] : [];
  });
  if (pages.length === 0) throw new Error("the design has no page");
  for (const page of pages) {
    writeFileSync(path.join(folder, page.html), page.content);
    context.draft(page.html, page.name); // shown on its colours while the picture is being made
  }
  // A vector deliverable (a logo): the SVG itself, cleaned like a drawn picture.
  const vector = typeof answer.vector === "string" ? cleanSvg(answer.vector) : undefined;
  if (vector) writeFileSync(out(`${pages[0]!.name}.svg`), vector);
  endDesign("done", str((answer.concept as Record<string, unknown> | undefined)?.title));

  const manifest = {
    skill: context.skill.name,
    pages: pages.map(({ name, html, width, height }) => ({ name, html, width, height })),
    keep_together: Array.isArray(answer.keep_together) ? answer.keep_together : [],
    ...(vector ? { vector: `out/${pages[0]!.name}.svg` } : {}),
  };
  writeFileSync(out("result.json"), JSON.stringify(manifest));
  const pending = picture;
  if (!pending) {
    // The plan showed a picture step (the format may have one); this design chose none.
    if (context.skill.needs.includes("image")) context.step("Making the picture")("done", "No picture for this design");
    return {};
  }
  const description = str(answer.image_prompt) ?? "";
  return {
    attachPicture: async () => {
      const made = await pending;
      if (placeVisual(folder, made.file)) {
        context.draft(`out/${VISUAL}`, "visual");
        writeFileSync(out("result.json"), JSON.stringify({ ...manifest, visual: `out/${VISUAL}` }));
        return { placed: true };
      }
      const reason = made.reason ?? "no agent made it";
      if (!(await drawInstead(context, manifest.pages, description, reason, manifest.pages[0]))) return { placed: false, reason };
      context.draft(`out/${DRAWN}`, "visual");
      writeFileSync(out("result.json"), JSON.stringify({ ...manifest, visual: `out/${DRAWN}` }));
      return { placed: true, drawn: true, reason };
    },
  };
}

async function runEdit(context: PipelineContext): Promise<void> {
  const { folder } = context;
  const previous = JSON.parse(readFileSync(path.join(folder, PREVIOUS_RESULT), "utf8")) as {
    pages?: { name: string; html: string }[];
    vector?: string;
  };
  const pages = previous.pages ?? [];
  // A logo's words and shapes are in its vector: replacements apply there too, and a new one may come.
  const vector = previous.vector ? path.join(folder, previous.vector) : undefined;
  const endEdit = context.step("Applying the edit");
  const answer = answerJson(
    await context.ask(pipelinePrompt(context.skill, folder, context.request), () => undefined),
  );
  const kind = str(answer.kind) ?? "text";
  const replacements = (Array.isArray(answer.replacements) ? answer.replacements : []).flatMap((item) => {
    const value = (item ?? {}) as Record<string, unknown>;
    return typeof value.from === "string" && typeof value.to === "string" && value.from
      ? [{ from: value.from, to: value.to }]
      : [];
  });
  let changed = 0;
  for (const page of pages) {
    const file = path.join(folder, page.html);
    if (!existsSync(file)) continue;
    if (kind === "html" && str(answer.html) && page === pages[0]) {
      writeFileSync(file, str(answer.html)!);
      changed += 1;
    } else if (replacements.length) {
      // Visible text only, never markup (spec 004 FR-018): an edit cannot break the page.
      const result = replaceText(readFileSync(file, "utf8"), replacements);
      writeFileSync(file, result.html);
      changed += result.count;
    }
  }
  if (vector && existsSync(vector)) {
    const replaced = typeof answer.vector === "string" ? cleanSvg(answer.vector) : undefined;
    if (replaced) {
      writeFileSync(vector, replaced);
      changed += 1;
    } else if (replacements.length) {
      const result = replaceText(readFileSync(vector, "utf8"), replacements);
      writeFileSync(vector, result.html);
      changed += result.count;
    }
  }
  let visual = (previous as { visual?: string }).visual;
  if (kind === "image" && str(answer.image_prompt)) {
    endEdit("done", "New picture requested");
    const endPicture = context.step("Making the picture");
    const { file, reason } = await context.makeImage(str(answer.image_prompt)!, aspectOf(context.size));
    endPicture("done", file ? undefined : `Not available (${reason ?? "no agent made it"})`);
    if (placeVisual(folder, file)) {
      // A design made by the agent loop shows `visual.png`: point it at the new picture.
      showPicture(folder, pages, VISUAL);
      visual = `out/${VISUAL}`;
      changed += 1;
    } else if (await drawInstead(context, pages, str(answer.image_prompt)!, reason ?? "no agent made it")) {
      visual = `out/${DRAWN}`;
      changed += 1;
    } else throw new Error(`no new picture could be made: ${reason ?? "no agent made it"}`);
  } else endEdit(changed ? "done" : "failed", `${kind}: ${changed} change(s)`);
  if (changed === 0) throw new Error("the edit changed nothing on the design");
  writeFileSync(
    path.join(folder, "out", "result.json"),
    JSON.stringify({ ...previous, ...(visual ? { visual } : {}) }),
  );
}

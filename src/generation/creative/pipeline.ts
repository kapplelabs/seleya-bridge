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
    "Answer now with the JSON object only.",
  ]
    .filter(Boolean)
    .join("\n\n");
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
): Promise<{ attachPicture?: () => Promise<{ placed: boolean; reason?: string }> }> {
  mkdirSync(path.join(context.folder, "out"), { recursive: true });
  if (typeof context.request.edit_instruction === "string") {
    await runEdit(context);
    return {};
  }
  const { folder, size } = context;
  const out = (name: string) => path.join(folder, "out", name);

  const endDesign = context.step("Designing");
  let picture: Promise<{ file?: string; reason?: string }> | undefined;
  const startPicture = (prompt: string) => {
    if (picture || !prompt.trim()) return;
    const endPicture = context.step("Making the picture");
    picture = context.makeImage(prompt, aspectOf(size)).then((made) => {
      endPicture(
        made.file ? "done" : "failed",
        made.file ? undefined : `No picture (${made.reason ?? "no agent made it"}): the design keeps its colours.`,
      );
      return made;
    });
  };
  const answer = answerJson(
    await context.ask(pipelinePrompt(context.skill, folder, context.request), (partial) => {
      const prompt = earlyImagePrompt(partial);
      if (prompt) startPicture(prompt);
    }),
  );
  startPicture(str(answer.image_prompt) ?? "");

  writeFileSync(out("brief.json"), JSON.stringify(answer.brief ?? {}, null, 2));
  writeFileSync(out("concept.json"), JSON.stringify(answer.concept ?? {}, null, 2));
  context.draft("out/brief.json", "brief");
  const pages = (Array.isArray(answer.pages) ? answer.pages : []).flatMap((page) => {
    const value = (page ?? {}) as Record<string, unknown>;
    const name = (str(value.name) ?? "design").replace(/[^A-Za-z0-9_-]/g, "") || "design";
    const html = str(value.html);
    return html ? [{ name, html: `out/${name}.html`, content: html }] : [];
  });
  if (pages.length === 0) throw new Error("the design has no page");
  for (const page of pages) {
    writeFileSync(path.join(folder, page.html), page.content);
    context.draft(page.html, page.name); // shown on its colours while the picture is being made
  }
  endDesign("done", str((answer.concept as Record<string, unknown> | undefined)?.title));

  const manifest = {
    skill: context.skill.name,
    pages: pages.map(({ name, html }) => ({ name, html, width: size.width, height: size.height })),
    keep_together: Array.isArray(answer.keep_together) ? answer.keep_together : [],
  };
  writeFileSync(out("result.json"), JSON.stringify(manifest));
  const pending = picture;
  if (!pending) return {};
  return {
    attachPicture: async () => {
      const made = await pending;
      if (!placeVisual(folder, made.file)) return { placed: false, reason: made.reason ?? "no agent made it" };
      context.draft(`out/${VISUAL}`, "visual");
      writeFileSync(out("result.json"), JSON.stringify({ ...manifest, visual: `out/${VISUAL}` }));
      return { placed: true };
    },
  };
}

async function runEdit(context: PipelineContext): Promise<void> {
  const { folder } = context;
  const previous = JSON.parse(readFileSync(path.join(folder, PREVIOUS_RESULT), "utf8")) as {
    pages?: { name: string; html: string }[];
  };
  const pages = previous.pages ?? [];
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
  let visual = existsSync(path.join(folder, "out", VISUAL));
  if (kind === "image" && str(answer.image_prompt)) {
    endEdit("done", "New picture requested");
    const endPicture = context.step("Making the picture");
    const { file, reason } = await context.makeImage(str(answer.image_prompt)!, aspectOf(context.size));
    endPicture(file ? "done" : "failed", reason);
    if (!file) throw new Error(`no new picture could be made: ${reason ?? "no agent made it"}`);
    if (placeVisual(folder, file)) {
      visual = true;
      changed += 1;
      // A design made by the agent loop shows `visual.png`: point it at the new picture.
      for (const page of pages) {
        const html = path.join(folder, page.html);
        if (existsSync(html))
          writeFileSync(html, readFileSync(html, "utf8").split("visual.png").join(VISUAL));
      }
    }
  } else endEdit(changed ? "done" : "failed", `${kind}: ${changed} change(s)`);
  if (changed === 0) throw new Error("the edit changed nothing on the design");
  writeFileSync(
    path.join(folder, "out", "result.json"),
    JSON.stringify({ ...previous, ...(visual ? { visual: `out/${VISUAL}` } : {}) }),
  );
}

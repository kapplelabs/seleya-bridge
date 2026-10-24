/**
 * Slides by the pipeline (docs/generation-perf-log.md): one answer with the whole deck, each slide
 * shown as soon as it is complete in the answer, then pictures made by the media agents and the deck
 * rendered with Seleya's themes. The agent loop took 75 turns and 482 s for a 5-slide deck.
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { answerJson, pipelinePrompt } from "../creative/pipeline.ts";
import { findDelivered } from "../media/catalog.ts";
import type { SkillMeta } from "../skills.ts";
import { readDeck, readSlide, type Slide } from "./deck.ts";

const pad = (number: number) => String(number).padStart(2, "0");

/** The complete objects of the array `key` in a partial JSON answer, in order. */
export function completeItems(partial: string, key: string): string[] {
  const start = new RegExp(`"${key}"\\s*:\\s*\\[`).exec(partial);
  if (!start) return [];
  const items: string[] = [];
  let depth = 0;
  let inString = false;
  let escaped = false;
  let begin = -1;
  for (let index = start.index + start[0].length; index < partial.length; index++) {
    const char = partial[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === "{") {
      if (depth === 0) begin = index;
      depth += 1;
    } else if (char === "}") {
      depth -= 1;
      if (depth === 0 && begin >= 0) items.push(partial.slice(begin, index + 1));
    } else if (char === "]" && depth === 0) break;
  }
  return items;
}

/** Picture shape per layout (skills/slides): wide for full-bleed, tall for a half. */
const aspectOf = (slide: Slide) =>
  slide.layout === "image-left" || slide.layout === "image-right" ? "4:5" : "16:9";

export interface SlidesPipelineContext {
  folder: string;
  skill: SkillMeta;
  request: Record<string, unknown>;
  ask: (prompt: string, onText: (partial: string) => void) => Promise<string>;
  step: (label: string) => (status: "done" | "failed", detail?: string) => void;
  draft: (file: string, slot: string) => void;
}

/** Writes the deck, its slides and the picture jobs; out/result.json last. */
export async function runSlidesPipeline(context: SlidesPipelineContext): Promise<void> {
  const { folder } = context;
  const out = path.join(folder, "out");
  mkdirSync(path.join(out, "slides"), { recursive: true });
  const end = context.step("Writing the slides");
  let shown = 0;
  let outlined = false;
  const answer = answerJson(
    await context.ask(pipelinePrompt(context.skill, folder, context.request), (partial) => {
      // The theme and title first, so each slide can be shown on its theme as soon as it is written.
      if (!outlined) {
        const theme = /"theme"\s*:\s*"([a-z]+)"/.exec(partial)?.[1];
        const title = /"title"\s*:\s*"((?:[^"\\]|\\.)*)"/.exec(partial)?.[1];
        if (theme && title !== undefined) {
          writeFileSync(path.join(out, "outline.json"), JSON.stringify({ title: JSON.parse(`"${title}"`), theme, slides: [] }));
          outlined = true;
        }
      }
      const items = completeItems(partial, "slides");
      for (; outlined && shown < items.length; shown++) {
        try {
          const slide = readSlide(JSON.parse(items[shown]!), shown);
          const file = `out/slides/${pad(shown + 1)}.json`;
          writeFileSync(path.join(folder, file), JSON.stringify(slide, null, 2));
          context.draft(file, `slide-${shown + 1}`);
        } catch {
          // shown with the whole deck
        }
      }
    }),
  );
  const deck = readDeck(answer);
  if (deck.slides.length === 0) throw new Error("the answer has no slides");
  writeFileSync(path.join(out, "outline.json"), JSON.stringify({ ...deck, slides: deck.slides.map(({ layout, heading }) => ({ layout, heading })) }));
  deck.slides.forEach((slide, index) =>
    writeFileSync(path.join(out, "slides", `${pad(index + 1)}.json`), JSON.stringify(slide, null, 2)),
  );
  writeFileSync(path.join(out, "deck.json"), JSON.stringify(deck, null, 2));
  // Pictures not already here (a refine keeps the earlier ones, spec 008) go to the media agents.
  const media = path.join(out, "media");
  const jobs = deck.slides.flatMap((slide) =>
    slide.image?.prompt && !(existsSync(media) && findDelivered(media, slide.image.id, "image"))
      ? [{ id: slide.image.id, kind: "image", prompt: slide.image.prompt, aspect: aspectOf(slide), purpose: slide.layout }]
      : [],
  );
  if (jobs.length) {
    mkdirSync(media, { recursive: true });
    writeFileSync(path.join(media, "jobs.json"), JSON.stringify(jobs, null, 2));
  }
  end("done", `${deck.slides.length} slides, ${jobs.length} picture(s) to make`);
  writeFileSync(path.join(out, "result.json"), JSON.stringify({ skill: context.skill.name, deck: "out/deck.json" }));
}

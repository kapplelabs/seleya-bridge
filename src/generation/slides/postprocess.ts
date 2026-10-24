import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { checkFacts, checkLayout, checkVisualText } from "../creative/checks.ts";
import { again, polishNote, requestText } from "../creative/postprocess.ts";
import { findDelivered } from "../media/catalog.ts";
import { containedPath } from "../paths.ts";
import { type ChromeRenderer, RenderError, type RenderResult } from "../render/chrome.ts";
import { recognizeText } from "../render/ocr.ts";
import type {
  DraftRenderer,
  PostProcessContext,
  PostProcessor,
  PostProcessResult,
} from "../runs/runner.ts";
import type { CheckResult, RunOutput } from "../runs/types.ts";
import {
  type Deck,
  notesHtml,
  readDeck,
  readSlide,
  type Slide,
  SLIDE_HEIGHT,
  SLIDE_WIDTH,
  slideHtml,
} from "./deck.ts";

const MAX_CORRECTIONS = 2;

/** Slide counts per Writing length (spec 005 FR-001). */
export const SLIDE_COUNTS: Record<string, number> = { short: 5, medium: 8, long: 12 };

export function expectedCount(request: Record<string, unknown>): number | undefined {
  const count = Number(request.count);
  if (count > 0) return count;
  return typeof request.length === "string" ? SLIDE_COUNTS[request.length] : undefined;
}

const pad = (number: number) => String(number).padStart(2, "0");

/** The slide's generated picture (spec 008), relative to out/slides/, when it was made. */
export function imageFor(folder: string, slide: Slide): string | undefined {
  if (!slide.image) return undefined;
  const file = findDelivered(path.join(folder, "out", "media"), slide.image.id, "image");
  return file ? `../media/${path.basename(file)}` : undefined;
}

/** The deck as the agent left it: out/deck.json, else the per-slide files plus the outline. */
export function loadDeck(folder: string): Deck {
  const deckFile = path.join(folder, "out", "deck.json");
  if (existsSync(deckFile)) {
    const deck = readDeck(JSON.parse(readFileSync(deckFile, "utf8")));
    if (deck.slides.length) return deck;
  }
  const slidesDir = path.join(folder, "out", "slides");
  const outlineFile = path.join(folder, "out", "outline.json");
  const outline = existsSync(outlineFile)
    ? (JSON.parse(readFileSync(outlineFile, "utf8")) as Record<string, unknown>)
    : {};
  const files = existsSync(slidesDir)
    ? readdirSync(slidesDir)
        .filter((name) => /^\d+\.json$/.test(name))
        .sort()
    : [];
  return readDeck({
    ...outline,
    slides: files.map(
      (name) => JSON.parse(readFileSync(path.join(slidesDir, name), "utf8")) as unknown,
    ),
  });
}

/** The words the agent put on the slides (title, headings, text, bullets, stats, cards, notes). */
export function deckContentText(deck: Deck): string {
  const parts: string[] = [deck.title];
  for (const slide of deck.slides) {
    parts.push(slide.kicker ?? "", slide.heading, slide.body ?? "", slide.notes ?? "");
    parts.push(...(slide.bullets ?? []), ...(slide.right ?? []));
    for (const stat of slide.stats ?? []) parts.push(stat.value, stat.label);
    for (const card of slide.cards ?? []) parts.push(card.title, card.body ?? "");
  }
  return parts.filter(Boolean).join("\n");
}

/** What the user gave for a deck: the creative fields plus the brief, instruction and earlier deck. */
export function slidesSourceText(request: Record<string, unknown>): string {
  const parts = [requestText(request)];
  for (const key of ["brief", "instruction", "topic", "context"])
    if (typeof request[key] === "string") parts.push(request[key] as string);
  const previous = request.previous_deck ?? request.previousDeck;
  if (previous) parts.push(JSON.stringify(previous));
  return parts.join("\n");
}

export interface RenderedDeck {
  outputs: RunOutput[];
  checks: CheckResult[];
}

/** Text scales tried, in order, before an overflowing slide goes back to the agent. */
const FIT_STEPS = [1, 0.92, 0.84];

/** Renders every slide (PNG), checks overflow and facts, and writes the deck PDF. */
export async function renderDeck(
  renderer: ChromeRenderer,
  folder: string,
  deck: Deck,
  request: Record<string, unknown>,
  /** Seleya Local's home, for text recognition in the pictures; absent: not checked. */
  home?: string,
): Promise<RenderedDeck> {
  const dir = path.join(folder, "out", "slides");
  mkdirSync(dir, { recursive: true });
  const outputs: RunOutput[] = [];
  const findings: string[] = [];
  const htmlFiles: string[] = [];
  /** The PDF's pages: each slide, followed by its speaker notes when it has any. */
  const pdfPages: string[] = [];
  for (const [index, slide] of deck.slides.entries()) {
    const number = index + 1;
    const html = path.join(dir, `${pad(number)}.html`);
    htmlFiles.push(html);
    pdfPages.push(html);
    const notes = notesHtml(slide, deck, number, deck.slides.length);
    if (notes) {
      const notesFile = path.join(dir, `${pad(number)}-notes.html`);
      writeFileSync(notesFile, notes);
      pdfPages.push(notesFile);
    }
    // A slide whose text does not fit is first scaled down a little by Seleya: asking the agent to
    // shorten it cost a whole correction round and often still failed (docs/generation-performance.md).
    let result: RenderResult | undefined;
    let fits = false;
    for (const fit of FIT_STEPS) {
      writeFileSync(
        html,
        slideHtml(slide, deck, number, deck.slides.length, imageFor(folder, slide), fit),
      );
      result = await renderer.render(html, SLIDE_WIDTH, SLIDE_HEIGHT, {});
      fits = checkLayout(
        result.boxes,
        { width: result.scrollWidth, height: result.scrollHeight },
        { width: SLIDE_WIDTH, height: SLIDE_HEIGHT },
      ).passed;
      if (fits) break;
    }
    const png = path.join("out", "slides", `${pad(number)}.png`);
    writeFileSync(path.join(folder, png), result!.png);
    outputs.push({ path: png, kind: "png", slot: `slide-${number}`, state: "final" });
    if (!fits)
      findings.push(
        `Slide ${number} ("${slide.heading.slice(0, 50)}") does not fit: shorten its text (fewer or shorter bullets, at most 6 bullets of about 12 words) in out/slides/${pad(number)}.json and out/deck.json.`,
      );
  }
  const pdf = await renderer.pdfOfPages(folder, pdfPages, SLIDE_WIDTH, SLIDE_HEIGHT);
  writeFileSync(path.join(folder, "out", "deck.pdf"), pdf);
  writeFileSync(path.join(folder, "out", "deck.json"), JSON.stringify(deck, null, 2));
  outputs.push(
    { path: "out/deck.pdf", kind: "pdf", slot: "deck", state: "final" },
    { path: "out/deck.json", kind: "json", slot: "content", state: "final" },
  );

  const checks: CheckResult[] = [
    { name: "fits on the slide", passed: findings.length === 0, findings, attempt: 0 },
  ];
  const count = expectedCount(request);
  if (count && !request.instruction)
    checks.push({
      name: "slide count",
      passed: deck.slides.length === count,
      findings:
        deck.slides.length === count
          ? []
          : [
              `The deck has ${deck.slides.length} slides but ${count} were asked for. Add or merge slides so there are exactly ${count}.`,
            ],
      attempt: 0,
    });
  // Figures are checked on what the agent wrote (not the rendered page: its "3 / 05" footer is
  // Seleya's), against everything the user gave: the brief, a refine instruction, the earlier deck.
  checks.push({
    ...checkFacts(deckContentText(deck), slidesSourceText(request)),
    name: "figures from the brief",
  });
  // Spec 008 FR-010: the pictures carry no text (checked once per picture, not on every re-render).
  const pictures = [
    ...new Set(deck.slides.map((slide) => imageFor(folder, slide)).filter(Boolean)),
  ];
  if (home && pictures.length) {
    const findings: string[] = [];
    for (const picture of pictures as string[]) {
      const file = path.join(folder, "out", "slides", picture);
      const result = checkVisualText(await recognizeText(home, file));
      findings.push(
        ...result.findings.map((finding) =>
          finding.startsWith("Not checked") ? finding : `${path.basename(file)}: ${finding}`,
        ),
      );
    }
    const real = [...new Set(findings)];
    checks.push({
      name: "text in pictures",
      passed: real.every((finding) => finding.startsWith("Not checked")),
      findings: real,
      attempt: 0,
    });
  }
  return { outputs, checks };
}

/** Post-processing for the slides skill: render, check, correct (at most twice), publish. */
export function slidesPostProcessor(renderer: ChromeRenderer, home?: string): PostProcessor {
  return async (context: PostProcessContext): Promise<PostProcessResult> => {
    const { folder, run, step, emit } = context;
    let rendered: RenderedDeck;
    let lastFound = "";
    for (let attempt = 0; ; attempt++) {
      const deck = loadDeck(folder);
      if (deck.slides.length === 0) throw new Error("the skill wrote no slides (out/deck.json)");
      const endRender = step(attempt === 0 ? "Rendering" : again("Rendering", attempt));
      try {
        rendered = await renderDeck(renderer, folder, deck, run.request, home);
      } catch (error) {
        // No browser could render here: the deck's content is still the result (Writing shows it).
        if (!(error instanceof RenderError)) throw error;
        endRender("done", "Shown from its content: no browser to render here");
        return unrenderedDeck(folder, deck, run.request, error.message);
      }
      endRender("done", `${deck.slides.length} slides and a PDF`);
      const endCheck = step(
        attempt === 0 ? "Checking the slides" : again("Checking", attempt),
      );
      for (const check of rendered.checks)
        emit("seleya.check.result", {
          name: check.name,
          passed: check.passed,
          findings: check.findings,
          attempt,
        });
      // The agent cannot fix a picture (another agent made it): only its own work goes back to it.
      const failing = rendered.checks.filter(
        (check) => !check.passed && check.name !== "text in pictures",
      );
      endCheck(
        // Something to polish is part of the work, not a failure: no alarm in the timeline.
        "done",
        failing.length ? polishNote(failing.length) : "All checks passed",
      );
      if (failing.length === 0 || attempt >= MAX_CORRECTIONS) break;
      // A fix that changed nothing the checks see will not do better the second time.
      const found = JSON.stringify(failing.map((check) => check.findings));
      if (found === lastFound) break;
      lastFound = found;
      const endFix = step(attempt === 0 ? "Polishing the design" : "Polishing again");
      const exit = await context.runAgain(
        [
          "Seleya rendered your slides and found problems. Fix ONLY these, keep everything else the same:",
          ...failing.flatMap((check) => check.findings.map((finding) => `- ${finding}`)),
          "Update both the per-slide files and out/deck.json, then rewrite out/result.json.",
        ].join("\n"),
      );
      endFix("done", exit.ok ? undefined : "Kept as it was");
      if (!exit.ok) break;
    }
    const deck = loadDeck(folder);
    return {
      outputs: rendered.outputs,
      checks: rendered.checks,
      summary: `${deck.slides.length} slides · ${deck.title}`,
    };
  };
}

/** While the agent writes, each finished slide is shown as an image (spec 005 FR-003). */
export function slideDraftRenderer(renderer: ChromeRenderer): DraftRenderer {
  return async (draft, folder) => {
    const match = /^slide-(\d+)$/.exec(draft.slot);
    if (!match || !draft.path.endsWith(".json")) return undefined;
    const number = Number(match[1]);
    const file = containedPath(folder, draft.path);
    if (!file || !existsSync(file)) return undefined;
    const outlineFile = path.join(folder, "out", "outline.json");
    const outline = existsSync(outlineFile)
      ? readDeck(JSON.parse(readFileSync(outlineFile, "utf8")))
      : undefined;
    const slide = readSlide(JSON.parse(readFileSync(file, "utf8")), number - 1);
    const total = outline?.slides.length || number;
    const html = path.join(folder, "out", "slides", `${pad(number)}.draft.html`);
    writeFileSync(
      html,
      slideHtml(
        slide,
        { title: outline?.title ?? "", theme: outline?.theme ?? "midnight" },
        number,
        total,
        imageFor(folder, slide),
      ),
    );
    const result = await renderer.render(html, SLIDE_WIDTH, SLIDE_HEIGHT, {});
    const png = path.join("out", "slides", `${pad(number)}.draft.png`);
    writeFileSync(path.join(folder, png), result.png);
    return { path: png, kind: "png", slot: draft.slot, state: "draft" };
  };
}

/** The result when no browser could render: the deck's content, and the checks that need no render. */
function unrenderedDeck(
  folder: string,
  deck: Deck,
  request: Record<string, unknown>,
  reason: string,
): PostProcessResult {
  writeFileSync(path.join(folder, "out", "deck.json"), JSON.stringify(deck, null, 2));
  return {
    outputs: [{ path: "out/deck.json", kind: "json", slot: "content", state: "final" }],
    checks: [
      { ...checkFacts(deckContentText(deck), slidesSourceText(request)), name: "figures from the brief" },
      {
        name: "rendering",
        passed: false,
        findings: [
          `Not rendered on this computer (${reason}). The slides are shown from their content; images and the PDF need Google Chrome, Chromium, Edge or Brave.`,
        ],
        attempt: 0,
      },
    ],
    summary: `${deck.slides.length} slides · ${deck.title} (not rendered)`,
  };
}

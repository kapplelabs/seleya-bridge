import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { containedPath } from "../paths.ts";
import { type ChromeRenderer, RenderError, type RenderResult } from "../render/chrome.ts";
import { recognizeText } from "../render/ocr.ts";
import { decodePng } from "../render/png.ts";
import type {
  DraftRenderer,
  PostProcessContext,
  PostProcessor,
  PostProcessResult,
} from "../runs/runner.ts";
import type { CheckResult, RunOutput } from "../runs/types.ts";
import {
  checkContrast,
  checkFacts,
  checkInventory,
  checkLayout,
  checkParts,
  checkQuotes,
  checkVisualText,
} from "./checks.ts";
import type { SkillMeta } from "../skills.ts";
import { saveLayout } from "./edit.ts";
import { type Usecase, usecaseFor } from "./usecases.ts";

const MAX_CORRECTIONS = 2;

interface ManifestPage {
  name: string;
  html: string;
  width?: number;
  height?: number;
}

/** What a creative skill writes in out/result.json (skills/CREATIVE.md). */
interface CreativeManifest {
  pages: ManifestPage[];
  visual?: string;
  vector?: string;
  keepTogether: string[];
}

const str = (value: unknown) => (typeof value === "string" ? value : undefined);
const strings = (value: unknown) =>
  Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.trim() !== "")
    : [];

export function readManifest(
  manifest: Record<string, unknown>,
  fallbackName: string,
): CreativeManifest {
  const pages: ManifestPage[] = Array.isArray(manifest.pages)
    ? manifest.pages.flatMap((page): ManifestPage[] => {
        if (typeof page !== "object" || page === null) return [];
        const record = page as Record<string, unknown>;
        const html = str(record.html);
        return html
          ? [
              {
                name: str(record.name) ?? fallbackName,
                html,
                width: Number(record.width) || undefined,
                height: Number(record.height) || undefined,
              },
            ]
          : [];
      })
    : str(manifest.html)
      ? [{ name: fallbackName, html: str(manifest.html) ?? "" }]
      : [];
  return {
    pages,
    visual: str(manifest.visual),
    vector: str(manifest.vector),
    keepTogether: strings(manifest.keep_together),
  };
}

/** What a custom design said it is (spec 007 out/definition.json): size, pages, content inventory. */
export interface Definition {
  size?: { width: number; height: number };
  pages: string[];
  inventory: string[];
  requiredParts: string[];
}

export function readDefinition(folder: string): Definition | undefined {
  const file = path.join(folder, "out", "definition.json");
  if (!existsSync(file)) return undefined;
  try {
    const value = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
    const size = (value.size ?? {}) as Record<string, unknown>;
    const width = Math.min(6000, Number(size.width_px) || 0);
    const height = Math.min(6000, Number(size.height_px) || 0);
    const pages = Array.isArray(value.pages)
      ? value.pages.flatMap((page) =>
          typeof page === "object" && page && typeof (page as { name?: unknown }).name === "string"
            ? [(page as { name: string }).name]
            : [],
        )
      : [];
    return {
      size: width && height ? { width, height } : undefined,
      pages,
      inventory: strings(value.content_inventory),
      requiredParts: strings(value.required_parts),
    };
  } catch {
    return undefined;
  }
}

/** The size a run must produce: the size the request asked for, else the usecase default. */
export function expectedSize(
  request: Record<string, unknown>,
  usecase: Usecase | undefined,
): { width: number; height: number } {
  const width = Number(request.width);
  const height = Number(request.height);
  if (width > 0 && height > 0) return { width: Math.round(width), height: Math.round(height) };
  const size = usecase?.sizes.find((item) => item.id === request.size) ?? usecase?.sizes[0];
  return size ? { width: size.width, height: size.height } : { width: 1000, height: 1000 };
}

/** Request fields the user typed: the only source of facts a design may show (FR-009). */
const USER_FIELDS = [
  "prompt",
  "fields",
  "items",
  "contact_lines",
  "cta",
  "brand_name",
  "title",
  "brand_kit",
  "edit_instruction",
];

/** Everything the user gave, as one text for fact checks; settings such as sizes and seeds are not facts. */
export function requestText(request: Record<string, unknown>): string {
  const parts: string[] = [];
  const walk = (value: unknown) => {
    if (typeof value === "string") parts.push(value);
    else if (Array.isArray(value)) value.forEach(walk);
    else if (value && typeof value === "object") Object.values(value).forEach(walk);
  };
  for (const key of USER_FIELDS) walk(request[key]);
  return parts.join("\n");
}

/**
 * The text whose quotes must appear verbatim. An edit may replace text the first request quoted
 * ("change the headline to …"): only the edit's own quotes count. Requiring the old ones made a
 * 352 s correction that put the replaced headline back (docs/generation-perf-log.md, r0).
 */
export function quotedText(request: Record<string, unknown>): string {
  return typeof request.edit_instruction === "string" ? request.edit_instruction : requestText(request);
}

interface Rendered {
  page: ManifestPage;
  result: RenderResult;
}

/**
 * Post-processing for creative skills: render every page at the exact size, check it, ask the agent
 * to fix what failed (at most twice), then publish PNG / PDF / SVG outputs.
 */
export function creativePostProcessor(renderer: ChromeRenderer, home: string): PostProcessor {
  return async (context: PostProcessContext): Promise<PostProcessResult> => {
    const { folder, run, step, emit } = context;
    // A routed run (orchestrator) post-processes as the skill it chose.
    const skillName = str(context.manifest.skill) ?? context.skill.name;
    const usecase = usecaseFor(context.skills, skillName);
    const definition = readDefinition(folder);
    const size =
      definition?.size && !(Number(run.request.width) > 0)
        ? definition.size
        : expectedSize(run.request, usecase);
    let manifest = readManifest(context.manifest, usecase?.pages[0] ?? "design");
    let checks: CheckResult[];
    let rendered: Rendered[];
    let lastFound = "";

    try {
      for (let attempt = 0; ; attempt++) {
        if (manifest.pages.length === 0)
          throw new Error("the skill did not say which page to render (out/result.json `pages`)");
        const endRender = step(attempt === 0 ? "Rendering" : `Rendering again (fix ${attempt})`);
        rendered = [];
        for (const page of manifest.pages) {
          const file = containedPath(folder, page.html);
          if (!file || !existsSync(file)) throw new Error(`${page.html} does not exist`);
          rendered.push({
            page,
            result: await renderer.render(file, size.width, size.height, {
              keepTogether: manifest.keepTogether,
            }),
          });
        }
        endRender(
          "done",
          `${rendered.length} page${rendered.length > 1 ? "s" : ""} at ${size.width}×${size.height}`,
        );

        const endCheck = step(
          attempt === 0 ? "Checking the design" : `Checking again (fix ${attempt})`,
        );
        checks = await runChecks(
          rendered,
          manifest,
          usecase,
          run.request,
          size,
          folder,
          home,
          definition,
        );
        for (const check of checks)
          emit("seleya.check.result", {
            name: check.name,
            passed: check.passed,
            findings: check.findings,
            attempt,
          });
        const failing = checks.filter((check) => !check.passed);
        endCheck(
          failing.length ? "failed" : "done",
          failing.length ? `${failing.length} check(s) need a fix` : "All checks passed",
        );
        if (failing.length === 0 || attempt >= MAX_CORRECTIONS) break;
        // A fix that changed nothing the checks see will not do better the second time.
        const found = JSON.stringify(failing.map((check) => check.findings));
        if (found === lastFound) break;
        lastFound = found;

        const endFix = step(`Fixing what the checks found (${attempt + 1}/${MAX_CORRECTIONS})`);
        const exit = await context.runAgain(correctionPrompt(failing, size));
        endFix(exit.ok ? "done" : "failed", exit.ok ? undefined : exit.message);
        if (!exit.ok) break;
        // A correction that did not rewrite the page list keeps the pages it had.
        const corrected = readManifest(
          readJson(path.join(folder, "out", "result.json")) ?? {},
          usecase?.pages[0] ?? "design",
        );
        manifest = corrected.pages.length ? corrected : { ...corrected, pages: manifest.pages };
      }

    } catch (error) {
      // No browser could render here: the person still gets the design, as a web page.
      if (!(error instanceof RenderError)) throw error;
      return unrenderedResult(folder, manifest, run.request, usecase, error.message);
    }
    const outputs = await publish(rendered, manifest, usecase, folder, size, renderer);
    // What later edits need to know which texts a marked area holds.
    saveLayout(folder, {
      pages: rendered.map(({ page, result }) => ({
        name: page.name,
        html: page.html,
        width: size.width,
        height: size.height,
        boxes: result.boxes.map(({ text, x, y, width, height }) => ({ text, x, y, width, height })),
      })),
    });
    const passed = checks.every((check) => check.passed);
    return {
      outputs,
      checks: checks.map((check) => ({ ...check })),
      summary: `${usecase ? usecase.format.charAt(0).toUpperCase() + usecase.format.slice(1) : "Design"} at ${size.width}×${size.height}${passed ? ", all checks passed" : ", with issues"}.`,
    };
  };
}

function readJson(file: string): Record<string, unknown> | undefined {
  try {
    return JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

async function runChecks(
  rendered: Rendered[],
  manifest: CreativeManifest,
  usecase: Usecase | undefined,
  request: Record<string, unknown>,
  size: { width: number; height: number },
  folder: string,
  home: string,
  definition?: Definition,
): Promise<CheckResult[]> {
  const text = rendered.map((item) => item.result.text).join("\n");
  const source = requestText(request);
  const results: CheckResult[] = [checkFacts(text, source), checkQuotes(text, quotedText(request))];
  const items = [
    ...strings(request.items),
    ...strings(request.contact_lines),
    ...(definition?.inventory ?? []),
  ];
  if (items.length) results.push(checkInventory(text, items));
  for (const { page, result } of rendered) {
    const prefix = rendered.length > 1 ? `${page.name}: ` : "";
    const contrast = checkContrast(result.boxes, decodePng(result.background));
    const layout = checkLayout(
      result.boxes,
      { width: result.scrollWidth, height: result.scrollHeight },
      size,
    );
    if (page.width && page.height && (page.width !== size.width || page.height !== size.height))
      layout.findings.push(
        `The page says ${page.width}×${page.height} px but this ${usecase?.format ?? "design"} must be ${size.width}×${size.height} px.`,
      );
    layout.passed = layout.findings.length === 0;
    results.push(
      { ...contrast, findings: contrast.findings.map((f) => prefix + f) },
      { ...layout, findings: layout.findings.map((f) => prefix + f) },
    );
  }
  if (definition && !usecase) {
    const missing = definition.pages.filter(
      (name) => !rendered.some((item) => item.page.name === name),
    );
    // A required part that names its content in brackets ("Date (14/12/2026)") must show that
    // content; parts described only in words are left to the agent's self-check.
    const named = definition.requiredParts.flatMap((part) =>
      [...part.matchAll(/\(([^()]{2,})\)/g)].map(([, value = ""]) => ({ part, value: value.trim() })),
    );
    const designText = text.toLowerCase();
    results.push(
      checkParts([
        ...missing.map((name) => ({ name: `${name} page`, ok: false })),
        ...named.map(({ part, value }) => ({
          name: part,
          ok: value.split(/,\s*/).every((piece) => designText.includes(piece.toLowerCase())),
        })),
      ]),
    );
  }
  if (usecase) {
    const parts = usecase.requiredParts.map((part) => ({
      name: part.name,
      ok: part.test(text, request),
    }));
    for (const name of usecase.pages)
      parts.push({
        name: `${name} page`,
        ok: usecase.pages.length === 1 || rendered.some((item) => item.page.name === name),
      });
    // A usecase that ships a vector (logos) must deliver it.
    if (usecase.outputs.includes("svg"))
      parts.push({
        name: "vector file (the manifest's `vector`)",
        ok: Boolean(manifest.vector && existsSync(path.join(folder, manifest.vector))),
      });
    results.push(checkParts(parts));
  }
  if (manifest.visual && existsSync(path.join(folder, manifest.visual)))
    results.push(checkVisualText(await recognizeText(home, path.join(folder, manifest.visual))));
  return results.map((check) => ({
    ...check,
    passed:
      check.findings.length === 0 ||
      (check.passed && check.findings.every((f) => f.startsWith("Not checked"))),
  }));
}

function correctionPrompt(failing: CheckResult[], size: { width: number; height: number }): string {
  const findings = failing
    .flatMap((check) => check.findings.map((finding) => `- ${finding}`))
    .join("\n");
  return [
    "Seleya checked the design you made in this folder and found problems. Fix ONLY these, keep everything else the same:",
    findings,
    `The design must stay exactly ${size.width}×${size.height} px. Follow skills/PROGRESS.md: report a step "Fixing the design" (active, then done).`,
    "When done, rewrite out/result.json (same format) so Seleya renders and checks it again.",
  ].join("\n");
}

async function publish(
  rendered: Rendered[],
  manifest: CreativeManifest,
  usecase: Usecase | undefined,
  folder: string,
  size: { width: number; height: number },
  renderer: ChromeRenderer,
): Promise<RunOutput[]> {
  const outputs: RunOutput[] = [];
  // Custom designs (spec 007 FR-009): every page as PNG plus one PDF.
  const formats = usecase?.outputs ?? ["png", "pdf"];
  for (const { page, result } of rendered) {
    const file = path.join("out", `${page.name}.png`);
    writeFileSync(path.join(folder, file), result.png);
    outputs.push({ path: file, kind: "png", slot: page.name, state: "final" });
  }
  if (formats.includes("pdf")) {
    // A PDF that cannot be printed is left out; the PNGs are already there.
    const print = async () =>
      rendered.length === 1
        ? (await renderer.render(path.join(folder, rendered[0]!.page.html), size.width, size.height, { pdf: true }))
            .pdf
        : await renderer.pdfOfPages(
            folder,
            rendered.map((item) => path.join(folder, item.page.html)),
            size.width,
            size.height,
          );
    const pdf = await print().catch((error: unknown) => {
      if (error instanceof RenderError) return undefined;
      throw error;
    });
    if (pdf) {
      const file = path.join("out", `${usecase?.format ?? "design"}.pdf`);
      writeFileSync(path.join(folder, file), pdf);
      outputs.push({ path: file, kind: "pdf", slot: "print", state: "final" });
    }
  }
  if (
    formats.includes("svg") &&
    manifest.vector &&
    existsSync(path.join(folder, manifest.vector))
  ) {
    outputs.push({ path: manifest.vector, kind: "svg", slot: "vector", state: "final" });
  }
  if (manifest.visual && existsSync(path.join(folder, manifest.visual)))
    outputs.push({ path: manifest.visual, kind: kindOfPicture(manifest.visual), slot: "visual", state: "final" });
  return outputs;
}

/** Replaces visible text only (between tags), never markup or attributes (spec 004 FR-018). */
export function replaceText(
  html: string,
  replacements: { from: string; to: string }[],
): { html: string; count: number } {
  let count = 0;
  const escape = (text: string) =>
    text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const out = html.replace(/>([^<]+)</g, (whole, text: string) => {
    let next = text;
    for (const { from, to } of replacements) {
      const needle = escape(from);
      if (needle && next.includes(needle)) {
        count += next.split(needle).length - 1;
        next = next.split(needle).join(escape(to));
      }
    }
    return next === text ? whole : `>${next}<`;
  });
  return { html: out, count };
}

/**
 * Re-renders and re-checks a finished design after a text edit, with no agent (FR-018): pages are
 * read from its manifest, outputs are rewritten in place, the previous version is kept under
 * out/versions/v<n>/.
 */
export async function rerenderDesign(
  renderer: ChromeRenderer,
  home: string,
  folder: string,
  run: { skill: string; request: Record<string, unknown> },
  replacements: { from: string; to: string }[],
  /** The skills the run could use (its recipe's settings give the size), spec 009. */
  skills: Map<string, SkillMeta>,
): Promise<{ outputs: RunOutput[]; checks: CheckResult[]; changed: number }> {
  const manifest = readManifest(readJson(path.join(folder, "out", "result.json")) ?? {}, "design");
  const skillName = str(readJson(path.join(folder, "out", "result.json"))?.skill) ?? run.skill;
  const usecase = usecaseFor(skills, skillName);
  const definition = readDefinition(folder);
  const size =
    definition?.size && !(Number(run.request.width) > 0)
      ? definition.size
      : expectedSize(run.request, usecase);
  let changed = 0;
  for (const page of manifest.pages) {
    const file = path.join(folder, page.html);
    const result = replaceText(readFileSync(file, "utf8"), replacements);
    changed += result.count;
    writeFileSync(file, result.html);
  }
  const rendered: Rendered[] = [];
  for (const page of manifest.pages)
    rendered.push({
      page,
      result: await renderer.render(path.join(folder, page.html), size.width, size.height, {
        keepTogether: manifest.keepTogether,
      }),
    });
  const checks = await runChecks(
    rendered,
    manifest,
    usecase,
    run.request,
    size,
    folder,
    home,
    definition,
  );
  const outputs = await publish(rendered, manifest, usecase, folder, size, renderer);
  return { outputs, checks, changed };
}

/**
 * While a design is being made, each page written in out/ is shown as an image (the pipeline shows
 * it on its colours before the picture is ready, docs/generation-perf-log.md E4).
 */
export function pageDraftRenderer(renderer: ChromeRenderer): DraftRenderer {
  return async (draft, folder, run) => {
    if (!/^out\/[A-Za-z0-9_-]+\.html$/.test(draft.path)) return undefined;
    const file = containedPath(folder, draft.path);
    if (!file || !existsSync(file)) return undefined;
    const size = expectedSize(run.request, undefined);
    const result = await renderer.render(file, size.width, size.height, {});
    const png = draft.path.replace(/\.html$/, ".draft.png");
    writeFileSync(path.join(folder, png), result.png);
    return { path: png, kind: "png", slot: draft.slot, state: "draft" };
  };
}

/**
 * The result when no browser could render (docs/generation-perf-log.md): each page as a web page
 * with its local pictures embedded (`<page>.preview.html`, viewable as it is), the checks that need
 * no rendering, and a finding that says what is missing.
 */
function unrenderedResult(
  folder: string,
  manifest: CreativeManifest,
  request: Record<string, unknown>,
  usecase: Usecase | undefined,
  reason: string,
): PostProcessResult {
  const outputs: RunOutput[] = [];
  let text = "";
  for (const page of manifest.pages) {
    const file = containedPath(folder, page.html);
    if (!file || !existsSync(file)) continue;
    const html = embedPictures(readFileSync(file, "utf8"), path.dirname(file));
    const preview = page.html.replace(/\.html$/, ".preview.html");
    writeFileSync(path.join(folder, preview), html);
    outputs.push({ path: preview, kind: "html", slot: page.name, state: "final" });
    text += `${visibleText(html)}\n`;
  }
  if (manifest.visual && existsSync(path.join(folder, manifest.visual)))
    outputs.push({ path: manifest.visual, kind: kindOfPicture(manifest.visual), slot: "visual", state: "final" });
  const checks: CheckResult[] = [
    checkFacts(text, requestText(request)),
    checkQuotes(text, quotedText(request)),
    {
      name: "rendering",
      passed: false,
      findings: [
        `Not rendered on this computer (${reason}). The design is shown as a web page; PNG and PDF, contrast and layout checks need Google Chrome, Chromium, Edge or Brave.`,
      ],
      attempt: 0,
    },
  ];
  return {
    outputs,
    checks,
    summary: `${usecase ? usecase.format.charAt(0).toUpperCase() + usecase.format.slice(1) : "Design"} as a web page (not rendered).`,
  };
}

const kindOfPicture = (file: string) => (path.extname(file).slice(1).toLowerCase() || "png").replace("jpeg", "jpg");

/** The page with its local pictures (`url('visual.jpg')`, `src="x.png"`) as data URLs. */
export function embedPictures(html: string, dir: string): string {
  return html.replace(/(url\(\s*['"]?|src=["'])([^'")\s]+\.(?:png|jpe?g|webp|svg))/gi, (match, lead: string, ref: string) => {
    if (/^[a-z]+:/i.test(ref) || ref.startsWith("/")) return match;
    const file = path.join(dir, ref);
    if (!file.startsWith(dir + path.sep) || !existsSync(file)) return match;
    const type = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", svg: "image/svg+xml" }[
      path.extname(file).slice(1).toLowerCase()
    ];
    return `${lead}data:${type};base64,${readFileSync(file).toString("base64")}`;
  });
}

/** The words a page shows (markup, styles and scripts removed), for the checks that need no render. */
function visibleText(html: string): string {
  return html
    .replace(/<(style|script|head)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ");
}

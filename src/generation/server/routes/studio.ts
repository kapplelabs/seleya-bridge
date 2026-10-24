import { randomBytes } from "node:crypto";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import type { ServerResponse } from "node:http";
import path from "node:path";

import { rerenderDesign } from "../../creative/postprocess.ts";
import { sizeForRatio, usecaseFor, usecaseOf } from "../../creative/usecases.ts";
import type { ChromeRenderer } from "../../render/chrome.ts";
import { fileUrl } from "../../runs/events.ts";
import { RunError, type RunManager } from "../../runs/manager.ts";
import type { GenerationRow, Store } from "../../runs/store.ts";
import type { RunRow } from "../../runs/types.ts";
import type { SkillMeta } from "../../skills.ts";
import { type Route, sendJson } from "../http.ts";

/**
 * Creative Studio on Seleya Local (spec 004): one Generation per request, one run per variation,
 * in the shape Seleya's Studio already reads (server-api-spec §3.13, plus image URLs and files).
 */
const str = (value: unknown) => (typeof value === "string" ? value.trim() : "");
const lines = (value: unknown) =>
  (Array.isArray(value) ? value : typeof value === "string" ? value.split("\n") : [])
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter(Boolean);

/** The first clause of the brief, cut at a word boundary (≤ 60 characters). */
export function shortTitle(prompt: string): string {
  const clause = (prompt.split(/[.!?\n]|\s[—–-]\s/)[0] ?? "").trim();
  if (clause.length <= 60) return clause;
  const cut = clause.slice(0, 60);
  return `${cut.slice(0, cut.lastIndexOf(" ")).trim()}…`;
}

function generationStatus(runs: RunRow[]): "queued" | "running" | "completed" | "failed" {
  if (runs.some((run) => run.localStatus === "running")) return "running";
  if (runs.some((run) => run.localStatus === "queued")) return "queued";
  if (
    runs.some(
      (run) => run.localStatus === "completed" || run.localStatus === "completed_with_issues",
    )
  )
    return "completed";
  return "failed";
}

export function generationJson(generation: GenerationRow, runs: RunRow[]) {
  const request = generation.request;
  const images = runs.flatMap((run, index) => {
    const png = run.outputs.find(
      (output) => output.kind === "png" && output.state === "final" && output.slot !== "visual",
    );
    // Not rendered on this computer: the design is shown as its web page (creative/postprocess.ts).
    const page = png
      ? undefined
      : run.outputs.find((output) => output.kind === "html" && output.state === "final");
    const shown = png ?? page;
    if (!shown) return [];
    const width = Number(run.request.width) || 0;
    const height = Number(run.request.height) || 0;
    return [
      {
        id: `${run.id}:img`,
        generation_id: generation.id,
        run_id: run.id,
        format: request.format,
        aspect_ratio: request.aspect_ratio,
        width,
        height,
        seed: Number(request.seed) || index + 1,
        version: run.attempt,
        url: fileUrl(run.id, shown.path),
        thumbnail_url: fileUrl(run.id, shown.path),
        preview: page ? "html" : "image",
        files: run.outputs
          .filter((output) => output.state === "final" && output.slot !== "visual")
          .map((output) => ({
            kind: output.kind,
            label: output.slot ?? output.kind,
            url: fileUrl(run.id, output.path),
          })),
        checks: run.checks,
        has_issues: run.localStatus === "completed_with_issues",
        // Ready on its colours; the picture is still being made (the page refreshes when it lands).
        picture_pending: run.phase === "picture",
      },
    ];
  });
  return {
    id: generation.id,
    title: generation.title,
    created_at: new Date(generation.createdAt).toISOString(),
    status: generationStatus(runs),
    request,
    run_ids: generation.runIds,
    images,
  };
}

/** A request as kept with a generation: the recipe's files are not repeated there. */
const withoutRecipe = (input: Record<string, unknown>) => {
  const { recipe: _recipe, ...rest } = input;
  return rest;
};

export function studioRoutes(
  store: Store,
  manager: RunManager,
  skills: () => Map<string, SkillMeta>,
  options: {
    runsDir: string;
    home: string;
    renderer?: () => ChromeRenderer;
    /** Verifies and keeps a signed recipe sent with a request (spec 009). */
    acceptRecipe?: (raw: unknown) => { digest: string; id: string; version: string };
  } = {
    runsDir: "",
    home: "",
  },
): Route[] {
  /** The request fields that tie a run to the recipe Seleya sent with it (spec 009 FR-007). */
  const recipeOf = (input: Record<string, unknown>) => {
    if (!input.recipe) return undefined;
    if (!options.acceptRecipe)
      throw new RunError("no_recipes", "This runtime does not take recipes.", 400);
    const accepted = options.acceptRecipe(input.recipe);
    return {
      id: accepted.id,
      fields: {
        recipe_digest: accepted.digest,
        recipe_id: accepted.id,
        recipe_version: accepted.version,
      },
    };
  };
  /** A finished design to build a new version from (spec 004 US5). */
  const finishedDesign = (runId: string) => {
    const run = manager.get(runId);
    if (!["completed", "completed_with_issues"].includes(run.localStatus))
      throw new RunError("not_finished", "Edit a design once it has finished.", 409);
    return run;
  };
  const versionRun = (source: RunRow, title: string, request: Record<string, unknown>) => {
    const run = manager.create(
      { skill: source.skill, title, request, harness: str(source.harness) || undefined },
      undefined,
      source,
    );
    const generation = store.addRunToGenerationOf(source.id, run.id);
    return { run_id: run.id, generation_id: generation?.id };
  };
  const runsOf = (generation: GenerationRow) =>
    generation.runIds.map((id) => store.getRun(id)).filter((run): run is RunRow => Boolean(run));

  /** Custom (spec 007): the generic skill, or a skill the user saved from a custom design. */
  const createCustom = (input: Record<string, unknown>, response: ServerResponse) => {
    const prompt = str(input.prompt);
    if (prompt.length < 8)
      throw new RunError(
        "prompt_too_short",
        "Describe what you want in at least 8 characters.",
        400,
      );
    // The generic recipe (spec 009), or a skill the user saved; a saved skill still gets the
    // recipe's shared procedures when the page sends it along.
    const recipe = recipeOf(input);
    const chosen = str(input.skill) || recipe?.id || "virtual-creative-usecase";
    const skill = manager.skillsOf(recipe?.fields ?? {}).get(chosen);
    if (!skill) throw new RunError("unknown_skill", `There is no skill named "${chosen}".`, 400);
    const variations = Math.min(4, Math.max(1, Number(input.variations) || 1));
    const title = str(input.title) || `${skill.title} · ${shortTitle(prompt) || "untitled"}`;
    const runs = Array.from({ length: variations }, (_, index) =>
      manager.create({
        skill: skill.name,
        title: variations > 1 ? `${title} (${index + 1}/${variations})` : title,
        request: {
          prompt,
          style: str(input.style) || undefined,
          width: Number(input.width) || undefined,
          height: Number(input.height) || undefined,
          pages: Number(input.pages) || undefined,
          negative_prompt: str(input.negative_prompt) || undefined,
          brand_kit: input.use_brand_kit ? input.brand_kit : undefined,
          variation: index + 1,
          of: variations,
          ...recipe?.fields,
        },
        harness: str(input.harness) || undefined,
      }),
    );
    const generation: GenerationRow = {
      id: `gen_${Date.now().toString(36)}${randomBytes(2).toString("hex")}`,
      title,
      request: { ...withoutRecipe(input), format: "custom", skill: skill.name },
      runIds: runs.map((run) => run.id),
      createdAt: Date.now(),
    };
    store.insertGeneration(generation);
    return sendJson(response, 202, generationJson(generation, runs));
  };

  return [
    {
      // Edit a design with an instruction, optionally limited to a marked area (fractions 0–1).
      method: "POST",
      pattern: /^\/studio\/images\/([A-Za-z0-9_-]+)\/edit$/,
      handle: async ({ params: [id = ""], body, response }) => {
        const source = finishedDesign(id);
        const input = await body();
        const instruction = str(input.instruction);
        if (instruction.length < 3)
          throw new RunError("no_instruction", "Say what to change.", 400);
        const region = typeof input.region === "object" && input.region ? input.region : undefined;
        return sendJson(
          response,
          202,
          versionRun(source, `${source.title} · edit`, {
            ...source.request,
            edit_instruction: instruction,
            edit_region: region,
          }),
        );
      },
    },
    {
      // Spec 007 FR-005: the person corrects a custom design's definition; a new version is made
      // from exactly that definition (the agent does not redefine it).
      method: "POST",
      pattern: /^\/studio\/images\/([A-Za-z0-9_-]+)\/definition$/,
      handle: async ({ params: [id = ""], body, response }) => {
        const source = finishedDesign(id);
        const input = await body();
        const sourceFile = path.join(options.runsDir, source.id, "out", "definition.json");
        if (!existsSync(sourceFile))
          throw new RunError("not_custom", "Only custom designs have a definition to edit.", 409);
        const previous = JSON.parse(readFileSync(sourceFile, "utf8")) as Record<string, unknown>;
        const lines = (value: unknown) =>
          Array.isArray(value)
            ? value
                .filter((item): item is string => typeof item === "string" && item.trim() !== "")
                .map((item) => item.trim())
            : undefined;
        const size = (input.size ?? {}) as Record<string, unknown>;
        const width = Math.min(6000, Number(size.width_px) || 0);
        const height = Math.min(6000, Number(size.height_px) || 0);
        const previousSize = (previous.size ?? {}) as Record<string, unknown>;
        const definition: Record<string, unknown> = {
          ...previous,
          size:
            width > 0 && height > 0
              ? { ...previousSize, width_px: width, height_px: height, why: "Set by you" }
              : previousSize,
          content_inventory: lines(input.content_inventory) ?? previous.content_inventory,
          required_parts: lines(input.required_parts) ?? previous.required_parts,
          assumptions: lines(input.assumptions) ?? previous.assumptions,
        };
        // Pages keep their names; a new size applies to every page.
        if (width > 0 && height > 0 && Array.isArray(definition.pages))
          definition.pages = (definition.pages as Record<string, unknown>[]).map((page) => ({
            ...page,
            width,
            height,
          }));
        const created = versionRun(source, `${source.title} · edited definition`, {
          ...source.request,
          definition_edited: true,
          width: width || source.request.width,
          height: height || source.request.height,
        });
        // The new run's folder already holds the source's outputs; its definition is the edited one.
        mkdirSync(path.join(options.runsDir, created.run_id, "out"), { recursive: true });
        writeFileSync(
          path.join(options.runsDir, created.run_id, "out", "definition.json"),
          JSON.stringify(definition, null, 2),
        );
        return sendJson(response, 202, created);
      },
    },
    {
      // The same content laid out for another size or format size id.
      method: "POST",
      pattern: /^\/studio\/images\/([A-Za-z0-9_-]+)\/resize$/,
      handle: async ({ params: [id = ""], body, response }) => {
        const source = finishedDesign(id);
        const input = await body();
        const usecase = usecaseFor(manager.skillsOf(source.request), source.skill);
        const preset = usecase?.sizes.find((item) => item.id === str(input.size));
        const width = preset?.width ?? Number(input.width);
        const height = preset?.height ?? Number(input.height);
        if (!(width > 0 && height > 0))
          throw new RunError("no_size", "Choose a size to resize to.", 400);
        return sendJson(
          response,
          202,
          versionRun(source, `${source.title} · ${width}×${height}`, {
            ...source.request,
            size: preset?.id ?? `${width}x${height}`,
            width,
            height,
            resize_from: `${Number(source.request.width) || ""}×${Number(source.request.height) || ""}`,
          }),
        );
      },
    },
    {
      // Text-only change: no agent, re-render in place (FR-018); the previous version is kept.
      method: "POST",
      pattern: /^\/studio\/images\/([A-Za-z0-9_-]+)\/text$/,
      handle: async ({ params: [id = ""], body }) => {
        const run = finishedDesign(id);
        if (!options.renderer)
          throw new RunError("no_renderer", "Rendering is not available.", 503);
        const input = await body();
        const replacements = Array.isArray(input.replacements)
          ? input.replacements.flatMap((item) => {
              const value = (item ?? {}) as Record<string, unknown>;
              return typeof value.from === "string" && typeof value.to === "string" && value.from
                ? [{ from: value.from, to: value.to }]
                : [];
            })
          : [];
        if (!replacements.length)
          throw new RunError("no_change", "Give at least one text to replace.", 400);
        const folder = path.join(options.runsDir, run.id);
        const version = path.join(folder, "out", "versions", `v${Date.now().toString(36)}`);
        mkdirSync(version, { recursive: true });
        for (const output of run.outputs.filter((item) => item.state === "final"))
          if (existsSync(path.join(folder, output.path)))
            cpSync(path.join(folder, output.path), path.join(version, path.basename(output.path)));
        const result = await rerenderDesign(
          options.renderer(),
          options.home,
          folder,
          run,
          replacements,
          manager.skillsOf(run.request),
        );
        if (result.changed === 0) {
          rmSync(version, { recursive: true, force: true }); // nothing changed: no version to keep
          throw new RunError("not_found", "None of those texts are on the design.", 404);
        }
        store.updateRun(run.id, {
          outputs: result.outputs,
          checks: result.checks,
          finishedAt: Date.now(),
        });
        const generation = store.listGenerations(500).find((item) => item.runIds.includes(run.id));
        return generation
          ? generationJson(generation, runsOf(generation))
          : { run_id: run.id, changed: result.changed };
      },
    },
    {
      method: "POST",
      pattern: /^\/studio\/generations$/,
      handle: async ({ body, response }) => {
        const input = await body();
        const format = str(input.format);
        if (format === "custom") return createCustom(input, response);
        const recipe = recipeOf(input);
        const runSkills = manager.skillsOf(recipe?.fields ?? {});
        const usecase = recipe
          ? usecaseFor(runSkills, recipe.id)
          : [...runSkills.values()].map(usecaseOf).find((item) => item?.format === format);
        if (!usecase)
          throw new RunError(
            "unsupported_format",
            `"${format}" cannot be generated locally yet.`,
            400,
          );
        const prompt = str(input.prompt);
        const fields = (typeof input.fields === "object" && input.fields) || {};
        const items = lines(input.items);
        const contactLines = lines(input.contact_lines);
        if (
          prompt.length < 8 &&
          items.length === 0 &&
          contactLines.length === 0 &&
          Object.keys(fields).length === 0
        )
          throw new RunError(
            "prompt_too_short",
            "Describe what you want in at least 8 characters.",
            400,
          );
        const variations = Math.min(4, Math.max(1, Number(input.variations) || 1));
        const sizeId = str(input.size);
        const size =
          usecase.sizes.find((item) => item.id === sizeId) ??
          (usecase.sizes.length === 1 && str(input.aspect_ratio) && !usecase.fixedSize
            ? { id: str(input.aspect_ratio), ...sizeForRatio(str(input.aspect_ratio)) }
            : usecase.sizes[0]);
        if (!size) throw new RunError("no_size", `"${format}" has no size to make.`, 500);
        const title =
          str(input.title) ||
          `${runSkills.get(usecase.skill)?.title ?? usecase.format} · ${shortTitle(prompt) || "untitled"}`;
        const shared = {
          prompt,
          fields,
          style: str(input.style) || undefined,
          size: size.id,
          width: size.width,
          height: size.height,
          negative_prompt: str(input.negative_prompt) || undefined,
          seed: input.seed,
          items: items.length ? items : undefined,
          contact_lines: contactLines.length ? contactLines : undefined,
          cta: str(input.cta) || undefined,
          brand_name: str(input.brand_name) || undefined,
          brand_kit: input.use_brand_kit ? input.brand_kit : undefined,
          refine_from: str(input.refine_from_run_id) || undefined,
          ...recipe?.fields,
        };
        const runs = Array.from({ length: variations }, (_, index) =>
          manager.create({
            skill: usecase.skill,
            title: variations > 1 ? `${title} (${index + 1}/${variations})` : title,
            request: { ...shared, variation: index + 1, of: variations },
            harness: str(input.harness) || undefined,
          }),
        );
        const generation: GenerationRow = {
          id: `gen_${Date.now().toString(36)}${randomBytes(2).toString("hex")}`,
          title,
          request: {
            ...withoutRecipe(input),
            format,
            size: size.id,
            aspect_ratio: str(input.aspect_ratio) || size.id,
          },
          runIds: runs.map((run) => run.id),
          createdAt: Date.now(),
        };
        store.insertGeneration(generation);
        return sendJson(response, 202, generationJson(generation, runs));
      },
    },
    {
      method: "GET",
      pattern: /^\/studio\/generations$/,
      handle: () => ({
        items: store
          .listGenerations(50)
          .map((generation) => generationJson(generation, runsOf(generation))),
      }),
    },
    {
      method: "GET",
      pattern: /^\/studio\/generations\/([A-Za-z0-9_-]+)$/,
      handle: ({ params: [id = ""] }) => {
        const generation = store.getGeneration(id);
        if (!generation) throw new RunError("not_found", "No such generation.", 404);
        return generationJson(generation, runsOf(generation));
      },
    },
    {
      // What each Studio format can make locally: sizes, outputs, whether it needs an image agent.
      method: "GET",
      pattern: /^\/studio\/usecases$/,
      handle: () =>
        // Seleya lists usecases from its catalog (spec 009); this lists recipes the runtime holds.
        [...skills().values()].flatMap((skill) => {
          const usecase = usecaseOf(skill);
          if (!usecase) return [];
          return {
            format: usecase.format,
            skill: usecase.skill,
            title: skill?.title ?? usecase.skill,
            sizes: usecase.sizes,
            pages: usecase.pages,
            needs_image: usecase.needsVisual,
            outputs: usecase.outputs,
            typical_ms: skill?.typicalMs,
          };
        }),
    },
  ];
}

import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

import type { LocalConfig } from "../../config.ts";
import { RunError, type RunManager } from "../../runs/manager.ts";
import { skillJson, type SkillMeta } from "../../skills.ts";
import type { Route } from "../http.ts";

/**
 * Saving a custom design as a named skill (spec 007 FR-010/FR-011). Saved skills live in
 * `<home>/skills`, are routable by the orchestrator and listed with the shipped ones.
 */
export const slugify = (title: string) =>
  title
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/gi, "d")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 40);

const readJson = (file: string): Record<string, unknown> => {
  try {
    return JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
  } catch {
    return {};
  }
};

export function savedSkillMarkdown(options: {
  name: string;
  title: string;
  runId: string;
  definition: Record<string, unknown>;
  concept: Record<string, unknown>;
}): string {
  const { name, title, runId, definition, concept } = options;
  const deliverable = typeof definition.deliverable === "string" ? definition.deliverable : title;
  const needsVisual = definition.needs_visual === true;
  const reference = {
    deliverable,
    size: definition.size,
    pages: definition.pages,
    needs_visual: needsVisual,
    required_parts: definition.required_parts,
  };
  const steps = [
    "Defining the design",
    "Writing the brief",
    "Choosing a direction",
    ...(needsVisual ? ["Generating the visual"] : []),
    "Laying out the design",
    "Rendering",
    "Checking the design",
  ];
  return `---
name: ${name}
version: 1.0.0
title: ${title.replace(/\n/g, " ")}
description: ${deliverable.replace(/\n/g, " ")} (saved from a custom design you liked).
planned_steps: [${steps.join(", ")}]
needs_image: ${needsVisual}
typical_ms: [180000, 420000]
saved_from: ${runId}
---
# ${title}

This skill was saved from a custom design. Follow \`skills/virtual-creative-usecase/SKILL.md\` exactly, with two differences:

1. In "Defining the design", start from this reference definition. Keep its deliverable, size, pages and required parts unless the request says otherwise. Take **all content** (names, dates, places, text) from the new request, never from the reference:

\`\`\`json
${JSON.stringify(reference, null, 2)}
\`\`\`

2. In "Choosing a direction", the direction that worked before was:

\`\`\`json
${JSON.stringify(concept, null, 2)}
\`\`\`

Reuse its spirit (style, typography, palette) unless the request asks for something else.

The manifest's \`"skill"\` is \`"${name}"\`.
`;
}

export function skillRoutes(
  config: LocalConfig,
  manager: RunManager,
  skills: () => Map<string, SkillMeta>,
  reload: () => void,
): Route[] {
  return [
    {
      method: "POST",
      pattern: /^\/local\/skills\/from-run\/([A-Za-z0-9_-]+)$/,
      handle: async ({ params: [runId = ""], body }) => {
        const run = manager.get(runId);
        if (!["completed", "completed_with_issues"].includes(run.localStatus))
          throw new RunError("not_finished", "Save a design as a skill once it has finished.", 409);
        const folder = path.join(config.runsDir, run.id);
        const definition = readJson(path.join(folder, "out", "definition.json"));
        if (!Object.keys(definition).length)
          throw new RunError(
            "not_custom",
            "Only custom designs (with a definition) can be saved as a skill.",
            400,
          );
        const input = await body();
        const title =
          typeof input.title === "string" && input.title.trim()
            ? input.title.trim()
            : String(definition.deliverable ?? "Saved design");
        const name = slugify(title);
        if (!name)
          throw new RunError("bad_name", "Give the skill a name with letters or numbers.", 400);
        if (existsSync(path.join(config.skillsDir, name)) || skills().has(name))
          throw new RunError("name_taken", `There is already a skill called "${name}".`, 409);
        const dir = path.join(config.userSkillsDir, name);
        mkdirSync(dir, { recursive: true });
        writeFileSync(
          path.join(dir, "SKILL.md"),
          savedSkillMarkdown({
            name,
            title,
            runId: run.id,
            definition,
            concept: readJson(path.join(folder, "out", "concept.json")),
          }),
        );
        // The procedure a saved design follows came with the recipe it was made from (spec 009):
        // keep a copy beside the saved skills so they still run without that recipe.
        const procedure = path.join(folder, "skills", "CREATIVE.md");
        if (existsSync(procedure) && !existsSync(path.join(config.userSkillsDir, "CREATIVE.md")))
          copyFileSync(procedure, path.join(config.userSkillsDir, "CREATIVE.md"));
        reload();
        const skill = skills().get(name);
        if (!skill) throw new RunError("save_failed", "The skill could not be read back.", 500);
        return { ...skillJson(skill), saved: true };
      },
    },
    {
      method: "DELETE",
      pattern: /^\/local\/skills\/([a-z0-9-]+)$/,
      handle: ({ params: [name = ""] }) => {
        const dir = path.join(config.userSkillsDir, name);
        if (!existsSync(path.join(dir, "SKILL.md")))
          throw new RunError("not_saved", "Only skills you saved can be deleted.", 404);
        rmSync(dir, { recursive: true, force: true });
        reload();
        return { deleted: name };
      },
    },
  ];
}

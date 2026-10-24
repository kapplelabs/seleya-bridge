import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { MEDIA_KINDS, mediaKinds } from "./media/catalog.ts";

/** What a skill declares in its SKILL.md front matter (contracts/progress-protocol.md). */
export interface SkillMeta {
  name: string;
  version: string;
  title: string;
  description: string;
  plannedSteps: string[];
  /** Media kinds the skill uses (spec 008); `needs_image: true` in older skills means image. */
  needs: string[];
  /** Kinds it cannot do without: no agent for one → the run is refused (D4). Others fall back. */
  mediaRequired: string[];
  /**
   * inline: the agent running the skill makes the media itself (posters);
   * delegated: the skill writes media jobs and Seleya has capable agents make them (slides).
   */
  media: "inline" | "delegated";
  /** Same as needs.includes("image"); kept for older callers. */
  needsImage: boolean;
  resumable: boolean;
  timeLimitMs: number;
  typicalMs: [number, number];
  /** Folder of the skill, absolute. */
  dir: string;
  /**
   * What the engine needs to know about the usecase (spec 009): the recipe's `recipe.json` beside
   * its SKILL.md — result shape, sizes, pages, checks… Absent for internal and older skills.
   */
  settings?: Record<string, unknown>;
  /** The signed recipe this skill came from (spec 009), when it came from Seleya. */
  recipe?: { digest: string; version: string };
}

/**
 * Parses the small YAML subset skills use: `key: value`, `key: [a, b]` (also spread over several
 * lines, as formatters write it) and block lists (`key:` then `- a` lines).
 */
export function parseFrontMatter(text: string): Record<string, string | string[]> {
  const match = /^---\n([\s\S]*?)\n---/.exec(text);
  const values: Record<string, string | string[]> = {};
  if (!match) return values;
  const unquote = (item: string) => item.trim().replace(/^["']|["']$/g, "");
  const lines = (match[1] ?? "").split("\n");
  for (let index = 0; index < lines.length; index++) {
    const pair = /^([a-z_]+):\s*(.*)$/.exec(lines[index]!.trim());
    if (!pair) continue;
    const [, key = "", value = ""] = pair;
    let raw = value.trim();
    // A flow list may start on the next line (`key:` then `  [`).
    if (raw === "" && lines[index + 1]?.trim().startsWith("[")) raw = lines[++index]!.trim();
    if (raw.startsWith("[")) {
      while (!raw.includes("]") && index + 1 < lines.length) raw += ` ${lines[++index]!.trim()}`;
      values[key] = raw.slice(1, raw.lastIndexOf("]")).split(",").map(unquote).filter(Boolean);
    } else if (raw === "") {
      const items: string[] = [];
      while (index + 1 < lines.length && /^\s*-\s+/.test(lines[index + 1]!))
        items.push(unquote(lines[++index]!.replace(/^\s*-\s+/, "")));
      values[key] = items.length ? items : "";
    } else values[key] = unquote(raw);
  }
  return values;
}

const text = (value: string | string[] | undefined, fallback = "") =>
  typeof value === "string" ? value : fallback;
const list = (value: string | string[] | undefined) => (Array.isArray(value) ? value : []);
const num = (value: string | string[] | undefined, fallback: number) => {
  const parsed = Number(text(value));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

function mediaOf(meta: Record<string, string | string[]>) {
  const needs = mediaKinds([
    ...list(meta.needs),
    ...(text(meta.needs_image) === "true" ? ["image"] : []),
  ]);
  return {
    needs,
    mediaRequired: mediaKinds(list(meta.media_required)).filter((kind) => needs.includes(kind)),
    media: text(meta.media) === "delegated" ? ("delegated" as const) : ("inline" as const),
    needsImage: needs.includes("image"),
  };
}

export function loadSkill(dir: string, defaultTimeLimitMs: number): SkillMeta | undefined {
  const file = path.join(dir, "SKILL.md");
  if (!existsSync(file)) return undefined;
  const meta = parseFrontMatter(readFileSync(file, "utf8"));
  const typical = list(meta.typical_ms).map(Number);
  return {
    name: text(meta.name, path.basename(dir)),
    version: text(meta.version, "0.0.0"),
    title: text(meta.title, text(meta.name, path.basename(dir))),
    description: text(meta.description),
    plannedSteps: list(meta.planned_steps),
    ...mediaOf(meta),
    resumable: text(meta.resumable) === "true",
    timeLimitMs: num(meta.time_limit_ms, defaultTimeLimitMs),
    typicalMs:
      typical.length === 2 && typical.every(Number.isFinite)
        ? [typical[0]!, typical[1]!]
        : [120_000, 360_000],
    dir,
    settings: readSettings(dir),
  };
}

function readSettings(dir: string): Record<string, unknown> | undefined {
  const file = path.join(dir, "recipe.json");
  if (!existsSync(file)) return undefined;
  try {
    const value = JSON.parse(readFileSync(file, "utf8")) as unknown;
    return value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

/** Shipped skills plus the user's saved ones (a saved skill never replaces a shipped one). */
export function loadAllSkills(dirs: string[], defaultTimeLimitMs: number): Map<string, SkillMeta> {
  const all = new Map<string, SkillMeta>();
  for (const dir of dirs)
    for (const [name, skill] of loadSkills(dir, defaultTimeLimitMs))
      if (!all.has(name)) all.set(name, skill);
  return all;
}

/** The list the orchestrator reads to pick a skill (written into every run folder). */
/** Which media kinds agents on this computer can make (spec 008 FR-007), by kind. */
export type MediaAvailability = Record<string, string[]>;

export function skillIndex(skills: Map<string, SkillMeta>, media?: MediaAvailability): string {
  const rows = [...skills.values()]
    .filter((skill) => !skill.name.startsWith("_") && skill.name !== "orchestrator")
    .map(
      (skill) =>
        `- \`${skill.name}\` — ${skill.title}: ${skill.description}${skill.needs.length ? ` (uses: ${skill.needs.join(", ")})` : ""}`,
    );
  const section = media
    ? [
        "",
        "## Media this computer can make",
        "",
        ...Object.values(MEDIA_KINDS).map((kind) => {
          const agents = media[kind.id];
          return agents?.length
            ? `- ${kind.id}: yes (${agents.join(", ")})`
            : `- ${kind.id}: **no** — no agent here can make ${kind.plural}. Decline a request that is only about ${kind.plural}, and say so.`;
        }),
      ].join("\n")
    : "";
  return `# Skills available on this computer\n\nPick the one that fits the request best (see skills/orchestrator/SKILL.md).\n\n${rows.join("\n")}\n${section}\n`;
}

/** Every skill shipped in the skills folder (one sub-folder each), by name. */
export function loadSkills(skillsDir: string, defaultTimeLimitMs: number): Map<string, SkillMeta> {
  const skills = new Map<string, SkillMeta>();
  if (!existsSync(skillsDir)) return skills;
  for (const entry of readdirSync(skillsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const skill = loadSkill(path.join(skillsDir, entry.name), defaultTimeLimitMs);
    if (skill) skills.set(skill.name, skill);
  }
  return skills;
}

export function skillJson(skill: SkillMeta) {
  return {
    name: skill.name,
    version: skill.version,
    title: skill.title,
    description: skill.description,
    planned_steps: skill.plannedSteps,
    needs_image: skill.needsImage,
    needs: skill.needs,
    media: skill.media,
    media_required: skill.mediaRequired,
    resumable: skill.resumable,
    time_limit_ms: skill.timeLimitMs,
    typical_ms: skill.typicalMs,
  };
}

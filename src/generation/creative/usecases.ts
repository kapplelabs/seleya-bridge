/**
 * What the engine needs to know about a design usecase: sizes, pages, outputs and required parts.
 * Since spec 009 these come from the recipe Seleya sends (its `recipe.json`), never from a table
 * here, so a new usecase needs no bridge update.
 */
import type { SkillMeta } from "../skills.ts";

export interface UsecaseSize {
  id: string;
  label: string;
  width: number;
  height: number;
}

export interface Usecase {
  skill: string;
  format: string;
  sizes: UsecaseSize[];
  /** Pages the design has (business cards have two faces). */
  pages: string[];
  needsVisual: boolean;
  outputs: string[];
  /** The size is the usecase's own; Studio's aspect ratio does not change it (logo, card, menu). */
  fixedSize: boolean;
  /** Text that must be on the design for it to count as this usecase. */
  requiredParts: {
    name: string;
    test: (text: string, request: Record<string, unknown>) => boolean;
  }[];
}

/** Studio's aspect ratios → pixel sizes with the long side at 1500 px (FR-014). */
export function sizeForRatio(ratio: string, longSide = 1500): { width: number; height: number } {
  const [w, h] = ratio.split(":").map(Number);
  if (!w || !h) return { width: longSide, height: longSide };
  return w >= h
    ? { width: longSide, height: Math.round((longSide * h) / w) }
    : { width: Math.round((longSide * w) / h), height: longSide };
}

const str = (value: unknown) => (typeof value === "string" ? value.trim() : "");
const records = (value: unknown) =>
  Array.isArray(value)
    ? value.filter((item): item is Record<string, unknown> => !!item && typeof item === "object")
    : [];

/**
 * A recipe's required part: `{name, request_field, when_missing}`. The field's text must appear on
 * the design; when the request has no such field, `any_text` asks for some text, `pass` for nothing.
 */
function requiredPart(raw: Record<string, unknown>): Usecase["requiredParts"][number] {
  const field = str(raw.request_field);
  const anyText = raw.when_missing === "any_text";
  return {
    name: str(raw.name) || field,
    test: (text, request) => {
      const value = str(request[field]);
      if (!value) return anyText ? /\S/.test(text) : true;
      return text.toLowerCase().includes(value.toLowerCase());
    },
  };
}

/** The design usecase a skill's recipe describes; undefined for decks, files and custom designs. */
export function usecaseOf(skill: SkillMeta | undefined): Usecase | undefined {
  const settings = skill?.settings;
  if (!skill || !settings || settings.result !== "pages" || settings.definition === true)
    return undefined;
  const sizes = records(settings.sizes)
    .map((size) => ({
      id: str(size.id),
      label: str(size.label) || str(size.id),
      width: Number(size.width),
      height: Number(size.height),
    }))
    .filter((size) => size.id && size.width > 0 && size.height > 0);
  const pages = Array.isArray(settings.pages) ? settings.pages.map(str).filter(Boolean) : [];
  return {
    skill: skill.name,
    format: str(settings.format) || skill.name,
    sizes,
    pages: pages.length ? pages : ["design"],
    needsVisual: skill.needsImage,
    outputs: Array.isArray(settings.outputs) ? settings.outputs.map(str).filter(Boolean) : ["png"],
    fixedSize: settings.fixed_size === true,
    requiredParts: records(settings.required_parts).map(requiredPart),
  };
}

/** The usecase of the skill `name` among the skills a run may use. */
export const usecaseFor = (skills: Map<string, SkillMeta>, name: string) =>
  usecaseOf(skills.get(name));

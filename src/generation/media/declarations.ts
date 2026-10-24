import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { mediaKinds } from "./catalog.ts";

/**
 * Which agents can make which media (spec 008 FR-002, D5). Agents do not report this themselves
 * (nor does Agent Fabric for its workers), so Seleya declares it per agent id; the same id covers
 * the CLI agent and the Fabric worker of that name.
 */
export const DECLARED: Record<string, string[]> = {
  antigravity: ["image"],
  // Documented by OpenAI (Codex image generation); the media broker verifies files and falls back.
  codex: ["image"],
  claude: [],
};

/** `<home>/capabilities.json`: `{"<agent or fabric worker id>": ["image", "audio"]}`, added to the above. */
export function loadOverrides(home: string): Record<string, string[]> {
  const file = path.join(home, "capabilities.json");
  if (!existsSync(file)) return {};
  try {
    const raw = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
    return Object.fromEntries(Object.entries(raw).map(([id, kinds]) => [id, mediaKinds(kinds)]));
  } catch {
    return {};
  }
}

/** Declared plus overridden kinds for one agent id. */
export function capabilitiesOf(
  id: string,
  declared: string[] = DECLARED[id] ?? [],
  overrides: Record<string, string[]> = {},
): string[] {
  return mediaKinds([...declared, ...(overrides[id] ?? [])]);
}

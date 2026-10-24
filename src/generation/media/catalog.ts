import { execFile } from "node:child_process";
import { existsSync, renameSync, rmSync } from "node:fs";
import path from "node:path";

/**
 * The kinds of media an agent can make (spec 008 FR-001). Routing knows nothing else about a kind:
 * adding one here (and declaring which agents make it) is all a new kind needs.
 */
export interface MediaKind {
  id: string;
  label: string;
  /** Plural noun for messages: "No agent here can make images". */
  plural: string;
  /** File types an agent may deliver, best first; the first is the normal form. */
  extensions: string[];
}

export const MEDIA_KINDS: Record<string, MediaKind> = {
  image: {
    id: "image",
    label: "Image",
    plural: "images",
    // JPEG first: Chrome's PDF writer stalls on several large photographic PNGs (spec 008 D7).
    extensions: ["jpg", "jpeg", "png", "webp"],
  },
  video: { id: "video", label: "Video", plural: "videos", extensions: ["mp4", "webm", "mov"] },
  audio: { id: "audio", label: "Audio", plural: "audio", extensions: ["mp3", "wav", "m4a", "ogg"] },
};

export const isMediaKind = (id: unknown): id is string =>
  typeof id === "string" && Object.hasOwn(MEDIA_KINDS, id);

/** Keeps known kinds only, once each. */
export const mediaKinds = (value: unknown): string[] =>
  Array.isArray(value) ? [...new Set(value.filter(isMediaKind))] : [];

export const pluralOf = (kind: string) => MEDIA_KINDS[kind]?.plural ?? kind;

/** The file an agent delivered for `<dir>/<id>.*`, if any. */
export function findDelivered(dir: string, id: string, kind: string): string | undefined {
  for (const extension of MEDIA_KINDS[kind]?.extensions ?? []) {
    const file = path.join(dir, `${id}.${extension}`);
    if (existsSync(file)) return file;
  }
  return undefined;
}

/**
 * Brings a delivered file to its kind's normal form (images → JPEG, through `sips` on macOS).
 * When it cannot be converted the delivered file is kept: Chrome shows PNG and WebP too.
 */
export async function normalizeMedia(file: string, kind: string): Promise<string | undefined> {
  const normal = MEDIA_KINDS[kind]?.extensions[0];
  if (!normal) return undefined;
  const extension = path.extname(file).slice(1).toLowerCase();
  if (kind !== "image" || extension === normal || extension === "jpeg") return file;
  const target = file.slice(0, -extension.length) + normal;
  const converted = await new Promise<boolean>((resolve) =>
    execFile(
      "sips",
      ["-s", "format", "jpeg", "-s", "formatOptions", "88", file, "--out", `${target}.tmp`],
      (error) => resolve(!error),
    ),
  );
  if (!converted || !existsSync(`${target}.tmp`)) return file;
  renameSync(`${target}.tmp`, target);
  rmSync(file, { force: true });
  return target;
}

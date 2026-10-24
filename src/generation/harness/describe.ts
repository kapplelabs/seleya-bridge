/**
 * What an agent's tool call means to the person watching (spec 003 FR-006): "Reading the poster
 * instructions", "Started: Choosing a direction", "Writing poster.html", never a raw tool name or an
 * absolute path. Works on what any harness reports: a tool name and its input.
 */
import path from "node:path";

import { toolLabel } from "./labels.ts";

export interface Described {
  label: string;
  /** One short line under the label: the file, the command, the image prompt… */
  detail?: string;
}

const MAX_DETAIL = 140;

const str = (value: unknown) => (typeof value === "string" ? value.trim() : "");
const short = (text: string) =>
  text.length > MAX_DETAIL ? `${text.slice(0, MAX_DETAIL - 1).trimEnd()}…` : text;

/** The run folder as agents may write it (macOS also reports /tmp as /private/tmp). */
const folderForms = (folder: string) =>
  folder ? [folder, `/private${folder}`, folder.replace(/^\/private/, "")] : [];

/**
 * Text with no absolute path left: the run folder becomes relative, any other absolute path only
 * its file name (`…/visual.jpg`), so nothing about the person's computer leaves the run.
 */
export function withoutPaths(text: string, folder: string): string {
  let out = text;
  for (const form of folderForms(folder).sort((a, b) => b.length - a.length))
    out = out.split(`${form}/`).join("").split(form).join(".");
  // An absolute path starts the text or follows a space, quote or `=`; relative ones stay as they are.
  return out.replace(
    /(^|[\s'"`=])(?:~\/|\/)(?:[^\s'"`/]+\/)*([^\s'"`/]*)/g,
    (_, before: string, name: string) => `${before}…/${name}`,
  );
}

/** A path as the person would recognise it: relative to the run folder, never absolute. */
function shown(file: string, folder: string): string {
  if (!file) return "";
  return withoutPaths(file, folder).replace(/^\.\//, "");
}

/** The input fields different harnesses use for the same thing. */
function field(input: Record<string, unknown>, ...names: string[]): string {
  for (const name of names) {
    const value = str(input[name]);
    if (value) return value;
  }
  return "";
}

/** The files a run reads and writes, in the words of its own procedure. */
function readingOf(file: string): string | undefined {
  const skill = /(?:^|\/)skills\/([a-z0-9_-]+)\/SKILL\.md$/i.exec(file)?.[1];
  if (skill) return `Reading the ${skill.replace(/-/g, " ")} instructions`;
  const settings = /(?:^|\/)skills\/([a-z0-9_-]+)\/recipe\.json$/i.exec(file)?.[1];
  if (settings) return `Reading the ${settings.replace(/-/g, " ")} settings`;
  if (/(?:^|\/)skills\/CREATIVE\.md$/.test(file)) return "Reading the design procedure";
  if (/(?:^|\/)skills\/PROGRESS\.md$/.test(file)) return "Reading how to report progress";
  if (/(?:^|\/)skills\/INDEX\.md$/.test(file)) return "Looking at what it can make";
  if (/(?:^|\/)request\.json$/.test(file)) return "Reading your request";
  if (/(?:^|\/)out\/media\/jobs[^/]*\.json$/.test(file)) return "Reading the pictures to make";
  return undefined;
}

function writingOf(file: string): string | undefined {
  const name = path.basename(file);
  if (name === "brief.json") return "Writing the brief";
  if (name === "concept.json") return "Choosing the direction";
  if (name === "definition.json") return "Defining the design";
  if (name === "outline.json") return "Writing the outline";
  if (name === "deck.json") return "Assembling the deck";
  if (name === "result.json") return "Finishing up";
  if (name === "jobs.json") return "Describing the pictures to make";
  const slide = /(?:^|\/)slides\/(\d+)\.json$/.exec(file)?.[1];
  if (slide) return `Writing slide ${Number(slide)}`;
  if (/\.html$/.test(name)) return `Laying out ${name}`;
  if (/\.(png|jpe?g|webp)$/.test(name)) return `Saving the picture ${name}`;
  if (/\.svg$/.test(name)) return `Drawing ${name}`;
  return undefined;
}

/**
 * Progress lines the agent appends (`printf '{"type":"step",…}' >> progress.jsonl`), often two at
 * once (a draft, then "step done"): the step line says the most, then a plan, then a draft.
 */
function progressOf(command: string): Described | undefined {
  if (!command.includes("progress.jsonl")) return undefined;
  const lines = [...command.matchAll(/'(\{[^']*\})'/g)].flatMap(([, json = ""]) => {
    try {
      return [JSON.parse(json) as Record<string, unknown>];
    } catch {
      return [];
    }
  });
  const step = lines.findLast((line) => line.type === "step" && str(line.label));
  if (step) {
    const label = str(step.label);
    const detail = str(step.detail) || undefined;
    if (step.status === "active") return { label: `Started: ${label}` };
    if (step.status === "failed") return { label: `Could not finish: ${label}`, detail };
    return { label: `Finished: ${label}`, detail };
  }
  const plan = lines.find((line) => line.type === "plan" && Array.isArray(line.steps));
  if (plan) return { label: `Planned ${(plan.steps as unknown[]).length} steps` };
  const draft = lines.find((line) => line.type === "draft");
  if (draft) return { label: "Showing a draft", detail: str(draft.path) || undefined };
  return { label: "Reporting progress" };
}

function commandOf(command: string, folder: string): Described {
  const progress = progressOf(command);
  if (progress) return progress;
  const clean = withoutPaths(command, folder);
  if (/^\s*sips\b/.test(command)) return { label: "Converting an image", detail: short(clean) };
  if (/^\s*mkdir\b/.test(command)) return { label: "Preparing folders" };
  if (/^\s*(cp|mv)\b/.test(command)) return { label: "Moving files", detail: short(clean) };
  if (/^\s*(ls|find|cat|head|tail)\b/.test(command))
    return { label: "Looking at files", detail: short(clean) };
  return { label: "Running a command", detail: short(clean) };
}

/** Label and detail for one tool call; `folder` is the run folder (paths are shown relative). */
export function describeTool(
  tool: string,
  input: Record<string, unknown> | undefined,
  folder: string,
): Described {
  const args = input ?? {};
  const command = field(args, "CommandLine", "command", "cmd");
  if (command) return commandOf(command, folder);

  const prompt = field(args, "prompt", "Prompt", "description", "Description");
  // Antigravity makes pictures through a helper agent ("Image Generator").
  const role = field(args, "Role", "TypeName", "role");
  if (/image|picture|draw/i.test(tool) || /image/i.test(role))
    return { label: "Generating an image", detail: prompt ? short(prompt) : undefined };
  if (/manage_subagents/i.test(tool)) return { label: "Checking on its helpers" };
  if (/subagent|task|agent/i.test(tool) && prompt)
    return { label: "Handing part of the work to a helper", detail: short(prompt) };

  const file = shown(
    field(args, "Path", "path", "file_path", "AbsolutePath", "TargetFile", "filePath"),
    folder,
  );
  const label = toolLabel(tool);
  if (file) {
    if (label === "Writing a file") return { label: writingOf(file) ?? `Writing ${file}`, detail: file };
    if (label === "Reading files") return { label: readingOf(file) ?? `Reading ${file}`, detail: file };
  }
  const query = field(args, "Query", "query", "pattern", "url", "Url");
  if (query) return { label, detail: short(query) };
  return { label };
}

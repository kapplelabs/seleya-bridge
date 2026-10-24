/** Human labels for agent tools, shown as activity chips (spec 003 FR-006), never raw tool names. */
const LABELS: [RegExp, string][] = [
  [/image|picture|draw/i, "Generating an image"],
  [/read|view|open|cat|list|glob|grep|search/i, "Reading files"],
  [/write|create|save|edit|replace|patch/i, "Writing a file"],
  [/run|command|shell|bash|exec|terminal/i, "Running a command"],
  [/web|fetch|browse|http/i, "Looking something up"],
  [/think|plan|todo/i, "Planning"],
];

export function toolLabel(tool: string): string {
  return LABELS.find(([pattern]) => pattern.test(tool))?.[1] ?? "Working";
}

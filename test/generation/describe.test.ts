import assert from "node:assert/strict";
import { test } from "node:test";

import { describeTool, withoutPaths } from "../../src/generation/harness/describe.ts";
import { parseAntigravity, parseClaude, parseCodex } from "../../src/generation/harness/parsers.ts";

const FOLDER = "/tmp/seleya-bridge-live/generation/runs/run_1";
const say = (tool: string, input: Record<string, unknown>) => describeTool(tool, input, FOLDER);
const printf = (...lines: object[]) =>
  lines.map((line) => `printf '%s\\n' '${JSON.stringify(line)}' >> progress.jsonl`).join(" && ");

test("spec 003 FR-006a: a tool call reads in the run's own words", () => {
  assert.deepEqual(say("read_file", { Path: "skills/poster/SKILL.md" }), {
    label: "Reading the poster instructions",
    detail: "skills/poster/SKILL.md",
  });
  assert.equal(say("read_file", { Path: `${FOLDER}/skills/CREATIVE.md` }).label, "Reading the design procedure");
  assert.equal(say("view_file", { AbsolutePath: `/private${FOLDER}/request.json` }).label, "Reading your request");
  assert.deepEqual(say("write_file", { Path: `${FOLDER}/out/brief.json` }), {
    label: "Writing the brief",
    detail: "out/brief.json",
  });
  assert.equal(say("write_file", { Path: `${FOLDER}/out/poster.html` }).label, "Laying out poster.html");
  assert.equal(say("Write", { file_path: `${FOLDER}/out/slides/03.json` }).label, "Writing slide 3");
  assert.equal(say("write_file", { Path: `${FOLDER}/out/result.json` }).label, "Finishing up");
});

test("spec 003 FR-006a: progress lines become the step they start or finish, even chained", () => {
  assert.deepEqual(
    say("run_command", {
      CommandLine: printf({ type: "step", label: "Writing the brief", status: "active" }),
    }),
    { label: "Started: Writing the brief" },
  );
  assert.deepEqual(
    say("run_command", {
      CommandLine: printf(
        { type: "draft", path: "out/brief.json", slot: "brief" },
        { type: "step", label: "Writing the brief", status: "done", detail: "Brief with 4 facts" },
      ),
    }),
    { label: "Finished: Writing the brief", detail: "Brief with 4 facts" },
  );
  assert.equal(
    say("run_command", { CommandLine: printf({ type: "plan", steps: ["a", "b", "c"] }) }).label,
    "Planned 3 steps",
  );
});

test("spec 003 FR-006a: images, conversions and other commands", () => {
  assert.equal(say("invoke_subagent", { Role: "Image Generator", TypeName: "image-generator" }).label, "Generating an image");
  assert.deepEqual(say("generate_image", { prompt: "warm wood café, golden light, no text" }), {
    label: "Generating an image",
    detail: "warm wood café, golden light, no text",
  });
  const sips = say("run_command", {
    CommandLine: "sips -s format png /Users/vulcan/.gemini/antigravity-cli/brain/c8ec/visual_17.jpg --out out/visual.png",
  });
  assert.equal(sips.label, "Converting an image");
  assert.equal(sips.detail, "sips -s format png …/visual_17.jpg --out out/visual.png");
  assert.equal(say("run_command", { CommandLine: "npm view left-pad" }).label, "Running a command");
});

test("spec 003 FR-006d: no absolute path ever leaves the run", () => {
  const command = `ls -la /private${FOLDER}/out /private/tmp/seleya-bridge-live/generation/runs/run_other ~/secret/notes.txt`;
  const detail = say("run_command", { CommandLine: command }).detail ?? "";
  assert.doesNotMatch(detail, /\/Users\/|\/private\/|\/tmp\/|~\//);
  assert.equal(detail, "ls -la out …/run_other …/notes.txt");
  assert.equal(withoutPaths(`cat ${FOLDER}/request.json`, FOLDER), "cat request.json");
});

test("parsers keep each call's id and input (Antigravity, Claude Code, Codex)", () => {
  const agy = parseAntigravity(
    JSON.stringify({
      event: "step_update",
      step_update: {
        step_index: 44,
        state: "ACTIVE",
        step_type: "tool",
        tool_name: "write_file",
        tool_info: { name: "write_file", parameters: { Path: `${FOLDER}/out/brief.json` } },
      },
    }),
  ).activity[0];
  assert.deepEqual(agy, {
    kind: "tool",
    tool: "write_file",
    state: "started",
    durationMs: undefined,
    callId: "44",
    input: { Path: `${FOLDER}/out/brief.json` },
  });
  const failed = parseAntigravity(
    JSON.stringify({ event: "step_update", step_update: { step_index: 2, state: "ERROR", step_type: "tool", tool_name: "read_file" } }),
  ).activity[0];
  assert.equal(failed?.kind === "tool" && failed.state, "finished");

  const claude = parseClaude(
    JSON.stringify({
      type: "assistant",
      message: { content: [{ type: "tool_use", id: "toolu_1", name: "Write", input: { file_path: "out/concept.json" } }] },
    }),
  ).activity[0];
  assert.equal(claude?.kind === "tool" && claude.callId, "toolu_1");
  const claudeDone = parseClaude(
    JSON.stringify({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: "toolu_1" }] } }),
  ).activity[0];
  assert.equal(claudeDone?.kind === "tool" && claudeDone.callId, "toolu_1");

  const codex = parseCodex(
    JSON.stringify({ type: "item.started", item: { id: "item_3", type: "command_execution", command: "mkdir -p out" } }),
  ).activity[0];
  assert.equal(codex?.kind === "tool" && codex.callId, "item_3");
  assert.equal(
    codex?.kind === "tool" ? describeTool(codex.tool, codex.input, FOLDER).label : "",
    "Preparing folders",
  );
});

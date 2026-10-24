import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { classifyFailure } from "../../src/generation/harness/classify.ts";
import { parseDescriptor } from "../../src/generation/harness/descriptor.ts";
import { parseAntigravity, parseClaude, parseCodex, type ParsedLine } from "../../src/generation/harness/parsers.ts";
import { spawnHarness } from "../../src/generation/harness/process.ts";
import type { HarnessActivity } from "../../src/generation/harness/types.ts";

const fixture = (name: string) =>
  readFileSync(path.join(import.meta.dirname, "fixtures", name), "utf8")
    .split("\n")
    .filter(Boolean);

function fold(lines: string[], parse: (line: string) => ParsedLine) {
  const activity: HarnessActivity[] = [];
  let outcome: ParsedLine["outcome"];
  const errors: string[] = [];
  for (const line of lines) {
    const parsed = parse(line);
    activity.push(...parsed.activity);
    if (parsed.outcome) outcome = parsed.outcome;
    if (parsed.error) errors.push(parsed.error);
  }
  return { activity, outcome, errors };
}

test("Antigravity: a real recorded run yields tool chips, narration and a successful outcome", () => {
  const { activity, outcome } = fold(fixture("antigravity-stream.jsonl"), parseAntigravity);
  const tools = activity.filter((item) => item.kind === "tool");
  assert.ok(
    tools.some(
      (item) => item.kind === "tool" && item.tool === "write_file" && item.state === "finished",
    ),
  );
  assert.ok(tools.some((item) => item.kind === "tool" && item.tool === "run_command"));
  assert.ok(activity.some((item) => item.kind === "text" && item.text.length > 0));
  assert.equal(outcome?.ok, true);
});

test("Codex: the signed-out recording classifies as sign-in expired, config warnings are not fatal", () => {
  const { outcome, errors, activity } = fold(fixture("codex-signed-out.jsonl"), parseCodex);
  assert.equal(activity.length, 0, "warning items are not shown as tools");
  assert.equal(outcome?.ok, false, "turn.failed ends the run");
  assert.equal(classifyFailure(errors.join("\n")), "sign_in_expired");
});

test("Claude Code: the signed-out recording ends as an error that classifies as not signed in", () => {
  const { outcome, errors } = fold(fixture("claude-signed-out.jsonl"), parseClaude);
  assert.equal(outcome?.ok, false);
  assert.equal(classifyFailure(errors.join("\n")), "not_signed_in");
});

test("classifier maps each known cause", () => {
  assert.equal(classifyFailure("Not logged in · Please run /login"), "not_signed_in");
  assert.equal(
    classifyFailure("refresh token was revoked. Please log out and sign in again"),
    "sign_in_expired",
  );
  assert.equal(classifyFailure("429 Too Many Requests"), "usage_limit");
  assert.equal(classifyFailure("Permission denied: rm"), "permission_denied");
  assert.equal(classifyFailure("segfault"), "crashed");
});

test("stop ends the whole process group within 10 s", async () => {
  const started = Date.now();
  const proc = spawnHarness({
    command: "/bin/sh",
    args: ["-c", "sleep 600 & sleep 600 & echo up; wait"],
    cwd: import.meta.dirname,
  });
  const up = new Promise<void>((resolve) => proc.onLine((line) => line === "up" && resolve()));
  await up;
  await proc.stop();
  const { code } = await proc.exited;
  assert.ok(Date.now() - started < 10_000);
  assert.notEqual(code, 0);
});

test("descriptors: permission bypass is rejected; placeholders are filled", () => {
  assert.throws(
    () =>
      parseDescriptor({
        id: "bad",
        start: { command: "agent", args: ["--dangerously-skip-permissions", "{prompt}"] },
      }),
    /permission checks off/,
  );
  assert.throws(
    () => parseDescriptor({ id: "Bad Id", start: { command: "x", args: [] } }),
    /needs `id`/,
  );
  const ok = parseDescriptor({
    id: "mine",
    name: "Mine",
    start: { command: "node", args: ["a.mjs", "{folder}", "{prompt}"] },
  });
  assert.deepEqual(ok.definition.args({ prompt: "P", folder: "/f", timeLimitS: 9 }), [
    "a.mjs",
    "/f",
    "P",
  ]);
  assert.equal(ok.definition.kind, "descriptor");
});

test("descriptors: every known bypass spelling and shell wrappers are rejected", () => {
  const bad: [string, string[]][] = [
    ["gemini", ["--approval-mode", "yolo", "-p", "{prompt}"]],
    ["gemini", ["--approval-mode=yolo", "{prompt}"]],
    ["gemini", ["-y", "-p", "{prompt}"]],
    ["codex", ["exec", "--dangerously-bypass-approvals-and-sandbox", "{prompt}"]],
    ["sh", ["-c", "agent --print '{prompt}'"]],
    ["/bin/bash", ["-c", "agent {prompt}"]],
  ];
  for (const [command, args] of bad)
    assert.throws(
      () => parseDescriptor({ id: "x", start: { command, args } }),
      /permission checks off|not a shell/,
      `${command} ${args.join(" ")}`,
    );
  // A benign `--yes-color` style flag is not mistaken for -y.
  assert.doesNotThrow(() =>
    parseDescriptor({ id: "ok", start: { command: "agent", args: ["--yes-color", "{prompt}"] } }),
  );
});

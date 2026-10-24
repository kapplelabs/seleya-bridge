import assert from "node:assert/strict";
import { appendFileSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import { FakeClock } from "../../src/generation/clock.ts";
import { applyPlan, applyStep, progressOf, runJson } from "../../src/generation/runs/events.ts";
import { parseProgressLine } from "../../src/generation/runs/progress.ts";
import { LineTailer } from "../../src/generation/runs/tail.ts";
import type { RunRow } from "../../src/generation/runs/types.ts";

test("parses typed records and the untyped step lines older skills write", () => {
  assert.deepEqual(parseProgressLine('{"type":"plan","steps":["A","B",""]}'), {
    kind: "plan",
    steps: ["A", "B"],
  });
  assert.deepEqual(parseProgressLine('{"label":"A","status":"active"}'), {
    kind: "step",
    label: "A",
    status: "active",
    detail: undefined,
  });
  assert.deepEqual(parseProgressLine('{"type":"draft","path":"out/bg.png","slot":"background"}'), {
    kind: "draft",
    path: "out/bg.png",
    slot: "background",
  });
  assert.equal(parseProgressLine("not json").kind, "invalid");
  assert.equal(parseProgressLine('{"label":"A","status":"weird"}').kind, "invalid");
});

test("tailer hands over complete lines once and keeps a partial line until its newline", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "tail-"));
  const file = path.join(dir, "p.jsonl");
  const lines: string[] = [];
  const tailer = new LineTailer(file, (line) => lines.push(line));
  const clock = new FakeClock();
  tailer.start(clock, 500);
  clock.advance(500); // file missing: nothing
  writeFileSync(file, "one\ntw");
  clock.advance(500);
  assert.deepEqual(lines, ["one"]);
  appendFileSync(file, "o\nthree");
  clock.advance(500);
  assert.deepEqual(lines, ["one", "two"]);
  tailer.stop();
  assert.deepEqual(lines, ["one", "two", "three"]);
});

test("plan, steps and progress fold the way the timeline shows them", () => {
  const { planned, steps } = applyPlan(["Brief", "Layout"], []);
  assert.deepEqual(
    planned.map((step) => step.label),
    ["Brief", "Layout"],
  );
  const a = applyStep({ kind: "step", label: "Brief", status: "active" }, steps, 1000);
  assert.equal(a.step.startedAt, 1000);
  const b = applyStep(
    { kind: "step", label: "Brief", status: "done", detail: "ok" },
    a.steps,
    4000,
  );
  assert.equal(b.step.finishedAt, 4000);
  assert.equal(b.step.startedAt, 1000);
  assert.equal(progressOf(planned, b.steps), 50);
  // A plan extended at run time never lowers progress below what was shown.
  const extended = applyPlan(["Brief", "Layout", "Slide 1", "Slide 2"], b.steps);
  assert.equal(progressOf(extended.planned, extended.steps, 50), 50);
  // An unplanned step is appended.
  const c = applyStep({ kind: "step", label: "Extra", status: "active" }, b.steps, 5000);
  assert.equal(c.steps.at(-1)?.label, "Extra");
});

test("maps local statuses onto Seleya's work_status", () => {
  const base: RunRow = {
    id: "run_x",
    title: "T",
    skill: "poster",
    skillVersion: "1",
    request: {},
    harness: null,
    localStatus: "timed_out",
    phase: "failed",
    error: { code: "timed_out", message: "late", retryable: true },
    createdAt: 1,
    startedAt: 1,
    finishedAt: 5,
    attempt: 1,
    retryOf: null,
    plannedSteps: [],
    steps: [],
    outputs: [{ path: "out/a b.png", kind: "png", state: "final" }],
    checks: [],
    summary: null,
    timeLimitMs: 1,
  };
  const json = runJson(base);
  assert.equal(json.status, "failed");
  assert.equal(json.local_status, "timed_out");
  assert.equal(json.agent_id, "creative-studio");
  assert.equal(json.outputs[0].url, "/api/runs/run_x/files/out/a%20b.png");
  assert.equal(runJson({ ...base, localStatus: "completed_with_issues" }).status, "completed");
});

test("skill front matter: one-line lists, lists spread over lines, and block lists", async () => {
  const { parseFrontMatter } = await import("../../src/generation/skills.ts");
  const flow = parseFrontMatter("---\nname: a\nplanned_steps: [One, Two]\n---\n");
  assert.deepEqual(flow.planned_steps, ["One", "Two"]);
  const formatted = parseFrontMatter(
    "---\nplanned_steps:\n  [\n    One,\n    Two,\n  ]\nneeds_image: true\n---\n",
  );
  assert.deepEqual(formatted.planned_steps, ["One", "Two"]);
  assert.equal(formatted.needs_image, "true");
  const block = parseFrontMatter("---\nplanned_steps:\n  - One\n  - Two\n---\n");
  assert.deepEqual(block.planned_steps, ["One", "Two"]);
});

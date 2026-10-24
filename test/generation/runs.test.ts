import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import type { ScriptAction } from "../../src/generation/harness/scripted.ts";
import { advanceUntil, eventsOf, makeTestApp, typesOf } from "./helpers.ts";

const finished = (status: string) =>
  [
    "completed",
    "completed_with_issues",
    "failed",
    "cancelled",
    "timed_out",
    "interrupted",
  ].includes(status);

test("a scripted run streams plan, timed steps, a draft and its result, then completes", async () => {
  const t = makeTestApp();
  try {
    const run = t.app.manager.create({ skill: "_scripted", title: "Test", request: {} });
    await advanceUntil(t.clock, () => finished(t.app.manager.get(run.id).localStatus));
    const done = t.app.manager.get(run.id);
    assert.equal(done.localStatus, "completed");

    const types = typesOf(eventsOf(t.app, run.id));
    for (const type of [
      "seleya.run.started",
      "seleya.run.plan",
      "seleya.run.estimate",
      "seleya.trace.step",
      "seleya.activity",
      "seleya.thought.delta",
      "seleya.output.draft",
      "seleya.output.final",
      "seleya.run.completed",
    ])
      assert.ok(types.includes(type), `missing ${type}`);
    assert.equal(types.at(-1), "stream.done");
    assert.ok(types.indexOf("seleya.output.draft") < types.indexOf("seleya.run.completed"));

    const step = done.steps.find((item) => item.label === "Producing");
    assert.equal(step?.status, "done");
    assert.ok(step?.startedAt && step.finishedAt && step.finishedAt >= step.startedAt);
    assert.ok(
      done.outputs.some((output) => output.path === "out/result.txt" && output.state === "final"),
    );
    assert.ok(
      existsSync(path.join(t.config.runsDir, run.id, "skills", "PROGRESS.md")),
      "skills copied into the run folder",
    );
  } finally {
    await t.cleanup();
  }
});

test("finishes on the manifest without waiting for the agent to exit", async () => {
  const t = makeTestApp();
  try {
    const script: ScriptAction[] = [
      { step: "Preparing", status: "active" },
      { step: "Preparing", status: "done" },
      { write: "out/a.txt", content: "a" },
      { manifest: { skill: "_scripted" } },
      { hang: true }, // the agent keeps "writing its final answer"
    ];
    const run = t.app.manager.create({ skill: "_scripted", title: "Early", request: { script } });
    await advanceUntil(t.clock, () => finished(t.app.manager.get(run.id).localStatus), 500, 20_000);
    assert.equal(t.app.manager.get(run.id).localStatus, "completed");
    assert.equal(
      t.harness.handles[0].stopped,
      true,
      "the harness was stopped once the result was there",
    );
  } finally {
    await t.cleanup();
  }
});

test("runs over the concurrency limit queue with their position and keep separate folders", async () => {
  const t = makeTestApp({ config: { concurrency: 3 } });
  try {
    const runs = [1, 2, 3, 4].map((n) =>
      t.app.manager.create({ skill: "_scripted", title: `R${n}`, request: {} }),
    );
    assert.equal(t.app.manager.queuePosition(runs[3].id), 1);
    assert.equal(t.app.manager.get(runs[3].id).localStatus, "queued");
    await advanceUntil(
      t.clock,
      () => runs.every((run) => finished(t.app.manager.get(run.id).localStatus)),
      500,
      60_000,
    );
    for (const run of runs) {
      assert.equal(t.app.manager.get(run.id).localStatus, "completed");
      assert.ok(existsSync(path.join(t.config.runsDir, run.id, "out", "result.txt")));
    }
    assert.equal(new Set(runs.map((run) => run.id)).size, 4);
  } finally {
    await t.cleanup();
  }
});

test("an agent that exits without a result fails the run with a plain reason", async () => {
  const t = makeTestApp();
  try {
    const run = t.app.manager.create({
      skill: "_scripted",
      title: "No result",
      request: { script: [{ step: "A", status: "active" }, { exit: "ok" }] },
    });
    await advanceUntil(t.clock, () => finished(t.app.manager.get(run.id).localStatus));
    const done = t.app.manager.get(run.id);
    assert.equal(done.localStatus, "failed");
    assert.equal(done.error?.code, "no_result");
    assert.equal(done.steps.find((step) => step.label === "A")?.status, "failed");
  } finally {
    await t.cleanup();
  }
});

import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import { createApp } from "../../src/generation/app.ts";
import { FakeClock } from "../../src/generation/clock.ts";
import { loadLocalConfig } from "../../src/generation/config.ts";
import { type ScriptAction, ScriptedHarness } from "../../src/generation/harness/scripted.ts";
import type { PostProcessor } from "../../src/generation/runs/runner.ts";
import { advanceUntil, eventsOf, flush, makeTestApp } from "./helpers.ts";

const hanging: ScriptAction[] = [
  { step: "Working", status: "active" },
  { draft: "out/partial.txt", slot: "output" },
  { hang: true },
];

test("US3: runs left running by a stopped program are marked interrupted on the next start", async () => {
  const first = makeTestApp();
  const run = first.app.manager.create({
    skill: "_scripted",
    title: "Crash",
    request: { script: hanging },
  });
  await flush();
  first.clock.advance(3000);
  await flush();
  assert.equal(first.app.manager.get(run.id).localStatus, "running");
  await first.app.close(); // the "crash": nothing finished the run

  const second = makeTestApp({ home: first.home });
  try {
    assert.equal(second.app.manager.recover(), 1);
    const recovered = second.app.manager.get(run.id);
    assert.equal(recovered.localStatus, "interrupted");
    assert.equal(recovered.error?.code, "interrupted");
    assert.ok(recovered.outputs.every((output) => output.state === "incomplete"));
    assert.equal(eventsOf(second.app, run.id).at(-1)?.type, "stream.done");
  } finally {
    await second.cleanup();
    await first.cleanup();
  }
});

test("US4: cancel stops the agent, keeps partial output marked incomplete; retry links attempts", async () => {
  const t = makeTestApp();
  try {
    const run = t.app.manager.create({
      skill: "_scripted",
      title: "Cancel me",
      request: { script: hanging },
    });
    await flush();
    t.clock.advance(3000);
    await flush();
    const cancelled = await t.app.manager.cancel(run.id);
    assert.equal(cancelled.localStatus, "cancelled");
    assert.equal(t.harness.handles[0].stopped, true);
    assert.deepEqual(
      cancelled.outputs.map((output) => output.state),
      ["incomplete"],
    );

    const retry = t.app.manager.retry(run.id);
    assert.equal(retry.attempt, 2);
    assert.equal(retry.retryOf, run.id);
    assert.throws(() => t.app.manager.retry(retry.id), /Only failed/);
  } finally {
    await t.cleanup();
  }
});

test("US4: a queued run can be cancelled before it starts", async () => {
  const t = makeTestApp({ config: { concurrency: 1 } });
  try {
    t.app.manager.create({ skill: "_scripted", title: "First", request: { script: hanging } });
    const second = t.app.manager.create({ skill: "_scripted", title: "Second", request: {} });
    assert.equal(t.app.manager.get(second.id).localStatus, "queued");
    assert.equal((await t.app.manager.cancel(second.id)).localStatus, "cancelled");
  } finally {
    await t.cleanup();
  }
});

test("US4: a silent agent is flagged at 60 s and 90 s, then stopped at the time limit", async () => {
  const t = makeTestApp({ config: { defaultTimeLimitMs: 5 * 60_000 } });
  try {
    const run = t.app.manager.create({
      skill: "_scripted",
      title: "Hang",
      request: { script: hanging },
    });
    await advanceUntil(t.clock, () => false, 1000, 3_000);
    const stalls = () =>
      eventsOf(t.app, run.id).filter((event) => event.type === "seleya.run.stall");
    await advanceUntil(t.clock, () => stalls().length >= 1, 1000, 70_000);
    assert.equal(stalls()[0].data.not_responding, false);
    await advanceUntil(t.clock, () => stalls().length >= 2, 1000, 40_000);
    assert.equal(stalls()[1].data.not_responding, true);
    assert.equal(
      t.app.manager.get(run.id).localStatus,
      "running",
      "the flag alone never stops a run",
    );
    // The _scripted skill's time limit comes from its metadata default (here 5 min via config).
    await advanceUntil(
      t.clock,
      () => t.app.manager.get(run.id).localStatus === "timed_out",
      5000,
      6 * 60_000,
    );
    assert.equal(t.app.manager.get(run.id).localStatus, "timed_out");
    assert.equal(t.app.manager.get(run.id).error?.code, "timed_out");
  } finally {
    await t.cleanup();
  }
});

// Post-processing that starts a correction agent which never finishes (the scripted harness replays
// the hanging script), so the run sits in post-processing until it is stopped.
const stuckInCorrection = new Map([
  [
    "_scripted",
    (async (context) => {
      await context.runAgain("Fix the findings.");
      return { outputs: [], checks: [] };
    }) satisfies PostProcessor,
  ],
]);
const toManifestThenHang: ScriptAction[] = [
  { step: "Working", status: "active" },
  { step: "Working", status: "done" },
  { manifest: { skill: "_scripted" } },
  { hang: true },
];

test("cancel works while the run is post-processing, and stops the correction agent", async () => {
  const t = makeTestApp({ postProcessors: stuckInCorrection });
  try {
    const run = t.app.manager.create({
      skill: "_scripted",
      title: "Cancel in post",
      request: { script: toManifestThenHang },
    });
    await advanceUntil(t.clock, () => t.harness.handles.length >= 2, 500, 30_000);
    assert.equal(t.harness.handles.length, 2, "a correction agent was started");
    assert.equal(t.app.manager.get(run.id).localStatus, "running");
    const cancelled = await t.app.manager.cancel(run.id);
    assert.equal(cancelled.localStatus, "cancelled");
    assert.equal(t.harness.handles[1].stopped, true, "the correction agent was stopped");
    await advanceUntil(t.clock, () => false, 1000, 5_000);
    assert.equal(
      t.app.manager.get(run.id).localStatus,
      "cancelled",
      "nothing completes it afterwards",
    );
    assert.equal(eventsOf(t.app, run.id).filter((event) => event.type === "stream.done").length, 1);
  } finally {
    await t.cleanup();
  }
});

test("the time limit also covers post-processing", async () => {
  const t = makeTestApp({
    postProcessors: stuckInCorrection,
    config: { defaultTimeLimitMs: 2 * 60_000 },
  });
  try {
    const run = t.app.manager.create({
      skill: "_scripted",
      title: "Slow correction",
      request: { script: toManifestThenHang },
    });
    await advanceUntil(
      t.clock,
      () => ["timed_out", "completed", "failed"].includes(t.app.manager.get(run.id).localStatus),
      5000,
      4 * 60_000,
    );
    assert.equal(t.app.manager.get(run.id).localStatus, "timed_out");
    assert.ok(t.harness.handles.every((handle) => handle.stopped));
  } finally {
    await t.cleanup();
  }
});

test("a cancel while the harness is being picked ends the run and it never starts", async () => {
  const home = mkdtempSync(path.join(tmpdir(), "seleya-local-test-"));
  const config = loadLocalConfig({
    home,
    runsDir: path.join(home, "runs"),
    dbFile: path.join(home, "seleya.db"),
    port: 0,
  });
  const clock = new FakeClock();
  const harness = new ScriptedHarness(clock, 1000);
  let release: () => void = () => undefined;
  const app = createApp({
    config,
    clock,
    apiOnly: true,
    pickHarness: () => new Promise((resolve) => (release = () => resolve({ harness }))),
  });
  try {
    const run = app.manager.create({ skill: "_scripted", title: "Pick", request: {} });
    await flush();
    assert.equal((await app.manager.cancel(run.id)).localStatus, "cancelled");
    release();
    await flush();
    clock.advance(5000);
    await flush();
    assert.equal(harness.handles.length, 0, "no agent was started");
    assert.equal(app.manager.get(run.id).localStatus, "cancelled");
    assert.equal(app.manager.activeCount(), 0, "the slot was freed");
  } finally {
    await app.close();
    rmSync(home, { recursive: true, force: true });
  }
});

test("an error while starting fails the run and frees its slot", async () => {
  const home = mkdtempSync(path.join(tmpdir(), "seleya-local-test-"));
  const config = loadLocalConfig({
    home,
    runsDir: path.join(home, "runs"),
    dbFile: path.join(home, "seleya.db"),
    port: 0,
    concurrency: 1,
  });
  const clock = new FakeClock();
  const good = new ScriptedHarness(clock, 1000);
  let first = true;
  const broken = {
    id: "broken",
    name: "Broken",
    check: good.check.bind(good),
    start: () => {
      throw new Error("spawn EACCES");
    },
  } as unknown as typeof good;
  const app = createApp({
    config,
    clock,
    apiOnly: true,
    pickHarness: async () => {
      const harness = first ? broken : good;
      first = false;
      return { harness };
    },
  });
  try {
    const bad = app.manager.create({ skill: "_scripted", title: "Bad", request: {} });
    const next = app.manager.create({ skill: "_scripted", title: "Next", request: {} });
    await flush();
    const failed = app.manager.get(bad.id);
    assert.equal(failed.localStatus, "failed");
    assert.match(failed.error?.message ?? "", /could not start: spawn EACCES/);
    await advanceUntil(clock, () => app.manager.get(next.id).localStatus === "completed");
    assert.equal(app.manager.get(next.id).localStatus, "completed", "the queue moved on");
  } finally {
    await app.close();
    rmSync(home, { recursive: true, force: true });
  }
});

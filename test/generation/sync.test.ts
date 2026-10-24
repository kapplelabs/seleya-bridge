import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { test } from "node:test";

import { createApp, fixedHarness } from "../../src/generation/app.ts";
import type { ScriptAction } from "../../src/generation/harness/scripted.ts";
import { stripPaths } from "../../src/generation/sync/payload.ts";
import { createStandinServer } from "../../src/generation/sync/standin.ts";
import { advanceUntil, flush, makeTestApp } from "./helpers.ts";

const listen = (server: Server, port = 0) =>
  new Promise<number>((resolve) =>
    server.listen(port, "127.0.0.1", () => resolve((server.address() as AddressInfo).port)),
  );
const close = (server: Server) => new Promise<void>((resolve) => server.close(() => resolve()));

/** A test app whose sync goes to a stand-in server under the test home. */
async function setup() {
  const base = makeTestApp();
  await base.app.close();
  const standinDir = path.join(base.home, "standin");
  const standin = createStandinServer(standinDir);
  const port = await listen(standin);
  const app = createApp({
    config: base.config,
    clock: base.clock,
    pickHarness: fixedHarness(base.harness),
    apiOnly: true,
    syncEndpoint: `http://127.0.0.1:${port}`,
  });
  return { ...base, app, standin, standinDir, port };
}

const finished = (status: string) => !["queued", "running"].includes(status);

/** Advances the clock and lets real HTTP finish, until the condition holds. */
async function until(t: Awaited<ReturnType<typeof setup>>, done: () => boolean, maxTicks = 200) {
  for (let tick = 0; tick < maxTicks && !done(); tick++) {
    t.clock.advance(1000);
    await flush();
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

test("off by default; once on, completed runs sync with their files and nothing private", async () => {
  const t = await setup();
  try {
    const before = t.app.manager.create({
      skill: "_scripted",
      title: "Before",
      request: { secret_field: "x", script: undefined },
    });
    await advanceUntil(t.clock, () => finished(t.app.manager.get(before.id).localStatus));
    await until(t, () => false, 5);
    assert.equal(readdirSync(t.standinDir).length, 0, "nothing is sent while sync is off");

    t.app.sync?.setSettings({ enabled: true });
    const script: ScriptAction[] = [
      { step: "Working", status: "active" },
      { step: "Working", status: "done", detail: `Wrote ${t.config.runsDir}/x/out/result.txt` },
      { write: "out/result.txt", content: "result" },
      { manifest: { skill: "_scripted" } },
      { exit: "ok" },
    ];
    const run = t.app.manager.create({
      skill: "_scripted",
      title: "After",
      request: { prompt: "make it", script, harness_token: "sk-secret" },
    });
    await advanceUntil(t.clock, () => finished(t.app.manager.get(run.id).localStatus));
    await until(t, () => t.app.sync?.records()[run.id]?.state === "synced");
    assert.equal(t.app.sync?.records()[run.id]?.state, "synced");
    assert.equal(
      t.app.sync?.records()[before.id],
      undefined,
      "runs finished before sync was on are not sent",
    );

    const sent = readFileSync(path.join(t.standinDir, run.id, "run.json"), "utf8");
    const payload = JSON.parse(sent) as Record<string, unknown>;
    assert.deepEqual(Object.keys(payload).sort(), [
      "agent",
      "checks",
      "computer_id",
      "files",
      "finished_at",
      "request",
      "run_id",
      "skill",
      "skill_version",
      "started_at",
      "status",
      "steps",
      "title",
    ]);
    assert.deepEqual(payload.request, { prompt: "make it" });
    assert.doesNotMatch(
      sent,
      /sk-secret|"script"|harness_token|\/Users\/|\/private\/|\/var\//,
      "no keys, internal fields or absolute paths",
    );
    assert.ok(existsSync(path.join(t.standinDir, run.id, "files", "result.txt")));
    assert.ok(existsSync(path.join(t.standinDir, run.id, ".complete")));
  } finally {
    await close(t.standin);
    await t.cleanup();
  }
});

test("failed runs are never sent; an unreachable server queues and later sends exactly once", async () => {
  const t = await setup();
  try {
    t.app.sync?.setSettings({ enabled: true });
    const failed = t.app.manager.create({
      skill: "_scripted",
      title: "Fails",
      request: { script: [{ exit: "fail", message: "boom" }] },
    });
    await advanceUntil(t.clock, () => finished(t.app.manager.get(failed.id).localStatus));
    assert.equal(t.app.sync?.records()[failed.id], undefined);

    await close(t.standin); // server down
    const run = t.app.manager.create({ skill: "_scripted", title: "Offline", request: {} });
    await advanceUntil(t.clock, () => finished(t.app.manager.get(run.id).localStatus));
    await until(t, () => (t.app.sync?.records()[run.id]?.attempts ?? 0) >= 1);
    const waiting = t.app.sync?.records()[run.id];
    assert.equal(waiting?.state, "waiting");
    assert.match(waiting?.lastError ?? "", /could not be reached/);

    const again = createStandinServer(t.standinDir);
    await listen(again, t.port); // server back
    try {
      await until(t, () => t.app.sync?.records()[run.id]?.state === "synced", 400);
      assert.equal(t.app.sync?.records()[run.id]?.state, "synced");
      // A repeat send keeps one copy (idempotent on run id).
      t.app.sync?.retry(run.id);
      await until(
        t,
        () =>
          t.app.sync?.records()[run.id]?.state === "synced" &&
          (t.app.sync?.records()[run.id]?.attempts ?? 1) === 0,
      );
      assert.deepEqual(
        readdirSync(t.standinDir).filter((name) => name === run.id),
        [run.id],
      );
      // Removing from the server keeps the local run.
      await t.app.sync?.remove(run.id);
      assert.equal(existsSync(path.join(t.standinDir, run.id)), false);
      assert.equal(t.app.manager.get(run.id).localStatus, "completed");
    } finally {
      await close(again);
    }
  } finally {
    await t.cleanup();
  }
});

test("absolute paths in text are reduced to file names", () => {
  assert.equal(
    stripPaths("Wrote /Users/vulcan/.seleya-local/runs/run_x/out/poster.png fine"),
    "Wrote poster.png fine",
  );
  assert.equal(stripPaths("Saved C:\\Users\\me\\deck.pdf"), "Saved deck.pdf");
});

test("a finished run that changes after it was sent (a deck edit) is sent again", async () => {
  const t = await setup();
  try {
    t.app.sync?.setSettings({ enabled: true });
    const run = t.app.manager.create({
      skill: "_scripted",
      title: "Edited",
      request: {
        script: [
          { write: "out/result.txt", content: "v1" },
          { manifest: { skill: "_scripted" } },
          { exit: "ok" },
        ],
      },
    });
    await advanceUntil(t.clock, () => finished(t.app.manager.get(run.id).localStatus));
    await until(t, () => t.app.sync?.records()[run.id]?.state === "synced");
    const folder = path.join(t.config.runsDir, run.id, "out", "result.txt");
    writeFileSync(folder, "v2");
    t.app.manager.emit(run.id, "seleya.run.updated", { reason: "edited" });
    assert.equal(t.app.sync?.records()[run.id]?.state, "waiting");
    await until(t, () => t.app.sync?.records()[run.id]?.state === "synced");
    assert.equal(
      readFileSync(path.join(t.standinDir, run.id, "files", "result.txt"), "utf8"),
      "v2",
    );
  } finally {
    await close(t.standin);
    await t.cleanup();
  }
});

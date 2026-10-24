import assert from "node:assert/strict";
import { symlinkSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import type { ScriptAction } from "../../src/generation/harness/scripted.ts";
import { advanceUntil, makeTestApp, raw, session } from "./helpers.ts";

const finishedWithFiles: ScriptAction[] = [
  { step: "Working", status: "active" },
  { write: "out/design.png", content: "png-bytes" },
  { write: "out/design.pdf", content: "pdf-bytes" },
  { step: "Working", status: "done" },
  { manifest: { skill: "_scripted" } },
];

test("a finished run is saved as an artifact once, with its real files, and listed", async () => {
  const t = makeTestApp();
  try {
    const port = await t.app.listen(0);
    const cookie = await session(port);
    const run = t.app.manager.create({
      skill: "_scripted",
      title: "Local AI Night poster",
      request: { prompt: "Poster for Local AI Night", script: finishedWithFiles },
    });

    const early = await raw(port, {
      method: "POST",
      path: "/api/artifacts",
      headers: { cookie },
      body: { run_id: run.id },
    });
    assert.equal(early.status, 409, "not before the run has finished");

    await advanceUntil(t.clock, () => t.app.manager.get(run.id).localStatus === "completed");
    // A symlink the agent planted is never part of the artifact.
    symlinkSync("/etc/hosts", path.join(t.config.runsDir, run.id, "out", "hosts.png"));
    t.app.store.updateRun(run.id, {
      outputs: [
        ...t.app.manager.get(run.id).outputs,
        { path: "out/hosts.png", kind: "png", state: "final" },
      ],
    });

    const saved = await raw(port, {
      method: "POST",
      path: "/api/artifacts",
      headers: { cookie },
      body: { run_id: run.id },
    });
    assert.equal(saved.status, 201);
    const artifact = JSON.parse(saved.body);
    assert.equal(artifact.title, "Local AI Night poster");
    assert.equal(artifact.run_id, run.id);
    assert.deepEqual(artifact.files.map((file: { name: string }) => file.name).sort(), [
      "design.pdf",
      "design.png",
    ]);
    assert.match(artifact.files[0].url, new RegExp(`^/api/runs/${run.id}/files/out/`));
    assert.equal(artifact.sections[0].body, "Poster for Local AI Night");

    const again = await raw(port, {
      method: "POST",
      path: "/api/artifacts",
      headers: { cookie },
      body: { run_id: run.id },
    });
    assert.equal(again.status, 200, "saving twice returns the same artifact");
    assert.equal(JSON.parse(again.body).id, artifact.id);

    const list = JSON.parse(
      (await raw(port, { path: "/api/artifacts", headers: { cookie } })).body,
    );
    assert.deepEqual(
      list.items.map((item: { id: string }) => item.id),
      [artifact.id],
    );
    const file = await raw(port, {
      path: artifact.files.find((item: { name: string }) => item.name === "design.png").url,
      headers: { cookie },
    });
    assert.equal(file.body, "png-bytes");
  } finally {
    await t.cleanup();
  }
});

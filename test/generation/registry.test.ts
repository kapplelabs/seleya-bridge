import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import { createApp } from "../../src/generation/app.ts";
import { FakeClock, realClock } from "../../src/generation/clock.ts";
import { loadLocalConfig } from "../../src/generation/config.ts";
import { parseDescriptor } from "../../src/generation/harness/descriptor.ts";
import { HarnessRegistry } from "../../src/generation/harness/registry.ts";
import type { Harness, HarnessStatus } from "../../src/generation/harness/types.ts";
import { Store } from "../../src/generation/runs/store.ts";
import type { SkillMeta } from "../../src/generation/skills.ts";

function fake(id: string, status: Partial<HarnessStatus>): Harness {
  return {
    id,
    name: id[0].toUpperCase() + id.slice(1),
    check: async () => ({ installed: true, signedIn: true, canGenerateImages: false, ...status }),
    start: () => {
      throw new Error("not used");
    },
  };
}

const skill = (needsImage: boolean): SkillMeta => ({
  name: needsImage ? "poster" : "slides",
  version: "1",
  title: "",
  description: "",
  plannedSteps: [],
  needs: needsImage ? ["image"] : [],
  mediaRequired: [],
  media: "inline",
  needsImage,
  resumable: false,
  timeLimitMs: 1,
  typicalMs: [1, 2],
  dir: "",
});

function registryWith(harnesses: Harness[]) {
  const home = mkdtempSync(path.join(tmpdir(), "registry-"));
  const store = new Store(path.join(home, "db"));
  const registry = new HarnessRegistry({
    store,
    clock: new FakeClock(),
    harnesses: harnesses.map((harness) => ({ harness, kind: "builtin" as const })),
  });
  return {
    registry,
    cleanup: () => (store.close(), rmSync(home, { recursive: true, force: true })),
  };
}

test("US2: with only one ready harness, it is used for every skill", async () => {
  const { registry, cleanup } = registryWith([
    fake("antigravity", { installed: false, signedIn: false }),
    fake("claude", { canGenerateImages: false }),
    fake("codex", { signedIn: false }),
  ]);
  try {
    const pick = await registry.pick(skill(false));
    assert.equal(pick.harness.id, "claude");
    assert.equal(pick.note, undefined);
  } finally {
    cleanup();
  }
});

test("US2: a skill needing images prefers an image-capable harness, else falls back with a note", async () => {
  const both = registryWith([fake("claude", {}), fake("antigravity", { canGenerateImages: true })]);
  try {
    assert.equal((await both.registry.pick(skill(true))).harness.id, "antigravity");
  } finally {
    both.cleanup();
  }
  const textOnly = registryWith([fake("claude", {})]);
  try {
    const pick = await textOnly.registry.pick(skill(true));
    assert.equal(pick.harness.id, "claude");
    assert.match(pick.note ?? "", /No agent here can make images/);
  } finally {
    textOnly.cleanup();
  }
});

test("US2: no ready harness fails with no_harness", async () => {
  const { registry, cleanup } = registryWith([fake("claude", { signedIn: false })]);
  try {
    await assert.rejects(
      registry.pick(skill(false)),
      (error: Error & { code?: string }) => error.code === "no_harness",
    );
    assert.equal(registry.statusJson()[0].ready, false);
  } finally {
    cleanup();
  }
});

test("US3: per-skill preference beats the default; an unavailable preference falls back with a note", async () => {
  const { registry, cleanup } = registryWith([
    fake("antigravity", { canGenerateImages: true }),
    fake("claude", {}),
    fake("codex", { signedIn: false }),
  ]);
  try {
    registry.setPreferences({ default: "antigravity", perSkill: { slides: "claude" } });
    assert.equal((await registry.pick(skill(false))).harness.id, "claude");
    registry.setPreferences({ perSkill: { slides: "codex" } });
    const pick = await registry.pick(skill(false));
    assert.equal(pick.harness.id, "antigravity");
    assert.match(pick.note ?? "", /Codex is not available/);
    assert.throws(() => registry.setPreferences({ default: "nope" }), /no agent named/);
  } finally {
    cleanup();
  }
});

test("US5: a descriptor-defined agent runs a skill end to end and streams its lines", async () => {
  const home = mkdtempSync(path.join(tmpdir(), "descriptor-"));
  const agent = parseDescriptor({
    id: "fake-agent",
    name: "Fake Agent",
    start: {
      command: process.execPath,
      args: [path.join(import.meta.dirname, "fixtures", "fake-agent.mjs"), "{folder}", "{prompt}"],
    },
    stream: "lines",
  });
  const config = loadLocalConfig({
    home,
    runsDir: path.join(home, "runs"),
    dbFile: path.join(home, "db"),
    port: 0,
    tailIntervalMs: 50,
  });
  const app = createApp({
    config,
    clock: realClock,
    apiOnly: true,
    registry: (store, clock) =>
      new HarnessRegistry({ store, clock, harnesses: [{ harness: agent, kind: "descriptor" }] }),
  });
  try {
    assert.equal((await app.registry?.pick(skill(false)))?.harness.id, "fake-agent");
    const run = app.manager.create({ skill: "_scripted", title: "Descriptor", request: {} });
    await new Promise<void>((resolve) => {
      const stop = app.manager.subscribe(run.id, (event) => {
        if (event.type === "stream.done") {
          stop();
          resolve();
        }
      });
    });
    const done = app.manager.get(run.id);
    assert.equal(done.localStatus, "completed");
    assert.equal(done.harness, "fake-agent");
    assert.equal(
      readFileSync(path.join(config.runsDir, run.id, "out", "result.txt"), "utf8"),
      "from fake agent",
    );
    const narration = app.store
      .eventsAfter(run.id, 0)
      .filter((event) => event.type === "seleya.thought.delta");
    assert.ok(narration.some((event) => String(event.data.text).includes("fake agent got")));
  } finally {
    await app.close();
    rmSync(home, { recursive: true, force: true });
  }
});

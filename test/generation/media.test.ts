import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import { FakeClock } from "../../src/generation/clock.ts";
import { claudeCode } from "../../src/generation/harness/builtins.ts";
import { FabricHarness } from "../../src/generation/harness/fabric.ts";
import { HarnessRegistry } from "../../src/generation/harness/registry.ts";
import type { ScriptAction } from "../../src/generation/harness/scripted.ts";
import type { Harness, HarnessStartInput, HarnessStatus } from "../../src/generation/harness/types.ts";
import type { MediaResult } from "../../src/generation/media/broker.ts";
import { mediaMcpServers } from "../../src/generation/media/mcp.ts";
import { Store } from "../../src/generation/runs/store.ts";
import { loadSkill, skillIndex, type SkillMeta } from "../../src/generation/skills.ts";
import { advanceUntil, makeTestApp } from "./helpers.ts";

function fake(id: string, status: Partial<HarnessStatus> = {}): Harness {
  return {
    id,
    name: id[0].toUpperCase() + id.slice(1),
    check: async () => ({ installed: true, signedIn: true, canGenerateImages: false, ...status }),
    start: () => {
      throw new Error("not used");
    },
  };
}

const skillOf = (patch: Partial<SkillMeta>): SkillMeta => ({
  name: "deck",
  version: "1",
  title: "",
  description: "",
  plannedSteps: [],
  needs: [],
  mediaRequired: [],
  media: "inline",
  needsImage: false,
  resumable: false,
  timeLimitMs: 1,
  typicalMs: [1, 2],
  dir: "",
  ...patch,
});

function registryWith(harnesses: Harness[], overrides: Record<string, string[]> = {}) {
  const home = mkdtempSync(path.join(tmpdir(), "media-registry-"));
  const store = new Store(path.join(home, "db"));
  const registry = new HarnessRegistry({
    store,
    clock: new FakeClock(),
    overrides,
    harnesses: harnesses.map((harness) => ({ harness, kind: "builtin" as const })),
  });
  return {
    registry,
    cleanup: () => (store.close(), rmSync(home, { recursive: true, force: true })),
  };
}

test("US1: delegated media keeps the user's agent for the text and routes images to a capable one", async () => {
  const { registry, cleanup } = registryWith([
    fake("claude"),
    fake("fabric", { capabilities: ["image"], canGenerateImages: true }),
  ]);
  try {
    registry.setPreferences({ default: "claude" });
    const pick = await registry.pick(skillOf({ needs: ["image"], media: "delegated" }));
    assert.equal(pick.harness.id, "claude");
    assert.deepEqual(
      pick.media?.image.map((agent) => agent.id),
      ["fabric"],
    );
    assert.match(pick.note ?? "", /Images will be made by Fabric/);
    // Inline: the agent that makes the images runs the whole skill.
    const inline = await registry.pick(skillOf({ needs: ["image"], media: "inline" }));
    assert.equal(inline.harness.id, "fabric");
  } finally {
    cleanup();
  }
});

test("US1: a required kind nobody can make refuses the run; a wanted one falls back with a note", async () => {
  const { registry, cleanup } = registryWith([fake("claude")]);
  try {
    await assert.rejects(
      registry.pick(skillOf({ needs: ["audio"], mediaRequired: ["audio"] })),
      (error: Error & { code?: string }) =>
        error.code === "capability_missing" &&
        /no agent on this computer can make audio/.test(error.message),
    );
    const wanted = await registry.pick(skillOf({ needs: ["video"], media: "delegated" }));
    assert.equal(wanted.harness.id, "claude");
    assert.match(wanted.note ?? "", /No agent here can make videos/);
    assert.deepEqual(wanted.media?.video, []);
  } finally {
    cleanup();
  }
});

test("US2: capabilities.json adds kinds, the per-kind preference wins, and the API lists both", async () => {
  const { registry, cleanup } = registryWith(
    [
      fake("antigravity", { capabilities: ["image"] }),
      fake("codex", { capabilities: ["image"] }),
      fake("claude"),
    ],
    { claude: ["audio"] },
  );
  try {
    assert.deepEqual(
      (await registry.pickFor("audio")).map((agent) => agent.id),
      ["claude"],
    );
    assert.equal((await registry.pickFor("image"))[0].id, "antigravity");
    registry.setPreferences({ perCapability: { image: "codex" } });
    assert.equal((await registry.pickFor("image"))[0].id, "codex");
    assert.throws(
      () => registry.setPreferences({ perCapability: { smell: "codex" } }),
      /media kind/,
    );
    const claude = registry.statusJson().find((item) => item.id === "claude");
    assert.deepEqual(claude?.capabilities, ["audio"]);
    const available = await registry.mediaAvailability();
    assert.deepEqual(
      available.video.map((agent) => agent.id),
      [],
    );
  } finally {
    cleanup();
  }
});

test("US1: Agent Fabric sends a task to the live worker that makes what it needs", () => {
  const fabric = new FabricHarness(new FakeClock(), undefined, { claude: ["audio"] });
  (fabric as unknown as { liveTargets: string[] }).liveTargets = ["claude", "antigravity"];
  assert.equal(fabric.targetFor(["image"]).id, "antigravity");
  assert.equal(fabric.targetFor(["audio"]).id, "claude");
  assert.equal(fabric.targetFor([]).id, "antigravity");
  assert.equal(fabric.targetFor(["video"]).id, "antigravity", "nobody can: the first worker up");
});

test("skills declare what they use; the index tells the orchestrator what this computer can make", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "media-skill-"));
  try {
    writeFileSync(
      path.join(dir, "SKILL.md"),
      "---\nname: podcast\nneeds: [audio, image, smell]\nmedia: delegated\nmedia_required: [audio]\n---\n",
    );
    const skill = loadSkill(dir, 1000);
    assert.deepEqual(skill?.needs, ["audio", "image"]);
    assert.deepEqual(skill?.mediaRequired, ["audio"]);
    assert.equal(skill?.media, "delegated");
    assert.equal(skill?.needsImage, true);
    writeFileSync(path.join(dir, "SKILL.md"), "---\nname: poster\nneeds_image: true\n---\n");
    assert.deepEqual(loadSkill(dir, 1000)?.needs, ["image"]);
    const index = skillIndex(new Map(skill ? [["podcast", skill]] : []), {
      image: ["Antigravity"],
      video: [],
      audio: [],
    });
    assert.match(index, /image: yes \(Antigravity\)/);
    assert.match(index, /video: \*\*no\*\* — no agent here can make videos/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

/** A media agent that writes some job files right away and exits. */
function mediaAgent(id: string, files: Record<string, string>, seen: HarnessStartInput[]): Harness {
  return {
    id,
    name: id,
    check: async () => ({ installed: true, signedIn: true, canGenerateImages: true }),
    start: (input) => {
      seen.push(input);
      for (const [name, content] of Object.entries(files))
        writeFileSync(path.join(input.folder, "out", "media", name), content);
      return {
        onActivity: () => undefined,
        exited: Promise.resolve({ ok: true }),
        stop: async () => undefined,
      };
    },
  };
}

const jobsScript = (jobs: unknown[]): ScriptAction[] => [
  { step: "Writing", status: "active" },
  { write: "out/media/jobs.json", content: JSON.stringify(jobs) },
  { write: "out/result.txt", content: "ok" },
  { step: "Writing", status: "done" },
  { manifest: { skill: "_scripted" } },
  { exit: "ok" },
];

test("US1: the broker makes each job, tries the next agent for what is missing, and records who made it", async () => {
  const seen: HarnessStartInput[] = [];
  const first = mediaAgent(
    "first",
    { "cover.png": "png-bytes", "chart.error.txt": "refused" },
    seen,
  );
  const second = mediaAgent("second", { "chart.png": "png-bytes" }, seen);
  const t = makeTestApp({ mediaAgents: async (kind) => (kind === "image" ? [first, second] : []) });
  try {
    const run = t.app.manager.create({
      skill: "_scripted",
      title: "Media",
      request: {
        script: jobsScript([
          { id: "cover", kind: "image", prompt: "a calm coffee shop at dawn", aspect: "16:9" },
          { id: "chart", kind: "image", prompt: "abstract growth shape" },
          { id: "jingle", kind: "audio", prompt: "a short jingle" },
          { id: "bad id!", kind: "image", prompt: "ignored" },
        ]),
      },
    });
    await advanceUntil(
      t.clock,
      () => !["queued", "running"].includes(t.app.manager.get(run.id).localStatus),
    );
    const done = t.app.manager.get(run.id);
    assert.equal(done.localStatus, "completed", JSON.stringify(done.error));
    const folder = path.join(t.config.runsDir, run.id);
    const results = JSON.parse(
      readFileSync(path.join(folder, "out", "media", "results.json"), "utf8"),
    ) as MediaResult[];
    assert.deepEqual(
      results.map((result) => [result.id, result.status, result.agent ?? null]),
      [
        ["cover", "made", "first"],
        ["chart", "made", "second"],
        ["jingle", "skipped", null],
      ],
    );
    assert.deepEqual(
      seen.map((input) => input.needs),
      [["image"], ["image"]],
    );
    assert.match(seen[0].prompt, /jobs-image\.json/);
    const secondJobs = JSON.parse(
      readFileSync(path.join(folder, "out", "media", "jobs-image.json"), "utf8"),
    );
    assert.deepEqual(
      secondJobs.map((job: { id: string }) => job.id),
      ["chart"],
      "only what was missing",
    );
    const check = done.checks.find((item) => item.name === "media");
    assert.equal(check?.passed, true);
    assert.match(
      check?.findings.join("\n") ?? "",
      /Skipped jingle: No agent on this computer can make audio/,
    );
    assert.ok(done.outputs.some((output) => output.slot === "media-cover"));
    assert.ok(done.steps.some((step) => step.label === "Making images with second"));
  } finally {
    await t.cleanup();
  }
});

test("US1: a job no agent delivers fails the media check, the run still finishes", async () => {
  const seen: HarnessStartInput[] = [];
  const lazy = mediaAgent("lazy", {}, seen);
  const t = makeTestApp({ mediaAgents: async () => [lazy] });
  try {
    const run = t.app.manager.create({
      skill: "_scripted",
      title: "Missing",
      request: { script: jobsScript([{ id: "hero", kind: "image", prompt: "a hero shot" }]) },
    });
    await advanceUntil(
      t.clock,
      () => !["queued", "running"].includes(t.app.manager.get(run.id).localStatus),
    );
    const done = t.app.manager.get(run.id);
    assert.equal(done.localStatus, "completed_with_issues");
    const check = done.checks.find((item) => item.name === "media");
    assert.equal(check?.passed, false);
    assert.match(check?.findings[0] ?? "", /hero \(image\) was not made: lazy did not deliver it/);
  } finally {
    await t.cleanup();
  }
});

test("an MCP server the person connected that makes images gives Claude Code images, for media jobs only", () => {
  const servers = {
    "fal-image": { command: "npx", args: ["-y", "fal-ai-mcp"] },
    "my-gen": { type: "http", url: "https://gen.example/mcp" },
    "codebase-memory-mcp": { command: "npx", args: ["-y", "codebase-memory-mcp"] },
    stitch: { type: "http", url: "https://stitch.googleapis.com/mcp" },
  };
  assert.deepEqual(Object.keys(mediaMcpServers("image", servers)), ["fal-image"]);
  // A server whose name says nothing is used once the person declares it.
  assert.deepEqual(Object.keys(mediaMcpServers("image", servers, { "my-gen": ["image"] })), ["fal-image", "my-gen"]);
  assert.deepEqual(Object.keys(mediaMcpServers("audio", servers)), []);

  const home = mkdtempSync(path.join(tmpdir(), "mcp-home-"));
  const saved = { HOME: process.env.HOME, SELEYA_BRIDGE_HOME: process.env.SELEYA_BRIDGE_HOME };
  try {
    writeFileSync(path.join(home, ".claude.json"), JSON.stringify({ mcpServers: servers }));
    process.env.HOME = home;
    process.env.SELEYA_BRIDGE_HOME = home;
    const base = { prompt: "Make it", folder: "/tmp/run", timeLimitS: 60 };
    const media = claudeCode.definition.args({ ...base, needs: ["image"] });
    const config = JSON.parse(media[media.indexOf("--mcp-config") + 1]!) as { mcpServers: Record<string, unknown> };
    assert.deepEqual(Object.keys(config.mcpServers), ["fal-image"], "only the image server");
    assert.ok(media.includes("mcp__fal-image") && media.includes("--strict-mcp-config"));
    const plain = claudeCode.definition.args(base);
    assert.equal(plain.includes("--mcp-config"), false, "every other run stays isolated");
    assert.equal(plain.some((arg) => arg.startsWith("mcp__") || arg.startsWith("Bash(curl")), false);
  } finally {
    process.env.HOME = saved.HOME;
    if (saved.SELEYA_BRIDGE_HOME === undefined) delete process.env.SELEYA_BRIDGE_HOME;
    else process.env.SELEYA_BRIDGE_HOME = saved.SELEYA_BRIDGE_HOME;
    rmSync(home, { recursive: true, force: true });
  }
});

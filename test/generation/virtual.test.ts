import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import type { ScriptAction } from "../../src/generation/harness/scripted.ts";
import { routedPostProcessor } from "../../src/generation/runs/route.ts";
import { defaultPostProcess } from "../../src/generation/runs/runner.ts";
import { slugify } from "../../src/generation/server/routes/skills.ts";
import { parseFrontMatter, skillIndex } from "../../src/generation/skills.ts";
import { signedRecipe } from "./recipes.ts";
import { advanceUntil, makeTestApp, raw, session } from "./helpers.ts";

const finished = (status: string) => !["queued", "running"].includes(status);

test("every run folder gets an index of the skills the orchestrator can pick", async () => {
  const t = makeTestApp();
  try {
    // A free-text run carries every recipe the orchestrator may pick (spec 009).
    const recipe_digests = ["poster", "virtual-creative-usecase", "slides"].map(
      (id) => t.app.recipes.accept(signedRecipe(id)).digest,
    );
    const run = t.app.manager.create({
      skill: "orchestrator",
      title: "Index",
      request: { recipe_digests },
    });
    await advanceUntil(t.clock, () => finished(t.app.manager.get(run.id).localStatus));
    const index = readFileSync(path.join(t.config.runsDir, run.id, "skills", "INDEX.md"), "utf8");
    assert.match(index, /`poster` — Poster/);
    assert.match(index, /`virtual-creative-usecase` — Custom design/);
    assert.match(index, /`slides` — Slides/);
    assert.doesNotMatch(index, /`orchestrator`|`_scripted`/);
    assert.ok(skillIndex(t.app.manager.skillsOf({ recipe_digests })).length > 200);
    assert.doesNotMatch(skillIndex(t.app.skills()), /`poster`/, "no usecase is built into the engine");
  } finally {
    await t.cleanup();
  }
});

test("a request that is not a still design is declined with the agent's reason", async () => {
  const routed = routedPostProcessor(new Map(), { creative: defaultPostProcess });
  const t = makeTestApp({ postProcessors: new Map([["_scripted", routed]]) });
  try {
    const script: ScriptAction[] = [
      { step: "Understanding your request", status: "active" },
      { step: "Understanding your request", status: "done", detail: "Not a still design" },
      {
        manifest: {
          skill: "none",
          reason: "Seleya makes still designs and slide decks, not videos.",
        },
      },
      { exit: "ok" },
    ];
    const run = t.app.manager.create({ skill: "_scripted", title: "Video", request: { script } });
    await advanceUntil(t.clock, () => finished(t.app.manager.get(run.id).localStatus));
    const done = t.app.manager.get(run.id);
    assert.equal(done.localStatus, "failed");
    assert.equal(done.error?.code, "not_supported");
    assert.equal(done.error?.retryable, false);
    assert.match(done.error?.message ?? "", /not videos/);
  } finally {
    await t.cleanup();
  }
});

test("a custom design can be saved as a skill, is routable, and can be deleted", async () => {
  const t = makeTestApp();
  try {
    const definition = {
      deliverable: "Wedding invitation",
      size: { width_px: 800, height_px: 1120, why: "5:7 portrait invitation" },
      pages: [{ name: "invitation", width: 800, height: 1120 }],
      needs_visual: false,
      content_inventory: ["Minh Anh & Quốc Bảo", "14/12/2026"],
      required_parts: ["couple names", "date", "venue"],
    };
    const script: ScriptAction[] = [
      { write: "out/definition.json", content: JSON.stringify(definition) },
      {
        write: "out/concept.json",
        content: JSON.stringify({ style: "elegant botanical", palette: ["#ffffff", "#8fbc8f"] }),
      },
      { write: "out/invitation.html", content: "<p>ok</p>" },
      {
        manifest: {
          skill: "virtual-creative-usecase",
          pages: [{ name: "invitation", html: "out/invitation.html" }],
        },
      },
      { exit: "ok" },
    ];
    const run = t.app.manager.create({ skill: "_scripted", title: "Invite", request: { script } });
    await advanceUntil(t.clock, () => finished(t.app.manager.get(run.id).localStatus));
    const port = await t.app.listen(0);
    const cookie = await session(port);
    const saved = await raw(port, {
      method: "POST",
      path: `/api/local/skills/from-run/${run.id}`,
      headers: { cookie },
      body: { title: "Thiệp cưới" },
    });
    assert.equal(saved.status, 200, saved.body);
    assert.equal(JSON.parse(saved.body).name, "thiep-cuoi");
    const skill = t.app.skills().get("thiep-cuoi");
    assert.ok(skill, "listed after saving");
    assert.deepEqual(skill?.plannedSteps.slice(0, 2), ["Defining the design", "Writing the brief"]);
    const markdown = readFileSync(path.join(skill?.dir ?? "", "SKILL.md"), "utf8");
    assert.match(markdown, /"deliverable": "Wedding invitation"/);
    assert.doesNotMatch(markdown, /Minh Anh/, "content comes from new requests, not the saved run");
    assert.equal(parseFrontMatter(markdown).saved_from, run.id);
    // Routable: new runs copy it into their skills folder and list it in the index.
    const next = t.app.manager.create({ skill: "orchestrator", title: "Next", request: {} });
    await advanceUntil(t.clock, () => finished(t.app.manager.get(next.id).localStatus));
    assert.match(
      readFileSync(path.join(t.config.runsDir, next.id, "skills", "INDEX.md"), "utf8"),
      /`thiep-cuoi`/,
    );
    const again = await raw(port, {
      method: "POST",
      path: `/api/local/skills/from-run/${run.id}`,
      headers: { cookie },
      body: { title: "Thiệp cưới" },
    });
    assert.equal(again.status, 409);
    const deleted = await raw(port, {
      method: "DELETE",
      path: "/api/local/skills/thiep-cuoi",
      headers: { cookie },
    });
    assert.equal(deleted.status, 200);
    assert.equal(t.app.skills().has("thiep-cuoi"), false);
    assert.equal(
      (await raw(port, { method: "DELETE", path: "/api/local/skills/poster", headers: { cookie } }))
        .status,
      404,
      "shipped skills cannot be deleted",
    );
  } finally {
    await t.cleanup();
  }
});

test("skill names are slugs, Vietnamese included", () => {
  assert.equal(slugify("Thiệp cưới Đẹp!"), "thiep-cuoi-dep");
  assert.equal(slugify("Certificate of Completion"), "certificate-of-completion");
});

test("correcting a custom definition makes a new version built from exactly that definition", async () => {
  const t = makeTestApp();
  try {
    const definition = {
      deliverable: "Wedding invitation",
      size: { width_px: 800, height_px: 1120, why: "5:7 portrait invitation" },
      pages: [{ name: "invitation", width: 800, height: 1120 }],
      content_inventory: ["Minh Anh & Quốc Bảo"],
      required_parts: ["couple names"],
      assumptions: ["no RSVP"],
    };
    const script: ScriptAction[] = [
      { write: "out/definition.json", content: JSON.stringify(definition) },
      { write: "out/invitation.html", content: "<p>ok</p>" },
      {
        manifest: {
          skill: "virtual-creative-usecase",
          pages: [{ name: "invitation", html: "out/invitation.html" }],
        },
      },
      { exit: "ok" },
    ];
    const run = t.app.manager.create({
      skill: "_scripted",
      title: "Invite",
      request: { prompt: "Invite", script },
    });
    await advanceUntil(t.clock, () => finished(t.app.manager.get(run.id).localStatus));
    const port = await t.app.listen(0);
    const cookie = await session(port);
    const edited = await raw(port, {
      method: "POST",
      path: `/api/studio/images/${run.id}/definition`,
      headers: { cookie },
      body: {
        size: { width_px: 1480, height_px: 1050 },
        required_parts: ["couple names", "RSVP line"],
        assumptions: [],
      },
    });
    assert.equal(edited.status, 202, edited.body);
    const next = JSON.parse(edited.body).run_id as string;
    const written = JSON.parse(
      readFileSync(path.join(t.config.runsDir, next, "out", "definition.json"), "utf8"),
    );
    assert.deepEqual(written.size, { width_px: 1480, height_px: 1050, why: "Set by you" });
    assert.deepEqual(written.required_parts, ["couple names", "RSVP line"]);
    assert.deepEqual(
      written.content_inventory,
      ["Minh Anh & Quốc Bảo"],
      "untouched fields are kept",
    );
    assert.equal(written.pages[0].width, 1480, "the new size applies to every page");
    const request = t.app.manager.get(next).request;
    assert.equal(request.definition_edited, true);
    assert.equal(request.width, 1480);
    // Not a custom design: nothing to edit.
    const plain = t.app.manager.create({ skill: "_scripted", title: "Plain", request: {} });
    await advanceUntil(t.clock, () => finished(t.app.manager.get(plain.id).localStatus));
    const refused = await raw(port, {
      method: "POST",
      path: `/api/studio/images/${plain.id}/definition`,
      headers: { cookie },
      body: {},
    });
    assert.equal(refused.status, 409);
  } finally {
    await t.cleanup();
  }
});

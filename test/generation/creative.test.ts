import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, test } from "node:test";

import { editContext, PREVIOUS_RESULT, saveLayout, textsInRegion } from "../../src/generation/creative/edit.ts";
import { plannedFor } from "../../src/generation/runs/manager.ts";
import { answerJson, earlyImagePrompt } from "../../src/generation/creative/pipeline.ts";
import type { Harness } from "../../src/generation/harness/types.ts";
import {
  checkContrast,
  checkFacts,
  checkInventory,
  checkLayout,
  checkQuotes,
} from "../../src/generation/creative/checks.ts";
import { creativePostProcessor, expectedSize, quotedText } from "../../src/generation/creative/postprocess.ts";
import { usecaseOf } from "../../src/generation/creative/usecases.ts";
import type { ScriptAction } from "../../src/generation/harness/scripted.ts";
import { ChromeRenderer, findChrome, RenderError } from "../../src/generation/render/chrome.ts";
import { decodePng } from "../../src/generation/render/png.ts";
import { recipeSkill, signedRecipe } from "./recipes.ts";
import { advanceUntil, eventsOf, makeTestApp } from "./helpers.ts";

const finished = (status: string) => !["queued", "running"].includes(status);

const home = mkdtempSync(path.join(tmpdir(), "creative-"));
const renderer = new ChromeRenderer(home);
after(async () => {
  await renderer.close();
  rmSync(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
});
const chrome = { skip: findChrome() ? false : "Google Chrome is not installed" };

const page = (body: string, width = 600, height = 400) =>
  `<!doctype html><html><head><style>html,body{margin:0;width:${width}px;height:${height}px;overflow:hidden;font:32px/1.2 Arial}</style></head><body>${body}</body></html>`;

function writePage(name: string, html: string) {
  const file = path.join(home, name);
  writeFileSync(file, html);
  return file;
}

test("facts: invented facts are caught; facts written differently still count as given", () => {
  const request =
    "Poster: Local AI Night, 19:00 Saturday 15/11/2026, Vulcan Labs HQ. Register at meetup.vulcan.dev";
  assert.equal(
    checkFacts("LOCAL AI NIGHT 19h00 15.11.2026 meetup.vulcan.dev", request).passed,
    true,
  );
  const invented = checkFacts("19:00 · 15/11/2026 · Hotline 0901 234 567 · 50% off", request);
  assert.equal(invented.passed, false);
  assert.ok(invented.findings.some((finding) => finding.includes("0901 234 567")));
  assert.ok(invented.findings.some((finding) => finding.includes("50")));
});

test("quotes are verbatim and listed items appear exactly once", () => {
  assert.equal(
    checkQuotes("Mây Coffee — Chậm lại một chút", 'tagline "Chậm lại một chút"').passed,
    true,
  );
  assert.equal(checkQuotes("Mây Coffee — Chậm lại", 'tagline "Chậm lại một chút"').passed, false);
  const items = ["Cà phê sữa đá — 35.000", "Bạc xỉu — 39.000"];
  assert.equal(checkInventory("Cà phê sữa đá — 35.000\nBạc xỉu — 39.000", items).passed, true);
  const twice = checkInventory("Cà phê sữa đá — 35.000 Cà phê sữa đá — 35.000", items);
  assert.equal(twice.findings.length, 2); // one duplicated, one missing
});

test("render: exact-size PNG, PDF, text boxes, wrapped names and overflow", chrome, async () => {
  const file = writePage(
    "layout.html",
    page(
      `<h1 style="margin:40px;color:#111">Hello</h1>
       <p style="width:120px;margin:40px;color:#111">Minh Anh &amp; Quốc Bảo</p>
       <div style="position:absolute;left:520px;top:300px;color:#111;white-space:nowrap">Outside the page edge</div>`,
    ),
  );
  const result = await renderer.render(file, 600, 400, {
    pdf: true,
    keepTogether: ["Minh Anh & Quốc Bảo"],
  });
  const png = decodePng(result.png);
  assert.equal(png.width, 600);
  assert.equal(png.height, 400);
  assert.ok(result.pdf && result.pdf.subarray(0, 4).toString() === "%PDF");
  const layout = checkLayout(
    result.boxes,
    { width: result.scrollWidth, height: result.scrollHeight },
    { width: 600, height: 400 },
  );
  assert.equal(layout.passed, false);
  assert.ok(
    layout.findings.some(
      (finding) => finding.includes("Minh Anh & Quốc Bảo") && finding.includes("two lines"),
    ),
  );
  assert.ok(layout.findings.some((finding) => finding.includes("outside the design")));
});

test("contrast is measured against the rendered pixels behind each text", chrome, async () => {
  const good = writePage(
    "good.html",
    page(`<div style="background:#ffffff;color:#1a1a1a;padding:40px">Readable</div>`),
  );
  const bad = writePage(
    "bad.html",
    page(
      `<div style="background:linear-gradient(90deg,#eeeeee,#999999);color:#bbbbbb;padding:40px">Faint text</div>`,
    ),
  );
  const okResult = await renderer.render(good, 600, 400);
  assert.equal(checkContrast(okResult.boxes, decodePng(okResult.background)).passed, true);
  const badResult = await renderer.render(bad, 600, 400);
  const contrast = checkContrast(badResult.boxes, decodePng(badResult.background));
  assert.equal(contrast.passed, false);
  assert.match(contrast.findings[0], /Faint text.*contrast/);
});

const posterHtml = (extra: string) =>
  page(
    `<div style="background:#0b1530;color:#ffffff;width:600px;height:400px;padding:48px;box-sizing:border-box">
       <h1 style="margin:0 0 16px">Local AI Night</h1>
       <p style="margin:0;font-size:22px;white-space:nowrap">19:00 · 15/11/2026 · Vulcan Labs HQ</p>${extra}</div>`,
  );

test(
  "post-processing: a failing design is corrected once, then published with all checks passing",
  chrome,
  async () => {
    const first: ScriptAction[] = [
      { step: "Laying out the design", status: "active" },
      {
        write: "out/poster.html",
        content: posterHtml(`<p style="margin:12px 0 0">Hotline 0901 234 567</p>`),
      },
      { step: "Laying out the design", status: "done" },
      {
        manifest: {
          skill: "poster",
          pages: [{ name: "poster", html: "out/poster.html", width: 600, height: 400 }],
          keep_together: ["Vulcan Labs HQ"],
        },
      },
      { exit: "ok" },
    ];
    const fix: ScriptAction[] = [
      { write: "out/poster.html", content: posterHtml("") },
      {
        manifest: {
          skill: "poster",
          pages: [{ name: "poster", html: "out/poster.html", width: 600, height: 400 }],
        },
      },
      { exit: "ok" },
    ];
    const t = makeTestApp({
      postProcessors: new Map([["poster", creativePostProcessor(renderer, home)]]),
    });
    try {
      const run = t.app.manager.create({
        skill: "poster",
        title: "Poster",
        request: {
          prompt: 'Poster for "Local AI Night", 19:00 15/11/2026 at Vulcan Labs HQ',
          width: 600,
          height: 400,
          scripts: [first, fix],
          recipe_digest: t.app.recipes.accept(signedRecipe("poster")).digest,
        },
      });
      // Rendering needs real time (Chrome); advance the fake clock while it works.
      for (
        let index = 0;
        index < 400 &&
        !["completed", "completed_with_issues", "failed"].includes(
          t.app.manager.get(run.id).localStatus,
        );
        index++
      ) {
        await advanceUntil(t.clock, () => false, 500, 500);
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      const done = t.app.manager.get(run.id);
      assert.equal(
        done.localStatus,
        "completed",
        JSON.stringify({ error: done.error, checks: done.checks }),
      );
      const facts = t.app.store
        .eventsAfter(run.id, 0)
        .filter((event) => event.type === "seleya.check.result" && event.data.name === "facts");
      assert.deepEqual(
        facts.map((event) => event.data.passed),
        [false, true],
        "failed once, then passed after the fix",
      );
      assert.ok(done.steps.some((step) => step.label.startsWith("Fixing what the checks found")));
      assert.ok(existsSync(path.join(t.config.runsDir, run.id, "out", "poster.png")));
      assert.ok(existsSync(path.join(t.config.runsDir, run.id, "out", "poster.pdf")));
    } finally {
      await t.cleanup();
    }
  },
);

test("usecase sizes: request size wins, else the usecase default", () => {
  // Sizes come from the recipe Seleya sends (spec 009), not from the engine.
  const usecaseFor = (id: string) => usecaseOf(recipeSkill(id));
  assert.deepEqual(expectedSize({}, usecaseFor("business-card")), { width: 1050, height: 600 });
  assert.deepEqual(expectedSize({ size: "story" }, usecaseFor("social-content")), {
    width: 1080,
    height: 1920,
  });
  assert.deepEqual(expectedSize({ width: 1200, height: 628 }, usecaseFor("ad-creative")), {
    width: 1200,
    height: 628,
  });
});

test("generation titles are cut at a word boundary", async () => {
  const { shortTitle } = await import("../../src/generation/server/routes/studio.ts");
  assert.equal(
    shortTitle('Poster cho buổi Tech Meetup "Local AI Night" — chạy AI ngay trên máy'),
    'Poster cho buổi Tech Meetup "Local AI Night"',
  );
  const long = shortTitle(
    "A very long brief that keeps going past sixty characters without any sentence break at all",
  );
  assert.ok(long.length <= 61 && long.endsWith("…") && !long.includes("charac…"));
});

test("text edits change visible text only, never markup", async () => {
  const { replaceText } = await import("../../src/generation/creative/postprocess.ts");
  const html = `<h1 class="Local AI Night" title="Local AI Night">Local AI Night</h1><p>Local AI Night · 19:00</p>`;
  const result = replaceText(html, [{ from: "Local AI Night", to: "Local AI Day" }]);
  assert.equal(result.count, 2);
  assert.match(result.html, /class="Local AI Night" title="Local AI Night">Local AI Day</);
  assert.match(result.html, /<p>Local AI Day · 19:00<\/p>/);
  assert.equal(
    replaceText("<b>a &amp; b</b>", [{ from: "a & b", to: "c < d" }]).html,
    "<b>c &lt; d</b>",
  );
});

test("a listed item hidden inside a longer token does not count (found on a real business card)", async () => {
  const { checkInventory } = await import("../../src/generation/creative/checks.ts");
  const card = "linh.tran@vulcanlabs.co\n+84 901 234 567\n25 Lý Thường Kiệt, Hà Nội";
  const result = checkInventory(card, [
    "linh.tran@vulcanlabs.co",
    "+84 901 234 567",
    "vulcanlabs.co",
    "25 Lý Thường Kiệt, Hà Nội",
  ]);
  assert.equal(result.passed, false);
  assert.deepEqual(result.findings.length, 1);
  assert.match(result.findings[0], /"vulcanlabs.co" is missing/);
  assert.equal(
    checkInventory(`${card}\nvulcanlabs.co.`, ["vulcanlabs.co"]).passed,
    true,
    "a trailing full stop is fine",
  );
});

test('menu items written as "Name — price" pass when laid out as name and price columns', async () => {
  const { checkInventory } = await import("../../src/generation/creative/checks.ts");
  const items = ["Cà phê sữa — 35.000đ", "Bạc xỉu — 39.000đ"];
  assert.equal(checkInventory("Cà phê sữa\t35.000đ\nBạc xỉu\t39.000đ", items).passed, true);
  assert.equal(checkInventory("Cà phê sữa — 35.000đ\nBạc xỉu — 39.000đ", items).passed, true);
  const missingPrice = checkInventory("Cà phê sữa\nBạc xỉu\t39.000đ", items);
  assert.equal(missingPrice.passed, false, "a missing price is still a missing item");
  const twice = checkInventory("Cà phê sữa 35.000đ\nCà phê sữa 35.000đ\nBạc xỉu 39.000đ", items);
  assert.equal(twice.passed, false, "an item printed twice is caught");
});

test("an edit is told the page, its direction and the texts in the marked area, and plans one step", () => {
  const folder = mkdtempSync(path.join(tmpdir(), "edit-"));
  try {
    mkdirSync(path.join(folder, "out"));
    writeFileSync(path.join(folder, "out", "poster.html"), "<body><p>by Vulcan Labs</p></body>");
    writeFileSync(path.join(folder, "out", "concept.json"), '{"title":"Dusk"}');
    writeFileSync(path.join(folder, PREVIOUS_RESULT), '{"skill":"poster"}');
    const page = {
      name: "poster",
      html: "out/poster.html",
      width: 1000,
      height: 1500,
      boxes: [
        { text: "Big headline", x: 100, y: 100, width: 800, height: 200 },
        { text: "by Vulcan Labs", x: 350, y: 1410, width: 300, height: 40 },
      ],
    };
    saveLayout(folder, { pages: [page] });
    const region = { x: 0.3, y: 0.93, width: 0.4, height: 0.04 };
    assert.deepEqual(textsInRegion(page, region), ["by Vulcan Labs"]);
    const context = editContext(folder, { edit_instruction: "Make it by KappleLabs", edit_region: region }) ?? "";
    assert.match(context, /The marked area holds these texts: "by Vulcan Labs"/);
    assert.match(context, /<p>by Vulcan Labs<\/p>/);
    assert.match(context, /"title":"Dusk"/);
    assert.match(context, /"skill":"poster"/);
    assert.equal(editContext(folder, { prompt: "new" }), undefined, "not an edit");
    const poster = ["Writing the brief", "Choosing a direction", "Laying out the design", "Rendering", "Checking the design"];
    assert.deepEqual(plannedFor(poster, { edit_instruction: "x" }), ["Applying the edit", "Rendering", "Checking the design"]);
    assert.deepEqual(plannedFor(poster, { resize_from: "1000×1500" })[0], "Re-laying out for the new size");
    assert.deepEqual(plannedFor(poster, {}), poster);
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
});

test("an edit's quoted text replaces the first request's: the replaced headline is not required", () => {
  const request = {
    prompt: 'Poster for "Hạt Mộc Coffee Talk" at 08:00',
    edit_instruction: 'Đổi tiêu đề thành "Sáng Thứ Bảy Cùng Cà Phê"',
  };
  const design = "Sáng Thứ Bảy Cùng Cà Phê 08:00";
  assert.equal(checkQuotes(design, quotedText(request)).passed, true);
  assert.equal(checkQuotes("Hạt Mộc Coffee Talk 08:00", quotedText(request)).passed, false);
  assert.equal(checkQuotes(design, quotedText({ prompt: request.prompt })).passed, false);
});

test("pipeline: one answer makes the design while the picture is made, then an edit is one answer", async () => {
  // A picture agent that delivers the job it is given.
  const painter: Harness = {
    id: "painter",
    name: "Painter",
    check: async () => ({ installed: true, signedIn: true, canGenerateImages: true, capabilities: ["image"] }),
    start: (input) => {
      const jobs = JSON.parse(readFileSync(path.join(input.folder, "out", "media", "jobs-image.json"), "utf8")) as {
        save_as: string;
      }[];
      for (const job of jobs) writeFileSync(path.join(input.folder, job.save_as), "picture");
      return { onActivity: () => undefined, exited: Promise.resolve({ ok: true }), stop: async () => undefined };
    },
  };
  const t = makeTestApp({ mediaAgents: async () => [painter] });
  try {
    const spec = signedRecipe("poster", (recipe) => {
      recipe.files["poster/SPEC.md"] = "# Poster\n\nFollow `skills/CREATIVE-SPEC.md`.";
      recipe.files["CREATIVE-SPEC.md"] = "Answer with one JSON object.";
      recipe.files["poster/recipe.json"] = JSON.stringify({
        ...JSON.parse(recipe.files["poster/recipe.json"]!),
        pipeline: "spec",
      });
    });
    const { digest } = t.app.recipes.accept(spec);
    const answer = JSON.stringify({
      image_prompt: "A warm café at dawn, no text",
      brief: { headline: "Coffee Talk" },
      concept: { title: "Dawn" },
      pages: [{ name: "poster", html: "<body style=\"background:#333 url('visual.jpg')\"><h1>Coffee Talk</h1></body>" }],
      keep_together: ["Coffee Talk"],
    });
    const run = t.app.manager.create({
      skill: "poster",
      title: "Pipeline",
      request: { recipe_digest: digest, prompt: "Coffee Talk", width: 1000, height: 1500, script: [{ answer }] },
    });
    assert.deepEqual(
      t.app.manager.get(run.id).plannedSteps.map((step) => step.label),
      ["Designing", "Making the picture", "Rendering", "Checking the design"],
    );
    // Ready on its colours first (phase "picture"), then the picture is added and checked again.
    await advanceUntil(t.clock, () => finished(t.app.manager.get(run.id).localStatus));
    const phases = () =>
      eventsOf(t.app, run.id)
        .filter((event) => event.type === "seleya.run.phase")
        .map((event) => (event.data as { phase: string }).phase);
    await advanceUntil(t.clock, () => t.app.manager.get(run.id).phase === "completed");
    assert.ok(phases().indexOf("picture") < phases().lastIndexOf("completed"), phases().join(","));
    const done = t.app.manager.get(run.id);
    assert.equal(done.localStatus, "completed", JSON.stringify(done.error));
    assert.equal(
      eventsOf(t.app, run.id).filter((event) => event.type === "seleya.output.final").length,
      2,
      "published without, then with the picture",
    );
    const out = path.join(t.config.runsDir, run.id, "out");
    assert.match(readFileSync(path.join(out, "poster.html"), "utf8"), /Coffee Talk/);
    assert.equal(readFileSync(path.join(out, "visual.jpg"), "utf8"), "picture");
    const manifest = JSON.parse(readFileSync(path.join(out, "result.json"), "utf8"));
    assert.equal(manifest.visual, "out/visual.jpg");
    assert.equal(manifest.pages[0].html, "out/poster.html");

    // An edit: one answer with replaced words; markup is never touched.
    const edit = t.app.manager.create(
      {
        skill: "poster",
        title: "Edit",
        request: {
          ...done.request,
          edit_instruction: 'Change the headline to "Tea Talk"',
          script: [{ answer: JSON.stringify({ kind: "text", replacements: [{ from: "Coffee Talk", to: "Tea Talk" }] }) }],
        },
      },
      undefined,
      done,
    );
    assert.deepEqual(edit.plannedSteps.map((step) => step.label)[0], "Applying the edit");
    await advanceUntil(t.clock, () => finished(t.app.manager.get(edit.id).localStatus));
    assert.equal(t.app.manager.get(edit.id).localStatus, "completed", JSON.stringify(t.app.manager.get(edit.id).error));
    const edited = readFileSync(path.join(t.config.runsDir, edit.id, "out", "poster.html"), "utf8");
    assert.match(edited, /<h1>Tea Talk<\/h1>/);
    assert.match(edited, /url\('visual.jpg'\)/);
  } finally {
    await t.cleanup();
  }
});

test("pipeline: the image prompt is read before the answer ends", () => {
  assert.equal(earlyImagePrompt('{"image_prompt": "A café \\"Mộc\\" at dawn", "brief'), 'A café "Mộc" at dawn');
  assert.equal(earlyImagePrompt('{"image_prompt": "A café at da'), undefined);
  assert.deepEqual(answerJson('```json\n{"kind":"text"}\n```'), { kind: "text" });
});

test("no browser can render: the design is delivered as a web page with its picture, not failed", async () => {
  const folder = mkdtempSync(path.join(tmpdir(), "unrendered-"));
  try {
    mkdirSync(path.join(folder, "out"));
    writeFileSync(path.join(folder, "out", "visual.jpg"), "jpeg");
    writeFileSync(
      path.join(folder, "out", "poster.html"),
      "<body style=\"background:#222 url('visual.jpg')\"><h1>Coffee Talk</h1><p>08:00</p></body>",
    );
    const broken = {
      render: async () => {
        throw new RenderError("No Chrome, Chromium, Edge or Brave was found");
      },
    } as unknown as ChromeRenderer;
    const steps: string[] = [];
    const result = await creativePostProcessor(broken, folder)({
      run: { request: { prompt: 'Poster "Coffee Talk" at 08:00', width: 1000, height: 1500 } } as never,
      folder,
      manifest: { skill: "poster", pages: [{ name: "poster", html: "out/poster.html" }], visual: "out/visual.jpg" },
      skill: recipeSkill("poster"),
      skills: new Map([["poster", recipeSkill("poster")]]),
      emit: () => undefined,
      step: (label) => (steps.push(label), () => undefined),
      runAgain: async () => ({ ok: true }),
    });
    const page = result.outputs.find((output) => output.kind === "html");
    assert.equal(page?.path, "out/poster.preview.html");
    const preview = readFileSync(path.join(folder, "out", "poster.preview.html"), "utf8");
    assert.match(preview, /url\('data:image\/jpeg;base64,/, "the picture travels inside the page");
    assert.ok(result.outputs.some((output) => output.slot === "visual"));
    const byName = Object.fromEntries(result.checks.map((check) => [check.name, check.passed]));
    assert.deepEqual(byName, { facts: true, "quoted text": true, rendering: false });
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
});

test("pipeline: a picture that cannot be made is reported, not hidden", async () => {
  const quotaOut: Harness = {
    id: "painter",
    name: "Painter",
    check: async () => ({ installed: true, signedIn: true, canGenerateImages: true, capabilities: ["image"] }),
    start: (input) => {
      writeFileSync(path.join(input.folder, "out", "media", "visual.error.txt"), "Image quota exhausted (429)");
      return { onActivity: () => undefined, exited: Promise.resolve({ ok: true }), stop: async () => undefined };
    },
  };
  const t = makeTestApp({ mediaAgents: async () => [quotaOut] });
  try {
    const { digest } = t.app.recipes.accept(
      signedRecipe("poster", (recipe) => {
        recipe.files["poster/SPEC.md"] = "# Poster\n\nFollow `skills/CREATIVE-SPEC.md`.";
        recipe.files["CREATIVE-SPEC.md"] = "Answer with one JSON object.";
        recipe.files["poster/recipe.json"] = JSON.stringify({ ...JSON.parse(recipe.files["poster/recipe.json"]!), pipeline: "spec" });
      }),
    );
    const answer = JSON.stringify({
      image_prompt: "A monolith, no text",
      brief: {},
      concept: {},
      pages: [{ name: "poster", html: "<body style='background:#111'><h1>Seleya</h1></body>" }],
    });
    const run = t.app.manager.create({
      skill: "poster",
      title: "No picture",
      request: { recipe_digest: digest, prompt: "Seleya", width: 1000, height: 1500, script: [{ answer }] },
    });
    await advanceUntil(t.clock, () => finished(t.app.manager.get(run.id).localStatus) && t.app.manager.get(run.id).phase === "completed");
    const done = t.app.manager.get(run.id);
    assert.equal(done.localStatus, "completed_with_issues");
    const picture = done.checks.find((check) => check.name === "picture");
    assert.equal(picture?.passed, false);
    assert.match(picture?.findings[0] ?? "", /No picture was made \(Image quota exhausted \(429\)\)/);
  } finally {
    await t.cleanup();
  }
});

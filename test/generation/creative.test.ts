import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, test } from "node:test";

import {
  checkContrast,
  checkFacts,
  checkInventory,
  checkLayout,
  checkQuotes,
} from "../../src/generation/creative/checks.ts";
import { creativePostProcessor, expectedSize } from "../../src/generation/creative/postprocess.ts";
import { usecaseOf } from "../../src/generation/creative/usecases.ts";
import type { ScriptAction } from "../../src/generation/harness/scripted.ts";
import { ChromeRenderer, findChrome } from "../../src/generation/render/chrome.ts";
import { decodePng } from "../../src/generation/render/png.ts";
import { recipeSkill, signedRecipe } from "./recipes.ts";
import { advanceUntil, makeTestApp } from "./helpers.ts";

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

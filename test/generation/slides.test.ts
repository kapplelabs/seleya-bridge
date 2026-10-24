import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, test } from "node:test";

import { ChromeRenderer, findChrome } from "../../src/generation/render/chrome.ts";
import { decodePng } from "../../src/generation/render/png.ts";
import { readDeck } from "../../src/generation/slides/deck.ts";
import { expectedCount, renderDeck } from "../../src/generation/slides/postprocess.ts";
import { completeItems } from "../../src/generation/slides/pipeline.ts";
import { advanceUntil, makeTestApp } from "./helpers.ts";
import { signedRecipe } from "./recipes.ts";

const home = mkdtempSync(path.join(tmpdir(), "slides-"));
const renderer = new ChromeRenderer(home);
after(async () => {
  await renderer.close();
  rmSync(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
});
const chrome = { skip: findChrome() ? false : "Google Chrome is not installed" };

test("deck reading tolerates the shapes agents write", () => {
  const deck = readDeck({
    title: "Atlas",
    theme: "nope",
    slides: [
      { title: "Kickoff", points: ["a", ""] },
      { layout: "quote", heading: "Linh" },
    ],
  });
  assert.equal(deck.theme, "midnight");
  assert.equal(deck.slides[0].layout, "cover");
  assert.equal(deck.slides[0].heading, "Kickoff");
  assert.deepEqual(deck.slides[0].bullets, ["a"]);
  assert.equal(deck.slides[1].layout, "quote");
  assert.equal(expectedCount({ length: "medium" }), 8);
  assert.equal(expectedCount({ count: 5, length: "long" }), 5);
});

test(
  "renders every slide at 1280×720 with a PDF, and flags the slide that does not fit",
  chrome,
  async () => {
    const folder = path.join(home, "run");
    mkdirSync(path.join(folder, "out"), { recursive: true });
    const deck = readDeck({
      title: "Project Atlas",
      theme: "paper",
      slides: [
        {
          layout: "cover",
          heading: "Project Atlas",
          body: "Kickoff · Seleya chạy AI trên máy người dùng",
        },
        {
          layout: "bullets",
          heading: "Mục tiêu",
          bullets: ["Gen thiết kế ngay trên máy", "Không giữ key AI trên server"],
        },
        {
          layout: "bullets",
          heading: "Too much",
          bullets: Array.from(
            { length: 14 },
            (_, index) =>
              `A very long bullet number ${index + 1} that keeps going and going well past one line of text`,
          ),
        },
      ],
    });
    const result = await renderDeck(renderer, folder, deck, {
      brief: "Kickoff deck for Project Atlas",
      count: 3,
    });
    const pngs = result.outputs.filter((output) => output.kind === "png");
    assert.equal(pngs.length, 3);
    const first = decodePng(readFileSync(path.join(folder, pngs[0].path)));
    assert.deepEqual([first.width, first.height], [1280, 720]);
    assert.ok(existsSync(path.join(folder, "out", "deck.pdf")));
    const pages =
      readFileSync(path.join(folder, "out", "deck.pdf"))
        .toString("latin1")
        .match(/\/Type\s*\/Page[^s]/g) ?? [];
    assert.equal(pages.length, 3);
    const fit = result.checks.find((check) => check.name === "fits on the slide");
    assert.equal(fit?.passed, false);
    assert.equal(fit?.findings.length, 1);
    assert.match(fit?.findings[0] ?? "", /Slide 3/);
    assert.equal(result.checks.find((check) => check.name === "slide count")?.passed, true);
  },
);

test(
  "spec 008: every layout fits, pictures render where they were made, the rest use theme artwork",
  chrome,
  async () => {
    const folder = path.join(home, "designed");
    mkdirSync(path.join(folder, "out", "media"), { recursive: true });
    // A real PNG for the cover and one image slide; slide-05's picture was never made.
    const art = path.join(home, "art.html");
    writeFileSync(
      art,
      "<body style='margin:0;width:1280px;height:720px;background:linear-gradient(120deg,#ff7a00,#2b1055)'></body>",
    );
    const picture = (await renderer.render(art, 1280, 720, {})).png;
    writeFileSync(path.join(folder, "out", "media", "slide-01.png"), picture);
    writeFileSync(path.join(folder, "out", "media", "slide-04.png"), picture);
    const deck = readDeck({
      title: "Hạt Mộc",
      theme: "ember",
      slides: [
        {
          layout: "cover",
          heading: "Hạt Mộc",
          body: "Cà phê rang mộc giữa phố",
          image: { id: "slide-01", prompt: "x" },
        },
        { layout: "section", heading: "Câu chuyện", kicker: "Phần 1" },
        {
          layout: "cards",
          heading: "Điều làm nên khác biệt",
          cards: [
            { title: "Rang mộc", body: "Không tẩm ướp, giữ vị thật" },
            { title: "Nguồn gốc", body: "Hạt từ nông trại Cầu Đất" },
            { title: "Không gian", body: "Gỗ, cây xanh và ánh sáng tự nhiên" },
          ],
        },
        {
          layout: "image-right",
          heading: "Không gian",
          bullets: ["Gỗ mộc", "Ánh sáng tự nhiên"],
          image: { id: "slide-04", prompt: "x" },
        },
        {
          layout: "image-left",
          heading: "Thực đơn",
          bullets: ["Phin truyền thống", "Cold brew"],
          image: { id: "slide-05", prompt: "x" },
        },
        {
          layout: "stats",
          heading: "Con số",
          stats: [
            { value: "3", label: "chi nhánh" },
            { value: "12", label: "loại hạt" },
          ],
        },
        { layout: "image-full", heading: "Một tách cho mỗi sáng", image: { id: "slide-01" } },
        { layout: "quote", heading: "Chị Lan", body: "Ly cà phê ngon nhất phố." },
        {
          layout: "two-column",
          heading: "Hai lựa chọn",
          bullets: ["Tại quán"],
          right: ["Mang đi"],
        },
        {
          layout: "closing",
          heading: "Hẹn gặp ở Hạt Mộc",
          body: "Mở cửa mỗi ngày",
          bullets: ["Phin", "Cold brew"],
        },
      ],
    });
    const result = await renderDeck(renderer, folder, deck, {
      brief: "Hạt Mộc có 3 chi nhánh và 12 loại hạt. Chị Lan nói: Ly cà phê ngon nhất phố.",
      count: 10,
    });
    assert.equal(result.outputs.filter((output) => output.kind === "png").length, 10);
    const fit = result.checks.find((check) => check.name === "fits on the slide");
    assert.equal(fit?.passed, true, fit?.findings.join("\n") ?? "");
    const html = (n: string) =>
      readFileSync(path.join(folder, "out", "slides", `${n}.html`), "utf8");
    assert.match(html("01"), /src="\.\.\/media\/slide-01\.png"/);
    assert.match(html("04"), /src="\.\.\/media\/slide-04\.png"/);
    assert.doesNotMatch(html("05"), /<img/, "no picture made: the theme placeholder shows");
    assert.match(html("05"), /media placeholder/);
    // The cover shows the picture: its far-right pixel is the picture's colour, not the theme's.
    const cover = decodePng(readFileSync(path.join(folder, "out", "slides", "01.png")));
    const theme = decodePng(readFileSync(path.join(folder, "out", "slides", "02.png")));
    const at = (png: ReturnType<typeof decodePng>, x: number, y: number) => {
      const i = (y * png.width + x) * 4;
      return [png.data[i], png.data[i + 1], png.data[i + 2]];
    };
    assert.notDeepEqual(at(cover, 1270, 20), at(theme, 1270, 20));
  },
);

test("slide figures are checked against the brief and the deck's own words, not the footer", async () => {
  const { deckContentText, slidesSourceText } = await import("../../src/generation/slides/postprocess.ts");
  const { checkFacts } = await import("../../src/generation/creative/checks.ts");
  const deck = {
    title: "Kế hoạch 2026",
    theme: "paper" as const,
    slides: [
      { layout: "cover" as const, heading: "Kế hoạch 2026" },
      {
        layout: "stats" as const,
        heading: "Mục tiêu",
        stats: [{ value: "40%", label: "tăng trưởng" }],
      },
    ],
  };
  const request = { brief: "Kickoff deck: mục tiêu năm 2026 là tăng trưởng 40%.", count: 5 };
  const ok = checkFacts(deckContentText(deck), slidesSourceText(request));
  assert.equal(ok.passed, true, ok.findings.join("; "));
  const invented = checkFacts(
    deckContentText({
      ...deck,
      slides: [...deck.slides, { layout: "bullets" as const, heading: "Doanh thu 12 tỷ" }],
    }),
    slidesSourceText(request),
  );
  assert.equal(invented.passed, false, "a figure absent from the brief is still caught");
  // A refine may keep figures the earlier deck already had.
  const refine = {
    instruction: "Fewer slides",
    previous_deck: { slides: [{ heading: "Doanh thu 12 tỷ" }] },
  };
  assert.equal(checkFacts("Doanh thu 12 tỷ", slidesSourceText(refine)).passed, true);
});

test(
  "speaker notes go into the PDF as a page after their slide, never as a slide image",
  chrome,
  async () => {
    const folder = path.join(home, "run-notes");
    mkdirSync(path.join(folder, "out"), { recursive: true });
    const deck = readDeck({
      title: "Notes",
      theme: "paper",
      slides: [
        {
          layout: "cover",
          heading: "Notes",
          notes: "Chào mọi người.\nGiới thiệu nhanh mục tiêu buổi họp.",
        },
        { layout: "bullets", heading: "Không có ghi chú", bullets: ["a"] },
      ],
    });
    const result = await renderDeck(renderer, folder, deck, { brief: "Notes", count: 2 });
    assert.equal(
      result.outputs.filter((output) => output.kind === "png").length,
      2,
      "2 slide images",
    );
    const pages =
      readFileSync(path.join(folder, "out", "deck.pdf"))
        .toString("latin1")
        .match(/\/Type\s*\/Page[^s]/g) ?? [];
    assert.equal(pages.length, 3, "slide 1, its notes, slide 2");
    assert.match(
      readFileSync(path.join(folder, "out", "slides", "01-notes.html"), "utf8"),
      /Giới thiệu nhanh/,
    );
  },
);

test("slides pipeline: each slide is read as soon as it is complete in the answer", () => {
  const partial = '{"title":"Hạt Mộc","theme":"ember","slides":[{"layout":"cover","heading":"A {b}"},{"layout":"cards","cards":[{"title":"x"}]},{"layout":"bul';
  const items = completeItems(partial, "slides");
  assert.equal(items.length, 2);
  assert.deepEqual(JSON.parse(items[0]!), { layout: "cover", heading: "A {b}" });
});

test("slides pipeline: one answer makes the deck, its slides and the picture jobs", async () => {
  const t = makeTestApp();
  try {
    const recipe = signedRecipe("slides", (value) => {
      value.files["slides/SPEC.md"] = "# Slides in one answer";
      value.files["slides/recipe.json"] = JSON.stringify({
        ...JSON.parse(value.files["slides/recipe.json"]!),
        pipeline: "spec",
      });
    });
    const { digest } = t.app.recipes.accept(recipe);
    const answer = JSON.stringify({
      title: "Hạt Mộc",
      theme: "ember",
      slides: [
        { layout: "cover", heading: "Hạt Mộc", image: { id: "slide-01", prompt: "a café, no text" } },
        { layout: "cards", heading: "Why", cards: [{ title: "Beans", body: "From Cầu Đất" }] },
      ],
    });
    const run = t.app.manager.create({
      skill: "slides",
      title: "Deck",
      request: { recipe_digest: digest, brief: "Hạt Mộc", count: 2, script: [{ answer }] },
    });
    assert.deepEqual(
      t.app.manager.get(run.id).plannedSteps.map((step) => step.label),
      ["Writing the slides", "Rendering", "Checking the slides"],
    );
    await advanceUntil(t.clock, () => !["queued", "running"].includes(t.app.manager.get(run.id).localStatus));
    const out = path.join(t.config.runsDir, run.id, "out");
    const deck = JSON.parse(readFileSync(path.join(out, "deck.json"), "utf8"));
    assert.equal(deck.slides.length, 2);
    assert.ok(existsSync(path.join(out, "slides", "02.json")));
    const jobs = JSON.parse(readFileSync(path.join(out, "media", "jobs.json"), "utf8"));
    assert.deepEqual(jobs.map((job: { id: string; aspect: string }) => [job.id, job.aspect]), [["slide-01", "16:9"]]);
  } finally {
    await t.cleanup();
  }
});

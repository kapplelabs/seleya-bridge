/**
 * Runs one benchmark task through the generation engine in-process, with real agents, in its own
 * home (never the bridge you use), and records what it cost (docs/generation-performance.md).
 *
 *   node scripts/bench-drive.ts --home <dir> --catalog <seleya>/public/catalog --task <task>
 *        [--from <run id>] [--harness antigravity] [--label <round name>]
 *
 * Tasks: poster | poster-edit-text | poster-edit-visual | slides | slides-refine.
 * Edits and refines need --from: a finished run of the same kind in this home.
 * Each result is appended to <home>/bench.jsonl.
 */
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import { startGeneration } from "../src/generation/main.ts";
import type { RunRow } from "../src/generation/runs/types.ts";
import { measure, table } from "./bench-lib.ts";

const args = process.argv.slice(2);
const flag = (name: string, fallback?: string) => {
  const index = args.indexOf(name);
  return index < 0 ? fallback : args[index + 1];
};
const home = path.resolve(flag("--home") ?? "bench-home");
const catalogDir = flag("--catalog") ?? path.join(import.meta.dirname, "..", "..", "seleya", "public", "catalog");
const task = flag("--task") ?? "poster";
const from = flag("--from");
const harness = flag("--harness", "antigravity");
const label = flag("--label", "baseline");

// Real requests people made (run history), so the suite matches actual use.
const POSTER_PROMPT =
  'Poster for "Hạt Mộc Coffee Talk" — a morning talk about specialty coffee, 08:00 Saturday 15/11/2026 at Hạt Mộc, 12 Lý Thường Kiệt, Hà Nội. Warm wood and green plants, earthy tones.';
const SLIDES_BRIEF =
  "Giới thiệu quán cà phê Hạt Mộc ở Hà Nội cho nhà đầu tư: cà phê rang mộc, hạt từ Cầu Đất (Đà Lạt), không gian gỗ và cây xanh, có 3 chi nhánh và 12 loại hạt đặc sản. Mở cửa 7:00–22:00. Mục tiêu: thu hút dân văn phòng đến làm việc buổi sáng. Viết bằng tiếng Việt.";
/** What each edit must leave on the design, to count as done (decided before running). */
const EDIT_TEXT = { instruction: 'Đổi dòng tiêu đề thành "Sáng Thứ Bảy Cùng Cà Phê"', expect: "Sáng Thứ Bảy Cùng Cà Phê" };
const EDIT_VISUAL = {
  instruction: "Make the background picture a sunrise scene with golden morning light; keep all the text as it is.",
};

const catalog = JSON.parse(readFileSync(path.join(catalogDir, "catalog.json"), "utf8")) as {
  recipes: { id: string }[];
};
const keys = JSON.parse(readFileSync(path.join(catalogDir, "keys.json"), "utf8")) as {
  keys: { key_id: string; public_key: string }[];
};
const recipe = (id: string) => {
  const found = catalog.recipes.find((item) => item.id === id);
  if (!found) throw new Error(`no recipe ${id} in the catalog`);
  return found;
};

const generation = await startGeneration({
  home,
  trustedRecipeKeys: Object.fromEntries(keys.keys.map((key) => [key.key_id, key.public_key])),
  log: () => undefined,
});
const { app } = generation;
const accept = (id: string) => {
  const accepted = app.recipes.accept(recipe(id));
  return { recipe_digest: accepted.digest, recipe_id: accepted.id, recipe_version: accepted.version };
};
const source = from ? app.manager.get(from) : undefined;
if (task !== "poster" && task !== "slides" && !source) throw new Error(`--task ${task} needs --from <run id>`);

let run: RunRow;
switch (task) {
  case "poster":
    run = app.manager.create({
      skill: "poster",
      title: "Bench poster",
      harness,
      request: { prompt: POSTER_PROMPT, fields: {}, size: "2:3", width: 1000, height: 1500, variation: 1, of: 1, ...accept("poster") },
    });
    break;
  case "poster-edit-text":
  case "poster-edit-visual": {
    const edit = task === "poster-edit-text" ? EDIT_TEXT : EDIT_VISUAL;
    run = app.manager.create(
      { skill: source!.skill, title: "Bench edit", harness, request: { ...source!.request, edit_instruction: edit.instruction } },
      undefined,
      source,
    );
    break;
  }
  case "slides":
    run = app.manager.create({
      skill: "slides",
      title: "Bench slides",
      harness,
      request: { brief: SLIDES_BRIEF, audience: "team", tone: "professional", language: "vi", length: "short", count: 5, ...accept("slides") },
    });
    break;
  case "slides-refine": {
    const deck = JSON.parse(readFileSync(path.join(app.config.runsDir, source!.id, "out", "deck.json"), "utf8"));
    run = app.manager.create({
      skill: "slides",
      title: "Bench refine",
      harness,
      request: { ...source!.request, instruction: "Ít chữ hơn, mỗi slide tối đa 3 ý", previous_deck: deck, media_from: source!.id },
    });
    break;
  }
  default:
    throw new Error(`unknown task ${task}`);
}

console.error(`${label} ${task}: ${run.id}`);
const terminal = ["completed", "completed_with_issues", "failed", "cancelled", "timed_out", "interrupted"];
while (!terminal.includes(app.manager.get(run.id).localStatus)) await new Promise((resolve) => setTimeout(resolve, 2000));

// When the result was ready for the person (the pipeline completes before its pictures land),
// then when its pictures were in (phase leaves "picture").
const ready = app.manager.get(run.id);
const readyS = ((ready.finishedAt ?? Date.now()) - (ready.startedAt ?? ready.createdAt)) / 1000;
while (app.manager.get(run.id).phase === "picture") await new Promise((resolve) => setTimeout(resolve, 2000));
const done = app.manager.get(run.id);
const row = new DatabaseSync(path.join(home, "seleya.db"), { readOnly: true })
  .prepare("select * from runs where id = ?")
  .get(run.id) as Record<string, unknown>;
const measured = measure(app.config.home, row);
// Task-specific pass rule, written down before running.
let taskPassed = ["completed"].includes(done.localStatus);
// A poster or a picture edit counts only with its picture: without it the run is faster but not
// the same product (image quota out, docs/generation-perf-log.md p1).
if (task === "poster" || task === "poster-edit-visual") {
  const out = path.join(app.config.runsDir, run.id, "out");
  taskPassed &&= ["visual.jpg", "visual.png", "visual.svg"].some((name) => existsSync(path.join(out, name)));
}
if (task === "poster-edit-text") {
  const html = path.join(app.config.runsDir, run.id, "out", "poster.html");
  taskPassed &&= existsSync(html) && readFileSync(html, "utf8").includes(EDIT_TEXT.expect);
}
const record = { label, task, at: new Date().toISOString(), taskPassed, error: done.error, readyS, ...measured };
appendFileSync(path.join(home, "bench.jsonl"), `${JSON.stringify(record)}\n`);
console.log(table([measured]));
console.log(`ready after ${readyS.toFixed(0)} s · task passed: ${taskPassed}${done.error ? ` (${done.error.message})` : ""}`);
await generation.close();
process.exit(0);

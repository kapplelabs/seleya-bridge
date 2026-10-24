/**
 * Turns <home>/bench.jsonl into the tables of docs/generation-perf-log.md: every run, and each task
 * compared with the reference round (docs/generation-performance.md).
 *
 *   node scripts/bench-report.ts --home <bench home> [--reference r0-pdf-fix]
 */
import { readFileSync } from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
const flag = (name: string, fallback: string) => {
  const index = args.indexOf(name);
  return index < 0 ? fallback : (args[index + 1] ?? fallback);
};
const home = flag("--home", "bench-home");
const reference = flag("--reference", "r0-pdf-fix");

interface Row {
  label: string;
  task: string;
  id: string;
  at: string;
  taskPassed: boolean;
  status: string;
  wallS: number;
  startupS: number;
  agentS: number;
  fixS: number;
  mediaS: number;
  renderS: number;
  sessions: unknown[];
  reads: number;
  tools: Record<string, number>;
  tokens: { input: number; output: number; thinking: number; cacheRead: number };
  error?: { code?: string } | null;
}

const rows = readFileSync(path.join(home, "bench.jsonl"), "utf8")
  .split("\n")
  .filter(Boolean)
  .map((line) => JSON.parse(line) as Row);
const k = (n: number) => `${Math.round(n / 1000)}k`;
const tools = (row: Row) => Object.values(row.tools).reduce((a, b) => a + b, 0);
const out = (row: Row) => row.tokens.output + row.tokens.thinking;

console.log("### Every run\n");
console.log("| Round | Task | Run | Result | Wall | Startup | Agent | Fix | Media | Render | Sessions | Reads | Tools | In | Out+think | Cache |");
console.log("|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|");
for (const row of rows)
  console.log(
    `| ${row.label} | ${row.task} | ${row.id.slice(-8)} | ${row.taskPassed ? "pass" : `FAIL ${row.error?.code ?? row.status}`} | ${row.wallS.toFixed(0)} s | ${row.startupS.toFixed(0)} | ${row.agentS.toFixed(0)} | ${row.fixS.toFixed(0)} | ${row.mediaS.toFixed(0)} | ${row.renderS.toFixed(0)} | ${row.sessions.length} | ${row.reads} | ${tools(row)} | ${k(row.tokens.input)} | ${k(out(row))} | ${k(row.tokens.cacheRead)} |`,
  );

console.log(`\n### Against ${reference} (mean of passing runs per round; Δ is vs the reference)\n`);
const pct = (value: number, base: number) => (base ? `${value <= base ? "" : "+"}${Math.round(((value - base) / base) * 100)}%` : "–");
for (const task of [...new Set(rows.map((row) => row.task))]) {
  const byRound = new Map<string, Row[]>();
  for (const row of rows.filter((item) => item.task === task))
    byRound.set(row.label, [...(byRound.get(row.label) ?? []), row]);
  const mean = (list: Row[], pick: (row: Row) => number) =>
    list.length ? list.reduce((total, row) => total + pick(row), 0) / list.length : 0;
  const base = (byRound.get(reference) ?? []).filter((row) => row.taskPassed);
  console.log(`**${task}**\n`);
  console.log("| Round | Runs (pass) | Wall | Δ wall | Input tokens | Δ input | Out+think | Tools | Δ tools |");
  console.log("|---|---|---|---|---|---|---|---|---|");
  for (const [label, list] of byRound) {
    const passing = list.filter((row) => row.taskPassed);
    const wall = mean(passing, (row) => row.wallS);
    const input = mean(passing, (row) => row.tokens.input);
    const count = mean(passing, tools);
    console.log(
      `| ${label} | ${list.length} (${passing.length}) | ${passing.length ? `${wall.toFixed(0)} s` : "–"} | ${passing.length && base.length ? pct(wall, mean(base, (row) => row.wallS)) : "–"} | ${passing.length ? k(input) : "–"} | ${passing.length && base.length ? pct(input, mean(base, (row) => row.tokens.input)) : "–"} | ${passing.length ? k(mean(passing, out)) : "–"} | ${passing.length ? count.toFixed(0) : "–"} | ${passing.length && base.length ? pct(count, mean(base, tools)) : "–"} |`,
    );
  }
  console.log("");
}

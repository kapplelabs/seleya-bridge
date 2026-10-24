/**
 * Measures finished generation runs from what they left behind (docs/generation-performance.md):
 * wall time per phase from the run's steps, and agent sessions, turns, tool calls and tokens from
 * the harness log (Antigravity and Claude Code stream-json both report usage).
 *
 *   node scripts/bench-runs.ts [--home <generation home>] [--json] [run_id …]
 *
 * With no run ids, every run in the store is listed, oldest first.
 */
import { homedir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import { measure, table } from "./bench-lib.ts";

const args = process.argv.slice(2);
const flag = (name: string) => {
  const index = args.indexOf(name);
  if (index < 0) return undefined;
  const value = args[index + 1];
  args.splice(index, 2);
  return value;
};
const json = args.includes("--json");
if (json) args.splice(args.indexOf("--json"), 1);
const home =
  flag("--home") ??
  path.join(process.env.SELEYA_BRIDGE_HOME ?? path.join(homedir(), ".config", "seleya-bridge"), "generation");

const db = new DatabaseSync(path.join(home, "seleya.db"), { readOnly: true });
const rows = (
  args.length
    ? args.map((id) => db.prepare("select * from runs where id = ?").get(id))
    : db.prepare("select * from runs order by created_at").all()
).filter(Boolean) as Record<string, unknown>[];

const measures = rows.map((row) => measure(home, row));
if (json) console.log(JSON.stringify(measures, null, 2));
else console.log(table(measures));

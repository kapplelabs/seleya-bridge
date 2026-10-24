// Stand-in agent for descriptor tests: behaves like a skill-following agent, no AI.
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const [folder, prompt] = process.argv.slice(2);
const progress = (record) =>
  appendFileSync(path.join(folder, "progress.jsonl"), `${JSON.stringify(record)}\n`);
console.log(`fake agent got: ${prompt.split("\n")[0]}`);
progress({ type: "step", label: "Preparing", status: "active" });
progress({ type: "step", label: "Preparing", status: "done", detail: "ok" });
progress({ type: "step", label: "Producing", status: "active" });
mkdirSync(path.join(folder, "out"), { recursive: true });
writeFileSync(path.join(folder, "out", "result.txt"), "from fake agent");
progress({ type: "step", label: "Producing", status: "done" });
writeFileSync(path.join(folder, "out", "result.json"), JSON.stringify({ skill: "_scripted" }));
console.log("done");

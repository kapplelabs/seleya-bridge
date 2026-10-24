import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import { ChromeRenderer, findChrome } from "../../src/generation/render/chrome.ts";

const chrome = findChrome();
const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

/** A Chrome left running on a profile by a bridge that is gone (it was killed, its Chrome was not). */
async function orphan(profile: string) {
  const child = spawn(chrome!, ["--headless=new", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "about:blank"], {
    stdio: "ignore",
    detached: true,
  });
  child.unref();
  for (let attempt = 0; attempt < 100 && !existsSync(path.join(profile, "DevToolsActivePort")); attempt++)
    await new Promise((resolve) => setTimeout(resolve, 100));
  return child.pid!;
}

for (const [name, profileOf] of [
  ["the shared profile of an older bridge", (root: string) => root],
  ["the profile of a bridge that is gone", (root: string) => path.join(root, "999999")],
] as const)
  test(`renders although a Chrome orphaned on ${name} holds it`, { skip: !chrome }, async () => {
    const home = mkdtempSync(path.join(tmpdir(), "render-"));
    const root = path.join(home, "chrome");
    const pid = await orphan(profileOf(root));
    const renderer = new ChromeRenderer(home);
    try {
      const page = path.join(home, "page.html");
      writeFileSync(page, "<body style='margin:0'><h1>Hello</h1></body>");
      const result = await renderer.render(page, 400, 300);
      assert.match(result.text, /Hello/);
      assert.equal(alive(pid), false, "the orphaned Chrome was stopped");
    } finally {
      await renderer.close();
      if (alive(pid)) process.kill(pid, "SIGKILL");
      rmSync(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
    }
  });

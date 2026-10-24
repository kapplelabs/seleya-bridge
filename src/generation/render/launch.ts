/**
 * Starting the headless Chrome the renderer drives, so that it starts whatever an earlier bridge left
 * behind (docs/generation-perf-log.md, "Chrome did not start its DevTools endpoint"):
 *
 * - every bridge process has its own profile (`chrome/<pid>`): a Chrome orphaned by a bridge that was
 *   killed kept the shared profile locked, and Chrome refuses a locked profile and exits;
 * - at start, profiles of bridges that are gone are cleared, their orphaned Chrome stopped;
 * - when Chrome still does not come up, it is tried once more on a fresh profile;
 * - Chrome is stopped when the bridge exits, however it exits.
 */
import { type ChildProcess, execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, readlinkSync, rmSync } from "node:fs";
import path from "node:path";

/** Chrome-family browsers that run headless with the DevTools protocol, in order of preference. */
const BROWSERS = [
  process.env.SELEYA_CHROME,
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
  "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
  "/usr/bin/google-chrome",
  "/usr/bin/google-chrome-stable",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
  "/usr/bin/microsoft-edge",
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
].filter((item): item is string => Boolean(item));

export function findBrowsers(): string[] {
  return BROWSERS.filter((candidate) => existsSync(candidate));
}

const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

/** The command line of a process, or undefined (gone, or not readable on this system). */
function commandOf(pid: number): string | undefined {
  try {
    return execFileSync("ps", ["-o", "command=", "-p", String(pid)], { encoding: "utf8", timeout: 2000 }).trim();
  } catch {
    return undefined;
  }
}

/**
 * Clears the profiles under `root` that belong to no running bridge: stops a Chrome still using one
 * (only one started with that very profile) and removes the folder. The profile of a bridge still
 * running (another instance, tests) is left alone.
 */
export function clearStaleProfiles(root: string): void {
  if (!existsSync(root)) return;
  for (const name of readdirSync(root)) {
    const dir = path.join(root, name);
    const owner = Number(/^(\d+)(?:-\d+)?$/.exec(name)?.[1]);
    // The shared profile of older bridges is a folder of Chrome files directly under root.
    const legacy = name === "SingletonLock";
    if (!legacy && !(owner > 0)) continue;
    if (owner === process.pid || (owner > 0 && alive(owner))) continue;
    const profile = legacy ? root : dir;
    const lock = path.join(profile, "SingletonLock");
    let holder: number | undefined;
    try {
      holder = Number(/-(\d+)$/.exec(readlinkSync(lock))?.[1]) || undefined;
    } catch {
      holder = undefined;
    }
    if (holder && alive(holder) && commandOf(holder)?.includes(`--user-data-dir=${profile}`)) {
      try {
        process.kill(holder, "SIGKILL");
      } catch {
        // already gone
      }
    }
    for (const file of ["SingletonLock", "SingletonSocket", "SingletonCookie", "DevToolsActivePort"])
      rmSync(path.join(profile, file), { force: true });
    if (!legacy) rmSync(dir, { recursive: true, force: true });
  }
}


export interface Launched {
  process: ChildProcess;
  /** `ws://127.0.0.1:<port>/devtools/browser/<id>` */
  endpoint: string;
}

const running = new Set<ChildProcess>();
let exitHook = false;

function stopAllOnExit() {
  if (exitHook) return;
  exitHook = true;
  // "exit" handlers run synchronously, also after process.exit(): a kill is synchronous.
  process.on("exit", () => {
    for (const child of running) child.kill("SIGKILL");
  });
}

async function launchOnce(browser: string, profile: string): Promise<Launched> {
  mkdirSync(profile, { recursive: true });
  rmSync(path.join(profile, "DevToolsActivePort"), { force: true });
  const child = spawn(
    browser,
    [
      "--headless=new",
      "--remote-debugging-port=0",
      `--user-data-dir=${profile}`,
      "--allow-file-access-from-files",
      "--hide-scrollbars",
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-gpu",
      "about:blank",
    ],
    { stdio: ["ignore", "ignore", "pipe"] },
  );
  running.add(child);
  child.on("exit", () => running.delete(child));
  let stderr = "";
  child.stderr?.setEncoding("utf8");
  child.stderr?.on("data", (chunk: string) => (stderr = (stderr + chunk).slice(-2000)));
  const portFile = path.join(profile, "DevToolsActivePort");
  for (let attempt = 0; attempt < 150 && !existsSync(portFile); attempt++) {
    if (child.exitCode !== null) break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  if (!existsSync(portFile)) {
    child.kill("SIGKILL");
    const reason = stderr.split("\n").find((line) => /ERROR|error/.test(line))?.replace(/^\[[^\]]*\]\s*/, "");
    throw new Error(`the browser did not open its DevTools endpoint${reason ? ` (${reason.slice(0, 200)})` : ""}`);
  }
  const [port, browserPath] = readFileSync(portFile, "utf8").trim().split("\n");
  return { process: child, endpoint: `ws://127.0.0.1:${port}${browserPath}` };
}

/**
 * Starts a headless browser for this process under `root`: each installed Chrome-family browser in
 * turn, each on this process's profile and then on a fresh one.
 */
export async function launchBrowser(root: string): Promise<Launched> {
  stopAllOnExit();
  clearStaleProfiles(root);
  const browsers = findBrowsers();
  if (browsers.length === 0)
    throw new Error("No Chrome, Chromium, Edge or Brave was found: one is needed to render designs.");
  const errors: string[] = [];
  for (const browser of browsers)
    for (const profile of [path.join(root, String(process.pid)), path.join(root, `${process.pid}-${Date.now()}`)]) {
      try {
        return await launchOnce(browser, profile);
      } catch (error) {
        errors.push(`${path.basename(browser)}: ${error instanceof Error ? error.message : String(error)}`);
        rmSync(profile, { recursive: true, force: true });
      }
    }
  throw new Error(`No browser could start: ${errors.join("; ")}`);
}

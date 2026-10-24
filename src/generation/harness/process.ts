import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";

/** A harness process: its stdout as lines, its exit, and a stop that takes the whole process group down. */
export interface HarnessProcess {
  onLine(listener: (line: string) => void): void;
  /** Exit code (null when killed) and the tail of stderr, once the process is gone. */
  exited: Promise<{ code: number | null; stderr: string }>;
  stop(): Promise<void>;
}

const STOP_GRACE_MS = 5_000;

export interface SpawnOptions {
  command: string;
  args: string[];
  cwd: string;
  /** Where stdout and stderr are copied (raw harness log; never synced). */
  logFile?: string;
  env?: NodeJS.ProcessEnv;
}

/**
 * Starts a harness in its own process group (so a stop also ends the tools it started) with stdin
 * closed, and reads stdout line by line.
 */
export function spawnHarness(options: SpawnOptions): HarnessProcess {
  const child = spawn(options.command, options.args, {
    cwd: options.cwd,
    env: options.env ?? process.env,
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const log = options.logFile ? createWriteStream(options.logFile, { flags: "a" }) : undefined;
  const listeners: ((line: string) => void)[] = [];
  let buffer = "";
  let stderr = "";
  let alive = true;

  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => {
    log?.write(chunk);
    buffer += chunk;
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) if (line.trim()) for (const listener of listeners) listener(line);
  });
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk: string) => {
    log?.write(chunk);
    stderr = (stderr + chunk).slice(-8_000);
  });

  const exited = new Promise<{ code: number | null; stderr: string }>((resolve) => {
    const finish = (code: number | null) => {
      if (!alive) return;
      alive = false;
      if (buffer.trim()) for (const listener of listeners) listener(buffer);
      buffer = "";
      log?.end();
      resolve({ code, stderr });
    };
    child.on("exit", (code) => finish(code));
    child.on("error", (error) => {
      stderr += `\n${error.message}`;
      finish(127);
    });
  });

  const signalGroup = (signal: NodeJS.Signals) => {
    if (!alive || child.pid === undefined) return;
    try {
      process.kill(-child.pid, signal);
    } catch {
      child.kill(signal);
    }
  };

  return {
    onLine: (listener) => listeners.push(listener),
    exited,
    stop: async () => {
      if (!alive) return;
      signalGroup("SIGTERM");
      const timer = setTimeout(() => signalGroup("SIGKILL"), STOP_GRACE_MS);
      await exited;
      clearTimeout(timer);
    },
  };
}

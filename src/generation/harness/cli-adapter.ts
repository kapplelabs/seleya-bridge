import { execFile } from "node:child_process";
import path from "node:path";

import { classifyFailure, failureMessage } from "./classify.ts";
import { PARSERS, type StreamKind } from "./parsers.ts";
import { spawnHarness } from "./process.ts";
import type {
  Harness,
  HarnessActivity,
  HarnessExit,
  HarnessHandle,
  HarnessStartInput,
  HarnessStatus,
} from "./types.ts";

const PROBE_TIMEOUT_MS = 15_000;

/** Runs a short command for a probe; never throws. */
export function run(
  command: string,
  args: string[],
  timeoutMs = PROBE_TIMEOUT_MS,
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    execFile(command, args, { timeout: timeoutMs, maxBuffer: 1 << 20 }, (error, stdout, stderr) => {
      const code = error ? (typeof error.code === "number" ? error.code : 1) : 0;
      resolve({ code, stdout: String(stdout), stderr: String(stderr) });
    });
  });
}

export async function installed(command: string): Promise<boolean> {
  return (await run("/bin/sh", ["-c", `command -v ${JSON.stringify(command)}`], 5_000)).code === 0;
}

export interface ArgsInput {
  prompt: string;
  folder: string;
  timeLimitS: number;
}

/** Everything that differs between CLI harnesses; the behaviour around it is shared. */
export interface CliDefinition {
  id: string;
  name: string;
  kind: "builtin" | "descriptor";
  command: string;
  args: (input: ArgsInput) => string[];
  stream: StreamKind;
  /** Media kinds it can make (spec 008). */
  capabilities: string[];
  signInCommand?: string;
  /** Called only when the command is installed. */
  probe: () => Promise<{ signedIn: boolean; version?: string; detail?: string }>;
}

/** A harness that runs a CLI agent headless and reads its JSON stream. */
export class CliHarness implements Harness {
  readonly id: string;
  readonly name: string;
  readonly definition: CliDefinition;

  constructor(definition: CliDefinition) {
    this.definition = definition;
    this.id = definition.id;
    this.name = definition.name;
  }

  async check(): Promise<HarnessStatus> {
    const { command, capabilities, signInCommand } = this.definition;
    const canGenerateImages = capabilities.includes("image");
    if (!(await installed(command)))
      return {
        installed: false,
        signedIn: false,
        canGenerateImages,
        capabilities,
        signInCommand,
        detail: `\`${command}\` is not installed.`,
      };
    const probe = await this.definition.probe();
    return { installed: true, canGenerateImages, capabilities, signInCommand, ...probe };
  }

  start(input: HarnessStartInput): HarnessHandle {
    const definition = this.definition;
    const parse = PARSERS[definition.stream];
    const proc = spawnHarness({
      command: definition.command,
      args: definition.args({
        prompt: input.prompt,
        folder: input.folder,
        timeLimitS: Math.ceil(input.skill.timeLimitMs / 1000),
      }),
      cwd: input.folder,
      logFile: path.join(input.folder, "harness.log"),
    });
    const listeners: ((activity: HarnessActivity) => void)[] = [];
    const errors: string[] = [];
    let outcome: { ok: boolean; text?: string } | undefined;

    proc.onLine((line) => {
      const parsed = parse(line);
      if (parsed.error) errors.push(parsed.error);
      if (parsed.outcome) outcome = parsed.outcome;
      for (const activity of parsed.activity) for (const listener of listeners) listener(activity);
    });

    const exited: Promise<HarnessExit> = proc.exited.then(({ code, stderr }) => {
      if (outcome?.ok || (!outcome && code === 0 && errors.length === 0)) return { ok: true };
      const text = [outcome?.text, ...errors, stderr].filter(Boolean).join("\n");
      const failure = code === 127 && !outcome ? "crashed" : classifyFailure(text);
      return {
        ok: false,
        code: failure,
        message: failureMessage(failure, definition.name, definition.signInCommand),
      };
    });

    return {
      onActivity: (listener) => listeners.push(listener),
      exited,
      stop: () => proc.stop(),
    };
  }
}

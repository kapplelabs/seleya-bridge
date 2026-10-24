import { execFile } from "node:child_process";
import path from "node:path";

import { classifyFailure, failureMessage } from "./classify.ts";
import { withoutPaths } from "./describe.ts";
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
  /** Media kinds this task makes (a media job); an agent may then use the person's MCP servers. */
  needs?: string[];
  /** A conversation to continue; only passed to a definition that `canResume`. */
  resume?: string;
  effort?: "low" | "medium" | "high";
}

/** Everything that differs between CLI harnesses; the behaviour around it is shared. */
export interface CliDefinition {
  id: string;
  name: string;
  kind: "builtin" | "descriptor";
  command: string;
  args: (input: ArgsInput) => string[];
  /** Its `args` continue `resume` when given one. */
  canResume?: boolean;
  stream: StreamKind;
  /** Media kinds it can make (spec 008). */
  capabilities: string[];
  signInCommand?: string;
  /** Called only when the command is installed. */
  probe: () => Promise<{ signedIn: boolean; version?: string; detail?: string; capabilities?: string[] }>;
}

/** "Antigravity was not allowed to read …/transcript.jsonl (outside this run's folder)." */
export function deniedMessage(agent: string, action: string, folder: string): string {
  const match = /^([a-z_]+)\((.*)\)$/.exec(action);
  const verb = (match?.[1] ?? "use").replace(/_file$/, "").replace(/_/g, " ");
  const target = withoutPaths(match?.[2] ?? "", folder);
  return `${agent} was not allowed to ${verb} ${target || "a file"} (outside this run's folder) and stopped.`;
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
    // Kinds the agent gains from what the person connected to it (MCP servers), on top of its own.
    const { capabilities: gained = [], ...probe } = await this.definition.probe();
    const all = [...new Set([...capabilities, ...gained])];
    return {
      installed: true,
      canGenerateImages: all.includes("image"),
      capabilities: all,
      signInCommand,
      ...probe,
    };
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
        resume: definition.canResume ? input.resume : undefined,
        needs: input.needs,
        effort: input.effort,
      }),
      cwd: input.folder,
      logFile: input.logFile ?? path.join(input.folder, "harness.log"),
    });
    const listeners: ((activity: HarnessActivity) => void)[] = [];
    const errors: string[] = [];
    let outcome: { ok: boolean; text?: string } | undefined;
    let denied: string | undefined;
    let session: string | undefined;

    proc.onLine((line) => {
      const parsed = parse(line);
      if (parsed.error) errors.push(parsed.error);
      if (parsed.denied) denied = parsed.denied;
      if (parsed.outcome) outcome = parsed.outcome;
      if (parsed.session) session = parsed.session;
      for (const activity of parsed.activity) for (const listener of listeners) listener(activity);
    });

    const exited: Promise<HarnessExit> = proc.exited.then(({ code, stderr }) => {
      if (outcome?.ok || (!outcome && code === 0 && errors.length === 0))
        return denied
          ? {
              ok: true,
              code: "denied",
              message: deniedMessage(definition.name, denied, input.folder),
              session,
            }
          : { ok: true, session, text: outcome?.text };
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

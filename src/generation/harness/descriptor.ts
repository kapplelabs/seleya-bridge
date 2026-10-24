import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { mediaKinds } from "../media/catalog.ts";
import { CliHarness, run } from "./cli-adapter.ts";
import type { StreamKind } from "./parsers.ts";

/** Flags that switch an agent's permission checks off; a descriptor using any is rejected (FR-011). */
const BYPASS = [
  /--dangerously/i, // --dangerously-skip-permissions, --dangerously-bypass-approvals-and-sandbox…
  /\byolo\b/i, // --yolo, --approval-mode yolo, --approval-mode=yolo
  /bypassPermissions/i,
  /danger-full-access/i,
  /(^|\s)-y(\s|$)/, // Gemini CLI's short form of --yolo
];

/** A shell would interpret the request text; descriptors must start the agent binary directly. */
const SHELLS = new Set([
  "sh",
  "bash",
  "zsh",
  "fish",
  "dash",
  "ksh",
  "cmd",
  "cmd.exe",
  "powershell",
  "pwsh",
]);

const STREAMS: StreamKind[] = ["antigravity", "claude", "codex", "lines"];

export interface DescriptorLoad {
  harnesses: CliHarness[];
  rejected: { file: string; reason: string }[];
}

interface Descriptor {
  id?: unknown;
  name?: unknown;
  detect?: { command?: unknown };
  signed_in?: { command?: unknown; args?: unknown; expect_exit_zero?: unknown };
  start?: { command?: unknown; args?: unknown };
  stream?: unknown;
  can_generate_images?: unknown;
  capabilities?: unknown;
  sign_in_command?: unknown;
}

const strings = (value: unknown) =>
  Array.isArray(value) && value.every((item) => typeof item === "string")
    ? (value as string[])
    : undefined;

export function parseDescriptor(raw: unknown): CliHarness {
  const value = (raw ?? {}) as Descriptor;
  const id = typeof value.id === "string" && /^[a-z0-9-]+$/.test(value.id) ? value.id : undefined;
  const command = typeof value.start?.command === "string" ? value.start.command : undefined;
  const args = strings(value.start?.args);
  if (!id || !command || !args)
    throw new Error("needs `id` (a-z, 0-9, -), `start.command` and `start.args`");
  if (SHELLS.has(path.basename(command).toLowerCase()))
    throw new Error(
      "`start.command` must be the agent program itself, not a shell (the request text would be run as shell code)",
    );
  const everything = [
    command,
    ...args,
    typeof value.detect?.command === "string" ? value.detect.command : "",
    typeof value.signed_in?.command === "string" ? value.signed_in.command : "",
    ...(strings(value.signed_in?.args) ?? []),
  ].join(" ");
  const bypass = BYPASS.find((pattern) => pattern.test(everything));
  if (bypass)
    throw new Error(
      `it switches the agent's permission checks off (${bypass.source.replace(/\\/g, "")})`,
    );
  const stream = STREAMS.find((item) => item === value.stream) ?? "lines";
  const signedIn = value.signed_in;
  const probeCommand = typeof signedIn?.command === "string" ? signedIn.command : undefined;
  const probeArgs = strings(signedIn?.args) ?? [];

  return new CliHarness({
    id,
    name: typeof value.name === "string" ? value.name : id,
    kind: "descriptor",
    command,
    stream,
    // `capabilities: ["image", "audio"]`; the older `can_generate_images: true` means image.
    capabilities: mediaKinds([
      ...(Array.isArray(value.capabilities) ? value.capabilities : []),
      ...(value.can_generate_images === true ? ["image"] : []),
    ]),
    signInCommand: typeof value.sign_in_command === "string" ? value.sign_in_command : undefined,
    args: ({ prompt, folder, timeLimitS }) =>
      args.map((arg) =>
        arg
          .replaceAll("{prompt}", prompt)
          .replaceAll("{folder}", folder)
          .replaceAll("{time_limit_s}", String(timeLimitS)),
      ),
    probe: async () => {
      if (!probeCommand) return { signedIn: true };
      const result = await run(probeCommand, probeArgs);
      return {
        signedIn: result.code === 0,
        detail: result.code === 0 ? undefined : result.stderr.trim().split("\n")[0],
      };
    },
  });
}

/** Loads `<home>/harnesses/*.json`; bad files are reported, never loaded. */
export function loadDescriptors(dir: string): DescriptorLoad {
  const load: DescriptorLoad = { harnesses: [], rejected: [] };
  if (!existsSync(dir)) return load;
  for (const file of readdirSync(dir).filter((name) => name.endsWith(".json"))) {
    try {
      load.harnesses.push(parseDescriptor(JSON.parse(readFileSync(path.join(dir, file), "utf8"))));
    } catch (error) {
      load.rejected.push({ file, reason: error instanceof Error ? error.message : String(error) });
    }
  }
  return load;
}

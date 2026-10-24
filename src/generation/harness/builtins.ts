/**
 * The three CLI agents Seleya knows (research R1, R2). Every command keeps the agent's permission
 * checks on and points it at the run folder only.
 */
import { DECLARED } from "../media/declarations.ts";
import { CliHarness, run } from "./cli-adapter.ts";

const firstLine = (text: string) => text.trim().split("\n")[0]?.trim() || undefined;

/** `agy models` id used unless SELEYA_ANTIGRAVITY_MODEL names another. */
export const ANTIGRAVITY_DEFAULT_MODEL = "gemini-3.8-flash-medium";

export const antigravity = new CliHarness({
  id: "antigravity",
  name: "Antigravity",
  kind: "builtin",
  command: "agy",
  stream: "antigravity",
  capabilities: DECLARED.antigravity ?? [],
  signInCommand: "agy",
  args: ({ prompt, folder, timeLimitS }) => [
    // Flags before --print: agy's Go flag parser would otherwise take them as the prompt.
    // Antigravity's quota is per model: a fast model by default, SELEYA_ANTIGRAVITY_MODEL to change it.
    "--model",
    process.env.SELEYA_ANTIGRAVITY_MODEL || ANTIGRAVITY_DEFAULT_MODEL,
    "--mode",
    "accept-edits",
    "--sandbox",
    "--output-format",
    "stream-json",
    "--new-project",
    "--add-dir",
    folder,
    "--print-timeout",
    `${timeLimitS}s`,
    "--print",
    prompt,
  ],
  probe: async () => {
    const [models, version] = await Promise.all([
      run("agy", ["models"]),
      run("agy", ["--version"], 5_000),
    ]);
    const signedIn = models.code === 0 && /\t/.test(models.stdout);
    return {
      signedIn,
      version: firstLine(version.stdout),
      detail: signedIn ? undefined : firstLine(models.stderr || models.stdout),
    };
  },
});

export const claudeCode = new CliHarness({
  id: "claude",
  name: "Claude Code",
  kind: "builtin",
  command: "claude",
  stream: "claude",
  capabilities: DECLARED.claude ?? [],
  signInCommand: "claude /login",
  args: ({ prompt }) => [
    "-p",
    prompt,
    "--output-format",
    "stream-json",
    "--verbose",
    "--include-partial-messages",
    "--permission-mode",
    "acceptEdits",
    "--allowedTools",
    "Bash(printf:*)",
    "Bash(mkdir:*)",
    // No `cp`: it takes any source path, so it could copy files from outside the run folder in.
    "Bash(sips:*)",
    "--strict-mcp-config",
  ],
  probe: async () => {
    const [status, version] = await Promise.all([
      run("claude", ["auth", "status"]),
      run("claude", ["--version"], 5_000),
    ]);
    let signedIn: boolean;
    try {
      signedIn = (JSON.parse(status.stdout) as { loggedIn?: unknown }).loggedIn === true;
    } catch {
      signedIn = false;
    }
    return {
      signedIn,
      version: firstLine(version.stdout),
      detail: signedIn ? undefined : "Not signed in.",
    };
  },
});

export const codex = new CliHarness({
  id: "codex",
  name: "Codex",
  kind: "builtin",
  command: "codex",
  stream: "codex",
  capabilities: DECLARED.codex ?? [],
  signInCommand: "codex login",
  args: ({ prompt, folder }) => [
    "exec",
    "--json",
    "--skip-git-repo-check",
    "-s",
    "workspace-write",
    "-C",
    folder,
    prompt,
  ],
  probe: async () => {
    const [status, version] = await Promise.all([
      run("codex", ["login", "status"]),
      run("codex", ["--version"], 5_000),
    ]);
    const text = `${status.stdout}\n${status.stderr}`;
    const signedIn = status.code === 0 && /logged in/i.test(text) && !/not logged in/i.test(text);
    return { signedIn, version: firstLine(version.stdout), detail: firstLine(text) };
  },
});

export const BUILTIN_CLI_HARNESSES = [antigravity, claudeCode, codex];

/**
 * The three CLI agents Seleya knows (research R1, R2). Every command keeps the agent's permission
 * checks on and points it at the run folder only.
 */
import { generationHome } from "../config.ts";
import { DECLARED } from "../media/declarations.ts";
import { claudeMcpKinds, claudeMcpServers, declaredMcp, type McpServer, mediaMcpServers } from "../media/mcp.ts";
import { CliHarness, run } from "./cli-adapter.ts";

const firstLine = (text: string) => text.trim().split("\n")[0]?.trim() || undefined;

/** `agy models` id used unless SELEYA_ANTIGRAVITY_MODEL names another. */
export const ANTIGRAVITY_DEFAULT_MODEL = "gemini-3.8-flash-medium";

/**
 * Antigravity's thinking level is part of the model id (`agy models`: …-low, …-medium, …-high), so an
 * effort picks the id with that suffix.
 */
export function antigravityModel(effort?: "low" | "medium" | "high"): string {
  const model = process.env.SELEYA_ANTIGRAVITY_MODEL || ANTIGRAVITY_DEFAULT_MODEL;
  return effort ? model.replace(/-(low|medium|high)$/, `-${effort}`) : model;
}

export const antigravity = new CliHarness({
  id: "antigravity",
  name: "Antigravity",
  kind: "builtin",
  command: "agy",
  stream: "antigravity",
  capabilities: DECLARED.antigravity ?? [],
  signInCommand: "agy",
  canResume: true,
  args: ({ prompt, folder, timeLimitS, resume, effort }) => [
    // Flags before --print: agy's Go flag parser would otherwise take them as the prompt.
    // Antigravity's quota is per model: a fast model by default, SELEYA_ANTIGRAVITY_MODEL to change it.
    "--model",
    antigravityModel(effort),
    "--mode",
    "accept-edits",
    "--sandbox",
    "--output-format",
    "stream-json",
    ...(resume ? ["--conversation", resume] : ["--new-project"]),
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
  canResume: true,
  args: ({ prompt, resume, effort, needs }) => {
    // A media job may use the person's MCP servers that make that media, and only those.
    const servers = Object.assign(
      {},
      ...(needs ?? []).map((kind) => mediaMcpServers(kind, claudeMcpServers(), declaredMcp(generationHome()))),
    ) as Record<string, McpServer>;
    const media = Object.keys(servers);
    return [
      "-p",
      prompt,
      ...(resume ? ["--resume", resume] : []),
      ...(effort ? ["--effort", effort] : []),
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
      // A generator that answers with a link: its picture is fetched into the run folder.
      ...(media.length ? ["Bash(curl:*)", ...media.map((name) => `mcp__${name}`)] : []),
      ...(media.length ? ["--mcp-config", JSON.stringify({ mcpServers: servers })] : []),
      "--strict-mcp-config",
    ];
  },
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
      capabilities: claudeMcpKinds(generationHome()),
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

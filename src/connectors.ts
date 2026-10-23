/**
 * claude.ai connectors (Gmail, Google Calendar, Slack…) for web requests, read-only.
 *
 * Connectors belong to the claude.ai account Claude Code is signed in with, and only a session that loads
 * the user's settings lists them. Web runs never load those settings (see claude.ts), so the bridge looks
 * the configured connectors up once, in a discovery session that sends no prompt and has no tools, and
 * keeps each one's `claudeai-proxy` config. Every run then gets exactly those servers, keyed by Seleya
 * connector id (`mcp__gmail__search_threads`), with the read-only tools allowed and every other tool removed.
 */
import { query, type McpServerStatus, type McpServerStatusConfig } from "@anthropic-ai/claude-agent-sdk";

import type { BridgeConfig } from "./config.ts";

const DISCOVERY_TIMEOUT_MS = 30_000;
const POLL_MS = 1_000;

export type ConnectorState = "connected" | "unavailable";

export interface ConnectorInfo {
  /** Seleya connector id, the key in config.connectors and in tool names. */
  id: string;
  /** claude.ai connector name, e.g. "Google Calendar". */
  name: string;
  state: ConnectorState;
  /** Read-only tools Claude may call (bare names, e.g. search_threads). */
  tools: string[];
  /** Why the connector can't be used, when it can't. */
  error?: string;
}

export interface ConnectorSet {
  connectors: ConnectorInfo[];
  /** Passed as the run's mcpServers: each connector's `claudeai-proxy` config, as discovery reported it. */
  mcpServers: Record<string, McpServerStatusConfig>;
  /** Full names of the read-only tools: the run's allowedTools. */
  readOnlyTools: string[];
  /** Full names of every other tool: removed from the run with disallowedTools. */
  writeTools: string[];
  /** Auto mode: claude.ai connectors left out because they aren't connected here (needs-auth, failed…). */
  skipped: string[];
}

export const EMPTY_CONNECTORS: ConnectorSet = {
  connectors: [],
  mcpServers: {},
  readOnlyTools: [],
  writeTools: [],
  skipped: [],
};

const CLAUDE_AI_PREFIX = "claude.ai ";

const claudeAiName = (name: string) => `${CLAUDE_AI_PREFIX}${name}`;

/**
 * Seleya connector ids for claude.ai connector names, so Seleya shows its own name and icon. Connectors
 * not listed here get an id made from their name (Google Sheets → google_sheets).
 */
const SELEYA_IDS: Record<string, string> = {
  Gmail: "gmail",
  "Google Calendar": "calendar",
  "Google Drive": "drive",
  Slack: "slack",
  GitHub: "github",
  GitLab: "gitlab",
  Jira: "jira",
  // claude.ai's Atlassian connector covers Jira and Confluence; Jira is what Seleya's agents read from it.
  Atlassian: "jira",
  Confluence: "confluence",
  Notion: "notion",
  Linear: "linear",
  Figma: "figma",
  Dropbox: "dropbox",
  HubSpot: "hubspot",
  Zoom: "zoom",
  "Microsoft Outlook": "outlook",
  Outlook: "outlook",
  "Microsoft Teams": "teams",
};

/** `mcp__<server>__<tool>`; the SDK replaces characters such as spaces and dots with `_`. */
export const toolName = (id: string, tool: string) => `mcp__${id.replace(/[^A-Za-z0-9_-]/g, "_")}__${tool}`;

/** The same set narrowed to `ids`: a run that needs one connector gets only that connector's tools. */
export function onlyConnectors(set: ConnectorSet, ids: string[]): ConnectorSet {
  const keep = new Set(ids);
  const prefixes = ids.map((id) => toolName(id, ""));
  const belongs = (tool: string) => prefixes.some((prefix) => tool.startsWith(prefix));
  return {
    connectors: set.connectors.filter((item) => keep.has(item.id)),
    mcpServers: Object.fromEntries(Object.entries(set.mcpServers).filter(([id]) => keep.has(id))),
    readOnlyTools: set.readOnlyTools.filter(belongs),
    // Still removed, whichever connector they belong to.
    writeTools: set.writeTools,
    skipped: [],
  };
}

const isSettled = (status: McpServerStatus | undefined) =>
  status !== undefined && status.status !== "pending";

const isClaudeAi = (status: McpServerStatus) =>
  status.scope === "claudeai" || status.name.startsWith(CLAUDE_AI_PREFIX);

/** "Google Sheets" → "google_sheets"; ids start with a letter, like the ones in config. */
function idFromName(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return /^[a-z]/.test(slug) ? slug : `c_${slug}`;
}

/** True when the config asks for any connectors. */
export const wantsConnectors = (config: BridgeConfig) =>
  config.connectors === "auto" || Object.keys(config.connectors).length > 0;

/** Every connected claude.ai connector, by Seleya connector id (ids made unique). */
function connectedConnectors(statuses: McpServerStatus[]): [string, string][] {
  const used = new Set<string>();
  const result: [string, string][] = [];
  for (const status of statuses) {
    if (!isClaudeAi(status) || status.status !== "connected") continue;
    const name = status.name.startsWith(CLAUDE_AI_PREFIX) ? status.name.slice(CLAUDE_AI_PREFIX.length) : status.name;
    const base = SELEYA_IDS[name] ?? idFromName(name);
    let id = base;
    for (let n = 2; used.has(id); n++) id = `${base}_${n}`;
    used.add(id);
    result.push([id, name]);
  }
  return result;
}

/** Looks up the configured connectors; never throws (a connector that can't be found is "unavailable"). */
export async function discoverConnectors(config: BridgeConfig, version: string): Promise<ConnectorSet> {
  if (!wantsConnectors(config)) return EMPTY_CONNECTORS;
  const auto = config.connectors === "auto";
  const listed = config.connectors === "auto" ? [] : Object.entries(config.connectors);

  // A prompt stream that never yields: the session starts, connects its MCP servers and is closed before
  // anything is sent to the model.
  let release = () => {};
  const held = new Promise<void>((resolve) => (release = resolve));
  async function* noPrompt() {
    await held;
  }
  const session = query({
    prompt: noPrompt(),
    options: {
      settingSources: ["user"],
      tools: [],
      pathToClaudeCodeExecutable: config.claudeExecutable,
      env: { ...process.env, CLAUDE_AGENT_SDK_CLIENT_APP: `seleya-bridge/${version}` },
    },
  });
  // Start the session; messages are not needed.
  void session[Symbol.asyncIterator]().next().catch(() => {});

  let statuses: McpServerStatus[] = [];
  try {
    const deadline = Date.now() + DISCOVERY_TIMEOUT_MS;
    while (Date.now() < deadline) {
      statuses = await session.mcpServerStatus();
      // Auto: wait until every claude.ai connector has settled (connected, needs-auth, failed…).
      const settled = auto
        ? statuses.some(isClaudeAi) && statuses.filter(isClaudeAi).every(isSettled)
        : listed.every(([, name]) => isSettled(statuses.find((s) => s.name === claudeAiName(name))));
      if (settled) break;
      await new Promise((resolve) => setTimeout(resolve, POLL_MS));
    }
  } catch (error) {
    console.error("Couldn't look up connectors:", error instanceof Error ? error.message : error);
  } finally {
    session.close();
    release();
  }

  const wanted = auto ? connectedConnectors(statuses) : listed;
  const skipped = auto
    ? statuses
        .filter((status) => isClaudeAi(status) && status.status !== "connected")
        .map((status) => `${status.name.replace(CLAUDE_AI_PREFIX, "")} (${status.status})`)
    : [];
  const set: ConnectorSet = { connectors: [], mcpServers: {}, readOnlyTools: [], writeTools: [], skipped };
  for (const [id, name] of wanted) {
    const status = statuses.find((s) => s.name === claudeAiName(name));
    if (status?.status !== "connected" || status.config?.type !== "claudeai-proxy") {
      set.connectors.push({
        id,
        name,
        state: "unavailable",
        tools: [],
        error: status
          ? `${status.status}${status.error ? `: ${status.error}` : ""}`
          : `not found in this claude.ai account (claude mcp list shows its exact name)`,
      });
      continue;
    }
    const tools = status.tools ?? [];
    const readOnly = tools.filter((tool) => tool.annotations?.readOnly === true).map((tool) => tool.name);
    set.mcpServers[id] = status.config;
    set.readOnlyTools.push(...readOnly.map((tool) => toolName(id, tool)));
    set.writeTools.push(
      ...tools.filter((tool) => tool.annotations?.readOnly !== true).map((tool) => toolName(id, tool.name)),
    );
    set.connectors.push({ id, name, state: "connected", tools: readOnly });
  }
  return set;
}

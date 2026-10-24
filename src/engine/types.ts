/**
 * What the gateway's parts agree on (docs/gateway.md §10.2): a provider adapter turns a RunSpec into a
 * stream of provider-neutral AgentEvents; the engine redacts them and writes the wire events (§6) to the
 * Run; the API reads ProviderStatus for /v1/capabilities.
 */
import type { Run } from "../runs.ts";

export type ProviderId = "claude";

/** Workspace tools by their neutral names; each adapter maps them to its own (Claude: Read, Glob, Grep). */
export const WORKSPACE_TOOLS = ["read_file", "list_files", "search_files"] as const;
export type WorkspaceTool = (typeof WORKSPACE_TOOLS)[number];

/** One run after policy (engine/policy.ts): every value is already within the config's limits. */
export interface RunSpec {
  prompt: string;
  /** The bridge's preamble, then the request's system_prompt. */
  systemPrompt: string;
  /** The id is always the bridge's. persist: false ⇒ the provider keeps no transcript. */
  session: { id: string; resume: boolean; persist: boolean; title?: string };
  model?: string;
  /** Checked connector ids; the adapter declares only their read-only tools. */
  connectorIds: string[];
  /** Empty: no workspace tool at all. */
  workspaceTools: WorkspaceTool[];
  /** JSON Schema (draft-7) the final answer must follow. */
  outputSchema?: object;
  maxTurns?: number;
  /** Unset: the provider's own limit. */
  maxToolOutputTokens?: number;
  /** What a request's template was filled with (docs/server-link.md §5.2); providers don't read it. */
  templateVars?: Record<string, string>;
}

export interface Usage {
  inputTokens: number;
  outputTokens: number;
  turns: number;
}

/** run.failed codes (§7). */
export type RunFailureCode =
  | "provider_auth_required"
  | "provider_usage_limit"
  | "provider_api_error"
  | "context_limit"
  | "max_turns"
  | "invalid_output"
  | "no_result"
  | "policy_violation"
  | "cancelled"
  | "provider_error";

export type ToolKind = "connector" | "workspace" | "other";

/**
 * What an adapter yields. Text, thinking, tool input and error text are raw: the engine redacts them.
 * `key` ties the start, deltas and end of one block together. Subagent activity is never yielded.
 */
export type AgentEvent =
  | { type: "text.start"; key: string }
  | { type: "text.delta"; key: string; text: string }
  | { type: "text.end"; key: string }
  | { type: "thinking.start"; key: string }
  | { type: "thinking.delta"; key: string; text: string }
  | { type: "thinking.end"; key: string }
  | {
      type: "tool.start";
      id: string;
      kind: ToolKind;
      /** Connector id, when kind is "connector". */
      connector?: string;
      /** Without a provider prefix: "search_threads", "read_file". */
      name: string;
      /** Workspace tools are normalized: {path} | {pattern} | {pattern, glob?}. */
      input: unknown;
    }
  | { type: "tool.end"; id: string; ok: boolean; errorText?: string }
  /** The model started filling in the structured output. */
  | { type: "output.writing" }
  | { type: "done"; text: string; structured?: unknown; usage?: Usage }
  | { type: "failed"; code: RunFailureCode; message: string; retryable: boolean; details?: Record<string, unknown> };

export interface ProviderConnector {
  /** Stable across restarts; part of tool names, so it never changes for a connector. */
  id: string;
  /** The provider's own name ("Gmail"); Seleya picks icons by it. */
  name: string;
  state: "connected" | "unavailable";
  /** Read-only tools, without prefix. */
  tools: string[];
}

export interface ProviderStatus {
  id: ProviderId;
  state: "ready" | "unavailable" | "signed_out";
  detail?: string;
  /** Models a request may pick besides the default. */
  models: string[];
  features: {
    structuredOutput: boolean;
    resume: boolean;
    thinking: boolean;
    workspaceTools: WorkspaceTool[];
  };
  connectorsState: "discovering" | "ready";
  connectors: ProviderConnector[];
}

export interface ProviderAdapter {
  readonly id: ProviderId;
  /** Starts discovery in the background; resolves without waiting for it. */
  start(): Promise<void>;
  status(): ProviderStatus;
  /**
   * Runs the spec to the end, ending with exactly one `done` or `failed` unless the iterator throws.
   * Stops when run.abort.signal is aborted (the engine then reports `cancelled`).
   */
  run(run: Run, spec: RunSpec): AsyncIterable<AgentEvent>;
  stop(): Promise<void>;
}

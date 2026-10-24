/**
 * Request → RunSpec (docs/gateway.md §5.2): checks a POST /v1/runs body against the config, the providers'
 * capabilities and session ownership, narrows connectors and tools to what the request asked for and is
 * allowed, clamps limits and puts the bridge's preamble in front of the system prompt.
 *
 * Synchronous on purpose: the server checks `busy` and creates the run right after, with nothing awaited
 * in between (§8.4). Anything a provider has to wait for happens inside the run.
 */
import { z } from "zod";

import type { BridgeConfig } from "../config.ts";
import { HttpError } from "../http.ts";
import type { SessionStore } from "../sessions.ts";
import { preamble } from "./preamble.ts";
import type { ProviderAdapter, ProviderConnector, ProviderId, RunSpec, WorkspaceTool } from "./types.ts";

export const MAX_PROMPT_CHARS = 100_000;
export const MAX_SYSTEM_PROMPT_CHARS = 20_000;
export const MAX_OUTPUT_SCHEMA_BYTES = 65_536;
/** Nesting of objects and arrays, the root counting as 1. Deeper than any real schema needs. */
export const MAX_OUTPUT_SCHEMA_DEPTH = 32;

/** Connector ids and tool names: short identifiers, never free text. */
const nameSchema = z.string().min(1).max(64);
const namesOrAll = z.union([z.literal("all"), z.array(nameSchema).max(100)]).default([]);

/** POST /v1/runs, keys as on the wire. Unknown keys are stripped, so a newer Seleya's fields are ignored (§9). */
export const runRequestSchema = z.object({
  /** Not an enum: a provider this bridge doesn't have is a 409 provider_unavailable, not a malformed body. */
  provider: nameSchema.nullish(),
  model: z.string().min(1).max(200).nullish(),
  prompt: z.string().trim().min(1).max(MAX_PROMPT_CHARS),
  /** Comes after the bridge's preamble, never instead of it. */
  system_prompt: z.string().max(MAX_SYSTEM_PROMPT_CHARS).nullish(),
  /** Absent: a one-off run that keeps no transcript. */
  session: z
    .object({
      persist: z.boolean().optional(),
      /** A session this browser started with the same provider; any other id is "not found". */
      resume_id: z.string().min(1).max(200).optional(),
      title: z.string().trim().min(1).max(200).optional(),
    })
    .nullish(),
  connectors: namesOrAll,
  workspace_tools: namesOrAll,
  /** Checked by hand (checkOutputSchema): its limits are their own error code. */
  output_schema: z.unknown().optional(),
  /** Any number: out of range is clamped, not refused. */
  limits: z.object({ max_turns: z.number().nullish(), max_tool_output_tokens: z.number().nullish() }).nullish(),
});

export type RunRequest = z.infer<typeof runRequestSchema>;

export interface PolicyContext {
  config: Pick<BridgeConfig, "defaultProvider" | "limits">;
  providers: ReadonlyMap<ProviderId, ProviderAdapter>;
  sessions: Pick<SessionStore, "owns">;
  /** The paired browser (token record id) asking. */
  ownerId: string;
  /** Session ids are always the bridge's: a client never picks the id of a new session. */
  newId: () => string;
}

export interface PolicyResult {
  spec: RunSpec;
  provider: ProviderId;
  adapter: ProviderAdapter;
  /** True for a new or resumed conversation that is kept; the server records new ones in sessions.json. */
  persisted: boolean;
}

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const unique = <T>(values: T[]) => [...new Set(values)];

/** Into [1, ceiling]; a fraction is truncated. */
const clamp = (value: number, ceiling: number) => Math.min(ceiling, Math.max(1, Math.trunc(value)));

const invalidSchema = (message: string) => new HttpError(400, "invalid_output_schema", message);

/**
 * A schema that can't be used to exhaust the bridge or reach outside the request: bounded size and depth,
 * an object at the root (the output is a JSON object), and only internal `$ref`s, so nothing tries to
 * fetch another document.
 */
function checkOutputSchema(schema: unknown): object {
  if (Buffer.byteLength(JSON.stringify(schema) ?? "") > MAX_OUTPUT_SCHEMA_BYTES)
    throw invalidSchema(`output_schema is larger than ${MAX_OUTPUT_SCHEMA_BYTES} bytes`);

  const walk = (node: unknown, depth: number): void => {
    if (typeof node !== "object" || node === null) return;
    if (depth > MAX_OUTPUT_SCHEMA_DEPTH)
      throw invalidSchema(`output_schema is nested deeper than ${MAX_OUTPUT_SCHEMA_DEPTH} levels`);
    for (const [key, child] of Object.entries(node)) {
      // Only a string is a reference; an object under "$ref" is a property that happens to have that name.
      if (key === "$ref" && typeof child === "string" && !child.startsWith("#/"))
        throw invalidSchema(`output_schema may only use internal references (#/…), not "${child.slice(0, 100)}"`);
      walk(child, depth + 1);
    }
  };
  walk(schema, 1);

  if (!isPlainObject(schema) || schema.type !== "object")
    throw invalidSchema('output_schema must have "type": "object" at its root');
  return schema;
}

function findAdapter(providers: ReadonlyMap<ProviderId, ProviderAdapter>, id: string): ProviderAdapter | undefined {
  for (const adapter of providers.values()) if (adapter.id === id) return adapter;
  return undefined;
}

/**
 * Checks a parsed request in the order of §5.2's table (rows 2–9; row 1 is the schema, row 10 `busy` is
 * the server's) and builds the run's spec. Throws HttpError with the table's code. Changes nothing: the
 * server records a new persisted session once the run is created.
 */
export function buildRunSpec(body: RunRequest, ctx: PolicyContext): PolicyResult {
  const { config, providers, sessions, ownerId } = ctx;

  const outputSchema = body.output_schema == null ? undefined : checkOutputSchema(body.output_schema);

  const providerName = body.provider ?? config.defaultProvider;
  const resumeId = body.session?.resume_id;
  if (resumeId !== undefined && !sessions.owns(resumeId, ownerId, providerName))
    throw new HttpError(404, "session_not_found", "No such conversation for this browser and provider");

  const adapter = findAdapter(providers, providerName);
  const status = adapter?.status();
  if (!adapter || !status || status.state !== "ready") {
    const state = status?.state ?? "unavailable";
    const detail = status?.detail ? `: ${status.detail}` : "";
    throw new HttpError(409, "provider_unavailable", `Provider ${providerName} is ${state}${detail}`, {
      provider: providerName,
      state,
    });
  }

  const model = body.model ?? undefined;
  if (model !== undefined && !status.models.includes(model))
    throw new HttpError(422, "model_not_allowed", `Model ${model} isn't allowed for ${providerName}`, { model });

  // Discovery doesn't hold up runs that read no connector, like a plain chat.
  let connectors: ProviderConnector[] = [];
  if (body.connectors === "all" || body.connectors.length > 0) {
    if (status.connectorsState === "discovering")
      throw new HttpError(409, "connectors_discovering", "Connectors are still being discovered; try again shortly");
    if (body.connectors === "all") connectors = status.connectors.filter((item) => item.state === "connected");
    else
      connectors = unique(body.connectors).map((id) => {
        const connector = status.connectors.find((item) => item.id === id);
        if (connector?.state !== "connected")
          throw new HttpError(422, "connector_unavailable", `Connector ${id} isn't connected`, { connector: id });
        return connector;
      });
  }

  const allowedTools = status.features.workspaceTools;
  const isAllowedTool = (name: string): name is WorkspaceTool => (allowedTools as readonly string[]).includes(name);
  const workspaceTools =
    body.workspace_tools === "all"
      ? [...allowedTools]
      : unique(body.workspace_tools).map((name) => {
          if (!isAllowedTool(name))
            throw new HttpError(422, "tool_not_allowed", `Workspace tool ${name} isn't allowed`, { tool: name });
          return name;
        });

  // Unset max_turns gets the ceiling, so the config always bounds a run; unset tool output stays the
  // provider's own limit, which is below any ceiling.
  const maxTurns = clamp(body.limits?.max_turns ?? config.limits.maxTurns, config.limits.maxTurns);
  const requestedToolOutput = body.limits?.max_tool_output_tokens;
  const maxToolOutputTokens =
    requestedToolOutput == null ? undefined : clamp(requestedToolOutput, config.limits.maxToolOutputTokens);

  // Resuming keeps the conversation it continues; a title only names a new one.
  const resume = resumeId !== undefined;
  const persist = resume || body.session?.persist === true;
  const title = !resume && persist ? body.session?.title : undefined;
  const session = { id: resumeId ?? ctx.newId(), resume, persist, ...(title !== undefined && { title }) };

  const head = preamble(connectors.map((item) => item.name));
  const systemPrompt = body.system_prompt?.trim() ? `${head}\n\n${body.system_prompt}` : head;

  const spec: RunSpec = {
    prompt: body.prompt,
    systemPrompt,
    session,
    ...(model !== undefined && { model }),
    connectorIds: connectors.map((item) => item.id),
    workspaceTools,
    ...(outputSchema !== undefined && { outputSchema }),
    maxTurns,
    ...(maxToolOutputTokens !== undefined && { maxToolOutputTokens }),
  };
  return { spec, provider: adapter.id, adapter, persisted: persist };
}

/**
 * What a run the server link starts may do (docs/server-link.md §6.5): less than a paired browser. It reads
 * no workspace file, keeps no transcript, and reads only the connectors `link.connectors` allows. Applied
 * before the usual run policy (engine/policy.ts), which still checks everything else.
 */
import type { BridgeConfig } from "../config.ts";
import type { RunRequest } from "../engine/policy.ts";

/** The owner id of every run the server link starts; browsers of the link's origin may watch them. */
export const LINK_OWNER = "link";

export class LinkPolicyError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

/**
 * The request narrowed for the link. `connected` is the provider's connected connector ids: "all" under a
 * connector ceiling becomes the connected ones the ceiling allows.
 */
export function applyLinkPolicy(
  body: RunRequest,
  link: Pick<BridgeConfig["link"], "connectors">,
  connected: readonly string[],
): RunRequest {
  let connectors = body.connectors;
  if (link.connectors !== "all") {
    const allowed = new Set(link.connectors);
    if (connectors === "all") connectors = connected.filter((id) => allowed.has(id));
    else {
      const outside = connectors.find((id) => !allowed.has(id));
      if (outside !== undefined)
        throw new LinkPolicyError("connector_not_allowed", `Scheduled runs may not read ${outside}`);
    }
  }
  return { ...body, connectors, workspace_tools: [], session: null };
}

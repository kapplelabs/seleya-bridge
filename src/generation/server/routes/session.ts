import type { LocalConfig } from "../../config.ts";
import type { Store } from "../../runs/store.ts";
import { skillJson, type SkillMeta } from "../../skills.ts";
import { type Route, sendError, sendJson } from "../http.ts";
import { mayIssueSession, type SecurityPolicy, sessionCookie } from "../security.ts";

export const LOCAL_VERSION = "0.1.0";

export interface SessionRouteDeps {
  config: LocalConfig;
  store: Store;
  policy: () => SecurityPolicy;
  skills: () => Map<string, SkillMeta>;
  /** Harness status list (spec 002); empty until adapters exist. */
  harnesses: () => Promise<unknown[]>;
}

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");

export function sessionRoutes(deps: SessionRouteDeps): Route[] {
  return [
    {
      method: "GET",
      pattern: /^\/local\/session$/,
      public: true,
      handle: ({ request, response }) => {
        if (!mayIssueSession(request))
          return sendError(response, 403, "cross_site", "Not available to other sites.");
        response.writeHead(204, {
          "set-cookie": sessionCookie(deps.policy()),
          "cache-control": "no-store",
        });
        response.end();
        return undefined;
      },
    },
    {
      // Demo: no sign-in, one local user (spec 001, decision D12).
      method: "GET",
      pattern: /^\/me$/,
      public: true,
      handle: () => {
        const { email, name, timezone } = deps.config.demoUser;
        return {
          id: `usr_local_${deps.store.machineId()}`,
          name,
          first_name: name.split(/\s+/)[0] ?? name,
          email,
          role: "Seleya Local",
          initials: initials(name),
          timezone,
        };
      },
    },
    {
      method: "GET",
      pattern: /^\/local\/health$/,
      public: true,
      handle: async ({ response }) =>
        sendJson(response, 200, {
          version: LOCAL_VERSION,
          machine_id: deps.store.machineId(),
          skills: [...deps.skills().values()]
            .filter((skill) => !skill.name.startsWith("_"))
            .map(skillJson),
          harnesses: await deps.harnesses(),
        }),
    },
    {
      method: "GET",
      pattern: /^\/local\/skills$/,
      handle: () =>
        [...deps.skills().values()].filter((skill) => !skill.name.startsWith("_")).map(skillJson),
    },
  ];
}

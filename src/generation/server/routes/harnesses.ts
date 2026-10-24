import type { HarnessRegistry } from "../../harness/registry.ts";
import { MEDIA_KINDS } from "../../media/catalog.ts";
import type { Route } from "../http.ts";

const prefsJson = (registry: HarnessRegistry) => {
  const prefs = registry.preferences();
  return {
    default: prefs.default,
    per_skill: prefs.perSkill,
    per_capability: prefs.perCapability,
    order: prefs.order,
  };
};

export function harnessRoutes(registry: HarnessRegistry): Route[] {
  return [
    {
      method: "GET",
      pattern: /^\/local\/harnesses$/,
      handle: async ({ query }) => {
        if (query.get("refresh") === "1") await registry.refresh();
        const media = await registry.mediaAvailability();
        return {
          harnesses: registry.statusJson(),
          rejected: registry.rejected,
          preferences: prefsJson(registry),
          // Spec 008 FR-008: what this computer can make, and with which agents.
          media: Object.values(MEDIA_KINDS).map((kind) => {
            const agents = media[kind.id] ?? [];
            return {
              kind: kind.id,
              label: kind.label,
              available: agents.length > 0,
              agents: agents.map((agent) => ({ id: agent.id, name: agent.name })),
            };
          }),
        };
      },
    },
    {
      method: "PUT",
      pattern: /^\/local\/harnesses\/preferences$/,
      handle: async ({ body }) => {
        const input = await body();
        const asMap = (value: unknown) =>
          typeof value === "object" && value !== null && !Array.isArray(value)
            ? Object.fromEntries(
                Object.entries(value as Record<string, unknown>).filter(
                  (entry): entry is [string, string] => typeof entry[1] === "string",
                ),
              )
            : undefined;
        const perCapability = asMap(input.per_capability);
        const perSkill =
          typeof input.per_skill === "object" &&
          input.per_skill !== null &&
          !Array.isArray(input.per_skill)
            ? Object.fromEntries(
                Object.entries(input.per_skill as Record<string, unknown>).filter(
                  (entry): entry is [string, string] => typeof entry[1] === "string",
                ),
              )
            : undefined;
        registry.setPreferences({
          ...(input.default === null || typeof input.default === "string"
            ? { default: input.default as string | null }
            : {}),
          ...(perSkill ? { perSkill } : {}),
          ...(perCapability ? { perCapability } : {}),
          ...(Array.isArray(input.order)
            ? { order: input.order.filter((id): id is string => typeof id === "string") }
            : {}),
        });
        return prefsJson(registry);
      },
    },
  ];
}

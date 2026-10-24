import { RunError } from "../../runs/manager.ts";
import type { SyncManager, SyncRecord } from "../../sync/sync.ts";
import type { Route } from "../http.ts";

const recordJson = (record: SyncRecord) => ({
  run_id: record.runId,
  state: record.state,
  attempts: record.attempts,
  last_error: record.lastError,
  files_done: record.uploaded.length,
  files_total: record.filesTotal,
  updated_at: new Date(record.updatedAt).toISOString(),
});

/** Sync settings and per-run sync state (spec 006 FR-001a, FR-002, FR-008). */
export function syncRoutes(sync: SyncManager): Route[] {
  const settingsJson = () => {
    const settings = sync.settings();
    return {
      enabled: settings.enabled,
      include_earlier: settings.includeEarlier,
      enabled_at: settings.enabledAt ? new Date(settings.enabledAt).toISOString() : null,
    };
  };
  return [
    { method: "GET", pattern: /^\/local\/sync\/settings$/, handle: () => settingsJson() },
    {
      method: "PUT",
      pattern: /^\/local\/sync\/settings$/,
      handle: async ({ body }) => {
        const input = await body();
        sync.setSettings({
          enabled: typeof input.enabled === "boolean" ? input.enabled : undefined,
          includeEarlier:
            typeof input.include_earlier === "boolean" ? input.include_earlier : undefined,
        });
        return settingsJson();
      },
    },
    {
      method: "GET",
      pattern: /^\/local\/sync\/runs$/,
      handle: () => Object.values(sync.records()).map(recordJson),
    },
    {
      method: "POST",
      pattern: /^\/local\/sync\/runs\/([A-Za-z0-9_-]+)\/retry$/,
      handle: ({ params: [runId = ""] }) => {
        const record = sync.retry(runId);
        if (!record) throw new RunError("not_synced", "This run was never queued for sync.", 404);
        return recordJson(record);
      },
    },
    {
      method: "DELETE",
      pattern: /^\/local\/sync\/runs\/([A-Za-z0-9_-]+)$/,
      handle: async ({ params: [runId = ""] }) => {
        const record = await sync.remove(runId);
        if (!record) throw new RunError("not_synced", "This run is not on the server.", 404);
        return recordJson(record);
      },
    },
  ];
}

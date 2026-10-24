import { agentIdFor, runJson } from "../../runs/events.ts";
import type { RunManager } from "../../runs/manager.ts";
import type { Store } from "../../runs/store.ts";
import type { RunRow, StoredEvent } from "../../runs/types.ts";
import type { Route } from "../http.ts";

/** Run events the whole app cares about (tray, notifications, inbox): forwarded on /local/events. */
const GLOBAL_TYPES = new Set([
  "seleya.run.started",
  "seleya.run.status",
  "seleya.run.progress",
  "seleya.run.estimate",
  "seleya.run.stall",
  "seleya.run.completed",
  "seleya.error",
]);

const HEARTBEAT_MS = 10_000;
const INBOX_KEY = "inbox_state";
const INBOX_STATUSES = [
  "completed",
  "completed_with_issues",
  "failed",
  "timed_out",
  "interrupted",
] as const;

interface InboxState {
  read: string[];
  done: string[];
}

function inboxItem(run: RunRow, state: InboxState) {
  const id = `inb_${run.id}`;
  const ok = run.localStatus === "completed" || run.localStatus === "completed_with_issues";
  const issues = run.localStatus === "completed_with_issues";
  return {
    id,
    category: ok ? "completed" : "attention",
    agent_id: agentIdFor(run.skill),
    title: ok
      ? `${run.title} is ready${issues ? " (with issues)" : ""}`
      : `${run.title} ${run.localStatus === "timed_out" ? "timed out" : run.localStatus === "interrupted" ? "was interrupted" : "failed"}`,
    body: ok
      ? (run.summary ?? `Made on this computer${run.harness ? ` with ${run.harness}` : ""}.`)
      : (run.error?.message ?? "The run did not finish."),
    time: new Date(run.finishedAt ?? run.createdAt).toISOString(),
    unread: !state.read.includes(id),
    priority: ok ? "normal" : "high",
    action: { label: ok ? "Open result" : "View run", to: `/tasks/${run.id}` },
  };
}

export function eventRoutes(store: Store, manager: RunManager): Route[] {
  const inboxState = (): InboxState =>
    JSON.parse(store.meta(INBOX_KEY, () => JSON.stringify({ read: [], done: [] }))) as InboxState;
  const saveInbox = (state: InboxState) => store.setMeta(INBOX_KEY, JSON.stringify(state));
  const inbox = () => {
    const state = inboxState();
    return store
      .listRuns({ status: [...INBOX_STATUSES], limit: 50 })
      .filter((run) => !state.done.includes(`inb_${run.id}`))
      .map((run) => inboxItem(run, state));
  };

  return [
    {
      // One stream for the whole app: what every local run is doing, without per-run replay.
      method: "GET",
      pattern: /^\/local\/events$/,
      handle: ({ request, response }) => {
        response.writeHead(200, {
          "content-type": "text/event-stream; charset=utf-8",
          "cache-control": "no-cache, no-transform",
          connection: "keep-alive",
        });
        const active = store.listRuns({ status: ["queued", "running"], limit: 50 });
        response.write(
          `event: local.snapshot\ndata: ${JSON.stringify({
            runs: active.map((run) => ({
              ...runJson(run, { queuePosition: manager.queuePosition(run.id) }),
              // The latest estimate, so a reloaded tray shows time left at once.
              remaining_ms: store
                .eventsAfter(run.id, 0)
                .filter((event) => event.type === "seleya.run.estimate")
                .at(-1)?.data.remaining_ms,
            })),
          })}\n\n`,
        );
        const titles = new Map<string, string>();
        const forward = (event: StoredEvent) => {
          if (!GLOBAL_TYPES.has(event.type)) return;
          const title = titles.get(event.runId) ?? store.getRun(event.runId)?.title ?? "";
          titles.set(event.runId, title);
          response.write(
            `event: ${event.type}\ndata: ${JSON.stringify({ ...event.data, run_id: event.runId, title })}\n\n`,
          );
        };
        const unsubscribe = manager.subscribeAll(forward);
        const heartbeat = setInterval(() => response.write(": heartbeat\n\n"), HEARTBEAT_MS);
        request.on("close", () => {
          unsubscribe();
          clearInterval(heartbeat);
        });
        return undefined;
      },
    },
    { method: "GET", pattern: /^\/local\/inbox$/, handle: () => inbox() },
    {
      method: "POST",
      pattern: /^\/local\/inbox\/read$/,
      handle: async ({ body }) => {
        const input = await body();
        const ids = Array.isArray(input.ids)
          ? input.ids.filter((id): id is string => typeof id === "string")
          : [];
        const state = inboxState();
        saveInbox({ ...state, read: [...new Set([...state.read, ...ids])] });
        return inbox();
      },
    },
    {
      method: "POST",
      pattern: /^\/local\/inbox\/([A-Za-z0-9_-]+)\/done$/,
      handle: ({ params: [id = ""] }) => {
        const state = inboxState();
        saveInbox({ ...state, done: [...new Set([...state.done, id])] });
        return inbox();
      },
    },
  ];
}

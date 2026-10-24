/**
 * Writes a run's events as SSE frames shaped like ms-agent-gateway's, so Seleya's `gatewayPayload`
 * reads them unchanged: `id: <n>`, `event: <type>`, `data: {"event_type", "session_id", "data"}`.
 */
import type { IncomingMessage, ServerResponse } from "node:http";

import { keysToSnakeCase, verbatim } from "./case.ts";
import type { Run, RunEvent } from "./runs.ts";

const HEARTBEAT_MS = 15_000;

/** Fields whose keys aren't the bridge's: snake-casing them would change what the model or tool wrote. */
const VERBATIM_FIELDS: Record<string, string> = { "run.completed": "output", "tool.started": "input" };

function writeEvent(res: ServerResponse, run: Run, event: RunEvent): void {
  const data: Record<string, unknown> = { ...event.data };
  const field = VERBATIM_FIELDS[event.type];
  if (field !== undefined && field in data) data[field] = verbatim(data[field]);
  const envelope = keysToSnakeCase({ eventType: event.type, sessionId: run.id, data });
  res.write(`id: ${event.id}\nevent: ${event.type}\ndata: ${JSON.stringify(envelope)}\n\n`);
}

/** The last event id the client already has (EventSource sends it on reconnect). */
function lastEventId(req: IncomingMessage): number {
  const value = Number(req.headers["last-event-id"]);
  return Number.isInteger(value) && value > 0 ? value : 0;
}

export function streamRun(req: IncomingMessage, res: ServerResponse, run: Run): void {
  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-store",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  res.flushHeaders();

  const heartbeat = setInterval(() => res.write(": ping\n\n"), HEARTBEAT_MS);
  let unsubscribe = () => {};
  const close = () => {
    clearInterval(heartbeat);
    unsubscribe();
    res.end();
  };

  unsubscribe = run.subscribe(lastEventId(req), (event) => {
    writeEvent(res, run, event);
    if (event.type === "stream.done" || event.type === "stream.error") close();
  });
  if (run.finished) close();
  req.on("close", close);
}

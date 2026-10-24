import type { IncomingMessage, ServerResponse } from "node:http";

import type { RunManager } from "../runs/manager.ts";
import type { Store } from "../runs/store.ts";
import type { StoredEvent } from "../runs/types.ts";

const HEARTBEAT_MS = 10_000;

/**
 * Inside seleya-bridge a run's frames use the bridge's (ms-agent-gateway's) envelope, the same as
 * chat and report runs, so the page reads every stream alike (spec 009 D5). Standalone: plain data.
 */
let gatewayEnvelope = false;
export function useGatewayEnvelope(on: boolean): void {
  gatewayEnvelope = on;
}

/** Rewrites a frame's text before it is sent (seleya-bridge: fresh file tickets on replay). */
let frameTransform = (text: string) => text;
export function setFrameTransform(transform: (text: string) => string): void {
  frameTransform = transform;
}

function frame(event: StoredEvent): string {
  const data = gatewayEnvelope
    ? { event_type: event.type, session_id: event.runId, data: event.data }
    : event.data;
  return `id: ${event.seq}\nevent: ${event.type}\ndata: ${frameTransform(JSON.stringify(data))}\n\n`;
}

/**
 * Streams one run: everything after `Last-Event-ID` (all of it on a fresh connection), then live
 * events, ending after `stream.done` (contracts/run-stream.md).
 */
export function streamRun(
  request: IncomingMessage,
  response: ServerResponse,
  runId: string,
  store: Store,
  manager: RunManager,
): void {
  const lastId = Number(request.headers["last-event-id"] ?? 0) || 0;
  response.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache, no-transform",
    connection: "keep-alive",
    "x-accel-buffering": "no",
  });
  response.write(": connected\n\n");

  let sent = lastId;
  let closed = false;
  const write = (event: StoredEvent) => {
    if (closed || event.seq <= sent) return;
    sent = event.seq;
    response.write(frame(event));
    if (event.type === "stream.done") close();
  };

  // Subscribe first, then replay: nothing emitted in between can be missed (seq dedupes).
  const unsubscribe = manager.subscribe(runId, write);
  const heartbeat = setInterval(() => response.write(": heartbeat\n\n"), HEARTBEAT_MS);
  function close() {
    if (closed) return;
    closed = true;
    unsubscribe();
    clearInterval(heartbeat);
    response.end();
  }
  request.on("close", close);
  for (const event of store.eventsAfter(runId, lastId)) write(event);
}

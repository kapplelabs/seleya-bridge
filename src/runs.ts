/**
 * A run is one Claude turn answering one prompt. Its events are kept in order so a stream can be
 * replayed from the start (new ticket) or resumed after a given event id (Last-Event-ID).
 */
import { randomUUID } from "node:crypto";

/** How long a finished run stays readable, for late or reconnecting streams. */
const RETENTION_MS = 10 * 60 * 1000;

export interface RunEvent {
  /** 1-based, increasing; sent as the SSE `id`. */
  id: number;
  type: string;
  data?: object;
}

type Listener = (event: RunEvent) => void;

export const isTerminalType = (type: string) => type === "stream.done" || type === "stream.error";

export class Run {
  readonly id = randomUUID();
  readonly assistantMessageId = randomUUID();
  readonly createdAt = new Date();
  readonly abort = new AbortController();
  /** The Claude Code session this run belongs to: Seleya's conversation id. */
  readonly sessionId: string;
  readonly events: RunEvent[] = [];
  /**
   * What a report run produced (a briefing, a calendar week), served by GET /v1/runs/:id/result as
   * `{ [key]: value }`. Already redacted.
   */
  result: { key: string; value: object } | undefined;
  private readonly listeners = new Set<Listener>();
  private onFinish: (() => void) | undefined;

  constructor(sessionId: string, onFinish: () => void) {
    this.sessionId = sessionId;
    this.onFinish = onFinish;
  }

  get finished(): boolean {
    const last = this.events.at(-1);
    return last !== undefined && isTerminalType(last.type);
  }

  emit(type: string, data?: object): void {
    if (this.finished) return;
    const event: RunEvent = { id: this.events.length + 1, type, data };
    this.events.push(event);
    for (const listener of this.listeners) listener(event);
    if (isTerminalType(type)) {
      this.listeners.clear();
      this.onFinish?.();
      this.onFinish = undefined;
    }
  }

  /** Replays events after `afterId`, then follows new ones until the run ends. Returns the unsubscribe. */
  subscribe(afterId: number, listener: Listener): () => void {
    for (const event of this.events) if (event.id > afterId) listener(event);
    if (this.finished) return () => {};
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}

export class RunRegistry {
  private readonly runs = new Map<string, Run>();
  private active: Run | undefined;

  /** One run at a time: Claude Code works on this machine, and a second caller shouldn't pile on. */
  get busy(): boolean {
    return this.active !== undefined;
  }

  create(sessionId: string): Run {
    const run = new Run(sessionId, () => {
      if (this.active === run) this.active = undefined;
      setTimeout(() => this.runs.delete(run.id), RETENTION_MS).unref();
    });
    this.runs.set(run.id, run);
    this.active = run;
    return run;
  }

  get(id: string): Run | undefined {
    return this.runs.get(id);
  }

  abortAll(): void {
    for (const run of this.runs.values()) run.abort.abort();
  }
}

/**
 * A run is one provider turn answering one prompt. Its events are kept in order so a stream can be
 * replayed from the start (new ticket) or resumed after a given event id (Last-Event-ID).
 */
import { randomUUID } from "node:crypto";

import type { ProviderId, RunFailureCode } from "./engine/types.ts";
import { Redactor } from "./redact.ts";

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

export interface RunError {
  code: RunFailureCode;
  message: string;
  retryable: boolean;
}

/** What a completed run read, for GET /v1/runs/:id as for run.completed. */
export interface RunSummary {
  /** Connectors that answered without an error. */
  sources: { id: string; name: string }[];
  /** The first error of each connector that failed, redacted and classified. */
  connectorErrors: { connector: string; kind: string; message: string }[];
  redactions: number;
}

/** What started a run: a browser, or the server link's scheduler (docs/server-link.md §6.4). */
export type RunTrigger = "manual" | "schedule" | "catch_up" | "remote";

/** Where a run's outcome is kept (docs/server-link.md §6.2). */
export interface RunStore {
  key: string;
  /** Seleya's own note about the result, given back as it was sent. */
  meta: Record<string, unknown>;
}

export interface RunInit {
  /** The provider session (Claude Code session id), always the bridge's own. */
  sessionId: string;
  /** False: a one-off run that keeps no transcript; its session id isn't given to the caller. */
  persisted: boolean;
  /** The paired browser (token record id) that started the run: the only one that may read or stop it. */
  ownerId: string;
  /** The origin of the caller; the server link's runs carry the origin it was linked from. */
  origin: string;
  provider: ProviderId;
  trigger?: RunTrigger;
  /** The schedule a server link run belongs to. */
  scheduleId?: string;
  store?: RunStore;
  templateVars?: Record<string, string>;
}

export class Run {
  readonly id = randomUUID();
  readonly createdAt = new Date();
  readonly abort = new AbortController();
  /** Everything removed with it, before the model reads or after it writes, counts in run.completed. */
  readonly redactor = new Redactor();
  readonly sessionId: string;
  readonly persisted: boolean;
  readonly ownerId: string;
  readonly origin: string;
  readonly provider: ProviderId;
  readonly trigger: RunTrigger;
  readonly scheduleId: string | undefined;
  readonly store: RunStore | undefined;
  readonly templateVars: Record<string, string> | undefined;
  readonly events: RunEvent[] = [];
  /** The final answer, redacted; set when the run completes. */
  text: string | undefined;
  /** The structured output, redacted; set when a run with an output schema completes. */
  output: object | undefined;
  /** Set when the run completes. */
  summary: RunSummary | undefined;
  /** Why the run failed or was cancelled. */
  error: RunError | undefined;
  private readonly listeners = new Set<Listener>();
  private onFinish: (() => void) | undefined;

  constructor(init: RunInit, onFinish: () => void) {
    this.sessionId = init.sessionId;
    this.persisted = init.persisted;
    this.ownerId = init.ownerId;
    this.origin = init.origin;
    this.provider = init.provider;
    this.trigger = init.trigger ?? "manual";
    this.scheduleId = init.scheduleId;
    this.store = init.store;
    this.templateVars = init.templateVars;
    this.onFinish = onFinish;
  }

  get finished(): boolean {
    const last = this.events.at(-1);
    return last !== undefined && isTerminalType(last.type);
  }

  get status(): "running" | "completed" | "failed" | "cancelled" {
    if (!this.finished) return "running";
    if (!this.error) return "completed";
    return this.error.code === "cancelled" ? "cancelled" : "failed";
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
  private readonly onBusyChange: ((busy: boolean) => void) | undefined;

  constructor(onBusyChange?: (busy: boolean) => void) {
    this.onBusyChange = onBusyChange;
  }

  /** One run at a time: the provider works on this machine, and a second caller shouldn't pile on. */
  get busy(): boolean {
    return this.active !== undefined;
  }

  /** The run holding `busy`, if any. */
  get current(): Run | undefined {
    return this.active;
  }

  create(init: RunInit): Run {
    const run = new Run(init, () => {
      if (this.active === run) {
        this.active = undefined;
        this.onBusyChange?.(false);
      }
      setTimeout(() => this.runs.delete(run.id), RETENTION_MS).unref();
    });
    this.runs.set(run.id, run);
    this.active = run;
    this.onBusyChange?.(true);
    return run;
  }

  get(id: string): Run | undefined {
    return this.runs.get(id);
  }

  abortAll(): void {
    for (const run of this.runs.values()) run.abort.abort();
  }
}

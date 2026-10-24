/**
 * Runs the server link's schedules on this machine (docs/server-link.md §6.4). The bridge keeps the clock:
 * the server only stores schedules, so a machine that slept through 08:00 still runs the briefing when it
 * wakes, and schedules keep running from link-config.json while the server can't be reached.
 *
 * One rule covers on time, waking up and restarts: every evaluation looks at each schedule's latest
 * occurrence; one not handled yet is run (on time, or as a catch-up within its window) or reported as
 * expired. Jobs wait in a queue while the bridge is busy, so a person using Seleya always goes first.
 */
import { randomUUID } from "node:crypto";

import type { BridgeConfig } from "../config.ts";
import { runRequestSchema, type RunRequest } from "../engine/policy.ts";
import { HttpError } from "../http.ts";
import { isTerminalType, type Run, type RunRegistry, type RunTrigger } from "../runs.ts";
import type { Caller } from "../runs/start.ts";
import { applyLinkPolicy, LINK_OWNER, LinkPolicyError } from "./policy.ts";
import type { LastRun, LinkConfig, LinkStore, Report, ReportStatus, Schedule } from "./store.ts";
import { isTimeZone, nextOccurrence, previousOccurrence } from "./timing.ts";

const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * MINUTE_MS;
/** A wake-up timer never sleeps longer than this, so a clock change or sleep is noticed within a minute. */
const MAX_TIMER_MS = MINUTE_MS;
/** An occurrence this late still counts as on time rather than a catch-up. */
const ON_TIME_MS = 2 * MINUTE_MS;
/** How long a job waits for the provider to be ready (Claude Code starting, connectors discovered). */
const PROVIDER_WAIT_MS = 5 * MINUTE_MS;
const PROVIDER_RETRY_MS = 15_000;

/** Run policy errors a report may carry; anything else about the request is a broken template. */
const REPORTED_POLICY_CODES = new Set(["connector_unavailable", "model_not_allowed", "provider_unavailable"]);

type LinkTrigger = Exclude<RunTrigger, "manual">;

interface Job {
  reportId: string;
  scheduleId: string;
  scheduledFor: number;
  trigger: LinkTrigger;
  commandId: string | null;
  expiresAt: number;
  /** When it joined the queue: how long it has waited for the provider. */
  queuedAt?: number;
}

export interface Clock {
  now(): number;
  setTimeout(callback: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

const systemClock: Clock = {
  now: () => Date.now(),
  setTimeout: (callback, ms) => {
    const handle = setTimeout(callback, ms);
    handle.unref();
    return handle;
  },
  clearTimeout: (handle) => clearTimeout(handle as NodeJS.Timeout),
};

export interface ProviderReadiness {
  ready: boolean;
  discovering: boolean;
  /** Connected connector ids. */
  connected: string[];
}

export interface Command {
  id: string;
  kind: "run_now" | "cancel";
  scheduleId: string;
  expiresAt: string;
}

export interface SchedulerDeps {
  store: LinkStore;
  link: () => BridgeConfig["link"];
  runs: RunRegistry;
  /** startRun with the bridge's own dependencies. */
  start: (body: RunRequest, caller: Caller) => Run;
  provider: () => ProviderReadiness;
  /** The linked origin; undefined once unlinked. */
  origin: () => string | undefined;
  /** A report for the server (the client keeps it in the outbox until accepted). */
  report: (report: Report) => void;
  clock?: Clock;
}

export interface ScheduleView {
  id: string;
  name: string;
  enabled: boolean;
  nextRunAt: string | null;
  lastRun: LastRun | null;
}

export class Scheduler {
  private readonly deps: SchedulerDeps;
  private readonly clock: Clock;
  private schedules: Schedule[] = [];
  private queue: Job[] = [];
  private current: { job: Job; run: Run } | undefined;
  private timer: unknown;
  private retryTimer: unknown;
  private stopped = false;

  constructor(deps: SchedulerDeps) {
    this.deps = deps;
    this.clock = deps.clock ?? systemClock;
  }

  /** Takes a new set of schedules (from the server, or link-config.json at startup) and acts on it. */
  apply(config: LinkConfig | undefined): void {
    this.stopped = false;
    this.schedules = config?.schedules ?? [];
    const ids = new Set(this.schedules.map((schedule) => schedule.id));
    // A job of a removed schedule never runs; a disabled schedule's remote run still may.
    this.queue = this.queue.filter((job) => {
      const schedule = this.schedules.find((item) => item.id === job.scheduleId);
      return schedule !== undefined && (schedule.enabled || job.trigger === "remote");
    });
    this.deps.store.updateState((state) => {
      for (const id of Object.keys(state.schedules)) if (!ids.has(id)) delete state.schedules[id];
    });
    this.evaluate();
  }

  /** The bridge has nothing running any more: the next job may start. */
  idle(): void {
    this.pump();
  }

  stop(): void {
    this.stopped = true;
    this.clock.clearTimeout(this.timer);
    this.clock.clearTimeout(this.retryTimer);
    this.queue = [];
  }

  /** run_now and cancel from the server, each handled once even when the server sends it again. */
  command(command: Command): void {
    const { store } = this.deps;
    if (store.scheduleState().processedCommands.includes(command.id)) return;
    store.updateState((state) => state.processedCommands.push(command.id));
    const schedule = this.schedules.find((item) => item.id === command.scheduleId);
    if (!schedule) return;
    if (command.kind === "run_now") {
      const now = this.clock.now();
      return this.enqueue({
        reportId: randomUUID(),
        scheduleId: schedule.id,
        scheduledFor: now,
        trigger: "remote",
        commandId: command.id,
        expiresAt: Date.parse(command.expiresAt) || now + schedule.template.expires_after_minutes * MINUTE_MS,
      });
    }
    const queued = this.queue.find((job) => job.scheduleId === schedule.id);
    if (queued) {
      this.queue = this.queue.filter((job) => job !== queued);
      this.finishJob(queued, schedule, "cancelled", { code: null });
    }
    if (this.current?.job.scheduleId === schedule.id) this.current.run.abort.abort();
  }

  view(): { schedules: ScheduleView[]; queue: { scheduleId: string; scheduledFor: string; trigger: string }[] } {
    const now = new Date(this.clock.now());
    const state = this.deps.store.scheduleState();
    const minInterval = this.deps.link().minIntervalMinutes;
    return {
      schedules: this.schedules.map((schedule) => {
        const next =
          schedule.enabled && isTimeZone(schedule.time_zone)
            ? nextOccurrence(schedule.timing, schedule.time_zone, now, minInterval)
            : undefined;
        return {
          id: schedule.id,
          name: schedule.name,
          enabled: schedule.enabled,
          nextRunAt: next?.toISOString() ?? null,
          lastRun: state.schedules[schedule.id]?.lastRun ?? null,
        };
      }),
      queue: this.queue.map((job) => ({
        scheduleId: job.scheduleId,
        scheduledFor: new Date(job.scheduledFor).toISOString(),
        trigger: job.trigger,
      })),
    };
  }

  /** The scheduled run in progress, if any. */
  active(): { runId: string; scheduleId: string } | undefined {
    return this.current && { runId: this.current.run.id, scheduleId: this.current.job.scheduleId };
  }

  /** Looks at each schedule's latest occurrence, queues or expires it, then sets the next wake-up. */
  private evaluate(): void {
    if (this.stopped) return;
    this.clock.clearTimeout(this.timer);
    const now = this.clock.now();
    const minInterval = this.deps.link().minIntervalMinutes;
    let wake = now + MAX_TIMER_MS;
    for (const schedule of this.schedules) {
      if (!schedule.enabled || !isTimeZone(schedule.time_zone)) continue;
      const previous = previousOccurrence(schedule.timing, schedule.time_zone, new Date(now), minInterval)?.getTime();
      const handled = this.deps.store.scheduleState().schedules[schedule.id]?.lastScheduledFor;
      // A schedule made after an occurrence doesn't run it.
      const floor = Math.max(Date.parse(schedule.created_at) || 0, handled ? Date.parse(handled) : 0);
      if (previous !== undefined && previous > floor) this.occurred(schedule, previous, now, handled !== undefined);
      const next = nextOccurrence(schedule.timing, schedule.time_zone, new Date(now), minInterval)?.getTime();
      if (next !== undefined) wake = Math.min(wake, next);
    }
    this.timer = this.clock.setTimeout(() => this.evaluate(), Math.max(1000, wake - now));
    this.pump();
  }

  /** `known`: the scheduler saw this schedule before, so a missed occurrence is worth reporting. */
  private occurred(schedule: Schedule, at: number, now: number, known: boolean): void {
    this.deps.store.updateState((state) => {
      state.schedules[schedule.id] = {
        lastRun: state.schedules[schedule.id]?.lastRun ?? null,
        lastScheduledFor: new Date(at).toISOString(),
      };
    });
    const expires = schedule.template.expires_after_minutes * MINUTE_MS;
    const catchUp = (schedule.template.catch_up_minutes ?? schedule.template.expires_after_minutes) * MINUTE_MS;
    const age = now - at;
    const job: Job = {
      reportId: randomUUID(),
      scheduleId: schedule.id,
      scheduledFor: at,
      trigger: age <= ON_TIME_MS ? "schedule" : "catch_up",
      commandId: null,
      expiresAt: at + expires,
    };
    if (age <= ON_TIME_MS || age <= catchUp) return this.enqueue(job);
    // A schedule seen for the first time (just linked, just created) has missed nothing worth a report.
    if (known) this.finishJob(job, schedule, "skipped", { code: "expired" });
  }

  private enqueue(job: Job): void {
    // One job per schedule: a newer occurrence replaces one still waiting.
    job.queuedAt = this.clock.now();
    this.queue = [...this.queue.filter((item) => item.scheduleId !== job.scheduleId), job];
    this.pump();
  }

  /** Starts the first job when nothing runs; jobs that can't run are reported and dropped. */
  private pump(): void {
    if (this.stopped || this.current || this.deps.runs.busy) return;
    this.clock.clearTimeout(this.retryTimer);
    const job = this.queue[0];
    if (!job) return;
    const schedule = this.schedules.find((item) => item.id === job.scheduleId);
    const now = this.clock.now();
    const drop = (status: ReportStatus, code: string | null) => {
      this.queue.shift();
      if (schedule) this.finishJob(job, schedule, status, { code });
      this.pump();
    };
    if (!schedule) return drop("skipped", null);
    if (now > job.expiresAt) return drop("skipped", "expired");
    const { link } = this.deps;
    const runLog = this.deps.store.scheduleState().runLog.filter((at) => now - Date.parse(at) < DAY_MS);
    if (runLog.length >= link().maxRunsPerDay) return drop("skipped", "daily_limit");

    const provider = this.deps.provider();
    if (!provider.ready || provider.discovering) {
      if (now - (job.queuedAt ?? now) >= PROVIDER_WAIT_MS) return drop("failed", "provider_unavailable");
      return this.retryLater();
    }
    const origin = this.deps.origin();
    if (origin === undefined) return drop("skipped", null);

    let body: RunRequest;
    try {
      const parsed = runRequestSchema.safeParse(schedule.template.request);
      if (!parsed.success) return drop("failed", "invalid_template");
      body = applyLinkPolicy(parsed.data, link(), provider.connected);
    } catch (error) {
      return drop("failed", error instanceof LinkPolicyError ? error.code : "invalid_template");
    }

    let run: Run;
    try {
      run = this.deps.start(body, { ownerId: LINK_OWNER, origin, trigger: job.trigger, scheduleId: schedule.id });
    } catch (error) {
      if (error instanceof HttpError && error.code === "busy") return;
      if (error instanceof HttpError && error.code === "connectors_discovering") return this.retryLater();
      const code = error instanceof HttpError && REPORTED_POLICY_CODES.has(error.code) ? error.code : "invalid_template";
      if (!(error instanceof HttpError)) console.error(error);
      return drop("failed", code);
    }

    this.queue.shift();
    this.current = { job, run };
    this.deps.store.updateState((state) => {
      state.runLog = [...runLog, new Date(now).toISOString()];
    });
    this.sendReport(job, schedule, "started", { code: null, startedAt: now, run });
    const unsubscribe = run.subscribe(0, (event) => {
      if (!isTerminalType(event.type)) return;
      // Deferred: the subscription may fire before subscribe() has returned.
      queueMicrotask(() => {
        unsubscribe();
        this.runEnded(job, schedule, run, now);
      });
    });
  }

  private retryLater(): void {
    this.retryTimer = this.clock.setTimeout(() => this.pump(), PROVIDER_RETRY_MS);
  }

  private runEnded(job: Job, schedule: Schedule, run: Run, startedAt: number): void {
    if (this.current?.run !== run) return;
    this.current = undefined;
    const status = run.status === "completed" ? "completed" : run.status === "cancelled" ? "cancelled" : "failed";
    const code = run.error && status === "failed" ? run.error.code : null;
    this.finishJob(job, schedule, status, { code, startedAt, run });
    this.pump();
  }

  /** Reports a job's end and remembers it as the schedule's last run. */
  private finishJob(
    job: Job,
    schedule: Schedule,
    status: ReportStatus,
    detail: { code: string | null; startedAt?: number; run?: Run },
  ): void {
    const at = new Date(this.clock.now()).toISOString();
    this.deps.store.updateState((state) => {
      const entry = state.schedules[schedule.id] ?? { lastScheduledFor: null, lastRun: null };
      entry.lastRun = {
        scheduledFor: new Date(job.scheduledFor).toISOString(),
        runId: detail.run?.id ?? null,
        status,
        code: detail.code,
        at,
        resultKey: detail.run?.store?.key ?? null,
      };
      state.schedules[schedule.id] = entry;
    });
    this.sendReport(job, schedule, status, detail);
  }

  private sendReport(
    job: Job,
    schedule: Schedule,
    status: ReportStatus,
    { code, startedAt, run }: { code: string | null; startedAt?: number; run?: Run },
  ): void {
    const finished = status !== "started";
    const now = this.clock.now();
    const summary = finished ? run?.summary : undefined;
    this.deps.report({
      report_id: job.reportId,
      schedule_id: schedule.id,
      command_id: job.commandId,
      trigger: job.trigger,
      scheduled_for: new Date(job.scheduledFor).toISOString(),
      status,
      code,
      retryable: status === "failed" && run?.error ? run.error.retryable : null,
      task_version: schedule.task_version,
      started_at: startedAt === undefined ? null : new Date(startedAt).toISOString(),
      finished_at: finished ? new Date(now).toISOString() : null,
      duration_ms: finished && startedAt !== undefined ? now - startedAt : null,
      connectors_read: summary?.sources.map((source) => source.id) ?? [],
      connector_errors: summary?.connectorErrors.map(({ connector, kind }) => ({ connector, kind })) ?? [],
      redactions: summary?.redactions ?? null,
    });
  }
}

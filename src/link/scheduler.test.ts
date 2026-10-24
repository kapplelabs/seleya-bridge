import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, test } from "node:test";

import type { BridgeConfig } from "../config.ts";
import type { RunRequest } from "../engine/policy.ts";
import { Run, RunRegistry } from "../runs.ts";
import type { Caller } from "../runs/start.ts";
import { type Clock, Scheduler } from "./scheduler.ts";
import { LinkStore, type Report, type Schedule } from "./store.ts";

const ORIGIN = "https://seleya.example.com";

class FakeClock implements Clock {
  time: number;
  private timers: { id: number; at: number; callback: () => void }[] = [];
  private nextId = 1;

  constructor(iso: string) {
    this.time = Date.parse(iso);
  }

  now(): number {
    return this.time;
  }

  setTimeout(callback: () => void, ms: number): unknown {
    const id = this.nextId++;
    this.timers.push({ id, at: this.time + ms, callback });
    return id;
  }

  clearTimeout(handle: unknown): void {
    this.timers = this.timers.filter((timer) => timer.id !== handle);
  }

  /** Moves time forward, firing timers in order; `jump` skips them (a machine asleep). */
  advance(ms: number, { jump = false } = {}): void {
    const target = this.time + ms;
    if (jump) {
      this.time = target;
      return;
    }
    for (;;) {
      const due = this.timers.filter((timer) => timer.at <= target).sort((a, b) => a.at - b.at)[0];
      if (!due) break;
      this.timers = this.timers.filter((timer) => timer !== due);
      // A timer that fired late (after a jump) runs at the current time, as a real one would.
      this.time = Math.max(this.time, due.at);
      due.callback();
    }
    this.time = target;
  }

  /** Fires whatever is due now, e.g. after a jump. */
  fire(): void {
    this.advance(0);
  }
}

const schedule = (overrides: Partial<Schedule> = {}): Schedule => ({
  id: "sch_1",
  name: "Daily Briefing",
  task_id: "briefing",
  task_version: 3,
  enabled: true,
  timing: { kind: "weekly", days: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"], time: "08:00" },
  time_zone: "UTC",
  created_at: "2026-10-01T00:00:00Z",
  template: {
    request: { prompt: "Brief {{today}}", template: {}, store: { key: "u_1:briefing" }, connectors: "all" },
    expires_after_minutes: 120,
  },
  ...overrides,
});

let home: string;
let store: LinkStore;
let runs: RunRegistry;
let clock: FakeClock;
let reports: Report[];
let started: { body: RunRequest; caller: Caller; run: Run }[];
let provider: { ready: boolean; discovering: boolean; connected: string[] };
let link: BridgeConfig["link"];
let scheduler: Scheduler;

function complete(run: Run, ok = true): void {
  if (ok) {
    run.summary = { sources: [{ id: "gmail", name: "Gmail" }], connectorErrors: [], redactions: 2 };
    run.emit("run.completed", {});
  } else {
    run.error = { code: "provider_auth_required", message: "Sign in", retryable: true };
    run.emit("run.failed", run.error);
  }
  run.emit("stream.done", {});
}

const flush = () => new Promise((resolve) => setImmediate(resolve));

beforeEach(() => {
  home = mkdtempSync(path.join(tmpdir(), "seleya-bridge-scheduler-"));
  store = new LinkStore(home);
  reports = [];
  started = [];
  provider = { ready: true, discovering: false, connected: ["gmail", "calendar"] };
  link = { enabled: true, connectors: "all", maxRunsPerDay: 24, minIntervalMinutes: 30 };
  clock = new FakeClock("2026-10-24T07:59:00Z");
  runs = new RunRegistry((busy) => {
    if (!busy) queueMicrotask(() => scheduler.idle());
  });
  scheduler = new Scheduler({
    store,
    link: () => link,
    runs,
    clock,
    provider: () => provider,
    origin: () => ORIGIN,
    report: (report) => reports.push(report),
    start: (body, caller) => {
      if (runs.busy) throw Object.assign(new Error("busy"), {});
      const run = runs.create({
        sessionId: "s",
        persisted: false,
        ownerId: caller.ownerId,
        origin: caller.origin,
        provider: "claude",
        ...(caller.trigger && { trigger: caller.trigger }),
        ...(caller.scheduleId && { scheduleId: caller.scheduleId }),
      });
      started.push({ body, caller, run });
      return run;
    },
  });
});

afterEach(() => {
  scheduler.stop();
  rmSync(home, { recursive: true, force: true });
});

describe("scheduler", () => {
  test("runs on time, reports started then completed under one report id", async () => {
    scheduler.apply({ configRevision: 1, schedules: [schedule()] });
    assert.equal(started.length, 0);
    clock.advance(2 * 60_000);
    assert.equal(started.length, 1);
    const [{ caller, body }] = started as [(typeof started)[number]];
    assert.deepEqual(caller, { ownerId: "link", origin: ORIGIN, trigger: "schedule", scheduleId: "sch_1" });
    assert.deepEqual(body.workspace_tools, []);
    assert.equal(body.session, null);

    complete(started[0]!.run);
    await flush();
    assert.deepEqual(
      reports.map((report) => report.status),
      ["started", "completed"],
    );
    assert.equal(reports[0]!.report_id, reports[1]!.report_id);
    assert.equal(reports[1]!.scheduled_for, "2026-10-24T08:00:00.000Z");
    assert.deepEqual(reports[1]!.connectors_read, ["gmail"]);
    assert.equal(reports[1]!.redactions, 2);
    assert.equal(reports[1]!.task_version, 3);
    assert.equal(scheduler.view().schedules[0]!.lastRun?.status, "completed");
    assert.equal(scheduler.view().schedules[0]!.nextRunAt, "2026-10-25T08:00:00.000Z");

    // The same occurrence never runs twice, even after a restart.
    scheduler.apply({ configRevision: 1, schedules: [schedule()] });
    clock.advance(60_000);
    assert.equal(started.length, 1);
  });

  test("waits while the bridge is busy, then runs", async () => {
    const manual = runs.create({ sessionId: "m", persisted: false, ownerId: "browser", origin: ORIGIN, provider: "claude" });
    scheduler.apply({ configRevision: 1, schedules: [schedule()] });
    clock.advance(2 * 60_000);
    assert.equal(started.length, 0);
    assert.equal(scheduler.view().queue.length, 1);
    complete(manual);
    await flush();
    assert.equal(started.length, 1);
  });

  test("catches up after sleeping, or reports the occurrence as expired", async () => {
    scheduler.apply({ configRevision: 1, schedules: [schedule()] });
    clock.advance(70 * 60_000, { jump: true });
    clock.fire();
    assert.equal(started.length, 1);
    assert.equal(started[0]!.caller.trigger, "catch_up");
    complete(started[0]!.run);
    await flush();

    // Asleep until 11:30 the next day: past the 120-minute window.
    clock.advance(26 * 60 * 60_000, { jump: true });
    clock.fire();
    assert.equal(started.length, 1);
    const expired = reports.at(-1)!;
    assert.equal(expired.status, "skipped");
    assert.equal(expired.code, "expired");
    assert.equal(expired.scheduled_for, "2026-10-25T08:00:00.000Z");
  });

  test("a schedule made after today's time doesn't run it", () => {
    clock.advance(60 * 60_000, { jump: true });
    scheduler.apply({ configRevision: 1, schedules: [schedule({ created_at: "2026-10-24T08:30:00Z" })] });
    assert.equal(started.length, 0);
    assert.equal(reports.length, 0);
  });

  test("run_now once per command id; cancel drops a waiting job", async () => {
    clock.advance(4 * 60 * 60_000, { jump: true });
    scheduler.apply({ configRevision: 1, schedules: [schedule({ enabled: false })] });
    const command = { id: "cmd_1", kind: "run_now" as const, scheduleId: "sch_1", expiresAt: "2026-10-24T13:00:00Z" };
    scheduler.command(command);
    scheduler.command(command);
    assert.equal(started.length, 1);
    assert.equal(started[0]!.caller.trigger, "remote");
    complete(started[0]!.run);
    await flush();
    assert.equal(reports.at(-1)!.command_id, "cmd_1");

    const manual = runs.create({ sessionId: "m", persisted: false, ownerId: "browser", origin: ORIGIN, provider: "claude" });
    scheduler.command({ ...command, id: "cmd_2" });
    scheduler.command({ ...command, id: "cmd_3", kind: "cancel" });
    assert.equal(scheduler.view().queue.length, 0);
    assert.equal(reports.at(-1)!.status, "cancelled");
    complete(manual);
  });

  test("daily limit, provider not ready, broken templates and connector ceilings are reported", async () => {
    link = { ...link, maxRunsPerDay: 1 };
    clock.advance(4 * 60 * 60_000, { jump: true });
    scheduler.apply({ configRevision: 1, schedules: [schedule({ enabled: false })] });
    const run = (id: string) =>
      scheduler.command({ id, kind: "run_now", scheduleId: "sch_1", expiresAt: "2026-10-24T20:00:00Z" });
    run("a");
    complete(started[0]!.run);
    await flush();
    run("b");
    assert.equal(reports.at(-1)!.code, "daily_limit");

    link = { ...link, maxRunsPerDay: 24 };
    provider = { ...provider, ready: false };
    run("c");
    assert.equal(started.length, 1);
    clock.advance(6 * 60_000);
    assert.equal(reports.at(-1)!.code, "provider_unavailable");
    provider = { ...provider, ready: true };

    scheduler.apply({
      configRevision: 2,
      schedules: [schedule({ enabled: false, template: { request: { prompt: "" }, expires_after_minutes: 120 } })],
    });
    run("d");
    assert.equal(reports.at(-1)!.code, "invalid_template");

    link = { ...link, connectors: ["calendar"] };
    scheduler.apply({
      configRevision: 3,
      schedules: [
        schedule({ enabled: false, template: { request: { prompt: "Hi", connectors: ["gmail"] }, expires_after_minutes: 120 } }),
      ],
    });
    run("e");
    assert.equal(reports.at(-1)!.code, "connector_not_allowed");

    // "all" under a ceiling: the connected connectors the ceiling allows.
    scheduler.apply({
      configRevision: 4,
      schedules: [schedule({ enabled: false, template: { request: { prompt: "Hi", connectors: "all" }, expires_after_minutes: 120 } })],
    });
    run("f");
    assert.deepEqual(started.at(-1)!.body.connectors, ["calendar"]);
  });

  test("a failed run is reported with its code", async () => {
    scheduler.apply({ configRevision: 1, schedules: [schedule()] });
    clock.advance(2 * 60_000);
    complete(started[0]!.run, false);
    await flush();
    const last = reports.at(-1)!;
    assert.equal(last.status, "failed");
    assert.equal(last.code, "provider_auth_required");
    assert.equal(last.retryable, true);
  });
});

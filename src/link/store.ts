/**
 * The server link's files (docs/server-link.md §6.3), all mode 600 next to config.json:
 *
 *   link.json            the link itself: server, origin, device id and token, the Seleya user
 *   link-config.json     the last schedules the server sent, so schedules run while the server can't be reached
 *   schedule-state.json  what the scheduler did: last occurrence per schedule, last run, handled commands
 *   link-outbox.json     reports not yet accepted by the server
 */
import { existsSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";

import { z } from "zod";

import { writePrivateFile } from "../config.ts";
import { timingSchema } from "./timing.ts";

export const linkSchema = z.object({
  /** e.g. https://seleya.example.com/api */
  server: z.string(),
  /** The Seleya origin that linked this bridge; its browsers see the link's runs and results. */
  origin: z.string(),
  deviceId: z.string(),
  deviceToken: z.string(),
  userId: z.string(),
  deviceName: z.string(),
  linkedAt: z.string(),
});
export type Link = z.infer<typeof linkSchema>;

/** A schedule as the server sends it (snake_case, docs/server-link.md §7.4). */
export const scheduleSchema = z.object({
  id: z.string().min(1).max(64),
  name: z.string().max(200),
  task_id: z.string().max(64),
  task_version: z.number().int(),
  enabled: z.boolean(),
  timing: timingSchema,
  time_zone: z.string().min(1).max(64),
  created_at: z.string(),
  template: z.object({
    /** A POST /v1/runs body; checked by the run policy when it runs, not here. */
    request: z.record(z.string(), z.unknown()),
    expires_after_minutes: z.number().int().min(5).max(1440).default(120),
    catch_up_minutes: z.number().int().min(0).max(1440).optional(),
  }),
});
export type Schedule = z.infer<typeof scheduleSchema>;

export const linkConfigSchema = z.object({
  configRevision: z.number().int(),
  schedules: z.array(scheduleSchema),
});
export type LinkConfig = z.infer<typeof linkConfigSchema>;

export const REPORT_STATUSES = ["started", "completed", "failed", "skipped", "cancelled"] as const;
export type ReportStatus = (typeof REPORT_STATUSES)[number];

/** What the server learns about a run: enums and counts, never text (docs/server-link.md §7.4, D6). */
export const reportSchema = z.object({
  report_id: z.string(),
  schedule_id: z.string(),
  command_id: z.string().nullable(),
  trigger: z.enum(["schedule", "catch_up", "remote"]),
  scheduled_for: z.string(),
  status: z.enum(REPORT_STATUSES),
  code: z.string().nullable(),
  retryable: z.boolean().nullable(),
  task_version: z.number().int(),
  started_at: z.string().nullable(),
  finished_at: z.string().nullable(),
  duration_ms: z.number().int().nullable(),
  connectors_read: z.array(z.string()),
  connector_errors: z.array(z.object({ connector: z.string(), kind: z.string() })),
  redactions: z.number().int().nullable(),
});
export type Report = z.infer<typeof reportSchema>;

const lastRunSchema = z.object({
  scheduledFor: z.string(),
  runId: z.string().nullable(),
  status: z.enum(REPORT_STATUSES),
  code: z.string().nullable(),
  at: z.string(),
  resultKey: z.string().nullable(),
});
export type LastRun = z.infer<typeof lastRunSchema>;

const stateSchema = z.object({
  schedules: z.record(
    z.string(),
    z.object({ lastScheduledFor: z.string().nullable(), lastRun: lastRunSchema.nullable() }),
  ),
  /** Command ids already handled, newest last: the server resends a command until it sees the ack. */
  processedCommands: z.array(z.string()),
  /** When each scheduled run of the last day started, for link.maxRunsPerDay. */
  runLog: z.array(z.string()),
});
export type ScheduleState = z.infer<typeof stateSchema>;

const MAX_OUTBOX = 500;
const MAX_PROCESSED_COMMANDS = 100;

const emptyState = (): ScheduleState => ({ schedules: {}, processedCommands: [], runLog: [] });

export class LinkStore {
  private readonly home: string;
  private state: ScheduleState;
  private outbox: Report[];

  constructor(home: string) {
    this.home = home;
    this.state = this.load("schedule-state.json", stateSchema) ?? emptyState();
    this.outbox = this.load("link-outbox.json", z.array(reportSchema)) ?? [];
  }

  private file(name: string): string {
    return path.join(this.home, name);
  }

  /** A missing or unreadable file reads as nothing: these files are rebuilt from the server. */
  private load<T>(name: string, schema: z.ZodType<T>): T | undefined {
    const file = this.file(name);
    if (!existsSync(file)) return undefined;
    try {
      const parsed = schema.safeParse(JSON.parse(readFileSync(file, "utf8")));
      return parsed.success ? parsed.data : undefined;
    } catch {
      return undefined;
    }
  }

  private save(name: string, value: unknown): void {
    writePrivateFile(this.file(name), `${JSON.stringify(value, null, 2)}\n`);
  }

  link(): Link | undefined {
    return this.load("link.json", linkSchema);
  }

  saveLink(link: Link): void {
    this.save("link.json", link);
  }

  config(): LinkConfig | undefined {
    return this.load("link-config.json", linkConfigSchema);
  }

  saveConfig(config: LinkConfig): void {
    this.save("link-config.json", config);
  }

  scheduleState(): ScheduleState {
    return this.state;
  }

  /** Changes the state and writes it at once: a crash right after a run starts must not run it again. */
  updateState(change: (state: ScheduleState) => void): void {
    change(this.state);
    this.state.processedCommands = this.state.processedCommands.slice(-MAX_PROCESSED_COMMANDS);
    this.save("schedule-state.json", this.state);
  }

  pendingReports(): Report[] {
    return [...this.outbox];
  }

  addReport(report: Report): void {
    this.outbox.push(report);
    // The server being away for days mustn't grow this forever; the oldest reports matter least.
    this.outbox = this.outbox.slice(-MAX_OUTBOX);
    this.save("link-outbox.json", this.outbox);
  }

  removeReports(ids: ReadonlySet<string>): void {
    this.outbox = this.outbox.filter((report) => !ids.has(report.report_id));
    this.save("link-outbox.json", this.outbox);
  }

  /** Forgets the link and everything that came with it; kept results stay (results.ts). */
  clear(): void {
    for (const name of ["link.json", "link-config.json", "schedule-state.json", "link-outbox.json"])
      rmSync(this.file(name), { force: true });
    this.state = emptyState();
    this.outbox = [];
  }
}

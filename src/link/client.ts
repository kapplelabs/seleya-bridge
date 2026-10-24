/**
 * The bridge's side of the server link (docs/server-link.md §6.3, §7.4). The server can't reach a bridge on
 * loopback, so the bridge calls out: one long-poll at a time brings new schedules and commands, and reports
 * go back in batches from an outbox kept on disk.
 *
 * What the server learns: the bridge's version, platform and time zone, provider and connector states, and
 * reports made of enums and counts. Never a run's output, text or tool input.
 */
import { hostname } from "node:os";

import { z } from "zod";

import { keysToSnakeCase } from "../case.ts";
import { isLoopbackOrigin } from "../config.ts";
import { HttpError } from "../http.ts";
import type { Command, Scheduler } from "./scheduler.ts";
import { scheduleSchema, type Link, type LinkStore, type Report } from "./store.ts";

/** The server answers within 25 s; a request open longer than this is lost. */
const POLL_TIMEOUT_MS = 35_000;
const REQUEST_TIMEOUT_MS = 10_000;
const UNLINK_TIMEOUT_MS = 3000;
const MAX_BACKOFF_MS = 60_000;
/** Consecutive failed polls before the link shows as offline. */
const OFFLINE_AFTER = 3;
const REPORT_BATCH = 50;
const OUTDATED_RETRY_MS = 60 * 60 * 1000;

export const SERVER_PATH_PATTERN = /^\/[A-Za-z0-9/_-]{0,100}$/;

export type LinkState = "unlinked" | "connecting" | "online" | "offline" | "revoked";

export interface LinkStatus {
  bridgeVersion: string;
  platform: string;
  timeZone: string;
  busy: boolean;
  paused: boolean;
  providers: { id: string; state: string }[];
  connectors: { id: string; state: string }[];
}

export interface LinkClientDeps {
  store: LinkStore;
  scheduler: Scheduler;
  status: () => LinkStatus;
  /** link.enabled in config.json. */
  enabled: () => boolean;
  /** For tests. */
  fetch?: typeof fetch;
  onChange?: (state: LinkState) => void;
}

const enrollSchema = z.object({ device_id: z.string(), device_token: z.string(), user_id: z.string() });

const pollSchema = z.object({
  config_revision: z.number().int(),
  config: z.object({ schedules: z.array(z.unknown()) }).nullish(),
  commands: z
    .array(
      z.object({
        id: z.string(),
        kind: z.enum(["run_now", "cancel"]),
        schedule_id: z.string(),
        expires_at: z.string(),
      }),
    )
    .default([]),
});

const errorSchema = z.object({ error: z.object({ code: z.string() }) });

class ServerError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string) {
    super(`Seleya answered ${status} ${code}`);
    this.status = status;
    this.code = code;
  }
}

const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });

/** The server's address for a Seleya origin: the same origin, so a paired page can't point elsewhere (D8). */
export function serverFor(origin: string, serverPath: string): string {
  const url = new URL(origin);
  if (url.protocol !== "https:" && !isLoopbackOrigin(origin))
    throw new HttpError(400, "invalid_request", "Seleya must be served over https to link this bridge");
  if (!SERVER_PATH_PATTERN.test(serverPath)) throw new HttpError(400, "invalid_request", "Invalid server_path");
  return `${url.origin}${serverPath.replace(/\/+$/, "")}`;
}

/**
 * Unlinks while the bridge isn't running (CLI, the app with the bridge stopped): gives the device back to the
 * server (best effort) and forgets the link. Kept results stay.
 */
export async function unlinkStored(store: LinkStore, fetchImpl: typeof fetch = fetch): Promise<boolean> {
  const link = store.link();
  if (!link) return false;
  await fetchImpl(`${link.server}/bridge/v1/unlink`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Device ${link.deviceToken}` },
    body: "{}",
    signal: AbortSignal.timeout(UNLINK_TIMEOUT_MS),
  }).catch(() => undefined);
  store.clear();
  return true;
}

export const defaultDeviceName = () => hostname().replace(/\.local$/, "") || "This computer";

export class LinkClient {
  private readonly deps: LinkClientDeps;
  private readonly fetch: typeof fetch;
  private state: LinkState;
  private lastSyncAt: string | null = null;
  private loop: AbortController | undefined;
  private acks: string[] = [];
  private flushing = false;
  /** A report arrived during a flush: send again once it ends. */
  private flushAgain = false;

  constructor(deps: LinkClientDeps) {
    this.deps = deps;
    this.fetch = deps.fetch ?? fetch;
    this.state = deps.store.link() ? "connecting" : "unlinked";
  }

  /** Runs the last schedules the server sent, then starts polling. */
  start(): void {
    const { store, scheduler } = this.deps;
    if (!store.link()) return this.setState("unlinked");
    scheduler.apply(store.config());
    this.startLoop();
  }

  stop(): void {
    this.loop?.abort();
    this.loop = undefined;
  }

  current(): { state: LinkState; link: Link | undefined; lastSyncAt: string | null; configRevision: number | null } {
    const { store } = this.deps;
    return {
      state: this.state,
      link: store.link(),
      lastSyncAt: this.lastSyncAt,
      configRevision: store.config()?.configRevision ?? null,
    };
  }

  /**
   * Links this bridge to the Seleya account that issued `enrollmentToken`. Linking again to the same
   * account replaces the device; another account needs an unlink first.
   */
  async link(origin: string, serverPath: string, enrollmentToken: string, deviceName?: string): Promise<Link> {
    const server = serverFor(origin, serverPath);
    const existing = this.deps.store.link();
    const status = this.deps.status();
    const name = deviceName?.trim() || defaultDeviceName();
    let answer: unknown;
    try {
      answer = await this.call(server, "/bridge/v1/enroll", undefined, {
        enrollmentToken,
        name,
        platform: status.platform,
        bridgeVersion: status.bridgeVersion,
        timeZone: status.timeZone,
      });
    } catch (error) {
      if (error instanceof ServerError && (error.status === 401 || error.status === 404 || error.status === 400))
        throw new HttpError(401, "enrollment_invalid", "The link code from Seleya is wrong or expired");
      throw new HttpError(502, "server_unreachable", `Couldn't reach Seleya at ${server}`);
    }
    const enrolled = enrollSchema.safeParse(answer);
    if (!enrolled.success) throw new HttpError(502, "server_unreachable", "Seleya answered something unexpected");
    if (existing && existing.userId !== enrolled.data.user_id) {
      // The new device stays unused on the server; give it back so it doesn't show as a stale machine.
      await this.call(server, "/bridge/v1/unlink", enrolled.data.device_token, {}, UNLINK_TIMEOUT_MS).catch(() => {});
      throw new HttpError(409, "already_linked", "This bridge is linked to another Seleya account; unlink it first", {
        userId: existing.userId,
      });
    }
    this.stop();
    if (existing) {
      await this.call(existing.server, "/bridge/v1/unlink", existing.deviceToken, {}, UNLINK_TIMEOUT_MS).catch(
        () => {},
      );
      this.deps.scheduler.stop();
      this.deps.store.clear();
    }
    const link: Link = {
      server,
      origin: new URL(origin).origin,
      deviceId: enrolled.data.device_id,
      deviceToken: enrolled.data.device_token,
      userId: enrolled.data.user_id,
      deviceName: name,
      linkedAt: new Date().toISOString(),
    };
    this.deps.store.saveLink(link);
    this.start();
    return link;
  }

  /** Gives the device back to the server (best effort) and forgets the link here. */
  async unlink(): Promise<void> {
    const link = this.deps.store.link();
    this.stop();
    this.deps.scheduler.stop();
    if (link)
      await this.call(link.server, "/bridge/v1/unlink", link.deviceToken, {}, UNLINK_TIMEOUT_MS).catch(() => {});
    this.forget("unlinked");
  }

  /** Queues a report and sends it soon. */
  report(report: Report): void {
    this.deps.store.addReport(report);
    void this.flush();
  }

  private forget(state: LinkState): void {
    this.deps.scheduler.stop();
    this.deps.store.clear();
    this.acks = [];
    this.setState(state);
  }

  private setState(state: LinkState): void {
    if (this.state === state) return;
    this.state = state;
    this.deps.onChange?.(state);
  }

  private startLoop(): void {
    this.loop?.abort();
    const controller = new AbortController();
    this.loop = controller;
    void this.run(controller.signal);
  }

  private async run(signal: AbortSignal): Promise<void> {
    let failures = 0;
    while (!signal.aborted) {
      const link = this.deps.store.link();
      if (!link) return this.setState("unlinked");
      if (!this.deps.enabled()) {
        await sleep(MAX_BACKOFF_MS, signal);
        continue;
      }
      if (failures === 0 && this.state !== "online") this.setState("connecting");
      try {
        await this.poll(link, signal);
        failures = 0;
        this.setState("online");
        void this.flush();
      } catch (error) {
        if (signal.aborted) return;
        if (error instanceof ServerError && error.status === 401) return this.forget("revoked");
        if (error instanceof ServerError && error.code === "bridge_outdated") {
          this.setState("offline");
          await sleep(OUTDATED_RETRY_MS, signal);
          continue;
        }
        failures++;
        if (failures >= OFFLINE_AFTER) this.setState("offline");
        const backoff = Math.min(MAX_BACKOFF_MS, 1000 * 2 ** (failures - 1));
        await sleep(backoff * (0.8 + Math.random() * 0.4), signal);
      }
    }
  }

  private async poll(link: Link, signal: AbortSignal): Promise<void> {
    const { store, scheduler } = this.deps;
    const acks = [...this.acks];
    const answer = pollSchema.parse(
      await this.call(
        link.server,
        "/bridge/v1/poll",
        link.deviceToken,
        { configRevision: store.config()?.configRevision ?? 0, status: this.deps.status(), acks },
        POLL_TIMEOUT_MS,
        signal,
      ),
    );
    // Delivered: the server won't send these commands again.
    this.acks = this.acks.filter((id) => !acks.includes(id));
    this.lastSyncAt = new Date().toISOString();
    if (answer.config) {
      // A schedule the bridge can't read is left out rather than failing the others.
      const schedules = answer.config.schedules.flatMap((item) => {
        const parsed = scheduleSchema.safeParse(item);
        if (!parsed.success) console.error(`seleya-bridge: ignored a schedule the server sent: ${parsed.error.message}`);
        return parsed.success ? [parsed.data] : [];
      });
      const config = { configRevision: answer.config_revision, schedules };
      store.saveConfig(config);
      scheduler.apply(config);
    }
    for (const command of answer.commands) {
      const parsed: Command = {
        id: command.id,
        kind: command.kind,
        scheduleId: command.schedule_id,
        expiresAt: command.expires_at,
      };
      scheduler.command(parsed);
      this.acks.push(command.id);
    }
  }

  /** Sends the outbox in batches; reports stay until the server accepts them. */
  private async flush(): Promise<void> {
    if (this.flushing) {
      this.flushAgain = true;
      return;
    }
    this.flushing = true;
    this.flushAgain = false;
    try {
      for (;;) {
        const link = this.deps.store.link();
        const batch = this.deps.store.pendingReports().slice(0, REPORT_BATCH);
        if (!link || batch.length === 0) return;
        await this.call(link.server, "/bridge/v1/reports", link.deviceToken, { reports: batch });
        this.deps.store.removeReports(new Set(batch.map((report) => report.report_id)));
      }
    } catch (error) {
      // Left in the outbox; the next successful poll sends it.
      if (error instanceof ServerError && error.status === 400)
        console.error(`seleya-bridge: the server refused reports: ${error.code}`);
      // The server is struggling: don't retry at once, the next poll will.
      this.flushAgain = false;
    } finally {
      this.flushing = false;
      if (this.flushAgain) void this.flush();
    }
  }

  private async call(
    server: string,
    pathname: string,
    deviceToken: string | undefined,
    body: unknown,
    timeoutMs = REQUEST_TIMEOUT_MS,
    signal?: AbortSignal,
  ): Promise<unknown> {
    const timeout = AbortSignal.timeout(timeoutMs);
    const response = await this.fetch(`${server}${pathname}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        ...(deviceToken !== undefined && { Authorization: `Device ${deviceToken}` }),
      },
      // Reports are written in snake_case already; keysToSnakeCase leaves those keys as they are.
      body: JSON.stringify(keysToSnakeCase(body)),
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    });
    const text = await response.text();
    let json: unknown;
    try {
      json = text ? JSON.parse(text) : {};
    } catch {
      json = undefined;
    }
    if (!response.ok) {
      const parsed = errorSchema.safeParse(json);
      throw new ServerError(response.status, parsed.success ? parsed.data.error.code : `http_${response.status}`);
    }
    return json;
  }
}

/**
 * The server link put together (docs/server-link.md §6): its files, the scheduler and the client, plus the
 * view GET /v1/link and the app show. bridge.ts creates one; server.ts only talks to this.
 */
import type { BridgeConfig } from "../config.ts";
import type { ProviderAdapter, ProviderId } from "../engine/types.ts";
import type { RunRegistry } from "../runs.ts";
import { startRun, type StartDeps } from "../runs/start.ts";
import { LinkClient, type LinkState } from "./client.ts";
import { Scheduler, type ScheduleView } from "./scheduler.ts";
import { LinkStore } from "./store.ts";

export interface LinkView {
  linked: boolean;
  server: string | null;
  origin: string | null;
  userId: string | null;
  deviceId: string | null;
  deviceName: string | null;
  state: LinkState;
  lastSyncAt: string | null;
  configRevision: number | null;
  paused: boolean;
  schedules: ScheduleView[];
  queue: { scheduleId: string; scheduledFor: string; trigger: string }[];
  activeRun: { runId: string; scheduleId: string } | null;
}

export interface LinkServiceDeps extends Omit<StartDeps, "runs"> {
  config: BridgeConfig;
  version: string;
  runs: RunRegistry;
  providers: ReadonlyMap<ProviderId, ProviderAdapter>;
  onChange?: () => void;
  fetch?: typeof fetch;
}

export class LinkService {
  private readonly store: LinkStore;
  private readonly scheduler: Scheduler;
  private readonly client: LinkClient;
  private readonly config: BridgeConfig;

  constructor(deps: LinkServiceDeps) {
    const { config, runs, providers } = deps;
    this.config = config;
    this.store = new LinkStore(config.home);
    const defaultProvider = () => providers.get(config.defaultProvider)?.status();
    this.scheduler = new Scheduler({
      store: this.store,
      link: () => config.link,
      runs,
      start: (body, caller) => startRun(body, caller, deps).run,
      provider: () => {
        const status = defaultProvider();
        return {
          ready: status?.state === "ready",
          discovering: status?.connectorsState === "discovering",
          connected: status?.connectors.filter((item) => item.state === "connected").map((item) => item.id) ?? [],
        };
      },
      origin: () => this.store.link()?.origin,
      report: (report) => {
        this.client.report(report);
        deps.onChange?.();
      },
    });
    this.client = new LinkClient({
      store: this.store,
      scheduler: this.scheduler,
      enabled: () => config.link.enabled,
      status: () => ({
        bridgeVersion: deps.version,
        platform: `${process.platform}-${process.arch}`,
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        busy: runs.busy,
        paused: !config.link.enabled,
        providers: [...providers.values()].map((adapter) => ({ id: adapter.id, state: adapter.status().state })),
        connectors: [...providers.values()].flatMap((adapter) =>
          adapter.status().connectors.map(({ id, state }) => ({ id, state })),
        ),
      }),
      ...(deps.fetch !== undefined && { fetch: deps.fetch }),
      onChange: () => deps.onChange?.(),
    });
  }

  start(): void {
    this.client.start();
  }

  stop(): void {
    this.client.stop();
    this.scheduler.stop();
  }

  /** The bridge finished a run: a waiting scheduled job may start. */
  idle(): void {
    this.scheduler.idle();
  }

  /** The origin whose browsers may see the link's runs and results; undefined when not linked. */
  origin(): string | undefined {
    return this.store.link()?.origin;
  }

  async link(origin: string, serverPath: string, enrollmentToken: string, deviceName?: string): Promise<LinkView> {
    await this.client.link(origin, serverPath, enrollmentToken, deviceName);
    return this.view();
  }

  unlink(): Promise<void> {
    return this.client.unlink();
  }

  view(): LinkView {
    const { state, link, lastSyncAt, configRevision } = this.client.current();
    const { schedules, queue } = link ? this.scheduler.view() : { schedules: [], queue: [] };
    return {
      linked: link !== undefined,
      server: link?.server ?? null,
      origin: link?.origin ?? null,
      userId: link?.userId ?? null,
      deviceId: link?.deviceId ?? null,
      deviceName: link?.deviceName ?? null,
      state,
      lastSyncAt,
      configRevision,
      paused: !this.config.link.enabled,
      schedules,
      queue,
      activeRun: this.scheduler.active() ?? null,
    };
  }
}

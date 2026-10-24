/**
 * Owns the bridge in the app: starts and stops it, and keeps the state the tray and control panel show.
 * Every change goes to the `onChange` listeners as a fresh `BridgeState`.
 */
import { app } from "electron";

import { PortInUseError, startBridge, type Bridge } from "../../../src/bridge.ts";
import { bridgeHome, DEFAULT_PORT, readConfigFile, updateConfigFile, type ConfigFile } from "../../../src/config.ts";
import { unlinkStored } from "../../../src/link/client.ts";
import type { LinkView } from "../../../src/link/service.ts";
import { LinkStore } from "../../../src/link/store.ts";
import type { ConnectorSet } from "../../../src/providers/claude/connectors.ts";
import { TokenStore, type PairingCode } from "../../../src/pairing.ts";
import type {
  BridgeError,
  BridgeSettings,
  BridgeState,
  BridgeStatus,
  LinkPanelState,
  SaveResult,
} from "../shared/ipc.ts";

const isLocal = (origin: string) => /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(origin);

/** The deployed Seleya when there is one, else the first allowed origin (local development). */
const seleyaUrlFrom = (origins: string[]) => origins.find((origin) => !isLocal(origin)) ?? origins[0];

function configOrUndefined(): ConfigFile | undefined {
  try {
    return readConfigFile();
  } catch {
    return undefined;
  }
}

export interface ControllerOptions {
  version: string;
  claudeExecutable: string | undefined;
  /** A new pairing code to bring to the user's attention. */
  onPairingCode: (code: PairingCode) => void;
  /** A scheduled run ended; the app may tell the user (never with what it read). */
  onScheduledRun?: (name: string, status: "completed" | "failed") => void;
}

const hostOf = (url: string) => {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
};

/** What the panel shows of the link; with the bridge stopped, what link.json says. */
function linkPanel(view: LinkView | undefined, config: ConfigFile | undefined): LinkPanelState {
  const paused = config?.link.enabled === false;
  if (!view) {
    let stored;
    try {
      stored = new LinkStore(bridgeHome()).link();
    } catch {
      stored = undefined;
    }
    return stored
      ? { linked: true, state: "offline", deviceName: stored.deviceName, server: hostOf(stored.server), paused, schedules: [] }
      : { linked: false, state: "unlinked", paused, schedules: [] };
  }
  return {
    linked: view.linked,
    state: view.state,
    deviceName: view.deviceName ?? undefined,
    server: view.server ? hostOf(view.server) : undefined,
    lastSyncAt: view.lastSyncAt ?? undefined,
    paused,
    schedules: view.schedules.map((schedule) => ({
      id: schedule.id,
      name: schedule.name,
      enabled: schedule.enabled,
      nextRunAt: schedule.nextRunAt ?? undefined,
      lastRun: schedule.lastRun
        ? { status: schedule.lastRun.status, code: schedule.lastRun.code ?? undefined, at: schedule.lastRun.at }
        : undefined,
    })),
    activeScheduleId: view.activeRun?.scheduleId,
  };
}

export class BridgeController {
  private bridge: Bridge | undefined;
  private status: BridgeStatus = "stopped";
  private error: BridgeError | undefined;
  private busy = false;
  private connectors: ConnectorSet | undefined;
  private link: LinkView | undefined;
  private pairing: PairingCode | undefined;
  private pairingTimer: NodeJS.Timeout | undefined;
  private readonly listeners = new Set<(state: BridgeState) => void>();
  private readonly options: ControllerOptions;

  constructor(options: ControllerOptions) {
    this.options = options;
  }

  onChange(listener: (state: BridgeState) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  state(): BridgeState {
    const config = this.bridge?.config ?? configOrUndefined();
    const tokens = this.bridge?.tokens ?? this.storedTokens();
    return {
      status: this.status,
      error: this.error,
      version: this.options.version,
      port: config?.port ?? DEFAULT_PORT,
      seleyaUrl: config ? seleyaUrlFrom(config.allowedOrigins) : undefined,
      busy: this.busy,
      pairing: this.pairing && {
        code: this.pairing.code,
        origin: this.pairing.origin,
        expiresAt: this.pairing.expiresAt.toISOString(),
      },
      paired: tokens?.list() ?? [],
      connectors: {
        wanted: config !== undefined && (config.connectors === "auto" || Object.keys(config.connectors).length > 0),
        discovering: this.bridge?.discovering() ?? false,
        items: (this.connectors?.connectors ?? []).map(({ id, name, state, tools, error }) => ({
          id,
          name,
          state,
          toolCount: tools.length,
          error,
        })),
        skipped: this.connectors?.skipped ?? [],
      },
      openAtLogin: app.getLoginItemSettings().openAtLogin,
      link: linkPanel(this.link, config),
    };
  }

  /** Tells every listener; call after anything the state shows changed. */
  changed(): void {
    const state = this.state();
    for (const listener of this.listeners) listener(state);
  }

  async start(): Promise<void> {
    if (this.status === "running" || this.status === "starting") return;
    this.status = "starting";
    this.error = undefined;
    this.changed();
    try {
      this.bridge = await startBridge({
        version: this.options.version,
        distribution: "app",
        claudeExecutable: this.options.claudeExecutable,
        listener: {
          code: (code) => this.showCode(code),
          settled: () => this.clearCode(),
          locked: (until) =>
            console.warn(
              `Too many wrong pairing codes: pairing is paused until ${until.toLocaleTimeString()}. Restart the bridge to allow it sooner.`,
            ),
          connectors: (set) => {
            this.connectors = set;
            for (const item of set.connectors)
              if (item.state === "unavailable") console.log(`connector ${item.id}: ${item.name} unavailable, ${item.error}`);
            this.changed();
          },
          busy: (busy) => {
            this.busy = busy;
            this.changed();
          },
          link: (view) => this.linkChanged(view),
        },
      });
      this.link = this.bridge.link();
      this.status = "running";
      console.log(`Listening on http://127.0.0.1:${this.bridge.config.port}`);
    } catch (error) {
      this.status = "error";
      this.error = toBridgeError(error);
      console.error(this.error.message);
    }
    this.changed();
  }

  async stop(): Promise<void> {
    const bridge = this.bridge;
    if (!bridge) return;
    this.status = "stopping";
    this.changed();
    await bridge.stop();
    this.bridge = undefined;
    this.busy = false;
    this.connectors = undefined;
    this.link = undefined;
    this.clearCode();
    this.status = "stopped";
    console.log("Stopped");
    this.changed();
  }

  async restart(): Promise<void> {
    await this.stop();
    await this.start();
  }

  revokeAll(): void {
    const count = (this.bridge?.tokens ?? this.storedTokens())?.revokeAll() ?? 0;
    console.log(`Forgot ${count} paired ${count === 1 ? "browser" : "browsers"}`);
    this.changed();
  }

  async unlink(): Promise<void> {
    if (this.bridge) await this.bridge.unlink();
    else await unlinkStored(new LinkStore(bridgeHome()));
    this.link = this.bridge?.link();
    console.log("Unlinked from Seleya");
    this.changed();
  }

  async setSchedulesPaused(paused: boolean): Promise<SaveResult> {
    try {
      updateConfigFile({ link: { ...readConfigFile().link, enabled: !paused } });
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : String(error) };
    }
    console.log(paused ? "Scheduled runs paused, restarting" : "Scheduled runs resumed, restarting");
    if (this.bridge) await this.restart();
    else this.changed();
    return { ok: true };
  }

  /** Logs each scheduled run that ended and tells the app, then shows the new state. */
  private linkChanged(view: LinkView): void {
    const before = new Map(this.link?.schedules.map((schedule) => [schedule.id, schedule.lastRun?.at]));
    this.link = view;
    for (const schedule of view.schedules) {
      const last = schedule.lastRun;
      if (!last || before.get(schedule.id) === last.at) continue;
      console.log(`Scheduled run "${schedule.name}": ${last.status}${last.code ? ` (${last.code})` : ""}`);
      if (last.status === "completed" || last.status === "failed")
        this.options.onScheduledRun?.(schedule.name, last.status);
    }
    this.changed();
  }

  settings(): BridgeSettings {
    const config = readConfigFile();
    return {
      allowedOrigins: config.allowedOrigins,
      workspace: config.workspace,
      tools: config.tools,
      connectors:
        config.connectors === "auto" ? "auto" : Object.keys(config.connectors).length === 0 ? "none" : config.connectors,
      model: config.model,
      port: config.port,
    };
  }

  async saveSettings(settings: BridgeSettings): Promise<SaveResult> {
    try {
      updateConfigFile({
        allowedOrigins: settings.allowedOrigins,
        workspace: settings.workspace,
        tools: settings.tools,
        connectors: settings.connectors === "none" ? {} : settings.connectors,
        model: settings.model?.trim() || undefined,
      });
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : String(error) };
    }
    console.log("Settings saved, restarting");
    await this.restart();
    return { ok: true };
  }

  private storedTokens(): TokenStore | undefined {
    try {
      return new TokenStore(bridgeHome());
    } catch {
      return undefined;
    }
  }

  private showCode(code: PairingCode): void {
    clearTimeout(this.pairingTimer);
    this.pairing = code;
    this.pairingTimer = setTimeout(() => this.clearCode(), code.expiresAt.getTime() - Date.now());
    console.log(`Pairing request from ${code.origin}`);
    this.options.onPairingCode(code);
    this.changed();
  }

  private clearCode(): void {
    clearTimeout(this.pairingTimer);
    if (!this.pairing) return;
    this.pairing = undefined;
    this.changed();
  }
}

function toBridgeError(error: unknown): BridgeError {
  if (error instanceof PortInUseError)
    return {
      kind: "port_in_use",
      message: `Port ${error.port} is already in use. Quit the other seleya-bridge (a terminal running pnpm dev?), then try again.`,
    };
  const message = error instanceof Error ? error.message : String(error);
  return { kind: message.startsWith("Invalid ") ? "config" : "other", message };
}

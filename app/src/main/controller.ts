/**
 * Owns the bridge in the app: starts and stops it, and keeps the state the tray and control panel show.
 * Every change goes to the `onChange` listeners as a fresh `BridgeState`.
 */
import { app } from "electron";

import { PortInUseError, startBridge, type Bridge } from "../../../src/bridge.ts";
import { bridgeHome, DEFAULT_PORT, readConfigFile, updateConfigFile, type ConfigFile } from "../../../src/config.ts";
import type { ConnectorSet } from "../../../src/providers/claude/connectors.ts";
import { TokenStore, type PairingCode } from "../../../src/pairing.ts";
import type { BridgeError, BridgeSettings, BridgeState, BridgeStatus, SaveResult } from "../shared/ipc.ts";

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
}

export class BridgeController {
  private bridge: Bridge | undefined;
  private status: BridgeStatus = "stopped";
  private error: BridgeError | undefined;
  private busy = false;
  private connectors: ConnectorSet | undefined;
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
        },
      });
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

/**
 * Starts and stops the bridge: config, paired tokens, pairing, the HTTP server and the providers (whose
 * start runs connector discovery). Shared by the CLI (index.ts), which prints what happens, and the Seleya
 * Bridge app (app/), which shows it.
 */
import { loadConfig, type BridgeConfig, type ConfigOverrides } from "./config.ts";
import type { ProviderAdapter, ProviderId } from "./engine/types.ts";
import { Pairing, TokenStore, type PairingListener } from "./pairing.ts";
import { ClaudeAdapter } from "./providers/claude/adapter.ts";
import type { ConnectorSet } from "./providers/claude/connectors.ts";
import { createBridgeServer } from "./server.ts";
import { SessionStore } from "./sessions.ts";

export interface BridgeListener extends PairingListener {
  /** Connector discovery finished; only called when the config asks for connectors. */
  connectors?: (set: ConnectorSet) => void;
  /** A provider started or finished answering a request. */
  busy?: (busy: boolean) => void;
}

export interface BridgeOptions {
  version: string;
  overrides?: ConfigOverrides;
  /** The `claude` binary to use when config.json names none (the app ships its own). */
  claudeExecutable?: string;
  listener: BridgeListener;
}

export interface Bridge {
  config: BridgeConfig;
  tokens: TokenStore;
  pairing: Pairing;
  /** Claude's connectors: the desktop app shows them. */
  connectors: () => ConnectorSet;
  /** Claude's connector discovery is still running. */
  discovering: () => boolean;
  busy: () => boolean;
  /** Cancels every run and stops listening. */
  stop: () => Promise<void>;
}

export class PortInUseError extends Error {
  readonly port: number;

  constructor(port: number) {
    super(`Port ${port} is in use: is another seleya-bridge running?`);
    this.port = port;
  }
}

/** Resolves once the bridge listens; rejects when the config is invalid or the port is taken. */
export async function startBridge({ version, overrides, claudeExecutable, listener }: BridgeOptions): Promise<Bridge> {
  const loaded = loadConfig(overrides);
  const config: BridgeConfig = { ...loaded, claudeExecutable: loaded.claudeExecutable ?? claudeExecutable };
  const tokens = new TokenStore(config.home);
  const sessions = new SessionStore(config.home);
  // Conversations of browsers revoked while the bridge was stopped (seleya-bridge revoke, the app).
  sessions.keepOwners(tokens.list().map((record) => record.id));
  const pairing = new Pairing(tokens, listener);
  let stopped = false;
  const claude = new ClaudeAdapter(config, version, {
    onConnectors: (set) => {
      if (!stopped) listener.connectors?.(set);
    },
  });
  const providers = new Map<ProviderId, ProviderAdapter>([[claude.id, claude]]);
  const { server, runs } = createBridgeServer({
    config,
    version,
    tokens,
    pairing,
    sessions,
    providers,
    onBusyChange: listener.busy,
  });

  await new Promise<void>((resolve, reject) => {
    const onError = (error: NodeJS.ErrnoException) =>
      reject(error.code === "EADDRINUSE" ? new PortInUseError(config.port) : error);
    server.once("error", onError);
    // Loopback only: the bridge is never reachable from another machine.
    server.listen(config.port, "127.0.0.1", () => {
      server.off("error", onError);
      resolve();
    });
  });

  for (const provider of providers.values()) await provider.start();

  return {
    config,
    tokens,
    pairing,
    connectors: () => claude.connectors(),
    discovering: () => claude.discovering(),
    busy: () => runs.busy,
    stop: () =>
      new Promise<void>((resolve) => {
        stopped = true;
        runs.abortAll();
        void Promise.all([...providers.values()].map((provider) => provider.stop()));
        server.close(() => resolve());
        // Open streams would keep close() waiting.
        server.closeAllConnections();
      }),
  };
}

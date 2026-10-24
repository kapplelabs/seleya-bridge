/**
 * Starts and stops the bridge: config, paired tokens, pairing, the HTTP server and connector discovery.
 * Shared by the CLI (index.ts), which prints what happens, and the Seleya Bridge app (app/), which shows it.
 */
import { loadConfig, type BridgeConfig, type ConfigOverrides } from "./config.ts";
import { discoverConnectors, EMPTY_CONNECTORS, wantsConnectors, type ConnectorSet } from "./connectors.ts";
import { Pairing, TokenStore, type PairingListener } from "./pairing.ts";
import { createBridgeServer } from "./server.ts";
import { SessionStore } from "./sessions.ts";

export interface BridgeListener extends PairingListener {
  /** Connector discovery finished; only called when the config asks for connectors. */
  connectors?: (set: ConnectorSet) => void;
  /** Claude started or finished answering a request. */
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
  connectors: () => ConnectorSet;
  /** Connector discovery is still running. */
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
  let connectors = EMPTY_CONNECTORS;
  let discovering = wantsConnectors(config);
  let stopped = false;
  const { server, runs } = createBridgeServer({
    config,
    version,
    tokens,
    pairing,
    sessions,
    connectors: () => connectors,
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

  if (discovering)
    void discoverConnectors(config, version)
      .catch((error: unknown) => {
        // E.g. no `claude` binary: runs still work, without connectors.
        console.error("Couldn't look up connectors:", error instanceof Error ? error.message : error);
        return EMPTY_CONNECTORS;
      })
      .then((found) => {
        discovering = false;
        if (stopped) return;
        connectors = found;
        listener.connectors?.(found);
      });

  return {
    config,
    tokens,
    pairing,
    connectors: () => connectors,
    discovering: () => discovering,
    busy: () => runs.busy,
    stop: () =>
      new Promise<void>((resolve) => {
        stopped = true;
        runs.abortAll();
        server.close(() => resolve());
        // Open streams would keep close() waiting.
        server.closeAllConnections();
      }),
  };
}

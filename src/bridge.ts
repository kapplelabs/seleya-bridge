/**
 * Starts and stops the bridge: config, paired tokens, pairing, the HTTP server and the providers (whose
 * start runs connector discovery). Shared by the CLI (index.ts), which prints what happens, and the Seleya
 * Bridge app (app/), which shows it.
 */
import { loadConfig, type BridgeConfig, type ConfigOverrides } from "./config.ts";
import type { ProviderAdapter, ProviderId } from "./engine/types.ts";
import { Pairing, TokenStore, type PairingListener } from "./pairing.ts";
import { ResultStore } from "./results.ts";
import { LinkService, type LinkView } from "./link/service.ts";
import { ClaudeAdapter } from "./providers/claude/adapter.ts";
import type { ConnectorSet } from "./providers/claude/connectors.ts";
import { type BridgeDistribution, createBridgeServer } from "./server.ts";
import { SessionStore } from "./sessions.ts";

export interface BridgeListener extends PairingListener {
  /** Connector discovery finished; only called when the config asks for connectors. */
  connectors?: (set: ConnectorSet) => void;
  /** A provider started or finished answering a request. */
  busy?: (busy: boolean) => void;
  /** The server link's state, schedules or last runs changed. */
  link?: (view: LinkView) => void;
}

export interface BridgeOptions {
  version: string;
  distribution: BridgeDistribution;
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
  /** The server link (docs/server-link.md): its view, and unlinking from the app. */
  link: () => LinkView;
  unlink: () => Promise<void>;
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
export async function startBridge({
  version,
  distribution,
  overrides,
  claudeExecutable,
  listener,
}: BridgeOptions): Promise<Bridge> {
  const loaded = loadConfig(overrides);
  const config: BridgeConfig = { ...loaded, claudeExecutable: loaded.claudeExecutable ?? claudeExecutable };
  const tokens = new TokenStore(config.home);
  const sessions = new SessionStore(config.home);
  // Conversations of browsers revoked while the bridge was stopped (seleya-bridge revoke, the app).
  sessions.keepOwners(tokens.list().map((record) => record.id));
  const pairing = new Pairing(tokens, listener);
  const results = new ResultStore(config.home, config.results);
  let stopped = false;
  const claude = new ClaudeAdapter(config, version, {
    onConnectors: (set) => {
      if (!stopped) listener.connectors?.(set);
    },
  });
  const providers = new Map<ProviderId, ProviderAdapter>([[claude.id, claude]]);
  // The server's run registry exists only once the server does; the link reaches it through this.
  let link: LinkService | undefined;
  const { server, runs } = createBridgeServer({
    config,
    version,
    distribution,
    tokens,
    pairing,
    sessions,
    providers,
    results,
    get link() {
      return link;
    },
    onBusyChange: (busy) => {
      listener.busy?.(busy);
      if (!busy) link?.idle();
    },
  });
  const linkService = new LinkService({
    config,
    version,
    runs,
    providers,
    sessions,
    results,
    onChange: () => {
      if (!stopped) listener.link?.(linkService.view());
    },
  });
  link = linkService;

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
  linkService.start();

  return {
    config,
    tokens,
    pairing,
    connectors: () => claude.connectors(),
    discovering: () => claude.discovering(),
    busy: () => runs.busy,
    link: () => linkService.view(),
    unlink: () => linkService.unlink(),
    stop: () =>
      new Promise<void>((resolve) => {
        stopped = true;
        linkService.stop();
        runs.abortAll();
        void Promise.all([...providers.values()].map((provider) => provider.stop()));
        server.close(() => resolve());
        // Open streams would keep close() waiting.
        server.closeAllConnections();
      }),
  };
}

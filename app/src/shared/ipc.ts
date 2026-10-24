/**
 * What the control panel sees of the bridge, and what it can ask the main process to do. The main process
 * owns the bridge; the panel only renders `BridgeState` and calls `BridgeApi` (exposed by the preload).
 */

export type BridgeStatus = "starting" | "running" | "stopping" | "stopped" | "error";

export interface BridgeError {
  kind: "port_in_use" | "config" | "other";
  message: string;
}

export interface PairingState {
  code: string;
  origin: string;
  /** ISO time the code stops working. */
  expiresAt: string;
}

export interface PairedBrowserState {
  id: string;
  origin: string;
  createdAt: string;
  /** When it last called the bridge (to the hour); unset until it does. */
  lastUsedAt?: string;
}

export interface ConnectorState {
  id: string;
  name: string;
  state: "connected" | "unavailable";
  /** Number of read-only tools Claude may call. */
  toolCount: number;
  error?: string;
}

export interface BridgeState {
  status: BridgeStatus;
  error?: BridgeError;
  version: string;
  port: number;
  /** Where Seleya web lives: the first allowed origin that isn't localhost, else the first one. */
  seleyaUrl?: string;
  /** Claude is answering a request. */
  busy: boolean;
  pairing?: PairingState;
  paired: PairedBrowserState[];
  connectors: {
    /** The config asks for connectors at all. */
    wanted: boolean;
    discovering: boolean;
    items: ConnectorState[];
    /** claude.ai connectors left out because they aren't connected here. */
    skipped: string[];
  };
  openAtLogin: boolean;
}

/** The config.json keys the Settings tab edits. */
export interface BridgeSettings {
  allowedOrigins: string[];
  workspace: string;
  tools: string[];
  /** `"none"` is written as `{}`; a hand-written map is shown as is and left alone. */
  connectors: "auto" | "none" | Record<string, string>;
  model?: string;
  port: number;
}

export type SaveResult = { ok: true } | { ok: false; message: string };

export interface BridgeApi {
  getState: () => Promise<BridgeState>;
  /** Calls `listener` with every new state; returns the unsubscribe. */
  onState: (listener: (state: BridgeState) => void) => () => void;
  start: () => Promise<void>;
  stop: () => Promise<void>;
  /** Opens Seleya's AI providers page, where this bridge is paired and connected. */
  openSeleya: () => Promise<void>;
  revokeAll: () => Promise<void>;
  getSettings: () => Promise<BridgeSettings>;
  /** Writes config.json and restarts the bridge with it. */
  saveSettings: (settings: BridgeSettings) => Promise<SaveResult>;
  /** The chosen folder, or undefined when the picker was cancelled. */
  chooseWorkspace: () => Promise<string | undefined>;
  setOpenAtLogin: (enabled: boolean) => Promise<void>;
  openConfigFile: () => Promise<void>;
  getLog: () => Promise<string[]>;
  /** Copies the pending pairing code, then hides the panel so the browser, where it's pasted, comes back. */
  copyCode: () => Promise<void>;
}

/** IPC channel names, shared by main and preload. */
export const CHANNELS = {
  state: "bridge:state",
  getState: "bridge:get-state",
  start: "bridge:start",
  stop: "bridge:stop",
  openSeleya: "bridge:open-seleya",
  revokeAll: "bridge:revoke-all",
  getSettings: "bridge:get-settings",
  saveSettings: "bridge:save-settings",
  chooseWorkspace: "bridge:choose-workspace",
  setOpenAtLogin: "bridge:set-open-at-login",
  openConfigFile: "bridge:open-config-file",
  getLog: "bridge:get-log",
  copyCode: "bridge:copy-code",
} as const;

declare global {
  interface Window {
    bridge: BridgeApi;
  }
}

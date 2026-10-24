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

export interface ScheduleState {
  id: string;
  name: string;
  enabled: boolean;
  /** ISO time of the next run; unset when off. */
  nextRunAt?: string;
  lastRun?: { status: "started" | "completed" | "failed" | "skipped" | "cancelled"; code?: string; at: string };
}

/** The link to a Seleya account (docs/server-link.md §6.6). */
export interface LinkPanelState {
  linked: boolean;
  state: "unlinked" | "connecting" | "online" | "offline" | "revoked";
  deviceName?: string;
  /** The Seleya site it is linked to, e.g. seleya.example.com. */
  server?: string;
  lastSyncAt?: string;
  /** link.enabled is off in config.json: no polling, no scheduled runs. */
  paused: boolean;
  schedules: ScheduleState[];
  /** The schedule whose run is in progress. */
  activeScheduleId?: string;
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
  link: LinkPanelState;
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
  /** Unlinks from the Seleya account; kept results stay. */
  unlink: () => Promise<void>;
  /** Turns scheduled runs off or on (link.enabled) and restarts the bridge. */
  setSchedulesPaused: (paused: boolean) => Promise<SaveResult>;
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
  unlink: "bridge:unlink",
  setSchedulesPaused: "bridge:set-schedules-paused",
} as const;

declare global {
  interface Window {
    bridge: BridgeApi;
  }
}

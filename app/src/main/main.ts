/**
 * Seleya Bridge: runs seleya-bridge from the menu bar, so nobody needs a terminal to let Seleya web reach
 * Claude Code on this Mac.
 *
 * - The bridge starts with the app (and the app can start at login).
 * - Pairing codes appear in the control panel and as a notification, instead of in a terminal.
 * - Seleya web opens the app with `seleya-bridge://open`; the link only shows the panel.
 */
import path from "node:path";

import { app, BrowserWindow, clipboard, dialog, ipcMain, Notification, shell, type IpcMainInvokeEvent } from "electron";

import { configPath } from "../../../src/config.ts";
import type { PairingCode } from "../../../src/pairing.ts";
import { CHANNELS, type BridgeSettings } from "../shared/ipc.ts";
import { bundledClaude } from "./claudeBinary.ts";
import { BridgeController } from "./controller.ts";
import { appendLog, captureConsole, logLines } from "./log.ts";
import { useLoginShellPath } from "./shellPath.ts";
import { createTray, spacedCode } from "./tray.ts";
import { createPanel } from "./window.ts";

declare const __BRIDGE_VERSION__: string;

const PROTOCOL = "seleya-bridge";
/** dist/, holding main/, preload/ and renderer/. */
const DIST_DIR = path.join(import.meta.dirname, "..");
const ASSETS_DIR = path.join(import.meta.dirname, "../../assets");

let panel: BrowserWindow | undefined;
let quitting = false;
/** A deep link that arrived before the app was ready. */
let pendingLink: string | undefined;

captureConsole();
useLoginShellPath();

const controller = new BridgeController({
  version: __BRIDGE_VERSION__,
  claudeExecutable: bundledClaude(),
  onPairingCode: announceCode,
});

function ensurePanel(): BrowserWindow {
  if (panel) return panel;
  const created = createPanel(DIST_DIR, () => quitting);
  // The panel floats only to show a code the user hasn't looked at yet. Once they've used it (clicked
  // Copy code) and gone back to the browser, it must not cover the field they type the code into.
  created.on("blur", () => created.setAlwaysOnTop(false));
  return (panel = created);
}

function showPanel(): void {
  ensurePanel().show();
  app.focus({ steal: true });
}

/**
 * Shows the code without taking focus from the browser, where the user types it: the panel floats over
 * it until the code is used or expires.
 */
function announceCode({ code, origin }: PairingCode): void {
  const window = ensurePanel();
  // Copy code hid the app; showing a window doesn't unhide it.
  app.show();
  window.setAlwaysOnTop(true, "floating");
  window.showInactive();
  const notification = new Notification({
    title: `Pairing code ${spacedCode(code)}`,
    body: `${new URL(origin).host} wants to connect. Enter this code in Seleya; it expires in 2 minutes.`,
  });
  notification.on("click", showPanel);
  notification.show();
}

/**
 * Copies the pending code and gets out of the way: hiding the app hands focus back to the app the user came
 * from (the browser), so they can paste right away.
 */
function copyCode(): void {
  const code = controller.state().pairing?.code;
  if (!code) return;
  clipboard.writeText(code);
  panel?.setAlwaysOnTop(false);
  app.hide();
}

function handleLink(url: string): void {
  if (!url.startsWith(`${PROTOCOL}:`)) return;
  // seleya-bridge://open: bring the panel up. Any website can open the link, so it changes nothing: it
  // doesn't pair a browser, and a bridge the user stopped stays stopped until they start it in the panel.
  // (Launching the app with the link starts the bridge as any launch does.)
  appendLog("Opened from a seleya-bridge:// link");
  showPanel();
}

/**
 * Seleya's AI providers page, opened on pairing this bridge (`connect=local` opens its "on this machine"
 * connection dialog). Pairing and connecting happen there; the panel shows the code.
 */
const SELEYA_PROVIDERS_PATH = "/providers?connect=local";

function openSeleya(): void {
  const url = controller.state().seleyaUrl;
  if (url && /^https?:\/\//.test(url)) void shell.openExternal(`${url}${SELEYA_PROVIDERS_PATH}`);
}

function setOpenAtLogin(enabled: boolean): void {
  app.setLoginItemSettings({ openAtLogin: enabled });
  controller.changed();
}

/** Only the control panel page may call the bridge's IPC. */
function fromPanel(event: IpcMainInvokeEvent): boolean {
  return panel !== undefined && event.sender === panel.webContents;
}

/** Arguments come from the page: handlers coerce them, and config.json is validated before it's written. */
function handle<A extends unknown[], T>(channel: string, run: (event: IpcMainInvokeEvent, ...args: A) => T): void {
  ipcMain.handle(channel, (event, ...args: unknown[]) => {
    if (!fromPanel(event)) throw new Error("Not allowed");
    return run(event, ...(args as A));
  });
}

function registerIpc(): void {
  handle(CHANNELS.getState, () => controller.state());
  handle(CHANNELS.start, () => controller.start());
  handle(CHANNELS.stop, () => controller.stop());
  handle(CHANNELS.openSeleya, openSeleya);
  handle(CHANNELS.revokeAll, () => controller.revokeAll());
  handle(CHANNELS.getSettings, () => controller.settings());
  handle(CHANNELS.saveSettings, (_event, settings: BridgeSettings) => controller.saveSettings(settings));
  handle(CHANNELS.chooseWorkspace, async () => {
    if (!panel) return undefined;
    const result = await dialog.showOpenDialog(panel, {
      title: "Choose Claude's workspace folder",
      defaultPath: controller.settings().workspace,
      properties: ["openDirectory", "createDirectory"],
    });
    return result.canceled ? undefined : result.filePaths[0];
  });
  handle(CHANNELS.setOpenAtLogin, (_event, enabled: boolean) => setOpenAtLogin(enabled === true));
  handle(CHANNELS.openConfigFile, async () => {
    const file = configPath();
    if ((await shell.openPath(file)) !== "") shell.showItemInFolder(file);
  });
  handle(CHANNELS.getLog, () => logLines());
  handle(CHANNELS.copyCode, copyCode);
}

function main(): void {
  // In development the app runs as `electron .`, so the link must name the app folder too.
  if (process.defaultApp && process.argv[1])
    app.setAsDefaultProtocolClient(PROTOCOL, process.execPath, [path.resolve(process.argv[1])]);
  else app.setAsDefaultProtocolClient(PROTOCOL);

  app.on("open-url", (event, url) => {
    event.preventDefault();
    if (app.isReady()) handleLink(url);
    else pendingLink = url;
  });
  app.on("second-instance", (_event, argv) => {
    const link = argv.find((arg) => arg.startsWith(`${PROTOCOL}:`));
    if (link) handleLink(link);
    else showPanel();
  });
  // A menu-bar app: closing the panel keeps it running.
  app.on("window-all-closed", () => {});
  app.on("activate", showPanel);
  app.on("before-quit", () => {
    quitting = true;
  });
  app.on("will-quit", (event) => {
    if (controller.state().status === "stopped") return;
    event.preventDefault();
    void controller.stop().finally(() => app.exit(0));
  });

  void app.whenReady().then(() => {
    app.dock?.hide();
    registerIpc();

    const tray = createTray(ASSETS_DIR, {
      openPanel: showPanel,
      openSeleya,
      start: () => void controller.start(),
      stop: () => void controller.stop(),
      setOpenAtLogin,
      copyCode,
      quit: () => app.quit(),
    });
    controller.onChange((state) => {
      tray.update(state);
      panel?.webContents.send(CHANNELS.state, state);
      if (!state.pairing && panel?.isAlwaysOnTop()) panel.setAlwaysOnTop(false);
    });
    tray.update(controller.state());

    void controller.start();
    if (pendingLink) handleLink(pendingLink);
    else if (!app.getLoginItemSettings().wasOpenedAtLogin) showPanel();
  });
}

if (app.requestSingleInstanceLock()) main();
else app.quit();

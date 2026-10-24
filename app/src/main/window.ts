/**
 * The control panel window. Closing it only hides it: the bridge keeps running from the menu bar.
 * The page is sandboxed and only reaches the main process through the preload's `window.bridge`.
 */
import path from "node:path";

import { BrowserWindow, nativeTheme, shell } from "electron";

const isWebUrl = (url: string) => /^https?:\/\//.test(url);

export function createPanel(distDir: string, isQuitting: () => boolean): BrowserWindow {
  const panel = new BrowserWindow({
    width: 400,
    height: 640,
    minHeight: 520,
    resizable: true,
    maximizable: false,
    fullscreenable: false,
    // A pairing code shows the panel without focusing it: the first click on Copy code must press the
    // button, not just focus the window.
    acceptFirstMouse: true,
    show: false,
    title: "Seleya Bridge",
    titleBarStyle: "hiddenInset",
    // Matches --background in the page's theme, so nothing flashes before it paints.
    backgroundColor: nativeTheme.shouldUseDarkColors ? "#0e0f13" : "#f3f4f7",
    webPreferences: {
      preload: path.join(distDir, "preload", "preload.cjs"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      spellcheck: false,
    },
  });

  const devServer = process.env.VITE_DEV_SERVER_URL;
  if (devServer) void panel.loadURL(devServer);
  else void panel.loadFile(path.join(distDir, "renderer", "index.html"));

  // The panel never navigates; links open in the user's browser.
  panel.webContents.setWindowOpenHandler(({ url }) => {
    if (isWebUrl(url)) void shell.openExternal(url);
    return { action: "deny" };
  });
  panel.webContents.on("will-navigate", (event, url) => {
    if (url === panel.webContents.getURL()) return;
    event.preventDefault();
    if (isWebUrl(url)) void shell.openExternal(url);
  });

  panel.on("close", (event) => {
    if (isQuitting()) return;
    event.preventDefault();
    panel.hide();
  });
  return panel;
}

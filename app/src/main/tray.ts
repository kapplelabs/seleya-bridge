/** The menu-bar icon and its menu, redrawn from every new state. */
import path from "node:path";

import { Menu, nativeImage, Tray, type MenuItemConstructorOptions } from "electron";

import type { BridgeState } from "../shared/ipc.ts";

export interface TrayActions {
  openPanel: () => void;
  openSeleya: () => void;
  start: () => void;
  stop: () => void;
  setOpenAtLogin: (enabled: boolean) => void;
  copyCode: () => void;
  quit: () => void;
}

/** One line for the menu and tooltip, in the words the control panel uses. */
export function statusLine(state: BridgeState): string {
  switch (state.status) {
    case "starting":
      return "Starting…";
    case "running":
      return state.busy ? "Claude is answering a request" : `Running on 127.0.0.1:${state.port}`;
    case "stopping":
      return "Stopping…";
    case "stopped":
      return "Bridge is off";
    case "error":
      return "Couldn't start the bridge";
  }
}

export const spacedCode = (code: string) => `${code.slice(0, 3)} ${code.slice(3)}`;

export function createTray(assets: string, actions: TrayActions): { update: (state: BridgeState) => void } {
  // "Template" images follow the menu bar's light or dark look; Electron picks the @2x file itself.
  const icon = (name: string) => {
    const image = nativeImage.createFromPath(path.join(assets, `${name}Template.png`));
    image.setTemplateImage(true);
    return image;
  };
  const icons = { on: icon("tray"), off: icon("trayOff"), attention: icon("trayDot") };
  const tray = new Tray(icons.off);

  const update = (state: BridgeState) => {
    const running = state.status === "running";
    tray.setImage(
      state.status === "stopped" || state.status === "error"
        ? icons.off
        : state.busy || state.pairing
          ? icons.attention
          : icons.on,
    );
    tray.setToolTip(`Seleya Bridge: ${statusLine(state)}`);

    const items: MenuItemConstructorOptions[] = [
      { label: statusLine(state), enabled: false },
      ...(state.pairing
        ? [
            {
              label: `Pairing code ${spacedCode(state.pairing.code)} (click to copy)`,
              click: actions.copyCode,
            },
          ]
        : []),
      { type: "separator" },
      { label: "Open Control Panel…", click: actions.openPanel },
      { label: "Open Seleya Provider", enabled: state.seleyaUrl !== undefined, click: actions.openSeleya },
      { type: "separator" },
      running || state.status === "starting"
        ? { label: "Stop Bridge", enabled: running, click: actions.stop }
        : { label: "Start Bridge", enabled: state.status !== "stopping", click: actions.start },
      {
        label: "Start at Login",
        type: "checkbox",
        checked: state.openAtLogin,
        click: (item) => actions.setOpenAtLogin(item.checked),
      },
      { type: "separator" },
      { label: "Quit Seleya Bridge", accelerator: "Command+Q", click: actions.quit },
    ];
    tray.setContextMenu(Menu.buildFromTemplate(items));
  };

  return { update };
}

/** Gives the control panel `window.bridge` and nothing else of Electron or Node. */
import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";

import { CHANNELS, type BridgeApi, type BridgeState } from "../shared/ipc.ts";

const api: BridgeApi = {
  getState: () => ipcRenderer.invoke(CHANNELS.getState),
  onState: (listener) => {
    const handler = (_event: IpcRendererEvent, state: BridgeState) => listener(state);
    ipcRenderer.on(CHANNELS.state, handler);
    return () => ipcRenderer.off(CHANNELS.state, handler);
  },
  start: () => ipcRenderer.invoke(CHANNELS.start),
  stop: () => ipcRenderer.invoke(CHANNELS.stop),
  openSeleya: () => ipcRenderer.invoke(CHANNELS.openSeleya),
  revokeAll: () => ipcRenderer.invoke(CHANNELS.revokeAll),
  getSettings: () => ipcRenderer.invoke(CHANNELS.getSettings),
  saveSettings: (settings) => ipcRenderer.invoke(CHANNELS.saveSettings, settings),
  chooseWorkspace: () => ipcRenderer.invoke(CHANNELS.chooseWorkspace),
  setOpenAtLogin: (enabled) => ipcRenderer.invoke(CHANNELS.setOpenAtLogin, enabled),
  openConfigFile: () => ipcRenderer.invoke(CHANNELS.openConfigFile),
  getLog: () => ipcRenderer.invoke(CHANNELS.getLog),
  copyCode: () => ipcRenderer.invoke(CHANNELS.copyCode),
};

contextBridge.exposeInMainWorld("bridge", api);

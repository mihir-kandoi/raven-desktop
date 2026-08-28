import { contextBridge, ipcRenderer } from "electron"
import type { IpcRendererEvent } from "electron"
import type { Appearance, DesktopBridge, RailDensity, ShellState } from "./types.js"

const bridge: DesktopBridge = {
  getState: () => ipcRenderer.invoke("shell:get-state") as Promise<ShellState>,
  addSite: (url: string) => ipcRenderer.invoke("shell:add-site", url),
  selectSite: (siteID: string) => ipcRenderer.invoke("shell:select-site", siteID),
  removeSite: (siteID: string) => ipcRenderer.invoke("shell:remove-site", siteID),
  setManagerOpen: (open: boolean) => ipcRenderer.invoke("shell:set-manager-open", open),
  setAppearance: (appearance: Appearance) => ipcRenderer.invoke("shell:set-appearance", appearance),
  setRailDensity: (density: RailDensity) => ipcRenderer.invoke("shell:set-rail-density", density),
  onStateChanged: (callback: (state: ShellState) => void) => {
    const listener = (_event: IpcRendererEvent, state: ShellState) => callback(state)
    ipcRenderer.on("shell:state-changed", listener)
    return () => ipcRenderer.removeListener("shell:state-changed", listener)
  },
}

contextBridge.exposeInMainWorld("ravenDesktop", bridge)

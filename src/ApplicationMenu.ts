import { Menu } from "electron"
import type { RavenSite } from "./types.js"

interface MenuActions {
  selectSite(siteID: string): void
  openManager(): void
  reload(): void
}

export class ApplicationMenu {
  public constructor(private readonly actions: MenuActions) {}

  public update(sites: RavenSite[]): void {
    Menu.setApplicationMenu(Menu.buildFromTemplate([
      ...(process.platform === "darwin" ? [{ role: "appMenu" as const }] : []),
      {
        label: "Sites",
        submenu: [
          ...sites.map((site) => ({
            label: site.name,
            click: () => this.actions.selectSite(site.id),
          })),
          { type: "separator" },
          {
            label: "Manage Sites…",
            accelerator: "CmdOrCtrl+,",
            click: () => this.actions.openManager(),
          },
        ],
      },
      { role: "editMenu" },
      {
        label: "View",
        submenu: [
          { label: "Reload Raven", accelerator: "CmdOrCtrl+R", click: () => this.actions.reload() },
          { type: "separator" },
          { role: "resetZoom" },
          { role: "zoomIn" },
          { role: "zoomOut" },
          { type: "separator" },
          { role: "togglefullscreen" },
        ],
      },
      { role: "windowMenu" },
    ]))
  }
}

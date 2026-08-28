import path from "node:path"
import { app, Menu, nativeImage, Tray } from "electron"
import type { RavenSite, SiteRuntimeState } from "./types.js"

interface TrayActions {
  showWindow(): void
  selectSite(siteID: string): void
  openManager(): void
  quit(): void
}

export class TrayController {
  private readonly tray: Tray

  public constructor(private readonly actions: TrayActions) {
    const iconPath = path.join(app.getAppPath(), "assets", "Raven.png")
    const image = nativeImage.createFromPath(iconPath).resize({ width: 18, height: 18 })
    image.setTemplateImage(process.platform === "darwin")
    this.tray = new Tray(image)
    this.tray.setToolTip("Raven")
    this.tray.on("click", () => this.actions.showWindow())
  }

  public update(
    sites: RavenSite[],
    activeSiteID: string | null,
    runtimeBySite: Record<string, SiteRuntimeState>,
  ): void {
    const siteItems = sites.map((site) => ({
      label: siteLabel(site, runtimeBySite[site.id]?.unreadCount ?? 0),
      type: "radio" as const,
      checked: site.id === activeSiteID,
      click: () => this.actions.selectSite(site.id),
    }))
    this.tray.setContextMenu(Menu.buildFromTemplate([
      { label: "Open Raven", click: () => this.actions.showWindow() },
      { type: "separator" },
      ...siteItems,
      ...(siteItems.length ? [{ type: "separator" as const }] : []),
      { label: "Manage sites…", click: () => this.actions.openManager() },
      { type: "separator" },
      { label: "Quit Raven", click: () => this.actions.quit() },
    ]))
  }

  public destroy(): void {
    this.tray.destroy()
  }
}

const siteLabel = (site: RavenSite, unreadCount: number): string =>
  unreadCount > 0 ? `${site.name} (${unreadCount})` : site.name

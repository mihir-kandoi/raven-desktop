import path from "node:path"
import {
  app,
  BaseWindow,
  ipcMain,
  WebContentsView,
} from "electron"
import type { IpcMainInvokeEvent } from "electron"
import { ApplicationMenu } from "./ApplicationMenu.js"
import { calculateShellLayout } from "./shellLayout.js"
import { SiteDiscovery } from "./SiteDiscovery.js"
import { SiteStore } from "./SiteStore.js"
import { SiteViewManager } from "./SiteViewManager.js"
import { shellUrl } from "./shellProtocol.js"
import { TrayController } from "./TrayController.js"
import { visibleWindowBounds } from "./windowBounds.js"
import type {
  Appearance,
  DeepLinkTarget,
  RavenSite,
  ShellState,
  SiteRuntimeState,
} from "./types.js"

const IPC_CHANNELS = [
  "shell:get-state",
  "shell:add-site",
  "shell:select-site",
  "shell:remove-site",
  "shell:set-manager-open",
  "shell:set-appearance",
] as const

export class ShellWindow {
  private readonly window: BaseWindow
  private readonly shellView: WebContentsView
  private readonly siteViews: SiteViewManager
  private readonly tray: TrayController
  private readonly applicationMenu: ApplicationMenu
  private readonly runtimeBySite: Record<string, SiteRuntimeState> = {}
  private readonly attachedViewIDs = new Set<number>()
  private managerOpen = false
  private isQuitting = false
  private isDestroyed = false
  private boundsSaveTimer?: NodeJS.Timeout

  public constructor(
    private readonly siteStore: SiteStore,
    private readonly siteDiscovery: SiteDiscovery,
  ) {
    this.window = this.createWindow()
    this.shellView = this.createShellView()
    this.siteViews = this.createSiteViews()
    this.tray = this.createTray()
    this.applicationMenu = this.createApplicationMenu()
    this.window.contentView.addChildView(this.shellView)
    this.registerWindowEvents()
    this.registerIPC()
  }

  public async start(): Promise<void> {
    const state = this.siteStore.snapshot()
    this.managerOpen = state.sites.length === 0
    await this.shellView.webContents.session.clearCache()
    await this.shellView.webContents.loadURL(shellUrl("index.html"))
    const activeSite = await this.refreshContentSite(this.findActiveSite())
    if (activeSite && !this.managerOpen) await this.showSite(activeSite)
    this.layout()
    this.publishState()
    this.updateApplicationMenu()
    this.window.show()
  }

  public show(): void {
    if (this.window.isMinimized()) this.window.restore()
    this.window.show()
    this.window.focus()
  }

  public openManager(): void {
    this.managerOpen = true
    this.show()
    this.layout()
    this.publishState()
  }

  public isNotificationServiceConnected(siteID: string): boolean {
    return this.siteViews.isNotificationServiceConnected(siteID)
  }

  public isNotificationServiceReady(siteID: string): boolean {
    return this.siteViews.isNotificationServiceReady(siteID)
  }

  public hasNotificationServiceReceivedMessage(siteID: string): boolean {
    return this.siteViews.hasNotificationServiceReceivedMessage(siteID)
  }

  public openDeepLink(target: DeepLinkTarget): void {
    const state = this.siteStore.snapshot()
    const hasSiteTarget = Boolean(target.siteID || target.siteOrigin)
    const site = hasSiteTarget
      ? state.sites.find((candidate) => candidate.id === target.siteID || candidate.origin === target.siteOrigin)
      : this.findActiveSite()
    if (!site) return this.openManager()
    void this.selectSite(site.id).then(() => this.siteViews.navigate(site, target.path))
  }

  public quit(): void {
    this.isQuitting = true
    app.quit()
  }

  public destroy(): void {
    if (this.isDestroyed) return
    this.isDestroyed = true
    this.isQuitting = true
    for (const channel of IPC_CHANNELS) ipcMain.removeHandler(channel)
    this.tray.destroy()
    this.siteViews.close()
    this.shellView.webContents.close()
    this.window.destroy()
  }

  private createWindow(): BaseWindow {
    const bounds = visibleWindowBounds(this.siteStore.snapshot().preferences.windowBounds)
    return new BaseWindow({
      ...bounds,
      minWidth: 900,
      minHeight: 600,
      show: false,
      title: "Raven",
      backgroundColor: "#171717",
      icon: path.join(app.getAppPath(), "assets", "Raven.png"),
    })
  }

  private createShellView(): WebContentsView {
    return new WebContentsView({
      webPreferences: {
        preload: path.join(app.getAppPath(), ".desktop-build", "preload.cjs"),
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
      },
    })
  }

  private createSiteViews(): SiteViewManager {
    return new SiteViewManager({
      onRuntimeChanged: (siteID, runtime) => {
        const current = this.runtimeBySite[siteID] ?? { status: "idle", unreadCount: 0 }
        this.runtimeBySite[siteID] = { ...current, ...runtime }
        this.publishState()
      },
      onPageTitleChanged: (siteID, title) => {
        if (siteID === this.siteStore.snapshot().activeSiteID) this.window.setTitle(title)
      },
      onContentOriginChanged: (siteID, origin) => {
        void this.siteStore.setContentOrigin(siteID, origin)
      },
      onNotificationClicked: (siteID, pagePath) => this.openNotification(siteID, pagePath),
    })
  }

  private openNotification(siteID: string, pagePath: string): void {
    this.show()
    void this.selectSite(siteID).then(() => {
      const site = this.siteStore.snapshot().sites.find(({ id }) => id === siteID)
      if (site) this.siteViews.navigate(site, pagePath)
    })
  }

  private createTray(): TrayController {
    return new TrayController({
      showWindow: () => this.show(),
      selectSite: (siteID) => void this.selectSite(siteID),
      openManager: () => this.openManager(),
      quit: () => this.quit(),
    })
  }

  private createApplicationMenu(): ApplicationMenu {
    return new ApplicationMenu({
      selectSite: (siteID) => void this.selectSite(siteID),
      openManager: () => this.openManager(),
      reload: () => {
        const contents = this.siteViews.getActiveView()?.webContents
        if (!contents || contents.isLoading()) return
        contents.reload()
      },
    })
  }

  private registerWindowEvents(): void {
    this.window.on("resize", () => {
      this.layout()
      this.scheduleBoundsSave()
    })
    this.window.on("move", () => this.scheduleBoundsSave())
    this.window.on("close", (event) => {
      if (this.isQuitting) return
      event.preventDefault()
      this.window.hide()
    })
  }

  private registerIPC(): void {
    this.handleIPC("shell:get-state", () => this.buildState())
    this.handleIPC("shell:add-site", (_event, input: string) => this.addSite(input))
    this.handleIPC("shell:select-site", (_event, siteID: string) => this.selectSite(siteID))
    this.handleIPC("shell:remove-site", (_event, siteID: string) => this.removeSite(siteID))
    this.handleIPC("shell:set-manager-open", (_event, open: boolean) => this.setManagerOpen(open))
    this.handleIPC("shell:set-appearance", (_event, value: Appearance) => this.setAppearance(value))
  }

  private handleIPC<Arguments extends unknown[], Result>(
    channel: string,
    handler: (event: IpcMainInvokeEvent, ...arguments_: Arguments) => Result,
  ): void {
    ipcMain.handle(channel, (event, ...arguments_) => {
      if (event.sender.id !== this.shellView.webContents.id) throw new Error("Untrusted IPC sender.")
      return handler(event, ...arguments_ as Arguments)
    })
  }

  private async addSite(input: string): Promise<RavenSite> {
    const site = await this.siteDiscovery.discover(input)
    await this.siteStore.addSite(site)
    await this.selectSite(site.id)
    return site
  }

  private async selectSite(siteID: string): Promise<void> {
    const storedSite = this.siteStore.snapshot().sites.find(({ id }) => id === siteID)
    const site = await this.resolveContentSite(storedSite)
    if (!site) return
    await this.siteStore.selectSite(siteID)
    this.managerOpen = false
    await this.showSite(site)
    this.layout()
    this.publishState()
    this.updateApplicationMenu()
  }

  private async removeSite(siteID: string): Promise<void> {
    const view = this.siteViews.getView(siteID)
    if (view && this.attachedViewIDs.has(view.webContents.id)) {
      this.window.contentView.removeChildView(view)
      this.attachedViewIDs.delete(view.webContents.id)
    }
    await this.siteViews.remove(siteID)
    await this.siteStore.removeSite(siteID)
    const activeSite = this.findActiveSite()
    if (activeSite) await this.selectSite(activeSite.id)
    else this.openManager()
  }

  private async setManagerOpen(open: boolean): Promise<void> {
    this.managerOpen = open || this.siteStore.snapshot().sites.length === 0
    const activeSite = this.findActiveSite()
    if (!this.managerOpen && activeSite) await this.showSite(activeSite)
    this.layout()
    this.publishState()
  }

  private async showSite(site: RavenSite): Promise<void> {
    const view = await this.siteViews.show(site)
    if (this.attachedViewIDs.has(view.webContents.id)) return
    this.window.contentView.addChildView(view)
    this.attachedViewIDs.add(view.webContents.id)
  }

  private async setAppearance(appearance: Appearance): Promise<void> {
    if (!["system", "light", "dark"].includes(appearance)) return
    await this.siteStore.setAppearance(appearance)
    this.publishState()
  }

  private layout(): void {
    const size = this.window.getContentSize()
    const layout = calculateShellLayout({
      width: size[0] ?? 900,
      height: size[1] ?? 600,
      managerOpen: this.managerOpen,
    })
    this.shellView.setBounds(layout.shellBounds)
    this.shellView.setVisible(layout.shellVisible)
    if (layout.hideSites) return this.siteViews.hideAll()
    this.siteViews.setBounds(layout.siteBounds)
  }

  private buildState(): ShellState {
    return {
      ...this.siteStore.snapshot(),
      managerOpen: this.managerOpen,
      runtimeBySite: structuredClone(this.runtimeBySite),
    }
  }

  private publishState(): void {
    if (this.isDestroyed || this.shellView.webContents.isDestroyed()) return
    const state = this.buildState()
    this.shellView.webContents.send("shell:state-changed", state)
    this.tray.update(state.sites, state.activeSiteID, state.runtimeBySite)
    app.setBadgeCount(totalUnread(state.runtimeBySite))
  }

  private findActiveSite(): RavenSite | undefined {
    const state = this.siteStore.snapshot()
    return state.sites.find(({ id }) => id === state.activeSiteID)
  }

  private async resolveContentSite(site: RavenSite | undefined): Promise<RavenSite | undefined> {
    if (!site || site.contentOrigin) return site
    return this.refreshContentSite(site)
  }

  private async refreshContentSite(site: RavenSite | undefined): Promise<RavenSite | undefined> {
    if (!site) return undefined
    try {
      const discoveredSite = await this.siteDiscovery.discover(site.origin)
      await this.siteStore.addSite(discoveredSite)
      return discoveredSite
    } catch {
      return site
    }
  }

  private scheduleBoundsSave(): void {
    clearTimeout(this.boundsSaveTimer)
    this.boundsSaveTimer = setTimeout(() => {
      if (!this.window.isMaximized() && !this.window.isFullScreen()) {
        void this.siteStore.setWindowBounds(this.window.getBounds())
      }
    }, 400)
  }

  private updateApplicationMenu(): void {
    this.applicationMenu.update(this.siteStore.snapshot().sites)
  }
}

const totalUnread = (runtime: Record<string, SiteRuntimeState>): number =>
  Object.values(runtime).reduce((total, site) => total + site.unreadCount, 0)

import path from "node:path"
import { app } from "electron"
import { parseDeepLink } from "./security.js"
import { ShellWindow } from "./ShellWindow.js"
import { SiteDiscovery } from "./SiteDiscovery.js"
import { SiteStore } from "./SiteStore.js"
import { SquirrelLifecycle } from "./SquirrelLifecycle.js"
import { handleShellProtocol } from "./shellProtocol.js"

export class DesktopApplication {
  private shellWindow?: ShellWindow
  private pendingDeepLink?: string

  public start(): void {
    if (new SquirrelLifecycle().handle()) return
    if (!app.requestSingleInstanceLock()) return app.quit()
    this.pendingDeepLink = process.argv.find((argument) => argument.startsWith("raven://"))

    this.registerProtocol()
    this.registerLifecycleEvents()
    void app.whenReady().then(() => this.initialize())
  }

  private async initialize(): Promise<void> {
    handleShellProtocol()
    const statePath = path.join(app.getPath("userData"), "desktop-state.json")
    const siteStore = new SiteStore(statePath)
    await siteStore.load()

    this.shellWindow = new ShellWindow(siteStore, new SiteDiscovery())
    await this.shellWindow.start()
    if (this.pendingDeepLink) this.handleDeepLink(this.pendingDeepLink)
  }

  private registerProtocol(): void {
    if (process.defaultApp && process.argv[1]) {
      app.setAsDefaultProtocolClient("raven", process.execPath, [path.resolve(process.argv[1])])
    } else {
      app.setAsDefaultProtocolClient("raven")
    }
  }

  private registerLifecycleEvents(): void {
    app.on("second-instance", (_event, commandLine) => {
      this.shellWindow?.show()
      const deepLink = commandLine.find((argument) => argument.startsWith("raven://"))
      if (deepLink) this.handleDeepLink(deepLink)
    })
    app.on("open-url", (event, url) => {
      event.preventDefault()
      this.handleDeepLink(url)
    })
    app.on("activate", () => this.shellWindow?.show())
    app.on("before-quit", () => this.shellWindow?.destroy())
  }

  private handleDeepLink(rawUrl: string): void {
    if (!this.shellWindow) {
      this.pendingDeepLink = rawUrl
      return
    }
    const target = parseDeepLink(rawUrl)
    if (target) this.shellWindow.openDeepLink(target)
    this.pendingDeepLink = undefined
  }
}

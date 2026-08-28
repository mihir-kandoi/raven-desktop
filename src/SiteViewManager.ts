import path from "node:path"
import { app, BrowserWindow, session, shell, WebContentsView } from "electron"
import type { Event, Rectangle, Session } from "electron"
import {
  hasAuthenticatedSession,
  isAuthenticationPage,
  isExternalUrlAllowed,
  isRavenPage,
  isSitePermissionAllowed,
  parseUnreadCount,
} from "./security.js"
import { DesktopNotificationService } from "./DesktopNotificationService.js"
import type { RavenSite, SiteRuntimeState } from "./types.js"

interface SiteViewEvents {
  onRuntimeChanged(siteID: string, runtime: Partial<SiteRuntimeState>): void
  onPageTitleChanged(siteID: string, title: string): void
  onContentOriginChanged(siteID: string, origin: string): void
  onNotificationClicked(siteID: string, path: string): void
}

interface ManagedView {
  site: RavenSite
  view: WebContentsView
  authenticationMode: boolean
  contentOrigin: string
  recoverGuestRedirect: boolean
  notifications: DesktopNotificationService
}

export class SiteViewManager {
  private readonly managedViews = new Map<string, ManagedView>()
  private activeSiteID: string | null = null

  public constructor(private readonly events: SiteViewEvents) {}

  public getActiveView(): WebContentsView | undefined {
    return this.activeSiteID ? this.managedViews.get(this.activeSiteID)?.view : undefined
  }

  public getView(siteID: string): WebContentsView | undefined {
    return this.managedViews.get(siteID)?.view
  }

  public isNotificationServiceConnected(siteID: string): boolean {
    return this.managedViews.get(siteID)?.notifications.isConnected() === true
  }

  public isNotificationServiceReady(siteID: string): boolean {
    return this.managedViews.get(siteID)?.notifications.isReady() === true
  }

  public hasNotificationServiceReceivedMessage(siteID: string): boolean {
    return this.managedViews.get(siteID)?.notifications.hasReceivedMessage() === true
  }

  public show(site: RavenSite): WebContentsView {
    const managed = this.getOrCreate(site)
    this.activeSiteID = site.id
    for (const candidate of this.managedViews.values()) {
      candidate.view.setVisible(candidate.site.id === site.id)
    }
    if (!managed.view.webContents.getURL()) this.loadSite(managed)
    return managed.view
  }

  public hideAll(): void {
    for (const managed of this.managedViews.values()) managed.view.setVisible(false)
  }

  public setBounds(bounds: Rectangle): void {
    this.getActiveView()?.setBounds(bounds)
  }

  public navigate(site: RavenSite, path: string): void {
    const managed = this.getOrCreate(site)
    this.show(site)
    this.loadUrl(managed, new URL(path, managed.contentOrigin).href)
  }

  public async remove(siteID: string): Promise<void> {
    const managed = this.managedViews.get(siteID)
    if (!managed) return
    this.managedViews.delete(siteID)
    if (this.activeSiteID === siteID) this.activeSiteID = null
    managed.notifications.stop()
    await managed.view.webContents.session.clearStorageData()
    managed.view.webContents.close()
  }

  public close(): void {
    for (const managed of this.managedViews.values()) {
      managed.notifications.stop()
      managed.view.webContents.close()
    }
    this.managedViews.clear()
  }

  private create(site: RavenSite): ManagedView {
    const partition = `persist:raven-site-${site.id}`
    const siteSession = session.fromPartition(partition)
    const view = new WebContentsView({
      webPreferences: {
        preload: path.join(app.getAppPath(), ".desktop-build", "site-preload.cjs"),
        partition,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        webSecurity: true,
        spellcheck: true,
      },
    })

    const managed: ManagedView = {
      site,
      authenticationMode: false,
      contentOrigin: site.contentOrigin ?? site.origin,
      recoverGuestRedirect: false,
      notifications: new DesktopNotificationService(
        view.webContents,
        (path) => this.events.onNotificationClicked(site.id, path),
      ),
      view,
    }
    this.configurePermissions(managed, siteSession)
    this.configureWebContents(managed)
    this.managedViews.set(site.id, managed)
    return managed
  }

  private getOrCreate(site: RavenSite): ManagedView {
    return this.managedViews.get(site.id) ?? this.create(site)
  }

  private configurePermissions(managed: ManagedView, siteSession: Session): void {
    const isAllowed = (permission: string, requestingUrl: string) =>
      isSitePermissionAllowed(permission, requestingUrl, managed.contentOrigin)

    siteSession.setPermissionCheckHandler((webContents, permission, origin, details) => {
      const requestingUrl = origin || details.requestingUrl || webContents?.getURL() || ""
      return isAllowed(permission, requestingUrl)
    })
    siteSession.setPermissionRequestHandler((webContents, permission, callback, details) => {
      const requestingUrl = details.requestingUrl || webContents.getURL()
      callback(isAllowed(permission, requestingUrl))
    })
  }

  private configureWebContents(managed: ManagedView): void {
    const contents = managed.view.webContents
    contents.setWindowOpenHandler(({ url }) => {
      this.openNewWindow(managed, url)
      return { action: "deny" }
    })
    contents.on("will-navigate", (event, url) => this.guardNavigation(managed, event, url))
    contents.on("will-redirect", (event, url) => this.guardRedirect(managed, event, url))
    contents.on("did-navigate", () => {
      managed.recoverGuestRedirect = false
    })
    contents.on("did-start-loading", () => this.updateRuntime(managed.site.id, "loading"))
    contents.on("did-stop-loading", () => this.updateRuntime(managed.site.id, "ready"))
    contents.on("dom-ready", () => {
      if (!isRavenPage(contents.getURL())) return
      void managed.notifications.installAdapter().catch((error) => {
        console.error("Unable to install desktop notification adapter", error)
      })
    })
    contents.on("did-finish-load", () => {
      if (isRavenPage(contents.getURL())) {
        void managed.notifications.start(managed.contentOrigin).catch((error) => {
          console.error("Unable to start desktop notifications", error)
        })
      }
    })
    contents.on("did-fail-load", (_event, code, _description, _url, isMainFrame) => {
      if (isMainFrame && code !== -3) this.updateRuntime(managed.site.id, "error")
    })
    contents.on("page-title-updated", (_event, title) => {
      this.events.onPageTitleChanged(managed.site.id, title)
      this.events.onRuntimeChanged(managed.site.id, { status: "ready", unreadCount: parseUnreadCount(title) })
    })
  }

  private async loadSite(managed: ManagedView): Promise<void> {
    const target = await this.getEntryUrl(managed)
    if (managed.view.webContents.isDestroyed()) return
    this.loadUrl(managed, target)
  }

  private async getEntryUrl(managed: ManagedView): Promise<string> {
    const cookies = await managed.view.webContents.session.cookies.get({
      url: managed.contentOrigin,
      name: "sid",
    })
    const authenticated = hasAuthenticatedSession(cookies.map(({ value }) => value))
    managed.authenticationMode = !authenticated
    managed.recoverGuestRedirect = authenticated
    return authenticated ? new URL("/raven", managed.contentOrigin).href : this.loginUrl(managed)
  }

  private guardRedirect(managed: ManagedView, event: Event, rawUrl: string): void {
    const destination = safeUrl(rawUrl)
    if (destination && this.finishAuthentication(managed, destination)) return
    const changedOrigin = destination?.origin !== managed.contentOrigin
    if (!managed.recoverGuestRedirect || !changedOrigin) {
      return this.guardNavigation(managed, event, rawUrl)
    }
    event.preventDefault()
    managed.recoverGuestRedirect = false
    managed.authenticationMode = true
    this.loadUrl(managed, this.loginUrl(managed))
  }

  private guardNavigation(managed: ManagedView, event: Event, rawUrl: string): void {
    const destination = safeUrl(rawUrl)
    if (!destination) return event.preventDefault()
    if (this.finishAuthentication(managed, destination)) return
    if (destination.origin === managed.contentOrigin) {
      managed.authenticationMode = isAuthenticationPage(destination.href, managed.contentOrigin)
      return
    }
    if (managed.authenticationMode
      || isAuthenticationPage(managed.view.webContents.getURL(), managed.contentOrigin)) {
      managed.authenticationMode = destination.protocol === "https:"
      if (managed.authenticationMode) return
    }
    event.preventDefault()
    this.openExternal(rawUrl)
  }

  private openNewWindow(managed: ManagedView, rawUrl: string): void {
    const target = safeUrl(rawUrl)
    if (!target) return
    if (target.origin === managed.contentOrigin) {
      if (isRavenPage(target.href)) this.loadUrl(managed, target.href)
      else this.openAuxiliaryWindow(managed, target.href)
      return
    }
    if (isAuthenticationPage(managed.view.webContents.getURL(), managed.contentOrigin)
      && target.protocol === "https:") {
      this.openAuxiliaryWindow(managed, target.href)
      return
    }
    this.openExternal(rawUrl)
  }

  private openAuxiliaryWindow(managed: ManagedView, url: string): void {
    const popup = new BrowserWindow({
      width: 980,
      height: 760,
      parent: BrowserWindow.getFocusedWindow() ?? undefined,
      webPreferences: {
        session: managed.view.webContents.session,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
      },
    })
    popup.webContents.setWindowOpenHandler(({ url: childUrl }) => {
      this.openExternal(childUrl)
      return { action: "deny" }
    })
    popup.webContents.on("will-navigate", (event, targetUrl) => {
      const target = safeUrl(targetUrl)
      if (target?.protocol === "https:" || target?.origin === managed.contentOrigin) return
      event.preventDefault()
      this.openExternal(targetUrl)
    })
    void popup.loadURL(url)
  }

  private openExternal(rawUrl: string): void {
    if (isExternalUrlAllowed(rawUrl)) void shell.openExternal(rawUrl)
  }

  private finishAuthentication(managed: ManagedView, destination: URL): boolean {
    if (!isRavenPage(destination.href)) return false
    const sameOrigin = destination.origin === managed.contentOrigin
    const secureReturn = (managed.authenticationMode || managed.recoverGuestRedirect)
      && destination.protocol === "https:"
    const verifiedOrigin = managed.site.contentOrigin
    const expectedReturn = !verifiedOrigin
      || verifiedOrigin === managed.site.origin
      || destination.origin === verifiedOrigin
    if (!sameOrigin && (!secureReturn || !expectedReturn)) return false
    managed.authenticationMode = false
    if (!sameOrigin) {
      managed.site.contentOrigin = destination.origin
      this.events.onContentOriginChanged(managed.site.id, destination.origin)
    }
    managed.contentOrigin = destination.origin
    managed.recoverGuestRedirect = false
    return true
  }

  private loginUrl(managed: ManagedView): string {
    return new URL("/login?redirect-to=/raven", managed.contentOrigin).href
  }

  private loadUrl(managed: ManagedView, url: string): void {
    void managed.view.webContents.loadURL(url).catch(() => {
      this.updateRuntime(managed.site.id, "error")
    })
  }

  private updateRuntime(siteID: string, status: SiteRuntimeState["status"]): void {
    this.events.onRuntimeChanged(siteID, { status })
  }
}

const safeUrl = (rawUrl: string): URL | undefined => {
  try {
    return new URL(rawUrl)
  } catch {
    return undefined
  }
}

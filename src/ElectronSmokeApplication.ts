import assert from "node:assert/strict"
import { mkdtempSync } from "node:fs"
import { writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { app, session, webContents } from "electron"
import type { WebContents, WebPreferences } from "electron"
import { ShellWindow } from "./ShellWindow.js"
import { SiteDiscovery } from "./SiteDiscovery.js"
import { SiteStore } from "./SiteStore.js"
import { handleShellProtocol } from "./shellProtocol.js"
import type { RavenSite, ShellState } from "./types.js"

interface SmokeConfiguration {
  origin?: string
  user?: string
  password?: string
  resultPath?: string
}

interface RavenPageState {
  path: string
  title: string
  rendered: boolean
  booted: boolean
  requireType: string
  desktopBridgeType: string
}

interface InspectableWebContents extends WebContents {
  getLastWebPreferences(): WebPreferences
}

class ElectronFailureTracker {
  private readonly failures: string[] = []

  public start(): void {
    app.on("web-contents-created", (_event, contents) => this.observe(contents))
    process.on("unhandledRejection", (reason) => {
      this.failures.push(`Unhandled rejection: ${String(reason)}`)
    })
    process.on("uncaughtException", (error) => {
      this.failures.push(`Uncaught exception: ${error.message}`)
    })
  }

  public assertClean(): void {
    assert.deepEqual(this.failures, [], this.failures.join("\n"))
  }

  private observe(contents: WebContents): void {
    contents.on("render-process-gone", (_event, details) => {
      this.failures.push(`Renderer exited: ${details.reason}`)
    })
    contents.on("unresponsive", () => {
      this.failures.push(`Renderer became unresponsive: ${contents.getURL()}`)
    })
    contents.on("did-fail-load", (_event, code, description, url, isMainFrame) => {
      if (isMainFrame && code !== -3) this.failures.push(`Load failed (${code}): ${description} — ${url}`)
    })
  }
}

export class ElectronSmokeApplication {
  private readonly configuration: SmokeConfiguration = {
    origin: process.env.RAVEN_TEST_SITE_ORIGIN,
    user: process.env.RAVEN_TEST_USER,
    password: process.env.RAVEN_TEST_PASSWORD,
    resultPath: process.env.RAVEN_ELECTRON_RESULT_PATH,
  }
  private readonly profileDirectory = process.env.RAVEN_ELECTRON_PROFILE_PATH
    ?? mkdtempSync(path.join(os.tmpdir(), "raven-electron-smoke-"))
  private readonly failures = new ElectronFailureTracker()
  private shellWindow?: ShellWindow

  public async start(): Promise<void> {
    try {
      this.validateConfiguration()
      app.setPath("userData", this.profileDirectory)
      app.on("window-all-closed", () => undefined)
      this.failures.start()
      await app.whenReady()
      await this.run()
      report("Electron integration smoke test passed")
      await this.finish(0)
    } catch (error) {
      console.error(error)
      await this.finish(1)
    }
  }

  private async run(): Promise<void> {
    handleShellProtocol()
    this.shellWindow = await this.startShell()
    const shellContents = await this.findShellContents()
    await this.assertShell(shellContents)
    const site = await this.addSite(shellContents)
    const ravenContents = await this.findRavenContents()
    await this.assertGuestEntry(ravenContents, site)
    await this.authenticate(ravenContents)
    await this.assertRaven(ravenContents, site)
    await this.assertDesktopNotifications(ravenContents, site)
    await this.assertSiteButton(shellContents, ravenContents, site)
    this.failures.assertClean()
  }

  private validateConfiguration(): void {
    assert.ok(this.configuration.origin, "Set RAVEN_TEST_SITE_ORIGIN.")
    assert.ok(this.configuration.user, "Set RAVEN_TEST_USER.")
    assert.ok(this.configuration.password, "Set RAVEN_TEST_PASSWORD.")
  }

  private async startShell(): Promise<ShellWindow> {
    const store = new SiteStore(path.join(this.profileDirectory, "desktop-state.json"))
    await store.load()
    const shellWindow = new ShellWindow(store, new SiteDiscovery())
    await shellWindow.start()
    return shellWindow
  }

  private async findShellContents(): Promise<WebContents> {
    return waitFor(
      () => webContents.getAllWebContents().find((contents) => contents.getURL().startsWith("raven-shell://")),
      "The Electron shell did not load.",
    )
  }

  private async assertShell(contents: WebContents): Promise<void> {
    const state = await waitFor(
      () => contents.executeJavaScript("window.ravenDesktop?.getState()") as Promise<ShellState | undefined>,
      "The sandboxed preload bridge did not load.",
    )
    assert.equal(state.managerOpen, true)
    assert.equal(state.sites.length, 0)
    const visible = await contents.executeJavaScript(
      "getComputedStyle(document.querySelector('#manager')).display !== 'none'",
    ) as boolean
    assert.equal(visible, true)
    const cacheControl = await contents.executeJavaScript(
      "fetch('renderer.js').then((response) => response.headers.get('cache-control'))",
    ) as string
    assert.equal(cacheControl, "no-store")
    report("Electron shell and sandboxed preload loaded")
  }

  private async addSite(contents: WebContents): Promise<RavenSite> {
    const origin = JSON.stringify(this.configuration.origin)
    await contents.executeJavaScript(`(() => {
      document.querySelector('#site-url').value = ${origin}
      document.querySelector('#site-form').requestSubmit()
    })()`)
    const state = await waitFor(
      async () => {
        const nextState = await contents.executeJavaScript("window.ravenDesktop.getState()") as ShellState
        return nextState.sites.length === 1 ? nextState : undefined
      },
      "The site manager could not add the Frappe site.",
    )
    assert.equal(state.managerOpen, false)
    assert.equal(state.sites[0]?.origin, this.configuration.origin)
    report("Site added through the rendered manager")
    return state.sites[0] as RavenSite
  }

  private async findRavenContents(): Promise<WebContents> {
    return waitFor(
      () => webContents.getAllWebContents().find((contents) =>
        contents.getURL().startsWith(this.configuration.origin ?? "")),
      "The Raven WebContentsView did not load.",
      30_000,
    )
  }

  private async authenticate(contents: WebContents): Promise<void> {
    const credentials = new URLSearchParams({
      usr: this.configuration.user ?? "",
      pwd: this.configuration.password ?? "",
    })
    const response = await contents.session.fetch(`${this.configuration.origin}/api/method/login`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: credentials,
      credentials: "include",
    })
    const responseBody = await response.text()
    assert.equal(response.ok, true, `Frappe login failed (${response.status}): ${responseBody}`)
    await contents.loadURL(`${this.configuration.origin}/raven`)
    report("Authenticated through the isolated Electron session")
  }

  private async assertGuestEntry(contents: WebContents, site: RavenSite): Promise<void> {
    const url = await waitFor(() => {
      const currentUrl = safeUrl(contents.getURL())
      return currentUrl?.pathname === "/login" ? currentUrl : undefined
    }, "The guest session did not open the in-app Frappe login page.")
    assert.equal(url.origin, site.origin)
    assert.equal(url.searchParams.get("redirect-to"), "/raven")
    report("Guest site entry stayed inside Electron")
  }

  private async assertRaven(contents: WebContents, site: RavenSite): Promise<void> {
    const page = await waitFor(
      async () => {
        const state = await contents.executeJavaScript(RAVEN_PAGE_STATE) as RavenPageState
        return state.rendered && state.booted ? state : undefined
      },
      "Raven did not render after login.",
      45_000,
    )
    this.assertSecurity(contents as InspectableWebContents, page, site)
    report(`Raven rendered securely: ${page.title}`)
  }

  private assertSecurity(contents: InspectableWebContents, page: RavenPageState, site: RavenSite): void {
    const preferences = contents.getLastWebPreferences()
    assert.equal(page.path.startsWith("/raven"), true)
    assert.equal(page.requireType, "undefined")
    assert.equal(page.desktopBridgeType, "undefined")
    assert.equal(preferences.nodeIntegration, false)
    assert.equal(preferences.contextIsolation, true)
    assert.equal(preferences.sandbox, true)
    assert.equal(preferences.webSecurity, true)
    assert.equal(contents.session, session.fromPartition(`persist:raven-site-${site.id}`))
  }

  private async assertDesktopNotifications(contents: WebContents, site: RavenSite): Promise<void> {
    const result = await waitFor(async () => {
      return contents.executeJavaScript(`(async () => {
        const client = window.frappePushNotification
        if (!client?.isRavenDesktopAdapter) return undefined
        const enabled = await client.enableNotification()
        return { enabled, active: client.isNotificationEnabled() }
      })()`)
    }, "The desktop notification adapter did not load.") as {
      active: boolean
      enabled: { permission_granted: boolean; token: string }
    }
    assert.deepEqual(result.enabled, { permission_granted: true, token: "raven-desktop" })
    assert.equal(result.active, true)
    await waitFor(
      () => this.shellWindow?.isNotificationServiceReady(site.id) || undefined,
      "The desktop notification service did not subscribe to Raven channels.",
    )
    await this.assertNotificationEvent(contents, site)
    report("Raven desktop notifications enabled with authenticated realtime delivery")
  }

  private async assertNotificationEvent(contents: WebContents, site: RavenSite): Promise<void> {
    const messageID = await contents.executeJavaScript(`(async () => {
      const channelResponse = await fetch(
        "/api/method/raven.api.raven_channel.get_all_channels?hide_archived=false"
      ).then((response) => response.json())
      const channel = channelResponse.message.channels.find(
        (candidate) => candidate.member_id && candidate.allow_notifications
      )
      if (!channel) throw new Error("No opted-in Raven channel is available for the smoke test.")
      const response = await fetch("/api/method/raven.api.raven_message.send_message", {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "X-Frappe-CSRF-Token": window.csrf_token,
        },
        body: new URLSearchParams({
          channel_id: channel.name,
          send_silently: "1",
          text: "Raven desktop realtime smoke test",
        }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(JSON.stringify(data))
      return data.message.name
    })()`) as string
    await waitFor(
      () => this.shellWindow?.hasNotificationServiceReceivedMessage(site.id) || undefined,
      "The desktop notification service did not receive Raven's message_created event.",
    )
    await contents.executeJavaScript(`fetch(
      "/api/resource/Raven Message/${messageID}",
      { method: "DELETE", headers: { "X-Frappe-CSRF-Token": window.csrf_token } },
    )`)
  }

  private async assertSiteButton(
    shellContents: WebContents,
    ravenContents: WebContents,
    site: RavenSite,
  ): Promise<void> {
    await shellContents.executeJavaScript(
      "document.querySelector('[data-action=\"show-manager\"]').click()",
    )
    await waitFor(async () => {
      const state = await this.getShellState(shellContents)
      return state.managerOpen ? state : undefined
    }, "The site manager did not open.")
    await shellContents.executeJavaScript(
      `document.querySelector('[data-action="select-site"][data-site-id="${site.id}"]').click()`,
    )
    const state = await waitFor(async () => {
      const nextState = await this.getShellState(shellContents)
      return !nextState.managerOpen ? nextState : undefined
    }, "The Raven site button did not select the site.")
    assert.equal(state.activeSiteID, site.id)
    assert.equal(safeUrl(ravenContents.getURL())?.origin, site.origin)
    const iconUrl = await shellContents.executeJavaScript(
      `document.querySelector('[data-site-id="${site.id}"] img').src`,
    ) as string
    assert.equal(safeUrl(iconUrl)?.protocol, "raven-shell:")
    const hasTextNode = await shellContents.executeJavaScript(
      `Array.from(document.querySelector('[data-site-id="${site.id}"]').childNodes)
        .some((node) => node.nodeType === Node.TEXT_NODE && node.textContent.trim())`,
    ) as boolean
    assert.equal(hasTextNode, false)
    report("Raven site button stayed inside the desktop window")
  }

  private getShellState(contents: WebContents): Promise<ShellState> {
    return contents.executeJavaScript("window.ravenDesktop.getState()") as Promise<ShellState>
  }

  private async finish(exitCode: number): Promise<void> {
    this.shellWindow?.destroy()
    await delay(100)
    if (exitCode === 0) this.failures.assertClean()
    if (this.configuration.resultPath) {
      await writeFile(this.configuration.resultPath, JSON.stringify({ exitCode }))
    }
    process.exit(exitCode)
  }
}

const RAVEN_PAGE_STATE = `({
  path: location.pathname,
  title: document.title,
  rendered: document.querySelector('#root')?.childElementCount > 0,
  booted: Boolean(window.frappe?.boot),
  requireType: typeof window.require,
  desktopBridgeType: typeof window.ravenDesktop,
})`

const waitFor = async <Value>(
  readValue: () => Promise<Value | undefined> | Value | undefined,
  message: string,
  timeout = 15_000,
): Promise<Value> => {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    const value = await readValue()
    if (value) return value
    await delay(100)
  }
  throw new Error(message)
}

const delay = (milliseconds: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, milliseconds))

const safeUrl = (rawUrl: string): URL | undefined => {
  try {
    return new URL(rawUrl)
  } catch {
    return undefined
  }
}

const report = (message: string): void => {
  process.stdout.write(`✓ ${message}\n`)
}

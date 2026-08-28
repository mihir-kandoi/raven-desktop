interface DesktopPushClient {
  readonly isRavenDesktopAdapter?: boolean
  readonly projectName?: string
  appendConfigToServiceWorkerURL?(url: string): Promise<string>
  initialize?(registration?: ServiceWorkerRegistration): Promise<void>
  onMessage?(callback: ((payload: unknown) => void) | null): void
}

interface RavenWindow extends Window {
  frappePushNotification?: DesktopPushClient
}

interface DesktopRuntimeWindow extends Window {
  readonly ravenDesktopPushRuntime?: boolean
}

export const installDesktopNotificationAdapter = (): void => {
  const ravenWindow = window as RavenWindow
  if (!ravenWindow.location.pathname.startsWith("/raven")) return

  const existingClient = ravenWindow.frappePushNotification
  if (existingClient?.isRavenDesktopAdapter) return

  const projectName = existingClient?.projectName ?? "raven"
  const tokenKey = `firebase_token_${projectName}`

  class DesktopPushNotification implements DesktopPushClient {
    public readonly isRavenDesktopAdapter = true
    public readonly projectName = projectName
    public serviceWorkerRegistration: ServiceWorkerRegistration | null = null
    private messageHandler: ((payload: unknown) => void) | null = null

    public async appendConfigToServiceWorkerURL(url: string): Promise<string> {
      return url
    }

    public async initialize(registration?: ServiceWorkerRegistration): Promise<void> {
      this.serviceWorkerRegistration = registration ?? null
    }

    public onMessage(callback: ((payload: unknown) => void) | null): void {
      this.messageHandler = callback
    }

    public isNotificationEnabled(): boolean {
      return localStorage.getItem(tokenKey) === "raven-desktop"
    }

    public async enableNotification(): Promise<{ permission_granted: boolean; token: string }> {
      const permission = await Notification.requestPermission()
      if (permission !== "granted") return { permission_granted: false, token: "" }
      localStorage.setItem(tokenKey, "raven-desktop")
      return { permission_granted: true, token: "raven-desktop" }
    }

    public async disableNotification(): Promise<void> {
      localStorage.removeItem(tokenKey)
    }
  }

  const desktopClient = new DesktopPushNotification()
  Object.defineProperty(ravenWindow, "frappePushNotification", {
    configurable: false,
    enumerable: true,
    get: () => desktopClient,
    set: () => undefined,
  })
}

const installDesktopPushRuntimeAdapter = (): void => {
  class DesktopPushRuntime {
    private readonly originalFetch: typeof window.fetch
    private readonly subscription = new DesktopPushSubscription()
    private readonly token = "raven-desktop"
    private readonly tokenKey = "firebase_token_raven"

    public constructor(private readonly ravenWindow: DesktopRuntimeWindow) {
      this.originalFetch = ravenWindow.fetch.bind(ravenWindow)
    }

    public install(): void {
      this.installPushManager()
      this.ravenWindow.fetch = (input, init) => this.fetch(input, init)
      Object.defineProperty(this.ravenWindow, "ravenDesktopPushRuntime", { value: true })
    }

    private installPushManager(): void {
      Object.defineProperties(PushManager.prototype, {
        getSubscription: {
          configurable: true,
          value: async () => localStorage.getItem(this.tokenKey) ? this.subscription : null,
        },
        subscribe: { configurable: true, value: async () => this.subscription },
      })
    }

    private async fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
      const url = this.requestUrl(input)
      if (url.startsWith("https://fcmregistrations.googleapis.com/")) {
        return this.jsonResponse(init?.method === "DELETE" ? {} : { token: this.token })
      }
      if (this.isDesktopTokenRequest(url, init)) return this.jsonResponse({ message: true })
      return this.originalFetch(input, init)
    }

    private requestUrl(input: RequestInfo | URL): string {
      if (typeof input === "string") return input
      if (input instanceof URL) return input.href
      return input.url
    }

    private isDesktopTokenRequest(url: string, init?: RequestInit): boolean {
      const requestBody = typeof init?.body === "string" ? init.body : ""
      return url.includes("/api/method/raven.api.notification.") && requestBody.includes(this.token)
    }

    private jsonResponse(body: unknown): Response {
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    }
  }

  class DesktopPushSubscription {
    public readonly endpoint = "https://raven.desktop/push/raven-desktop"

    public getKey(name: PushEncryptionKeyName): ArrayBuffer | null {
      if (name === "auth") return this.createKey(16, 1)
      if (name === "p256dh") return this.createKey(65, 4)
      return null
    }

    public async unsubscribe(): Promise<boolean> {
      return true
    }

    private createKey(size: number, firstByte: number): ArrayBuffer {
      const key = new Uint8Array(size)
      key.fill(2)
      key[0] = firstByte
      return key.buffer
    }
  }

  const ravenWindow = window as DesktopRuntimeWindow
  if (!ravenWindow.location.pathname.startsWith("/raven")) return
  if (ravenWindow.ravenDesktopPushRuntime || typeof PushManager === "undefined") return
  new DesktopPushRuntime(ravenWindow).install()
}

export const DESKTOP_NOTIFICATION_ADAPTER_SCRIPT =
  `(${installDesktopNotificationAdapter.toString()})();` +
  `(${installDesktopPushRuntimeAdapter.toString()})()`

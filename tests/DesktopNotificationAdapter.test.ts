import vm from "node:vm"
import { describe, expect, it } from "vitest"
import { DESKTOP_NOTIFICATION_ADAPTER_SCRIPT } from "../src/DesktopNotificationAdapter.js"

describe("desktop notification adapter", () => {
  it("enables notifications without registering a browser push token", async () => {
    const values = new Map<string, string>()
    const window = {
      frappePushNotification: { projectName: "raven" },
      location: { pathname: "/raven" },
    }
    vm.runInNewContext(DESKTOP_NOTIFICATION_ADAPTER_SCRIPT, {
      Notification: { requestPermission: async () => "granted" },
      localStorage: {
        getItem: (key: string) => values.get(key) ?? null,
        removeItem: (key: string) => values.delete(key),
        setItem: (key: string, value: string) => values.set(key, value),
      },
      window,
    })

    const client = window.frappePushNotification as typeof window.frappePushNotification & {
      enableNotification(): Promise<{ permission_granted: boolean; token: string }>
      isNotificationEnabled(): boolean
    }
    await expect(client.enableNotification()).resolves.toEqual({
      permission_granted: true,
      token: "raven-desktop",
    })
    expect(client.isNotificationEnabled()).toBe(true)
  })

  it("cannot be replaced by Raven's browser push client", () => {
    const window = {
      frappePushNotification: undefined as unknown,
      location: { pathname: "/raven/Frappe/general" },
    }
    vm.runInNewContext(DESKTOP_NOTIFICATION_ADAPTER_SCRIPT, {
      Notification: { requestPermission: async () => "granted" },
      localStorage: createStorage(),
      window,
    })
    const desktopClient = window.frappePushNotification

    window.frappePushNotification = { projectName: "raven" }

    expect(window.frappePushNotification).toBe(desktopClient)
    expect(Object.getOwnPropertyDescriptor(window, "frappePushNotification")).toMatchObject({
      configurable: false,
      enumerable: true,
    })
  })

  it("supports Raven's production service worker bootstrap", async () => {
    const window = {
      frappePushNotification: undefined as unknown,
      location: { pathname: "/raven" },
    }
    vm.runInNewContext(DESKTOP_NOTIFICATION_ADAPTER_SCRIPT, {
      Notification: { requestPermission: async () => "granted" },
      localStorage: createStorage(),
      window,
    })
    const client = window.frappePushNotification as {
      appendConfigToServiceWorkerURL(url: string): Promise<string>
      isRavenDesktopAdapter: boolean
    }

    await expect(client.appendConfigToServiceWorkerURL("/assets/raven/sw.js"))
      .resolves.toBe("/assets/raven/sw.js")
    expect(client.isRavenDesktopAdapter).toBe(true)
  })

  it("adapts Raven's captured Firebase client to the desktop runtime", async () => {
    class FakePushManager {}

    const upstreamRequests: string[] = []
    const window = {
      fetch: async (input: RequestInfo | URL, _init?: RequestInit) => {
        const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url
        upstreamRequests.push(url)
        return new Response(JSON.stringify({ upstream: true }))
      },
      frappePushNotification: undefined as unknown,
      location: { pathname: "/raven/Frappe/general" },
    }
    vm.runInNewContext(DESKTOP_NOTIFICATION_ADAPTER_SCRIPT, {
      Notification: { requestPermission: async () => "granted" },
      PushManager: FakePushManager,
      Response,
      URL,
      Uint8Array,
      localStorage: createStorage(),
      window,
    })
    const pushManager = new FakePushManager() as FakePushManager & {
      subscribe(): Promise<{ endpoint: string; getKey(name: string): ArrayBuffer | null }>
    }

    const subscription = await pushManager.subscribe()
    const fcmResponse = await window.fetch("https://fcmregistrations.googleapis.com/v1/projects/raven/registrations", {
      method: "POST",
    })
    const apiResponse = await window.fetch("/api/method/raven.api.notification.subscribe", {
      method: "POST",
      body: JSON.stringify({ fcm_token: "raven-desktop" }),
    })
    await window.fetch("/api/method/raven.api.user_availability.get_active_users")

    expect(subscription.endpoint).toContain("raven.desktop")
    expect(subscription.getKey("auth")?.byteLength).toBe(16)
    expect(subscription.getKey("p256dh")?.byteLength).toBe(65)
    await expect(fcmResponse.json()).resolves.toEqual({ token: "raven-desktop" })
    await expect(apiResponse.json()).resolves.toEqual({ message: true })
    expect(upstreamRequests).toEqual(["/api/method/raven.api.user_availability.get_active_users"])
  })
})

const createStorage = () => {
  const values = new Map<string, string>()
  return {
    getItem: (key: string) => values.get(key) ?? null,
    removeItem: (key: string) => values.delete(key),
    setItem: (key: string, value: string) => values.set(key, value),
  }
}

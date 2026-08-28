import { describe, expect, it, vi } from "vitest"
import { SiteDiscovery } from "../src/SiteDiscovery.js"

describe("SiteDiscovery", () => {
  it("discovers Raven metadata from the public mobile endpoint", async () => {
    const fetchSite = vi.fn(async (input: string | Request) => {
      const url = String(input)
      if (url === "https://chat.acme.test/raven") {
        return redirectTo("https://raven.acme.test/raven/")
      }
      if (url === "https://raven.acme.test/raven/") {
        return redirectTo("/raven")
      }
      if (url === "https://raven.acme.test/raven") {
        return new Response(null, { status: 200 })
      }
      if (url.startsWith("https://raven.acme.test/api/")) {
        return Response.json({ message: { sitename: "canonical.local" } })
      }
      return Response.json({
        message: {
          app_name: "Acme Chat",
          sitename: "acme.local",
          logo: "/files/acme.svg",
        },
      })
    })
    const discovery = new SiteDiscovery(fetchSite)

    await expect(discovery.discover("https://chat.acme.test/raven")).resolves.toMatchObject({
      name: "Acme Chat",
      origin: "https://chat.acme.test",
      contentOrigin: "https://raven.acme.test",
      siteName: "acme.local",
      iconUrl: "https://chat.acme.test/files/acme.svg",
    })
    expect(fetchSite).toHaveBeenCalledWith(
      "https://chat.acme.test/api/method/raven.api.raven_mobile.get_client_id",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    )
    expect(fetchSite).toHaveBeenCalledWith(
      "https://chat.acme.test/raven",
      expect.objectContaining({ redirect: "manual" }),
    )
  })

  it("rejects non-Raven and incomplete responses", async () => {
    const missing = new SiteDiscovery(async () => Response.json({ message: {} }))
    const unavailable = new SiteDiscovery(async () => new Response(null, { status: 404 }))

    await expect(missing.discover("chat.example.com")).rejects.toThrow("incomplete")
    await expect(unavailable.discover("chat.example.com")).rejects.toThrow("did not respond")
  })
})

const redirectTo = (location: string): Response => new Response(null, {
  status: 302,
  headers: { location },
})

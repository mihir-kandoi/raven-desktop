import { describe, expect, it } from "vitest"
import {
  createSiteID,
  hasAuthenticatedSession,
  isAuthenticationPage,
  isExternalUrlAllowed,
  isRavenPage,
  isSitePermissionAllowed,
  normalizeSiteOrigin,
  parseDeepLink,
  parseUnreadCount,
} from "../src/security.js"

describe("desktop URL security", () => {
  it("normalizes secure site addresses", () => {
    expect(normalizeSiteOrigin(" chat.example.com/raven ")).toBe("https://chat.example.com")
    expect(normalizeSiteOrigin("http://raven.test:8000/raven")).toBe("http://raven.test:8000")
  })

  it("rejects unsafe site addresses", () => {
    expect(() => normalizeSiteOrigin("http://chat.example.com")).toThrow("Use HTTPS")
    expect(() => normalizeSiteOrigin("https://user:secret@chat.example.com")).toThrow("credentials")
  })

  it("creates stable, origin-specific site identifiers", () => {
    expect(createSiteID("https://chat.example.com")).toHaveLength(16)
    expect(createSiteID("https://chat.example.com")).toBe(createSiteID("https://chat.example.com"))
    expect(createSiteID("https://other.example.com")).not.toBe(createSiteID("https://chat.example.com"))
  })

  it("accepts only supported external protocols", () => {
    expect(isExternalUrlAllowed("https://example.com/help")).toBe(true)
    expect(isExternalUrlAllowed("mailto:support@example.com")).toBe(true)
    expect(isExternalUrlAllowed("javascript:alert(1)")).toBe(false)
    expect(isExternalUrlAllowed("file:///etc/passwd")).toBe(false)
  })

  it("parses constrained Raven deep links", () => {
    expect(parseDeepLink("raven://open?site=abc123&path=/raven/channel/general")).toEqual({
      siteID: "abc123",
      path: "/raven/channel/general",
    })
    expect(parseDeepLink("raven://open?path=/desk")).toBeNull()
    expect(parseDeepLink("raven://open?path=/raven/../../desk")).toBeNull()
    expect(parseDeepLink("raven://open?path=/ravenevil")).toBeNull()
    expect(parseDeepLink("other://open?path=/raven")).toBeNull()
  })

  it("recognizes authentication pages and unread titles", () => {
    expect(isAuthenticationPage("https://chat.example.com/login", "https://chat.example.com")).toBe(true)
    expect(isAuthenticationPage("https://other.example.com/login", "https://chat.example.com")).toBe(false)
    expect(parseUnreadCount("(8) Raven")).toBe(8)
    expect(parseUnreadCount("(99+) Raven")).toBe(99)
    expect(parseUnreadCount("Raven")).toBe(0)
  })

  it("distinguishes authenticated Frappe session cookies", () => {
    expect(hasAuthenticatedSession([])).toBe(false)
    expect(hasAuthenticatedSession(["Guest"])).toBe(false)
    expect(hasAuthenticatedSession(["", "session-id"])).toBe(true)
  })

  it("recognizes Raven application routes", () => {
    expect(isRavenPage("https://chat.example.com/raven")).toBe(true)
    expect(isRavenPage("https://chat.example.com/raven/channel/general")).toBe(true)
    expect(isRavenPage("https://chat.example.com/ravenevil")).toBe(false)
    expect(isRavenPage("not a url")).toBe(false)
  })

  it("allows scoped site permissions for normalized requesting origins", () => {
    expect(isSitePermissionAllowed(
      "notifications",
      "https://chat.example.com/",
      "https://chat.example.com",
    )).toBe(true)
    expect(isSitePermissionAllowed(
      "notifications",
      "https://other.example.com/",
      "https://chat.example.com",
    )).toBe(false)
    expect(isSitePermissionAllowed(
      "camera",
      "https://chat.example.com/",
      "https://chat.example.com",
    )).toBe(false)
  })
})

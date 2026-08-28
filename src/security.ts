import { createHash } from "node:crypto"
import type { DeepLinkTarget } from "./types.js"

const DEVELOPMENT_HOSTS = new Set(["localhost", "127.0.0.1", "::1"])
const EXTERNAL_PROTOCOLS = new Set(["https:", "mailto:", "tel:"])
const SITE_PERMISSIONS = new Set(["notifications", "clipboard-sanitized-write", "fullscreen"])

export const normalizeSiteOrigin = (input: string): string => {
  const value = input.trim()
  const candidate = value.includes("://") ? value : `https://${value}`
  const url = new URL(candidate)

  if (url.username || url.password) {
    throw new Error("Site URLs cannot contain credentials.")
  }
  if (!isSecureSiteUrl(url)) {
    throw new Error("Use HTTPS. HTTP is only allowed for local development sites.")
  }
  return url.origin
}

export const createSiteID = (origin: string): string =>
  createHash("sha256").update(origin).digest("hex").slice(0, 16)

export const isExternalUrlAllowed = (rawUrl: string): boolean => {
  try {
    return EXTERNAL_PROTOCOLS.has(new URL(rawUrl).protocol)
  } catch {
    return false
  }
}

export const parseDeepLink = (rawUrl: string): DeepLinkTarget | null => {
  try {
    const url = new URL(rawUrl)
    if (url.protocol !== "raven:" || url.hostname !== "open") return null

    const path = normalizeRavenPath(url.searchParams.get("path") ?? "/raven")
    if (!path) return null

    const site = url.searchParams.get("site") ?? undefined
    if (!site) return { path }
    if (site.startsWith("https://") || site.startsWith("http://")) {
      return { siteOrigin: normalizeSiteOrigin(site), path }
    }
    return { siteID: site, path }
  } catch {
    return null
  }
}

export const parseUnreadCount = (title: string): number => {
  const match = title.match(/^\((\d+|99\+)\)/)
  if (!match) return 0
  return match[1] === "99+" ? 99 : Number(match[1])
}

export const isAuthenticationPage = (rawUrl: string, siteOrigin: string): boolean => {
  try {
    const url = new URL(rawUrl)
    if (url.origin !== siteOrigin) return false
    return url.pathname === "/login" || url.pathname.includes("oauth2_logins")
  } catch {
    return false
  }
}

export const hasAuthenticatedSession = (sessionIDs: string[]): boolean =>
  sessionIDs.some((sessionID) => sessionID.length > 0 && sessionID !== "Guest")

export const isRavenPage = (rawUrl: string): boolean => {
  try {
    const path = new URL(rawUrl).pathname
    return path === "/raven" || path.startsWith("/raven/")
  } catch {
    return false
  }
}

export const isSitePermissionAllowed = (
  permission: string,
  requestingUrl: string,
  contentOrigin: string,
): boolean => {
  if (!SITE_PERMISSIONS.has(permission)) return false
  try {
    return new URL(requestingUrl).origin === contentOrigin
  } catch {
    return false
  }
}

const isSecureSiteUrl = (url: URL): boolean => {
  if (url.protocol === "https:") return true
  if (url.protocol !== "http:") return false
  return DEVELOPMENT_HOSTS.has(url.hostname) || url.hostname.endsWith(".localhost") || url.hostname.endsWith(".test")
}

const normalizeRavenPath = (path: string): string | undefined => {
  const base = "https://raven.invalid"
  const route = new URL(path, base)
  const isRavenRoute = route.origin === base
    && (route.pathname === "/raven" || route.pathname.startsWith("/raven/"))
  return isRavenRoute ? `${route.pathname}${route.search}${route.hash}` : undefined
}

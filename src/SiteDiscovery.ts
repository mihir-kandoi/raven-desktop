import { createSiteID, normalizeSiteOrigin } from "./security.js"
import type { RavenSite } from "./types.js"

interface SiteInformation {
  app_name?: string
  sitename?: string
  logo?: string
}

type FetchSite = (input: string | Request, init?: RequestInit) => Promise<Response>

export class SiteDiscovery {
  public constructor(private readonly fetchSite: FetchSite = (input, init) => fetch(input, init)) {}

  public async discover(input: string): Promise<RavenSite> {
    const origin = normalizeSiteOrigin(input)
    const information = await this.getInformation(origin)
    const contentOrigin = await this.getCanonicalOrigin(origin)
    return this.buildSite(origin, information, contentOrigin)
  }

  private async getInformation(origin: string): Promise<SiteInformation & { sitename: string }> {
    const endpoint = new URL("/api/method/raven.api.raven_mobile.get_client_id", origin)
    const response = await this.fetchSite(endpoint.href, { signal: AbortSignal.timeout(10_000) })
    if (!response.ok) throw new Error("This site did not respond as a Raven site.")
    return readInformation(response)
  }

  private async getCanonicalOrigin(origin: string): Promise<string | undefined> {
    const contentOrigin = await this.followRavenRedirects(origin)
    if (contentOrigin === origin) return undefined
    await this.getInformation(contentOrigin)
    return contentOrigin
  }

  private async followRavenRedirects(origin: string): Promise<string> {
    let page = new URL("/raven", origin)
    for (let count = 0; count < 10; count += 1) {
      const response = await this.fetchSite(page.href, redirectRequest())
      const location = response.headers.get("location")
      if (!isRedirect(response.status) || !location) return normalizeSiteOrigin(page.href)
      page = new URL(location, page)
      normalizeSiteOrigin(page.href)
    }
    throw new Error("Raven redirected too many times.")
  }

  private buildSite(origin: string, information: SiteInformation & { sitename: string }, contentOrigin?: string): RavenSite {
    return {
      id: createSiteID(origin),
      name: information.app_name?.trim() || "Raven",
      origin,
      contentOrigin: contentOrigin ?? origin,
      siteName: information.sitename,
      iconUrl: resolveIconUrl(information.logo, origin),
    }
  }
}

const redirectRequest = (): RequestInit => ({
  redirect: "manual",
  signal: AbortSignal.timeout(10_000),
})

const isRedirect = (status: number): boolean => status >= 300 && status < 400

const readInformation = async (response: Response): Promise<Required<Pick<SiteInformation, "sitename">> & SiteInformation> => {
  const payload = await response.json() as { message?: SiteInformation }
  if (!payload.message?.sitename) throw new Error("Raven returned incomplete site information.")
  return payload.message as Required<Pick<SiteInformation, "sitename">> & SiteInformation
}

const resolveIconUrl = (logo: string | undefined, origin: string): string | undefined => {
  if (!logo) return undefined
  try {
    return new URL(logo, origin).href
  } catch {
    return undefined
  }
}

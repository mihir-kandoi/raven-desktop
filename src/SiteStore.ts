import { mkdir, readFile, rename, writeFile } from "node:fs/promises"
import path from "node:path"
import type { Rectangle } from "electron"
import type {
  Appearance,
  DesktopPreferences,
  RavenSite,
  StoredDesktopState,
} from "./types.js"
import { createSiteID, normalizeSiteOrigin } from "./security.js"

const DEFAULT_PREFERENCES: DesktopPreferences = {
  appearance: "system",
}

export class SiteStore {
  private state: StoredDesktopState = defaultState()
  private saveQueue: Promise<void> = Promise.resolve()

  public constructor(private readonly filePath: string) {}

  public async load(): Promise<void> {
    try {
      const stored = JSON.parse(await readFile(this.filePath, "utf8")) as unknown
      this.state = parseStoredState(stored)
    } catch {
      this.state = defaultState()
    }
  }

  public snapshot(): StoredDesktopState {
    return structuredClone(this.state)
  }

  public async addSite(site: RavenSite): Promise<void> {
    const existingIndex = this.state.sites.findIndex(({ id }) => id === site.id)
    if (existingIndex >= 0) this.state.sites[existingIndex] = site
    else this.state.sites.push(site)
    this.state.activeSiteID = site.id
    await this.save()
  }

  public async removeSite(siteID: string): Promise<void> {
    this.state.sites = this.state.sites.filter(({ id }) => id !== siteID)
    if (this.state.activeSiteID === siteID) {
      this.state.activeSiteID = this.state.sites[0]?.id ?? null
    }
    await this.save()
  }

  public async selectSite(siteID: string): Promise<void> {
    if (!this.state.sites.some(({ id }) => id === siteID)) return
    this.state.activeSiteID = siteID
    await this.save()
  }

  public async setAppearance(appearance: Appearance): Promise<void> {
    this.state.preferences.appearance = appearance
    await this.save()
  }

  public async setContentOrigin(siteID: string, contentOrigin: string): Promise<void> {
    const site = this.state.sites.find(({ id }) => id === siteID)
    if (!site) return
    site.contentOrigin = normalizeSiteOrigin(contentOrigin)
    await this.save()
  }

  public async setWindowBounds(windowBounds: Rectangle): Promise<void> {
    this.state.preferences.windowBounds = windowBounds
    await this.save()
  }

  private async save(): Promise<void> {
    const serializedState = JSON.stringify(this.state, null, 2)
    this.saveQueue = this.saveQueue.catch(() => undefined).then(() => this.write(serializedState))
    await this.saveQueue
  }

  private async write(serializedState: string): Promise<void> {
    await mkdir(path.dirname(this.filePath), { recursive: true })
    const temporaryPath = `${this.filePath}.temporary`
    await writeFile(temporaryPath, serializedState, "utf8")
    await rename(temporaryPath, this.filePath)
  }
}

const defaultState = (): StoredDesktopState => ({
  sites: [],
  activeSiteID: null,
  preferences: { ...DEFAULT_PREFERENCES },
})

const parseStoredState = (value: unknown): StoredDesktopState => {
  if (!isRecord(value)) return defaultState()
  const sites = Array.isArray(value.sites) ? value.sites.filter(isRavenSite) : []
  const activeSiteID = typeof value.activeSiteID === "string" && sites.some(({ id }) => id === value.activeSiteID)
    ? value.activeSiteID
    : sites[0]?.id ?? null
  return { sites, activeSiteID, preferences: parsePreferences(value.preferences) }
}

const parsePreferences = (value: unknown): DesktopPreferences => {
  if (!isRecord(value)) return { ...DEFAULT_PREFERENCES }
  const appearance = isAppearance(value.appearance) ? value.appearance : "system"
  const windowBounds = isRectangle(value.windowBounds) ? value.windowBounds : undefined
  return { appearance, windowBounds }
}

const isRavenSite = (value: unknown): value is RavenSite => {
  if (!isRecord(value)) return false
  if (![value.id, value.name, value.origin, value.siteName].every((field) => typeof field === "string")) return false
  if (value.iconUrl !== undefined && typeof value.iconUrl !== "string") return false
  if (value.contentOrigin !== undefined && typeof value.contentOrigin !== "string") return false
  try {
    const origin = normalizeSiteOrigin(value.origin as string)
    const contentOrigin = value.contentOrigin === undefined
      ? undefined
      : normalizeSiteOrigin(value.contentOrigin as string)
    return origin === value.origin
      && contentOrigin === value.contentOrigin
      && createSiteID(origin) === value.id
  } catch {
    return false
  }
}

const isRectangle = (value: unknown): value is Rectangle => isRecord(value)
  && [value.x, value.y, value.width, value.height].every((field) => typeof field === "number")

const isAppearance = (value: unknown): value is Appearance => ["system", "light", "dark"].includes(String(value))
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null

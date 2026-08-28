import type { Rectangle } from "electron"

export type Appearance = "system" | "light" | "dark"
export type SiteStatus = "idle" | "loading" | "ready" | "error"

export interface RavenSite {
  id: string
  name: string
  origin: string
  contentOrigin?: string
  siteName: string
  iconUrl?: string
}

export interface DesktopPreferences {
  appearance: Appearance
  windowBounds?: Rectangle
}

export interface StoredDesktopState {
  sites: RavenSite[]
  activeSiteID: string | null
  preferences: DesktopPreferences
}

export interface SiteRuntimeState {
  status: SiteStatus
  unreadCount: number
}

export interface ShellState extends StoredDesktopState {
  managerOpen: boolean
  runtimeBySite: Record<string, SiteRuntimeState>
}

export interface DesktopBridge {
  getState(): Promise<ShellState>
  addSite(url: string): Promise<RavenSite>
  selectSite(siteID: string): Promise<void>
  removeSite(siteID: string): Promise<void>
  setManagerOpen(open: boolean): Promise<void>
  setAppearance(appearance: Appearance): Promise<void>
  onStateChanged(callback: (state: ShellState) => void): () => void
}

export interface DeepLinkTarget {
  siteID?: string
  siteOrigin?: string
  path: string
}

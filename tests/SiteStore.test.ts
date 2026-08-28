import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { createSiteID } from "../src/security.js"
import { SiteStore } from "../src/SiteStore.js"
import type { RavenSite } from "../src/types.js"

const temporaryDirectories: string[] = []
const siteOrigin = "https://chat.example.com"
const site: RavenSite = {
  id: createSiteID(siteOrigin),
  name: "Acme",
  origin: siteOrigin,
  contentOrigin: siteOrigin,
  siteName: "chat.example.com",
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true })))
})

describe("SiteStore", () => {
  it("persists sites, selection, appearance, and window bounds", async () => {
    const statePath = await createStatePath()
    const store = new SiteStore(statePath)
    await store.load()
    await store.addSite(site)
    await store.setAppearance("dark")
    await store.setWindowBounds({ x: 10, y: 20, width: 1200, height: 800 })

    const restored = new SiteStore(statePath)
    await restored.load()
    expect(restored.snapshot()).toEqual({
      sites: [site],
      activeSiteID: site.id,
      preferences: {
        appearance: "dark",
        windowBounds: { x: 10, y: 20, width: 1200, height: 800 },
      },
    })
    expect(JSON.parse(await readFile(statePath, "utf8"))).toEqual(restored.snapshot())
  })

  it("falls back safely when stored state is invalid", async () => {
    const statePath = await createStatePath()
    const store = new SiteStore(statePath)
    await store.load()

    expect(store.snapshot()).toEqual({
      sites: [],
      activeSiteID: null,
      preferences: { appearance: "system" },
    })
  })

  it("removes the legacy rail preference from stored state", async () => {
    const statePath = await createStatePath()
    await writeFile(statePath, JSON.stringify({
      sites: [site],
      activeSiteID: site.id,
      preferences: { appearance: "dark", railDensity: "compact" },
    }))
    const store = new SiteStore(statePath)
    await store.load()

    expect(store.snapshot().preferences).toEqual({ appearance: "dark" })
  })

  it("filters sites with unsafe or forged origins", async () => {
    const statePath = await createStatePath()
    await writeFile(statePath, JSON.stringify({
      sites: [{ ...site, id: "forged", origin: "file:///tmp/raven" }],
      activeSiteID: "forged",
      preferences: {},
    }))
    const store = new SiteStore(statePath)
    await store.load()

    expect(store.snapshot().sites).toEqual([])
    expect(store.snapshot().activeSiteID).toBeNull()
  })

  it("persists a canonical Raven content origin", async () => {
    const store = new SiteStore(await createStatePath())
    await store.addSite(site)
    await store.setContentOrigin(site.id, "https://raven.example.com/raven")

    expect(store.snapshot().sites[0]?.contentOrigin).toBe("https://raven.example.com")
  })

  it("moves selection when the active site is removed", async () => {
    const store = new SiteStore(await createStatePath())
    const secondOrigin = "https://beta.example.com"
    const secondSite = { ...site, id: createSiteID(secondOrigin), name: "Beta", origin: secondOrigin }
    await store.addSite(site)
    await store.addSite(secondSite)
    await store.removeSite(secondSite.id)

    expect(store.snapshot().activeSiteID).toBe(site.id)
  })
})

const createStatePath = async (): Promise<string> => {
  const directory = await mkdtemp(path.join(tmpdir(), "raven-desktop-test-"))
  temporaryDirectories.push(directory)
  return path.join(directory, "state.json")
}

import { describe, expect, it } from "vitest"
import { calculateShellLayout } from "../src/shellLayout.js"

describe("desktop shell layout", () => {
  it("uses the full window for one Raven site", () => {
    const layout = calculateShellLayout({
      width: 1200,
      height: 800,
      managerOpen: false,
      railDensity: "comfortable",
      siteCount: 1,
    })

    expect(layout.railVisible).toBe(false)
    expect(layout.shellVisible).toBe(false)
    expect(layout.siteBounds).toEqual({ x: 0, y: 0, width: 1200, height: 800 })
  })

  it("shows the rail when multiple sites need switching", () => {
    const layout = calculateShellLayout({
      width: 1200,
      height: 800,
      managerOpen: false,
      railDensity: "compact",
      siteCount: 2,
    })

    expect(layout.railVisible).toBe(true)
    expect(layout.shellBounds.width).toBe(64)
    expect(layout.siteBounds).toEqual({ x: 64, y: 0, width: 1136, height: 800 })
  })

  it("fills the window with the manager and keeps the rail hidden", () => {
    const layout = calculateShellLayout({
      width: 1200,
      height: 800,
      managerOpen: true,
      railDensity: "comfortable",
      siteCount: 1,
    })

    expect(layout.railVisible).toBe(false)
    expect(layout.shellVisible).toBe(true)
    expect(layout.hideSites).toBe(true)
    expect(layout.shellBounds.width).toBe(1200)
  })
})

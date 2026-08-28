import { describe, expect, it } from "vitest"
import { calculateShellLayout } from "../src/shellLayout.js"

describe("desktop shell layout", () => {
  it("uses the full window for Raven content", () => {
    const layout = calculateShellLayout({
      width: 1200,
      height: 800,
      managerOpen: false,
    })

    expect(layout.shellVisible).toBe(false)
    expect(layout.siteBounds).toEqual({ x: 0, y: 0, width: 1200, height: 800 })
  })

  it("fills the window with the manager and keeps the rail hidden", () => {
    const layout = calculateShellLayout({
      width: 1200,
      height: 800,
      managerOpen: true,
    })

    expect(layout.shellVisible).toBe(true)
    expect(layout.hideSites).toBe(true)
    expect(layout.shellBounds.width).toBe(1200)
  })
})

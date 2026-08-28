import type { Rectangle } from "electron"
import type { RailDensity } from "./types.js"

interface ShellLayoutInput {
  height: number
  managerOpen: boolean
  railDensity: RailDensity
  siteCount: number
  width: number
}

interface ShellLayout {
  hideSites: boolean
  railVisible: boolean
  shellBounds: Rectangle
  shellVisible: boolean
  siteBounds: Rectangle
}

export const calculateShellLayout = (input: ShellLayoutInput): ShellLayout => {
  const railVisible = input.siteCount > 1
  const railWidth = railVisible ? widthFor(input.railDensity) : 0
  return {
    hideSites: input.managerOpen,
    railVisible,
    shellBounds: {
      x: 0,
      y: 0,
      width: input.managerOpen ? input.width : railWidth,
      height: input.height,
    },
    shellVisible: input.managerOpen || railVisible,
    siteBounds: {
      x: railWidth,
      y: 0,
      width: input.width - railWidth,
      height: input.height,
    },
  }
}

const widthFor = (density: RailDensity): number => density === "compact" ? 64 : 76

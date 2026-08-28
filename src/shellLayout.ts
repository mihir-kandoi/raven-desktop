import type { Rectangle } from "electron"

interface ShellLayoutInput {
  height: number
  managerOpen: boolean
  width: number
}

interface ShellLayout {
  hideSites: boolean
  shellBounds: Rectangle
  shellVisible: boolean
  siteBounds: Rectangle
}

export const calculateShellLayout = (input: ShellLayoutInput): ShellLayout => {
  return {
    hideSites: input.managerOpen,
    shellBounds: {
      x: 0,
      y: 0,
      width: input.managerOpen ? input.width : 0,
      height: input.height,
    },
    shellVisible: input.managerOpen,
    siteBounds: {
      x: 0,
      y: 0,
      width: input.width,
      height: input.height,
    },
  }
}

import { screen } from "electron"
import type { Rectangle } from "electron"

export const visibleWindowBounds = (stored?: Rectangle): Rectangle => {
  const primaryArea = screen.getPrimaryDisplay().workArea
  const fallback = centeredBounds(primaryArea)
  if (!stored) return fallback
  const display = screen.getDisplayMatching(stored)
  return intersectsDisplay(stored, display.bounds) ? stored : fallback
}

const intersectsDisplay = (windowBounds: Rectangle, displayBounds: Rectangle): boolean =>
  windowBounds.x + 100 < displayBounds.x + displayBounds.width
  && windowBounds.y + 100 < displayBounds.y + displayBounds.height
  && windowBounds.x + windowBounds.width > displayBounds.x
  && windowBounds.y + windowBounds.height > displayBounds.y

const centeredBounds = (workArea: Rectangle): Rectangle => {
  const width = Math.min(1240, Math.max(900, workArea.width - 80))
  const height = Math.min(820, Math.max(600, workArea.height - 80))
  return {
    x: workArea.x + Math.round((workArea.width - width) / 2),
    y: workArea.y + Math.round((workArea.height - height) / 2),
    width,
    height,
  }
}

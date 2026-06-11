interface ResizePanelWidthsInput {
  startLeftWidth: number
  startRightWidth: number
  /** Signed delta in pixels. Positive = drag right (grow left, shrink right). */
  delta: number
  minWidth: number
}

interface ResolveResizeStartWidthsInput {
  storedWidths: Array<number | undefined>
  measuredWidths: Array<number | undefined>
  minWidth: number
  measuredFirstIndices?: number[]
}

export function resolveResizeStartWidths({
  storedWidths,
  measuredWidths,
  minWidth,
  measuredFirstIndices = [],
}: ResolveResizeStartWidthsInput): number[] {
  const measuredFirst = new Set(measuredFirstIndices)
  const count = Math.max(storedWidths.length, measuredWidths.length)
  return Array.from({ length: count }, (_, index) => {
    const measured = measuredWidths[index]
    if (measuredFirst.has(index) && measured != null && Number.isFinite(measured)) {
      return Math.max(minWidth, measured)
    }

    const stored = storedWidths[index]
    if (stored != null && Number.isFinite(stored)) {
      return Math.max(minWidth, stored)
    }

    if (measured != null && Number.isFinite(measured)) {
      return Math.max(minWidth, measured)
    }

    return minWidth
  })
}

export interface ResizePanelWidthsResult {
  leftWidth: number
  rightWidth: number
}

export function computeResizedPanelWidths({
  startLeftWidth,
  startRightWidth,
  delta,
  minWidth,
}: ResizePanelWidthsInput): ResizePanelWidthsResult {
  const desiredLeftWidth = Math.max(minWidth, startLeftWidth) + delta
  const desiredRightWidth = Math.max(minWidth, startRightWidth) - delta

  if (desiredLeftWidth < minWidth) {
    return {
      leftWidth: minWidth,
      rightWidth: Math.max(minWidth, desiredRightWidth),
    }
  }

  if (desiredRightWidth < minWidth) {
    return {
      leftWidth: Math.max(minWidth, desiredLeftWidth),
      rightWidth: minWidth,
    }
  }

  return {
    leftWidth: desiredLeftWidth,
    rightWidth: desiredRightWidth,
  }
}

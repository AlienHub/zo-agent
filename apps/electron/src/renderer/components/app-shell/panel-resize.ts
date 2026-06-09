interface ResizePanelWidthsInput {
  startLeftWidth: number
  startRightWidth: number
  delta: number
  minWidth: number
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

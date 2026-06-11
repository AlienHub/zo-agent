interface PanelSlotSizingInput {
  isOnly: boolean
  explicitWidth?: number
  proportion: number
  minWidth: number
  fillsRemainingSpace: boolean
}

export function getPanelSlotSizingStyle({
  isOnly,
  explicitWidth,
  proportion,
  minWidth,
  fillsRemainingSpace,
}: PanelSlotSizingInput): Record<string, number> {
  if (isOnly) {
    return { flexGrow: 1, minWidth: 0 }
  }

  if (fillsRemainingSpace) {
    return {
      flexGrow: 1,
      flexShrink: 1,
      flexBasis: explicitWidth ?? 0,
      minWidth,
    }
  }

  if (explicitWidth != null) {
    return {
      flexGrow: 0,
      flexShrink: 0,
      flexBasis: explicitWidth,
      minWidth,
    }
  }

  return {
    flexGrow: proportion,
    flexShrink: 1,
    flexBasis: 0,
    minWidth,
  }
}

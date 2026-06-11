import { describe, expect, it } from 'bun:test'
import {
  computeResizedPanelWidths,
  resolveResizeStartWidths,
} from '../panel-resize'
import { getPanelSlotSizingStyle } from '../panel-layout'

const MIN = 440

describe('computeResizedPanelWidths', () => {
  it('redistributes width while both panels can stay above their minimum', () => {
    expect(computeResizedPanelWidths({
      startLeftWidth: 520,
      startRightWidth: 520,
      delta: 40,
      minWidth: MIN,
    })).toEqual({
      leftWidth: 560,
      rightWidth: 480,
    })
  })

  it('grows the dragged panel when the opposite panel is already at minimum width', () => {
    expect(computeResizedPanelWidths({
      startLeftWidth: 440,
      startRightWidth: 440,
      delta: 120,
      minWidth: MIN,
    })).toEqual({
      leftWidth: 560,
      rightWidth: 440,
    })
  })

  it('grows the right panel when dragging left from two minimum-width panels', () => {
    expect(computeResizedPanelWidths({
      startLeftWidth: 440,
      startRightWidth: 440,
      delta: -80,
      minWidth: MIN,
    })).toEqual({
      leftWidth: 440,
      rightWidth: 520,
    })
  })

  it('shrinks an oversized right panel without a hard maximum on the left panel', () => {
    expect(computeResizedPanelWidths({
      startLeftWidth: 900,
      startRightWidth: 1040,
      delta: 300,
      minWidth: MIN,
    })).toEqual({
      leftWidth: 1200,
      rightWidth: 740,
    })
  })
})

describe('panel resize layout integration helpers', () => {
  it('uses measured DOM widths when an auto-sized panel has no stored width', () => {
    const widths = resolveResizeStartWidths({
      storedWidths: [720, undefined, undefined],
      measuredWidths: [720, 500, 1040],
      minWidth: MIN,
    })

    expect(widths).toEqual([720, 500, 1040])
  })

  it('uses stored basis widths over measured flex-grown widths to avoid accumulation', () => {
    const widths = resolveResizeStartWidths({
      storedWidths: [600, 440],
      measuredWidths: [920, 760],
      minWidth: MIN,
    })

    expect(widths).toEqual([600, 440])
  })

  it('can prefer measured width for the final fill panel even when a stale width exists', () => {
    const widths = resolveResizeStartWidths({
      storedWidths: [600, 440],
      measuredWidths: [620, 760],
      minWidth: MIN,
      measuredFirstIndices: [1],
    })

    expect(widths).toEqual([600, 760])
  })

  it('keeps non-final explicitly sized panels fixed to avoid flex accumulation', () => {
    const style = getPanelSlotSizingStyle({
      isOnly: false,
      explicitWidth: 440,
      proportion: 0.5,
      minWidth: MIN,
      fillsRemainingSpace: false,
    })

    expect(style).toMatchObject({
      flexGrow: 0,
      flexShrink: 0,
      flexBasis: 440,
      minWidth: MIN,
    })
    expect(style).not.toHaveProperty('width')
  })

  it('lets the final panel fill remaining space without writing free space into width', () => {
    const style = getPanelSlotSizingStyle({
      isOnly: false,
      explicitWidth: undefined,
      proportion: 0.5,
      minWidth: MIN,
      fillsRemainingSpace: true,
    })

    expect(style).toMatchObject({
      flexGrow: 1,
      flexShrink: 1,
      flexBasis: 0,
      minWidth: MIN,
    })
  })
})

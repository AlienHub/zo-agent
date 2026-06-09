import { describe, expect, it } from 'bun:test'
import { computeResizedPanelWidths } from '../panel-resize'

describe('computeResizedPanelWidths', () => {
  it('redistributes width while both panels can stay above their minimum', () => {
    expect(computeResizedPanelWidths({
      startLeftWidth: 520,
      startRightWidth: 520,
      delta: 40,
      minWidth: 440,
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
      minWidth: 440,
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
      minWidth: 440,
    })).toEqual({
      leftWidth: 440,
      rightWidth: 520,
    })
  })
})

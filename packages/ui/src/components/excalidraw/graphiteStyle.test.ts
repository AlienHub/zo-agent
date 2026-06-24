import { describe, it, expect } from 'bun:test'
import {
  applyGraphiteTheme,
  edgeStyle,
  hasGraphiteElements,
  nodeElement,
  oklchToHex,
  roleStyle,
  shapeType,
  theme,
} from './graphiteStyle'

describe('graphite oklch derivation', () => {
  it('produces deterministic, well-formed hex', () => {
    const hex = oklchToHex(0.62, 0.13, 293)
    expect(hex).toMatch(/^#[0-9a-f]{6}$/)
    expect(oklchToHex(0.62, 0.13, 293)).toBe(hex)
  })

  it('forces neutral grays (C=0) to be untinted', () => {
    const gray = oklchToHex(0.5, 0, 0)
    expect(gray.slice(1, 3)).toBe(gray.slice(3, 5))
    expect(gray.slice(3, 5)).toBe(gray.slice(5, 7))
  })
})

describe('graphite roles', () => {
  it('keeps default light on a pure white fill with role stroke widths', () => {
    expect(roleStyle('default', 'light').fill).toBe('#ffffff')
    expect(roleStyle('default', 'light').strokeWidth).toBe(1.4)
    expect(roleStyle('accent', 'light').strokeWidth).toBe(1.7)
    expect(roleStyle('alert', 'light').strokeWidth).toBe(1.5)
    expect(roleStyle('muted', 'light').strokeWidth).toBe(1.1)
  })

  it('derives distinct light and dark palettes for accent', () => {
    expect(roleStyle('accent', 'light').stroke).not.toBe(roleStyle('default', 'light').stroke)
    expect(roleStyle('accent', 'dark').fill).not.toBe(roleStyle('accent', 'light').fill)
  })

  it('themes the canvas per mode', () => {
    expect(theme('light').canvas).toBe('#ffffff')
    expect(theme('dark').canvas).not.toBe('#ffffff')
  })
})

describe('graphite shapes and edges', () => {
  it('maps shapes to Excalidraw types + roundness', () => {
    expect(shapeType('rect')).toEqual({ type: 'rectangle', roundness: { type: 3 } })
    expect(shapeType('rectSharp')).toEqual({ type: 'rectangle', roundness: null })
    expect(shapeType('diamond')).toEqual({ type: 'diamond', roundness: null })
    expect(shapeType('ellipse')).toEqual({ type: 'ellipse', roundness: null })
  })

  it('stamps semantic tags on nodes', () => {
    const el = nodeElement({ id: 'n', x: 0, y: 0, w: 120, h: 48, role: 'accent', shape: 'diamond', text: 'Decide?' }, 'light')
    expect(el.type).toBe('diamond')
    expect(el.customData).toEqual({ graphite: { kind: 'node', role: 'accent', shape: 'diamond' } })
    expect(el.strokeColor).toBe(roleStyle('accent', 'light').stroke)
  })

  it('distinguishes branch from curve and honors dashed / no-arrow', () => {
    expect(edgeStyle('branch', 'light').roundness).toBeNull()
    expect(edgeStyle('curve', 'light').roundness).toEqual({ type: 2 })
    expect(edgeStyle('branch', 'light', { dashed: true }).strokeStyle).toBe('dashed')
    expect(edgeStyle('branch', 'light', { arrow: false }).endArrowhead).toBeNull()
  })
})

describe('applyGraphiteTheme (display recolor)', () => {
  const scene = [
    { id: 'box', type: 'rectangle', strokeColor: '#000', backgroundColor: '#fff', strokeWidth: 1, customData: { graphite: { kind: 'node', role: 'accent', shape: 'rect' } } },
    { id: 'lbl', type: 'text', containerId: 'box', strokeColor: '#000' },
    { id: 'e0', type: 'arrow', strokeColor: '#000', customData: { graphite: { kind: 'edge', edgeKind: 'branch' } } },
    { id: 'plain', type: 'rectangle', strokeColor: '#123456' },
  ]

  it('re-derives node + bound-label + edge colors for the active mode', () => {
    const [box, lbl, edge] = applyGraphiteTheme(scene, 'dark') as typeof scene
    expect(box?.strokeColor).toBe(roleStyle('accent', 'dark').stroke)
    expect(box?.backgroundColor).toBe(roleStyle('accent', 'dark').fill)
    expect(lbl?.strokeColor).toBe(roleStyle('accent', 'dark').text)
    expect(edge?.strokeColor).toBe(theme('dark').edge)
  })

  it('leaves untagged elements untouched and detects graphite scenes', () => {
    const dark = applyGraphiteTheme(scene, 'dark') as typeof scene
    expect(dark[3]?.strokeColor).toBe('#123456')
    expect(hasGraphiteElements(scene)).toBe(true)
    expect(hasGraphiteElements([{ id: 'x', type: 'rectangle' }])).toBe(false)
  })
})

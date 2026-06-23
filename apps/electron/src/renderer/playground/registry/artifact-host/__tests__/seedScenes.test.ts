import { describe, expect, it, mock } from 'bun:test'
import type { CanvasAgentScenario } from '../canvasTypes'

mock.module('@excalidraw/excalidraw', () => ({
  FONT_FAMILY: { Helvetica: 2 },
  ROUNDNESS: { ADAPTIVE_RADIUS: 3 },
  convertToExcalidrawElements: (elements: unknown[]) => elements,
}))

const { canvasSeedScenes } = await import('../seedScenes')
const scenarios: CanvasAgentScenario[] = ['product-map', 'workflow', 'review']

describe('canvasSeedScenes', () => {
  it('exports one Excalidraw JSON seed per canvas scenario', () => {
    expect(Object.keys(canvasSeedScenes).sort()).toEqual([...scenarios].sort())

    for (const scenario of scenarios) {
      const scene = JSON.parse(canvasSeedScenes[scenario])

      expect(scene.type).toBe('excalidraw')
      expect(scene.source).toBe('craft-agent-playground')
      expect(Array.isArray(scene.elements)).toBe(true)
      expect(scene.elements.length).toBeGreaterThan(0)
      expect(scene.appState?.viewBackgroundColor).toBe('transparent')
      expect(scene.files).toEqual({})
    }
  })

  it('keeps product-map seeded to the artifact-host node', () => {
    const scene = JSON.parse(canvasSeedScenes['product-map'])

    expect(scene.appState?.selectedElementIds).toEqual({ 'artifact-host': true })
  })
})

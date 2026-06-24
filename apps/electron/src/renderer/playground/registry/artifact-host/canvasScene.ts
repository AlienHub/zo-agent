/**
 * Playground canvas seed scenes.
 *
 * The generic canvas helpers (Graphite style, builders, selection/normalization,
 * connection drawing) live in @craft-agent/ui; this file only assembles the
 * playground's agent-authored seed scenarios from those shared primitives, using
 * the Graphite design language (role/shape/edge-kind) so the demos match what
 * the materializer produces.
 */
import { FONT_FAMILY, convertToExcalidrawElements } from '@excalidraw/excalidraw'
import {
  edgeStyle,
  nodeElement,
  theme as graphiteTheme,
  type CanvasScene,
  type EdgeKind,
  type Role,
  type Shape,
} from '@craft-agent/ui/excalidraw/canvasScene'
import type { AppState } from '@excalidraw/excalidraw/types'
import type { ExcalidrawElement } from '@excalidraw/excalidraw/element/types'
import type { ExcalidrawElementSkeleton } from '@excalidraw/excalidraw/data/transform'
import type { CanvasAgentScenario } from './canvasTypes'

const MODE = 'light' as const

function seedNode(id: string, x: number, y: number, w: number, h: number, text: string, role: Role = 'default', shape: Shape = 'rect') {
  return nodeElement({ id, x, y, w, h, text, role, shape }, MODE)
}

function seedNote(id: string, x: number, y: number, value: string) {
  return {
    type: 'text' as const,
    id,
    x,
    y,
    text: value,
    fontSize: 14,
    fontFamily: FONT_FAMILY.Helvetica,
    strokeColor: graphiteTheme(MODE).labelText,
    backgroundColor: 'transparent',
    roughness: 0,
    customData: { graphite: { kind: 'title' } },
  }
}

function seedEdge(id: string, x: number, y: number, w: number, h: number, label: string, kind: EdgeKind = 'branch', dashed = false) {
  const style = edgeStyle(kind, MODE, { dashed })
  return {
    ...style,
    type: 'arrow' as const,
    id,
    x,
    y,
    points: [[0, 0], [w, h]] as [number, number][],
    customData: { ...(style.customData as object), productGeneratedLine: true },
    ...(label
      ? { label: { text: label, fontSize: 13, fontFamily: FONT_FAMILY.Helvetica, strokeColor: graphiteTheme(MODE).labelText } }
      : {}),
  }
}

export function createCanvasSeedScene(scenario: CanvasAgentScenario): CanvasScene {
  const scenarioElements = {
    'product-map': [
      seedNote('agent-note', 40, 36, 'Agent authored canvas structure'),
      seedNode('user-object', 56, 96, 172, 70, 'Current object\nDocument / board / browser'),
      seedNode('artifact-host', 316, 96, 172, 70, 'Artifact host\nPanel chrome + identity', 'accent'),
      seedNode('agent-control', 576, 96, 184, 70, 'Agent control\nOpen / focus / patch'),
      seedNode('human-review', 316, 226, 172, 70, 'Human review\nResize nodes + connect lines'),
      seedNode('store-boundary', 576, 226, 184, 70, 'Store boundary\nContent outside route URL', 'muted', 'rectSharp'),
      seedEdge('edge-object-host', 228, 131, 88, 0, 'mount'),
      seedEdge('edge-host-agent', 488, 131, 88, 0, 'protocol'),
      seedEdge('edge-host-review', 402, 166, 0, 60, 'turn'),
      seedEdge('edge-review-store', 488, 261, 88, 0, 'save'),
      seedEdge('edge-store-agent', 668, 226, 0, -60, 'context', 'branch', true),
    ],
    workflow: [
      seedNote('agent-note', 40, 36, 'Agent creates the working canvas; user edits the structure'),
      seedNode('brief', 56, 120, 160, 64, 'Brief', 'default', 'ellipse'),
      seedNode('decompose', 296, 120, 160, 64, 'Decompose'),
      seedNode('draft', 536, 120, 160, 64, 'Draft board', 'accent'),
      seedNode('review', 296, 244, 160, 64, 'Review', 'default', 'diamond'),
      seedNode('revise', 536, 244, 160, 64, 'Revise'),
      seedEdge('edge-brief-decompose', 216, 152, 80, 0, ''),
      seedEdge('edge-decompose-draft', 456, 152, 80, 0, ''),
      seedEdge('edge-draft-review', 616, 184, -160, 60, ''),
      seedEdge('edge-review-revise', 456, 276, 80, 0, ''),
      seedEdge('edge-revise-draft', 616, 244, 0, -60, 'iterate', 'branch', true),
    ],
    review: [
      seedNote('agent-note', 40, 36, 'Agent adds review notes to the selected canvas area'),
      seedNode('surface', 80, 116, 186, 72, 'Canvas surface\nagent generated'),
      seedNode('risk', 344, 76, 188, 72, 'Risk\navoid full editor complexity', 'alert'),
      seedNode('human-scope', 344, 220, 188, 72, 'Human scope\nread, resize, connect'),
      seedNode('next', 610, 148, 188, 72, 'Next\nwire MCP / skill actions', 'accent'),
      seedEdge('edge-surface-risk', 266, 152, 78, -40, 'review'),
      seedEdge('edge-surface-scope', 266, 152, 78, 104, 'edit limits'),
      seedEdge('edge-risk-next', 532, 112, 78, 72, ''),
      seedEdge('edge-scope-next', 532, 256, 78, -72, ''),
    ],
  } satisfies Record<CanvasAgentScenario, unknown[]>

  return {
    type: 'excalidraw',
    version: 2,
    source: 'craft-agent-playground',
    elements: convertToExcalidrawElements(
      scenarioElements[scenario] as unknown as ExcalidrawElementSkeleton[],
      { regenerateIds: false },
    ) as ExcalidrawElement[],
    appState: {
      currentItemFontFamily: FONT_FAMILY.Helvetica,
      currentItemRoughness: 0,
      gridModeEnabled: false,
      selectedElementIds: scenario === 'product-map' ? { 'artifact-host': true } : {},
      theme: 'light',
      viewBackgroundColor: 'transparent',
    } as Partial<AppState>,
    files: {},
  }
}

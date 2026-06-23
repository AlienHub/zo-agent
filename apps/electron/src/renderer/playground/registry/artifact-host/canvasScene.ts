/**
 * Playground canvas seed scenes.
 *
 * The generic canvas helpers (palette, builders, selection/normalization,
 * connection drawing) live in @craft-agent/ui; this file only assembles the
 * playground's agent-authored seed scenarios from those shared primitives.
 */
import { FONT_FAMILY, convertToExcalidrawElements } from '@excalidraw/excalidraw'
import { LIGHT_PALETTE, arrow, node, text, type CanvasScene } from '@craft-agent/ui/excalidraw/canvasScene'
import type { AppState } from '@excalidraw/excalidraw/types'
import type { ExcalidrawElement } from '@excalidraw/excalidraw/element/types'
import type { CanvasAgentScenario } from './canvasTypes'

export function createCanvasSeedScene(scenario: CanvasAgentScenario): CanvasScene {
  const palette = LIGHT_PALETTE
  const scenarioElements = {
    'product-map': [
      text('agent-note', 40, 36, 'Agent authored canvas structure', palette.muted),
      node('user-object', 56, 96, 172, 70, 'Current object\nDocument / board / browser', palette.surface, palette.stroke, palette.text),
      node('artifact-host', 316, 96, 172, 70, 'Artifact host\nPanel chrome + identity', palette.blueFill, palette.blueStroke, palette.text),
      node('agent-control', 576, 96, 184, 70, 'Agent control\nOpen / focus / patch', palette.purpleFill, palette.purpleStroke, palette.text),
      node('human-review', 316, 226, 172, 70, 'Human review\nResize nodes + connect lines', palette.greenFill, palette.greenStroke, palette.text),
      node('store-boundary', 576, 226, 184, 70, 'Store boundary\nContent outside route URL', palette.amberFill, palette.amberStroke, palette.text),
      arrow('edge-object-host', 228, 131, 88, 0, 'mount', palette.line),
      arrow('edge-host-agent', 488, 131, 88, 0, 'protocol', palette.purpleStroke),
      arrow('edge-host-review', 402, 166, 0, 60, 'turn', palette.greenStroke),
      arrow('edge-review-store', 488, 261, 88, 0, 'save', palette.amberStroke),
      arrow('edge-store-agent', 668, 226, 0, -60, 'context', palette.line, true),
    ],
    workflow: [
      text('agent-note', 40, 36, 'Agent creates the working canvas; user edits the structure', palette.muted),
      node('brief', 56, 120, 160, 64, 'Brief', palette.surface, palette.stroke, palette.text),
      node('decompose', 296, 120, 160, 64, 'Decompose', palette.blueFill, palette.blueStroke, palette.text),
      node('draft', 536, 120, 160, 64, 'Draft board', palette.purpleFill, palette.purpleStroke, palette.text),
      node('review', 296, 244, 160, 64, 'Review', palette.greenFill, palette.greenStroke, palette.text),
      node('revise', 536, 244, 160, 64, 'Revise', palette.amberFill, palette.amberStroke, palette.text),
      arrow('edge-brief-decompose', 216, 152, 80, 0, '', palette.line),
      arrow('edge-decompose-draft', 456, 152, 80, 0, '', palette.line),
      arrow('edge-draft-review', 616, 184, -160, 60, '', palette.greenStroke),
      arrow('edge-review-revise', 456, 276, 80, 0, '', palette.amberStroke),
      arrow('edge-revise-draft', 616, 244, 0, -60, 'iterate', palette.purpleStroke, true),
    ],
    review: [
      text('agent-note', 40, 36, 'Agent adds review notes to the selected canvas area', palette.muted),
      node('surface', 80, 116, 186, 72, 'Canvas surface\nagent generated', palette.blueFill, palette.blueStroke, palette.text),
      node('risk', 344, 76, 188, 72, 'Risk\navoid full editor complexity', palette.amberFill, palette.amberStroke, palette.text),
      node('human-scope', 344, 220, 188, 72, 'Human scope\nread, resize, connect', palette.greenFill, palette.greenStroke, palette.text),
      node('next', 610, 148, 188, 72, 'Next\nwire MCP / skill actions', palette.purpleFill, palette.purpleStroke, palette.text),
      arrow('edge-surface-risk', 266, 152, 78, -40, 'review', palette.amberStroke),
      arrow('edge-surface-scope', 266, 152, 78, 104, 'edit limits', palette.greenStroke),
      arrow('edge-risk-next', 532, 112, 78, 72, '', palette.purpleStroke),
      arrow('edge-scope-next', 532, 256, 78, -72, '', palette.purpleStroke),
    ],
  } satisfies Record<CanvasAgentScenario, unknown[]>

  return {
    type: 'excalidraw',
    version: 2,
    source: 'craft-agent-playground',
    elements: convertToExcalidrawElements(scenarioElements[scenario], { regenerateIds: false }) as ExcalidrawElement[],
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

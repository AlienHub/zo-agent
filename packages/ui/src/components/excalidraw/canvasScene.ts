/**
 * Shared canvas-scene helpers for Excalidraw artifacts.
 *
 * Generic geometry, palette, element builders, selection + product-line
 * normalization, and connection drawing — used by the editable canvas
 * (EditableExcalidrawCanvas) and by app-level seed-scene builders. Playground
 * seed scenes live in apps and import these primitives.
 */
import { FONT_FAMILY, ROUNDNESS, convertToExcalidrawElements } from '@excalidraw/excalidraw'
import type { AppState, BinaryFiles } from '@excalidraw/excalidraw/types'
import type { ExcalidrawElement } from '@excalidraw/excalidraw/element/types'
import { readGraphiteTag, theme as graphiteTheme } from './graphiteStyle'

// Graphite design language — the single source of truth for diagram styling.
// Re-exported here so existing `@craft-agent/ui/excalidraw/canvasScene`
// consumers (the materializer, seed builders) reach it without a new subpath.
export * from './graphiteStyle'

export interface CanvasScene {
  type: 'excalidraw'
  version: number
  source: string
  elements: readonly ExcalidrawElement[]
  appState: Partial<AppState>
  files: BinaryFiles
}

export interface SelectionOverlay {
  label: string
  elementId: string
  left: number
  top: number
  bottom: number
}

export const NODE_ACTION_GAP = 16
export const NODE_ACTION_EDGE_INSET = 8

// Container-like Graphite shapes that can host a label / comment hotspot
// (everything except arrows, free text, and the non-native triangle line).
const CANVAS_NODE_SHAPES = new Set<ExcalidrawElement['type']>(['rectangle', 'ellipse', 'diamond'])

// User-drawn connections in the editor follow the Graphite neutral edge color
// (light-mode `theme('light').edge`) so hand-drawn lines match agent-authored
// branch edges. Graphite-tagged edges keep their own per-kind style and are
// skipped by the normalizer below.
export const PRODUCT_CANVAS_CONNECTION_STYLE = {
  strokeColor: graphiteTheme('light').edge,
  strokeWidth: 1.3,
  strokeStyle: 'solid' as const,
  roughness: 0,
  roundness: null,
  endArrowhead: 'triangle' as const,
  arrowType: 'sharp' as const,
}

export const LIGHT_PALETTE = {
  text: '#242733',
  muted: '#727987',
  line: '#7d8492',
  surface: '#ffffff',
  stroke: '#d7dbe4',
  blueFill: '#edf5ff',
  blueStroke: '#4d8bcc',
  greenFill: '#eaf7ef',
  greenStroke: '#42a66b',
  purpleFill: '#f3efff',
  purpleStroke: '#8a73d6',
  amberFill: '#fff7e5',
  amberStroke: '#d59b2d',
}

export function node(
  id: string,
  x: number,
  y: number,
  width: number,
  height: number,
  text: string,
  fill: string,
  stroke: string,
  textColor: string,
) {
  return {
    type: 'rectangle' as const,
    id,
    x,
    y,
    width,
    height,
    backgroundColor: fill,
    strokeColor: stroke,
    fillStyle: 'solid' as const,
    strokeStyle: 'solid' as const,
    strokeWidth: 1,
    roughness: 0,
    roundness: { type: ROUNDNESS.ADAPTIVE_RADIUS },
    label: {
      text,
      fontSize: 16,
      fontFamily: FONT_FAMILY.Helvetica,
      strokeColor: textColor,
    },
  }
}

export function arrow(id: string, x: number, y: number, width: number, height: number, label: string, color: string, dashed = false) {
  return {
    type: 'arrow' as const,
    id,
    x,
    y,
    width,
    height,
    strokeColor: color,
    strokeWidth: 1,
    strokeStyle: dashed ? 'dashed' as const : 'solid' as const,
    roughness: 0,
    roundness: null,
    endArrowhead: 'triangle' as const,
    customData: {
      productGeneratedLine: true,
    },
    label: label
      ? {
        text: label,
        fontSize: 12,
        fontFamily: FONT_FAMILY.Helvetica,
        strokeColor: color,
      }
      : undefined,
  }
}

export function text(id: string, x: number, y: number, value: string, color: string) {
  return {
    type: 'text' as const,
    id,
    x,
    y,
    text: value,
    fontSize: 13,
    fontFamily: FONT_FAMILY.Helvetica,
    strokeColor: color,
    backgroundColor: 'transparent',
    roughness: 0,
  }
}

export function getSceneAppState(scene: CanvasScene) {
  return {
    currentItemFontFamily: scene.appState.currentItemFontFamily ?? FONT_FAMILY.Helvetica,
    currentItemStrokeColor: PRODUCT_CANVAS_CONNECTION_STYLE.strokeColor,
    currentItemStrokeWidth: PRODUCT_CANVAS_CONNECTION_STYLE.strokeWidth,
    currentItemStrokeStyle: PRODUCT_CANVAS_CONNECTION_STYLE.strokeStyle,
    currentItemRoughness: scene.appState.currentItemRoughness ?? 0,
    currentItemStartArrowhead: null,
    currentItemEndArrowhead: PRODUCT_CANVAS_CONNECTION_STYLE.endArrowhead,
    currentItemRoundness: PRODUCT_CANVAS_CONNECTION_STYLE.arrowType,
    currentItemArrowType: PRODUCT_CANVAS_CONNECTION_STYLE.arrowType,
    gridModeEnabled: false,
    selectedElementIds: scene.appState.selectedElementIds ?? {},
    theme: scene.appState.theme ?? 'light',
    viewBackgroundColor: scene.appState.viewBackgroundColor ?? 'transparent',
  }
}

export function getSelectedElements(elements: readonly ExcalidrawElement[], appState: Partial<AppState>) {
  const selectedIds = appState.selectedElementIds ?? {}
  return elements.filter(element => !element.isDeleted && selectedIds[element.id])
}

export function getElementLabel(element: ExcalidrawElement) {
  const maybeText = element as ExcalidrawElement & { text?: string; customData?: { label?: string } }
  return maybeText.text || maybeText.customData?.label || element.id
}

export function getSelectionOverlay(elements: readonly ExcalidrawElement[], appState: Partial<AppState>): SelectionOverlay | null {
  const [selected] = getSelectedElements(elements, appState).filter(element => !isLinearElement(element))
  if (!selected) return null

  const zoom = typeof appState.zoom?.value === 'number' ? appState.zoom.value : 1
  const scrollX = typeof appState.scrollX === 'number' ? appState.scrollX : 0
  const scrollY = typeof appState.scrollY === 'number' ? appState.scrollY : 0

  return {
    label: getElementLabel(selected),
    elementId: selected.id,
    left: (selected.x + scrollX + selected.width / 2) * zoom,
    top: (selected.y + scrollY) * zoom,
    bottom: (selected.y + scrollY + selected.height) * zoom,
  }
}

export function isLinearElement(element: ExcalidrawElement) {
  return element.type === 'arrow' || element.type === 'line'
}

export interface NodeHotspot {
  elementId: string
  label: string
  left: number
  top: number
  width: number
  height: number
}

/**
 * Screen-space (container-relative) rects for every node, used to overlay
 * clickable comment hotspots in read mode — Excalidraw's view mode disables
 * element selection, so comment targeting is driven by this overlay instead.
 */
export function getNodeHotspots(elements: readonly ExcalidrawElement[], appState: Partial<AppState>): NodeHotspot[] {
  const zoom = typeof appState.zoom?.value === 'number' ? appState.zoom.value : 1
  const scrollX = typeof appState.scrollX === 'number' ? appState.scrollX : 0
  const scrollY = typeof appState.scrollY === 'number' ? appState.scrollY : 0

  return elements
    .filter(element => !element.isDeleted && CANVAS_NODE_SHAPES.has(element.type))
    .map(element => ({
      elementId: element.id,
      label: getElementLabel(element),
      left: (element.x + scrollX) * zoom,
      top: (element.y + scrollY) * zoom,
      width: element.width * zoom,
      height: element.height * zoom,
    }))
}

function isProductArrowElement(element: ExcalidrawElement) {
  return element.type === 'arrow'
    && element.endArrowhead === PRODUCT_CANVAS_CONNECTION_STYLE.endArrowhead
    && ('elbowed' in element ? element.elbowed === false : true)
}

function shouldPreserveLineStyle(element: ExcalidrawElement) {
  return Boolean((element as ExcalidrawElement & { customData?: { productGeneratedLine?: boolean } }).customData?.productGeneratedLine)
}

function getProductLineStrokeColor(element: ExcalidrawElement) {
  return shouldPreserveLineStyle(element) ? element.strokeColor : PRODUCT_CANVAS_CONNECTION_STYLE.strokeColor
}

function getProductLineStrokeStyle(element: ExcalidrawElement) {
  return shouldPreserveLineStyle(element) ? element.strokeStyle : PRODUCT_CANVAS_CONNECTION_STYLE.strokeStyle
}

function hasProductLineStyle(element: ExcalidrawElement) {
  if (!isLinearElement(element)) return true

  return element.strokeColor === getProductLineStrokeColor(element)
    && element.strokeWidth === PRODUCT_CANVAS_CONNECTION_STYLE.strokeWidth
    && element.strokeStyle === getProductLineStrokeStyle(element)
    && element.roughness === PRODUCT_CANVAS_CONNECTION_STYLE.roughness
    && element.roundness === PRODUCT_CANVAS_CONNECTION_STYLE.roundness
    && (element.type !== 'arrow' || isProductArrowElement(element))
}

export function normalizeProductLineElement(element: ExcalidrawElement) {
  if (!isLinearElement(element)) return element
  // Graphite edges carry an intentional per-kind style (branch vs curve, 1.3
  // stroke, dashed for async). Leave them untouched — the uniform normalizer is
  // only for ad-hoc user-drawn connections.
  if (readGraphiteTag(element)) return element
  if (hasProductLineStyle(element)) return element

  return {
    ...element,
    strokeColor: getProductLineStrokeColor(element),
    strokeWidth: PRODUCT_CANVAS_CONNECTION_STYLE.strokeWidth,
    strokeStyle: getProductLineStrokeStyle(element),
    roughness: PRODUCT_CANVAS_CONNECTION_STYLE.roughness,
    roundness: PRODUCT_CANVAS_CONNECTION_STYLE.roundness,
    ...(element.type === 'arrow'
      ? {
        elbowed: false,
        endArrowhead: PRODUCT_CANVAS_CONNECTION_STYLE.endArrowhead,
      }
      : {}),
  } as ExcalidrawElement
}

export function normalizeProductLineElements(elements: readonly ExcalidrawElement[]) {
  let changed = false
  const normalizedElements = elements.map(element => {
    const nextElement = normalizeProductLineElement(element)
    if (nextElement !== element) changed = true
    return nextElement
  })

  return {
    changed,
    elements: normalizedElements,
  }
}

function getElementCenter(element: ExcalidrawElement) {
  return {
    x: element.x + element.width / 2,
    y: element.y + element.height / 2,
  }
}

function getConnectionPoints(source: ExcalidrawElement, target: ExcalidrawElement) {
  const sourceCenter = getElementCenter(source)
  const targetCenter = getElementCenter(target)
  const dx = targetCenter.x - sourceCenter.x
  const dy = targetCenter.y - sourceCenter.y

  if (Math.abs(dx) >= Math.abs(dy)) {
    return {
      start: {
        x: dx >= 0 ? source.x + source.width : source.x,
        y: sourceCenter.y,
      },
      end: {
        x: dx >= 0 ? target.x : target.x + target.width,
        y: targetCenter.y,
      },
    }
  }

  return {
    start: {
      x: sourceCenter.x,
      y: dy >= 0 ? source.y + source.height : source.y,
    },
    end: {
      x: targetCenter.x,
      y: dy >= 0 ? target.y : target.y + target.height,
    },
  }
}

export function createUserConnectionElement(source: ExcalidrawElement, target: ExcalidrawElement) {
  const { start, end } = getConnectionPoints(source, target)
  const [connection] = convertToExcalidrawElements([{
    type: 'arrow' as const,
    id: `user-connection-${source.id}-${target.id}-${Date.now()}`,
    x: start.x,
    y: start.y,
    width: end.x - start.x,
    height: end.y - start.y,
    strokeColor: PRODUCT_CANVAS_CONNECTION_STYLE.strokeColor,
    strokeWidth: PRODUCT_CANVAS_CONNECTION_STYLE.strokeWidth,
    strokeStyle: PRODUCT_CANVAS_CONNECTION_STYLE.strokeStyle,
    roughness: PRODUCT_CANVAS_CONNECTION_STYLE.roughness,
    roundness: PRODUCT_CANVAS_CONNECTION_STYLE.roundness,
    endArrowhead: PRODUCT_CANVAS_CONNECTION_STYLE.endArrowhead,
  }], { regenerateIds: false }) as ExcalidrawElement[]

  return normalizeProductLineElement({
    ...connection,
    startBinding: { elementId: source.id, focus: 0, gap: 0 },
    endBinding: { elementId: target.id, focus: 0, gap: 0 },
  } as ExcalidrawElement)
}

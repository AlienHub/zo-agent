import './excalidraw-materializer-assets'
import { FONT_FAMILY, ROUNDNESS, convertToExcalidrawElements, exportToBlob } from '@excalidraw/excalidraw'
import { graphlib, layout as dagreLayout } from '@dagrejs/dagre'
import type { AppState, BinaryFiles } from '@excalidraw/excalidraw/types'
import type { ExcalidrawElement } from '@excalidraw/excalidraw/element/types'
import type { ExcalidrawElementSkeleton } from '@excalidraw/excalidraw/data/transform'
import type { ExcalidrawGraph, ExcalidrawGraphNode, ExcalidrawScene } from '@craft-agent/session-tools-core'
import {
  GRAPHITE_FONT,
  GRAPHITE_LAYOUT,
  edgeStyle,
  nodeElement,
  theme as graphiteTheme,
  type EdgeKind,
  type Role,
  type Shape,
} from '@craft-agent/ui/excalidraw/canvasScene'
import { buildSceneSkeleton } from '@craft-agent/ui/excalidraw/sceneSkeleton'

declare global {
  interface Window {
    __excalidrawMaterializerBridge?: {
      ready: () => void
      respond: (payload: unknown) => void
    }
  }
}

interface MaterializeRequest {
  requestId: string
  graph?: ExcalidrawGraph
  scene?: ExcalidrawScene
}

interface Bounds {
  x: number
  y: number
  width: number
  height: number
}

interface GraphBounds {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

interface MeasuredNode extends Bounds {
  id: string
  label: string
  group?: string
  role: Role
  shape: Shape
}

// Canonical bake mode. The on-disk scene is always light; the display recolors
// to the active light/dark mode at view time from the stamped graphite tags.
const BAKE_MODE = 'light' as const

const NODE_PADDING = GRAPHITE_LAYOUT.nodePadding
// Non-rectangular containers inscribe their label, so they need extra slack to
// keep text inside the ellipse / diamond.
const SHAPE_PADDING_EXTRA: Partial<Record<Shape, number>> = {
  ellipse: 14,
  circle: 14,
  diamond: 18,
  triangle: 24,
}
const NODE_MIN_WIDTH = GRAPHITE_LAYOUT.nodeMinWidth
const NODE_MIN_HEIGHT = GRAPHITE_LAYOUT.nodeMinHeight
const NODE_FONT_SIZE = GRAPHITE_FONT.nodeLabel
const NODE_LINE_HEIGHT = 22
const EDGE_FONT_SIZE = GRAPHITE_FONT.edgeLabel
const EDGE_LINE_HEIGHT = 16
const LAYOUT_NODES_EP = Math.max(72, GRAPHITE_LAYOUT.siblingGapMin)
const LAYOUT_RANK_SEP = Math.max(96, GRAPHITE_LAYOUT.rankGapMin)
const LAYOUT_MARGIN = 48
const EXPORT_PADDING = 48

const ROLES: ReadonlySet<Role> = new Set(['default', 'accent', 'alert', 'muted'])
const SHAPES: ReadonlySet<Shape> = new Set(['rect', 'rectSharp', 'ellipse', 'circle', 'diamond', 'triangle'])
const EDGE_KINDS: ReadonlySet<EdgeKind> = new Set(['branch', 'curve'])

function resolveRole(value: unknown): Role {
  return typeof value === 'string' && ROLES.has(value as Role) ? (value as Role) : 'default'
}

function resolveShape(value: unknown): Shape {
  return typeof value === 'string' && SHAPES.has(value as Shape) ? (value as Shape) : 'rect'
}

function resolveEdgeKind(value: unknown): EdgeKind {
  return typeof value === 'string' && EDGE_KINDS.has(value as EdgeKind) ? (value as EdgeKind) : 'branch'
}

function createTextMeasurer(fontSize: number) {
  const canvas = document.createElement('canvas')
  const context = canvas.getContext('2d')
  if (!context) {
    throw new Error('Unable to create 2D canvas context for Excalidraw text measurement')
  }
  context.font = `${fontSize}px Helvetica`
  return (value: string, lineHeight: number) => {
    const lines = value.split('\n')
    const width = Math.max(0, ...lines.map((line) => context.measureText(line).width))
    return {
      width: Math.ceil(width),
      height: Math.ceil(Math.max(1, lines.length) * lineHeight),
    }
  }
}

function measureNodes(nodes: ExcalidrawGraphNode[]) {
  const measure = createTextMeasurer(NODE_FONT_SIZE)
  return nodes.map((graphNode): MeasuredNode => {
    const labelSize = measure(graphNode.label, NODE_LINE_HEIGHT)
    const role = resolveRole((graphNode as { role?: unknown }).role)
    const shape = resolveShape((graphNode as { shape?: unknown }).shape)
    const pad = NODE_PADDING + (SHAPE_PADDING_EXTRA[shape] ?? 0)
    return {
      id: graphNode.id,
      label: graphNode.label,
      ...(graphNode.group ? { group: graphNode.group } : {}),
      x: 0,
      y: 0,
      width: Math.max(NODE_MIN_WIDTH, labelSize.width + pad * 2),
      height: Math.max(NODE_MIN_HEIGHT, labelSize.height + pad * 2),
      role,
      shape,
    }
  })
}

function validateGraph(graph: ExcalidrawGraph) {
  const seen = new Set<string>()
  for (const graphNode of graph.nodes) {
    if (seen.has(graphNode.id)) {
      throw new Error(`Duplicate node id "${graphNode.id}"`)
    }
    seen.add(graphNode.id)
  }

  for (const edge of graph.edges) {
    if (!seen.has(edge.from)) {
      throw new Error(`Edge references missing source node "${edge.from}"`)
    }
    if (!seen.has(edge.to)) {
      throw new Error(`Edge references missing target node "${edge.to}"`)
    }
  }
}

function layoutGraph(graph: ExcalidrawGraph) {
  validateGraph(graph)

  const measuredNodes = measureNodes(graph.nodes)
  const nodesById = new Map(measuredNodes.map((graphNode) => [graphNode.id, graphNode]))
  const measureEdge = createTextMeasurer(EDGE_FONT_SIZE)
  const g = new graphlib.Graph({ directed: true, multigraph: true })
  g.setGraph({
    rankdir: graph.direction === 'LR' ? 'LR' : 'TB',
    nodesep: LAYOUT_NODES_EP,
    ranksep: LAYOUT_RANK_SEP,
    marginx: LAYOUT_MARGIN,
    marginy: LAYOUT_MARGIN,
  })
  g.setDefaultEdgeLabel(() => ({}))

  for (const graphNode of measuredNodes) {
    g.setNode(graphNode.id, { width: graphNode.width, height: graphNode.height })
  }

  graph.edges.forEach((edge, index) => {
    const labelSize = edge.label ? measureEdge(edge.label, EDGE_LINE_HEIGHT) : { width: 0, height: 0 }
    g.setEdge(edge.from, edge.to, labelSize, `edge-${index}`)
  })

  dagreLayout(g)

  for (const graphNode of measuredNodes) {
    const positioned = g.node(graphNode.id) as { x: number; y: number }
    graphNode.x = Math.round(positioned.x - graphNode.width / 2)
    graphNode.y = Math.round(positioned.y - graphNode.height / 2)
  }

  // Capture dagre's routed waypoints per edge so arrows follow the path that
  // avoids nodes, instead of a straight center-to-center line that crosses them.
  const edgePoints = new Map<number, Array<{ x: number; y: number }>>()
  graph.edges.forEach((edge, index) => {
    const routed = g.edge(edge.from, edge.to, `edge-${index}`) as { points?: Array<{ x: number; y: number }> } | undefined
    if (routed?.points && routed.points.length >= 2) {
      edgePoints.set(index, routed.points.map((point) => ({ x: point.x, y: point.y })))
    }
  })

  return { nodesById, edgePoints }
}

function centerOf(bounds: Bounds) {
  return {
    x: bounds.x + bounds.width / 2,
    y: bounds.y + bounds.height / 2,
  }
}

function boundsOfNodes(nodes: Iterable<Bounds>): GraphBounds {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const node of nodes) {
    minX = Math.min(minX, node.x)
    minY = Math.min(minY, node.y)
    maxX = Math.max(maxX, node.x + node.width)
    maxY = Math.max(maxY, node.y + node.height)
  }
  if (!Number.isFinite(minX) || !Number.isFinite(minY) || !Number.isFinite(maxX) || !Number.isFinite(maxY)) {
    return { minX: LAYOUT_MARGIN, minY: LAYOUT_MARGIN, maxX: LAYOUT_MARGIN, maxY: LAYOUT_MARGIN }
  }
  return { minX, minY, maxX, maxY }
}

/**
 * Graphite `branch` routing: a crisp right-angle ("elbow") polyline with a
 * single mid-bend, oriented along the layout's primary axis. Anchors on the
 * facing edge of each node; collapses to a straight line when the nodes are
 * axis-aligned. `convertToExcalidrawElements` doesn't accept native `elbowed`
 * arrows, so we generate the orthogonal points ourselves (curve edges keep
 * dagre's obstacle-avoiding waypoints instead). Adjacent-rank edges — the common
 * case — stay clean; the agent's preview self-review catches the rare long span
 * that would cross an intervening node.
 */
function orthogonalPoints(source: Bounds, target: Bounds, direction: 'TB' | 'LR', graphBounds?: GraphBounds) {
  const s = centerOf(source)
  const t = centerOf(target)

  if (direction === 'LR') {
    const startX = t.x >= s.x ? source.x + source.width : source.x
    const endX = t.x >= s.x ? target.x : target.x + target.width
    const start = { x: startX, y: s.y }
    const end = { x: endX, y: t.y }
    if (t.x < s.x && graphBounds) {
      const topTrackY = graphBounds.minY - 48
      const bottomTrackY = graphBounds.maxY + 48
      const topCost = Math.abs(start.y - topTrackY) + Math.abs(end.y - topTrackY)
      const bottomCost = Math.abs(start.y - bottomTrackY) + Math.abs(end.y - bottomTrackY)
      const trackY = topCost <= bottomCost ? topTrackY : bottomTrackY
      return [start, { x: start.x, y: trackY }, { x: end.x, y: trackY }, end]
    }
    if (Math.abs(start.y - end.y) < 1) return [start, end]
    const midX = (start.x + end.x) / 2
    return [start, { x: midX, y: start.y }, { x: midX, y: end.y }, end]
  }

  const startY = t.y >= s.y ? source.y + source.height : source.y
  const endY = t.y >= s.y ? target.y : target.y + target.height
  const start = { x: s.x, y: startY }
  const end = { x: t.x, y: endY }
  if (t.y < s.y && graphBounds) {
    const leftTrackX = graphBounds.minX - 48
    const rightTrackX = graphBounds.maxX + 48
    const leftCost = Math.abs(start.x - leftTrackX) + Math.abs(end.x - leftTrackX)
    const rightCost = Math.abs(start.x - rightTrackX) + Math.abs(end.x - rightTrackX)
    const trackX = leftCost <= rightCost ? leftTrackX : rightTrackX
    return [start, { x: trackX, y: start.y }, { x: trackX, y: end.y }, end]
  }
  if (Math.abs(start.x - end.x) < 1) return [start, end]
  const midY = (start.y + end.y) / 2
  return [start, { x: start.x, y: midY }, { x: end.x, y: midY }, end]
}

function edgeLabelPosition(
  text: string,
  points: Array<{ x: number; y: number }>,
  measure: (value: string, lineHeight: number) => { width: number; height: number },
  graphBounds?: GraphBounds
) {
  const labelSize = measure(text, EDGE_LINE_HEIGHT)
  let best = { from: points[0]!, to: points[1]!, length: -1 }
  for (let index = 0; index < points.length - 1; index += 1) {
    const from = points[index]!
    const to = points[index + 1]!
    const length = Math.hypot(to.x - from.x, to.y - from.y)
    if (length > best.length) best = { from, to, length }
  }
  const mid = {
    x: (best.from.x + best.to.x) / 2,
    y: (best.from.y + best.to.y) / 2,
  }
  const horizontal = Math.abs(best.to.x - best.from.x) >= Math.abs(best.to.y - best.from.y)
  const labelY = horizontal && graphBounds && mid.y <= graphBounds.minY
    ? mid.y + 8
    : mid.y - labelSize.height - 8
  return {
    x: Math.round(horizontal ? mid.x - labelSize.width / 2 : mid.x + 12),
    y: Math.round(horizontal ? labelY : mid.y - labelSize.height / 2),
    width: labelSize.width,
    height: labelSize.height,
  }
}

function buildOfficialSkeleton(graph: ExcalidrawGraph): ExcalidrawElementSkeleton[] {
  const { nodesById, edgePoints } = layoutGraph(graph)
  const skeleton: ExcalidrawElementSkeleton[] = []
  const measureEdgeLabel = createTextMeasurer(EDGE_FONT_SIZE)
  const optionalTitle = (graph as ExcalidrawGraph & { title?: unknown }).title
  const layoutDir: 'TB' | 'LR' = graph.direction === 'LR' ? 'LR' : 'TB'
  const graphBounds = boundsOfNodes(nodesById.values())

  for (const graphNode of graph.nodes) {
    const measured = nodesById.get(graphNode.id)
    if (!measured) continue
    skeleton.push(nodeElement({
      id: measured.id,
      x: measured.x,
      y: measured.y,
      w: measured.width,
      h: measured.height,
      role: measured.role,
      shape: measured.shape,
      text: measured.label,
    }, BAKE_MODE) as ExcalidrawElementSkeleton)
  }

  if (typeof optionalTitle === 'string' && optionalTitle.trim()) {
    const positionedNodes = [...nodesById.values()]
    const minX = positionedNodes.length ? Math.min(...positionedNodes.map((graphNode) => graphNode.x)) : LAYOUT_MARGIN
    const minY = positionedNodes.length ? Math.min(...positionedNodes.map((graphNode) => graphNode.y)) : LAYOUT_MARGIN
    skeleton.push({
      type: 'text',
      id: 'canvas-title',
      x: minX,
      y: minY - 44,
      text: optionalTitle,
      fontSize: 18,
      fontFamily: FONT_FAMILY.Helvetica,
      strokeColor: graphiteTheme(BAKE_MODE).labelText,
      backgroundColor: 'transparent',
      roughness: 0,
      customData: { graphite: { kind: 'title' } },
    } as ExcalidrawElementSkeleton)
  }

  graph.edges.forEach((edge, index) => {
    const source = nodesById.get(edge.from)
    const target = nodesById.get(edge.to)
    if (!source || !target) return
    const kind = resolveEdgeKind((edge as { kind?: unknown }).kind)
    const dashed = (edge as { dashed?: unknown }).dashed === true
    const arrow = (edge as { arrow?: unknown }).arrow !== false
    const style = edgeStyle(kind, BAKE_MODE, { dashed, arrow })
    const isBranch = kind === 'branch'
    // branch = crisp right-angle elbow polyline (orthogonal route, no
    // roundness). curve = dagre's obstacle-avoiding waypoints smoothed into a
    // bezier (proportional radius).
    const routed = edgePoints.get(index)
    const points = isBranch
      ? orthogonalPoints(source, target, layoutDir, graphBounds)
      : (routed && routed.length >= 2 ? routed : [centerOf(source), centerOf(target)])
    const origin = points[0]
    skeleton.push({
      ...style,
      type: 'arrow',
      id: `edge-${index}-${edge.from}-${edge.to}`,
      x: origin.x,
      y: origin.y,
      points: points.map((point) => [point.x - origin.x, point.y - origin.y] as [number, number]),
      roundness: isBranch ? null : { type: ROUNDNESS.PROPORTIONAL_RADIUS },
      customData: { ...(style.customData as object), productGeneratedLine: true },
      start: { id: edge.from },
      end: { id: edge.to },
    } as ExcalidrawElementSkeleton)
    if (edge.label) {
      const label = edgeLabelPosition(edge.label, points, measureEdgeLabel, graphBounds)
      skeleton.push({
        type: 'text',
        id: `edge-label-${index}-${edge.from}-${edge.to}`,
        x: label.x,
        y: label.y,
        width: label.width,
        height: label.height,
        text: edge.label,
        fontSize: EDGE_FONT_SIZE,
        fontFamily: FONT_FAMILY.Helvetica,
        strokeColor: graphiteTheme(BAKE_MODE).labelText,
        backgroundColor: 'transparent',
        roughness: 0,
        customData: { graphite: { kind: 'edgeLabel' } },
      } as ExcalidrawElementSkeleton)
    }
  })

  return skeleton
}

function buildScene(graph: ExcalidrawGraph) {
  const officialSkeleton = buildOfficialSkeleton(graph)
  const materialized = convertToExcalidrawElements(officialSkeleton, { regenerateIds: false }) as ExcalidrawElement[]

  // Guard against silently producing a blank canvas: if the graph has nodes but
  // convertToExcalidrawElements dropped everything, fail loudly so the tool
  // retries / reports an error instead of writing an empty .excalidraw that the
  // agent thinks succeeded.
  const renderable = materialized.filter((element) => !element.isDeleted)
  if (graph.nodes.length > 0 && renderable.length === 0) {
    throw new Error(`Materialization produced 0 elements for ${graph.nodes.length} node(s); the canvas would be blank.`)
  }

  return {
    type: 'excalidraw',
    version: 2,
    source: 'craft-agent',
    elements: materialized,
    appState: {
      currentItemFontFamily: FONT_FAMILY.Helvetica,
      gridModeEnabled: false,
      viewBackgroundColor: 'transparent',
    } as Partial<AppState>,
    files: {} as BinaryFiles,
  }
}

function blobToDataUrl(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error ?? new Error('Failed to read exported Excalidraw PNG blob'))
    reader.readAsDataURL(blob)
  })
}

async function exportPreviewPng(scene: ReturnType<typeof buildScene>) {
  const blob = await exportToBlob({
    elements: scene.elements as any,
    appState: scene.appState,
    files: scene.files,
    mimeType: 'image/png',
    exportPadding: EXPORT_PADDING,
  })
  return blobToDataUrl(blob)
}

async function materialize(graph: ExcalidrawGraph) {
  const scene = buildScene(graph)
  const previewPng = await exportPreviewPng(scene)
  return { scene, previewPng }
}

function buildSceneFromSpec(spec: ExcalidrawScene) {
  const skeleton = buildSceneSkeleton(spec, BAKE_MODE) as ExcalidrawElementSkeleton[]
  const materialized = convertToExcalidrawElements(skeleton, { regenerateIds: false }) as ExcalidrawElement[]

  const renderable = materialized.filter((element) => !element.isDeleted)
  if (spec.nodes.length > 0 && renderable.length === 0) {
    throw new Error(`Materialization produced 0 elements for ${spec.nodes.length} node(s); the canvas would be blank.`)
  }

  return {
    type: 'excalidraw' as const,
    version: 2,
    source: 'craft-agent',
    elements: materialized,
    appState: {
      currentItemFontFamily: FONT_FAMILY.Helvetica,
      gridModeEnabled: false,
      viewBackgroundColor: 'transparent',
    } as Partial<AppState>,
    files: {} as BinaryFiles,
  }
}

async function materializeScene(spec: ExcalidrawScene) {
  const scene = buildSceneFromSpec(spec)
  const previewPng = await exportPreviewPng(scene)
  return { scene, previewPng }
}

window.addEventListener('craft:excalidraw-materialize', (event) => {
  const detail = (event as CustomEvent<MaterializeRequest>).detail
  let work: Promise<{ scene: ReturnType<typeof buildScene>; previewPng: string }>
  if (detail.scene && Array.isArray(detail.scene.nodes) && Array.isArray(detail.scene.arrows)) {
    work = materializeScene(detail.scene)
  } else {
    work = materialize(detail.graph && Array.isArray(detail.graph.nodes) && Array.isArray(detail.graph.edges)
      ? detail.graph
      : { nodes: [], edges: [] })
  }
  work
    .then(({ scene, previewPng }) => {
      window.__excalidrawMaterializerBridge?.respond({
        requestId: detail.requestId,
        ok: true,
        scene,
        previewPng,
      })
    })
    .catch((error) => {
      window.__excalidrawMaterializerBridge?.respond({
        requestId: detail.requestId,
        ok: false,
        error: {
          reason: 'materialize_failed',
          message: error instanceof Error ? error.message : String(error),
        },
      })
    })
})

window.__excalidrawMaterializerBridge?.ready()

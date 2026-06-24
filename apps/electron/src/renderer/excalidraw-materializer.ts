import './excalidraw-materializer-assets'
import { FONT_FAMILY, ROUNDNESS, convertToExcalidrawElements, exportToBlob } from '@excalidraw/excalidraw'
import { graphlib, layout as dagreLayout } from '@dagrejs/dagre'
import type { AppState, BinaryFiles } from '@excalidraw/excalidraw/types'
import type { ExcalidrawElement } from '@excalidraw/excalidraw/element/types'
import type { ExcalidrawElementSkeleton } from '@excalidraw/excalidraw/data/transform'
import type { ExcalidrawGraph, ExcalidrawGraphNode } from '@craft-agent/session-tools-core'
import { LIGHT_PALETTE, node, text } from '@craft-agent/ui/excalidraw/canvasScene'

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
  graph: ExcalidrawGraph
}

interface Bounds {
  x: number
  y: number
  width: number
  height: number
}

interface MeasuredNode extends Bounds {
  id: string
  label: string
  group?: string
  fill: string
  stroke: string
}

const NODE_PADDING_X = 28
const NODE_PADDING_Y = 20
const NODE_MIN_WIDTH = 140
const NODE_MIN_HEIGHT = 64
const NODE_FONT_SIZE = 16
const NODE_LINE_HEIGHT = 22
const EDGE_FONT_SIZE = 12
const EDGE_LINE_HEIGHT = 16
const LAYOUT_NODES_EP = 72
const LAYOUT_RANK_SEP = 112
const LAYOUT_MARGIN = 48
const EXPORT_PADDING = 48

const PALETTE = [
  { fill: LIGHT_PALETTE.blueFill, stroke: LIGHT_PALETTE.blueStroke },
  { fill: LIGHT_PALETTE.greenFill, stroke: LIGHT_PALETTE.greenStroke },
  { fill: LIGHT_PALETTE.purpleFill, stroke: LIGHT_PALETTE.purpleStroke },
  { fill: LIGHT_PALETTE.amberFill, stroke: LIGHT_PALETTE.amberStroke },
  { fill: LIGHT_PALETTE.surface, stroke: LIGHT_PALETTE.stroke },
]

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

function colorForNode(node: ExcalidrawGraphNode, index: number, groups: Map<string, number>) {
  if (!node.group) return PALETTE[index % PALETTE.length]
  const existing = groups.get(node.group)
  if (existing !== undefined) return PALETTE[existing % PALETTE.length]
  const next = groups.size
  groups.set(node.group, next)
  return PALETTE[next % PALETTE.length]
}

function measureNodes(nodes: ExcalidrawGraphNode[]) {
  const measure = createTextMeasurer(NODE_FONT_SIZE)
  const groups = new Map<string, number>()
  return nodes.map((graphNode, index): MeasuredNode => {
    const labelSize = measure(graphNode.label, NODE_LINE_HEIGHT)
    const colors = colorForNode(graphNode, index, groups)
    return {
      id: graphNode.id,
      label: graphNode.label,
      ...(graphNode.group ? { group: graphNode.group } : {}),
      x: 0,
      y: 0,
      width: Math.max(NODE_MIN_WIDTH, labelSize.width + NODE_PADDING_X * 2),
      height: Math.max(NODE_MIN_HEIGHT, labelSize.height + NODE_PADDING_Y * 2),
      fill: colors.fill,
      stroke: colors.stroke,
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

function buildOfficialSkeleton(graph: ExcalidrawGraph): ExcalidrawElementSkeleton[] {
  const { nodesById, edgePoints } = layoutGraph(graph)
  const skeleton: ExcalidrawElementSkeleton[] = []
  const optionalTitle = (graph as ExcalidrawGraph & { title?: unknown }).title

  for (const graphNode of graph.nodes) {
    const measured = nodesById.get(graphNode.id)
    if (!measured) continue
    skeleton.push(node(
      measured.id,
      measured.x,
      measured.y,
      measured.width,
      measured.height,
      measured.label,
      measured.fill,
      measured.stroke,
      LIGHT_PALETTE.text,
    ) as ExcalidrawElementSkeleton)
  }

  if (typeof optionalTitle === 'string' && optionalTitle.trim()) {
    const positionedNodes = [...nodesById.values()]
    const minX = positionedNodes.length ? Math.min(...positionedNodes.map((graphNode) => graphNode.x)) : LAYOUT_MARGIN
    const minY = positionedNodes.length ? Math.min(...positionedNodes.map((graphNode) => graphNode.y)) : LAYOUT_MARGIN
    skeleton.push(text('canvas-title', minX, minY - 44, optionalTitle, LIGHT_PALETTE.text) as ExcalidrawElementSkeleton)
  }

  graph.edges.forEach((edge, index) => {
    const source = nodesById.get(edge.from)
    const target = nodesById.get(edge.to)
    if (!source || !target) return
    // Follow dagre's routed waypoints (falls back to a straight center-to-center
    // line only if routing is unavailable).
    const routed = edgePoints.get(index)
    const points = routed && routed.length >= 2 ? routed : [centerOf(source), centerOf(target)]
    const origin = points[0]
    skeleton.push({
      type: 'arrow',
      id: `edge-${index}-${edge.from}-${edge.to}`,
      x: origin.x,
      y: origin.y,
      points: points.map((point) => [point.x - origin.x, point.y - origin.y] as [number, number]),
      strokeColor: LIGHT_PALETTE.line,
      strokeWidth: 1,
      strokeStyle: 'solid',
      roughness: 0,
      // Smooth the routed waypoints into a curve instead of sharp elbows.
      roundness: { type: ROUNDNESS.PROPORTIONAL_RADIUS },
      endArrowhead: 'triangle',
      customData: { productGeneratedLine: true },
      start: { id: edge.from },
      end: { id: edge.to },
      ...(edge.label ? { label: { text: edge.label, fontSize: EDGE_FONT_SIZE, fontFamily: FONT_FAMILY.Helvetica } } : {}),
    } as ExcalidrawElementSkeleton)
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

window.addEventListener('craft:excalidraw-materialize', (event) => {
  const detail = (event as CustomEvent<MaterializeRequest>).detail
  materialize(detail.graph && Array.isArray(detail.graph.nodes) && Array.isArray(detail.graph.edges)
    ? detail.graph
    : { nodes: [], edges: [] })
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

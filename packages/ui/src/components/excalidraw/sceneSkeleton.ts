import {
  GRAPHITE_FONT,
  edgeStyle,
  nodeElement,
  roleStyle,
  theme,
  type Mode,
  type Role,
  type Shape,
} from './graphiteStyle'

const HELVETICA = 2

export type SceneNodeType = 'rectangle' | 'ellipse' | 'diamond' | 'text'

export interface SceneNodeInput {
  id: string
  type: SceneNodeType
  x: number
  y: number
  width: number
  height: number
  label?: string
  role?: Role
  icon?: string
}

export interface SceneArrowInput {
  id: string
  points: Array<{ x: number; y: number }>
  label?: string
  start?: string
  end?: string
  dashed?: boolean
  arrow?: boolean
  role?: Role
}

export interface SceneInput {
  nodes: SceneNodeInput[]
  arrows: SceneArrowInput[]
  title?: string
}

const ICON_WHITELIST: Readonly<Record<string, string>> = {
  check: '\u2713',
  cross: '\u2715',
  warning: '\u26A0',
  info: '\u2139',
  star: '\u2605',
  arrow: '\u2192',
  circle: '\u25CF',
  square: '\u25A0',
  triangle: '\u25B2',
  diamond: '\u25C6',
  flag: '\u2691',
  bolt: '\u26A1',
}

export function resolveSceneIcon(name: unknown): string | null {
  return typeof name === 'string' && name in ICON_WHITELIST ? ICON_WHITELIST[name]! : null
}

function withIcon(label: string | undefined, icon: string | undefined): string | undefined {
  const symbol = icon ? resolveSceneIcon(icon) : null
  if (!symbol) return label
  return label ? `${symbol} ${label}` : symbol
}

function sceneNodeTypeToShape(type: SceneNodeType): Shape {
  switch (type) {
    case 'ellipse': return 'ellipse'
    case 'diamond': return 'diamond'
    default: return 'rect'
  }
}

const TITLE_OFFSET_Y = 44
const TITLE_FALLBACK_X = 48
const TITLE_FALLBACK_Y = 48

function sceneBounds(nodes: SceneNodeInput[]): { minX: number; minY: number } | null {
  if (nodes.length === 0) return null
  let minX = Infinity
  let minY = Infinity
  for (const n of nodes) {
    if (n.x < minX) minX = n.x
    if (n.y < minY) minY = n.y
  }
  if (!Number.isFinite(minX) || !Number.isFinite(minY)) return null
  return { minX, minY }
}

export function buildSceneSkeleton(scene: SceneInput, mode: Mode): Record<string, unknown>[] {
  const skeleton: Record<string, unknown>[] = []
  const t = theme(mode)

  const titleText = typeof scene.title === 'string' ? scene.title.trim() : ''
  if (titleText) {
    const bounds = sceneBounds(scene.nodes)
    const x = bounds ? bounds.minX : TITLE_FALLBACK_X
    const y = bounds ? bounds.minY - TITLE_OFFSET_Y : TITLE_FALLBACK_Y
    skeleton.push({
      type: 'text',
      id: 'canvas-title',
      x,
      y,
      text: titleText,
      fontSize: 18,
      fontFamily: HELVETICA,
      strokeColor: t.labelText,
      backgroundColor: 'transparent',
      roughness: 0,
      customData: { graphite: { kind: 'title' } },
    })
  }

  for (const node of scene.nodes) {
    const text = withIcon(node.label, node.icon)

    if (node.type === 'text') {
      if (!text) continue
      skeleton.push({
        type: 'text',
        id: node.id,
        x: node.x,
        y: node.y,
        width: node.width,
        height: node.height,
        text,
        fontSize: GRAPHITE_FONT.nodeLabel,
        fontFamily: HELVETICA,
        strokeColor: roleStyle(node.role ?? 'default', mode).text,
        backgroundColor: 'transparent',
        roughness: 0,
        customData: { graphite: { kind: 'node', role: node.role ?? 'default', shape: 'rect' } },
      })
      continue
    }

    const shape = sceneNodeTypeToShape(node.type)
    skeleton.push(nodeElement({
      id: node.id,
      x: node.x,
      y: node.y,
      w: node.width,
      h: node.height,
      role: node.role,
      shape,
      text: text ?? '',
    }, mode))
  }

  for (const arrow of scene.arrows) {
    if (!Array.isArray(arrow.points) || arrow.points.length < 2) {
      throw new Error(`Arrow "${arrow.id}" needs at least 2 points; got ${arrow.points?.length ?? 0}.`)
    }
    const origin = arrow.points[0]!
    const style = edgeStyle('branch', mode, { dashed: arrow.dashed, arrow: arrow.arrow, role: arrow.role })
    skeleton.push({
      ...style,
      type: 'arrow',
      id: arrow.id,
      x: origin.x,
      y: origin.y,
      points: arrow.points.map((p) => [p.x - origin.x, p.y - origin.y] as [number, number]),
      roundness: null,
      customData: { ...(style.customData as object), productGeneratedLine: true },
      ...(arrow.start ? { start: { id: arrow.start } } : {}),
      ...(arrow.end ? { end: { id: arrow.end } } : {}),
      ...(arrow.label
        ? { label: { text: arrow.label, fontSize: GRAPHITE_FONT.edgeLabel, fontFamily: HELVETICA, strokeColor: t.labelText } }
        : {}),
    })
  }

  return skeleton
}

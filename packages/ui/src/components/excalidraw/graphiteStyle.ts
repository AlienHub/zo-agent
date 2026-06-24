/**
 * Graphite — diagram design language · single runtime source of truth.
 *
 * Ported from the Graphite handoff (`graphiteStyle.ts`). Every color is derived
 * from an OKLCH formula; change one number in `HUES` to re-skin every diagram.
 * Neutral grays are forced to C=0 so they never tint.
 *
 * This module is intentionally React/CSS-free so it can be consumed from the
 * pure `@craft-agent/ui/excalidraw/canvasScene` subpath and from the hidden
 * materializer renderer alike.
 *
 * Two consumers:
 *   - The materializer bakes a canonical *light* scene (it stamps each element
 *     with `customData.graphite` semantics so the display can re-derive colors).
 *   - The display recolors a scene to the active light/dark mode at view time
 *     via `applyGraphiteTheme`, keeping colors reactive instead of frozen on
 *     disk (Graphite's "derive, don't store" principle).
 */

export type Mode = 'light' | 'dark'
export type Role = 'default' | 'accent' | 'alert' | 'muted'
export type Shape = 'rect' | 'rectSharp' | 'ellipse' | 'circle' | 'diamond' | 'triangle'
export type EdgeKind = 'branch' | 'curve'

/** Change this = re-skin. `accent` may be any hue; `alert` stays rose. */
export const HUES = { accent: 293, alert: 25 }

// Excalidraw roundness type ids (mirrored locally to avoid importing the heavy
// @excalidraw/excalidraw barrel into this pure module).
const ROUNDNESS_PROPORTIONAL = 2 // smooth / curve
const ROUNDNESS_ADAPTIVE = 3 // rounded rectangle
const HELVETICA = 2 // FONT_FAMILY.Helvetica

/** Token defaults the layout engine must respect (dagre). */
export const GRAPHITE_LAYOUT = {
  rankGapMin: 64,
  siblingGapMin: 40,
  nodeMinWidth: 120,
  nodeMinHeight: 48,
  nodePadding: 16,
} as const

export const GRAPHITE_FONT = {
  family: HELVETICA,
  nodeLabel: 16,
  childLabel: 14,
  edgeLabel: 13,
  groupLabel: 12,
} as const

/* ---------------- OKLCH → hex ---------------- */
export function oklchToHex(L: number, C: number, H: number): string {
  const h = (H * Math.PI) / 180, a = C * Math.cos(h), b = C * Math.sin(h)
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b
  const s_ = L - 0.0894841775 * a - 1.2914855480 * b
  const l = l_ ** 3, m = m_ ** 3, s = s_ ** 3
  const lin = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s,
  ]
  const f = (x: number) => {
    x = x <= 0.0031308 ? 12.92 * x : 1.055 * Math.pow(x, 1 / 2.4) - 0.055
    return Math.round(Math.max(0, Math.min(1, x)) * 255).toString(16).padStart(2, '0')
  }
  return '#' + lin.map(f).join('')
}

/* ---------------- derivation formulae ---------------- */
function accentLike(H: number, mode: Mode) {
  return mode === 'dark'
    ? { fill: oklchToHex(0.255, 0.085, H), stroke: oklchToHex(0.65, 0.22, H), text: oklchToHex(0.86, 0.10, H) }
    : { fill: oklchToHex(0.975, 0.030, H), stroke: oklchToHex(0.62, 0.13, H), text: oklchToHex(0.40, 0.085, H) }
}
const gray = (L: number) => oklchToHex(L, 0, 0) // pure neutral, C=0

export interface RoleStyle {
  fill: string
  stroke: string
  text: string
  strokeWidth: number
}

const ROLE_STROKE_WIDTH: Record<Role, number> = { default: 1.4, accent: 1.7, alert: 1.5, muted: 1.1 }

export function roleStyle(role: Role, mode: Mode): RoleStyle {
  const dark = mode === 'dark'
  const strokeWidth = ROLE_STROKE_WIDTH[role]
  let c: { fill: string; stroke: string; text: string }
  if (role === 'accent') c = accentLike(HUES.accent, mode)
  else if (role === 'alert') c = accentLike(HUES.alert, mode)
  else if (role === 'muted')
    c = dark ? { fill: gray(0.18), stroke: gray(0.30), text: gray(0.62) }
             : { fill: gray(0.985), stroke: gray(0.88), text: gray(0.55) }
  else
    c = dark ? { fill: gray(0.205), stroke: gray(0.42), text: gray(0.88) }
             : { fill: '#ffffff', stroke: gray(0.78), text: gray(0.30) }
  return { ...c, strokeWidth }
}

export interface GraphiteTheme {
  canvas: string
  edge: string
  groupStroke: string
  labelText: string
  fontFamily: number
}

export function theme(mode: Mode): GraphiteTheme {
  const dark = mode === 'dark'
  return {
    canvas: dark ? gray(0.165) : '#ffffff',
    edge: dark ? gray(0.62) : gray(0.45),
    groupStroke: dark ? gray(0.27) : gray(0.88),
    labelText: dark ? gray(0.65) : gray(0.50),
    fontFamily: HELVETICA,
  }
}

/* ---------------- shape → Excalidraw type ---------------- */
export function shapeType(shape: Shape): { type: 'rectangle' | 'ellipse' | 'diamond' | 'line'; roundness: { type: number } | null } {
  switch (shape) {
    case 'rectSharp': return { type: 'rectangle', roundness: null }
    case 'ellipse':
    case 'circle': return { type: 'ellipse', roundness: null }
    case 'diamond': return { type: 'diamond', roundness: null }
    case 'triangle': return { type: 'line', roundness: null } // closed 3-point polygon (non-native)
    case 'rect':
    default: return { type: 'rectangle', roundness: { type: ROUNDNESS_ADAPTIVE } }
  }
}

/**
 * Semantic tag stamped onto every Graphite element's `customData.graphite`.
 * The display reads it to re-derive colors for the active mode and to know
 * which neutral channel an edge / title / group should follow.
 */
export type GraphiteTag =
  | { kind: 'node'; role: Role; shape: Shape }
  | { kind: 'edge'; edgeKind: EdgeKind; dashed?: boolean }
  | { kind: 'group' }
  | { kind: 'title' }

export interface NodeSpec {
  id?: string
  x: number
  y: number
  w: number
  h: number
  role?: Role
  shape?: Shape
  text: string
  fontSize?: number
}

/** Build a node skeleton for `convertToExcalidrawElements`, baked for `mode`. */
export function nodeElement(n: NodeSpec, mode: Mode): Record<string, unknown> {
  const role = n.role ?? 'default'
  const shape = n.shape ?? 'rect'
  const r = roleStyle(role, mode)
  const s = shapeType(shape)
  const tag: GraphiteTag = { kind: 'node', role, shape }
  const el: Record<string, unknown> = {
    type: s.type,
    x: n.x,
    y: n.y,
    width: n.w,
    height: n.h,
    strokeColor: r.stroke,
    backgroundColor: r.fill,
    strokeWidth: r.strokeWidth,
    strokeStyle: 'solid',
    roughness: 0,
    fillStyle: 'solid',
    roundness: s.roundness,
    customData: { graphite: tag },
    label: { text: n.text, fontSize: n.fontSize ?? GRAPHITE_FONT.nodeLabel, fontFamily: HELVETICA, strokeColor: r.text },
  }
  if (s.type === 'line') {
    // Triangle: closed polygon (apex → bottom-right → bottom-left → apex).
    el.points = [[n.w / 2, 0], [n.w, n.h], [0, n.h], [n.w / 2, 0]]
  }
  if (n.id) el.id = n.id
  return el
}

export interface EdgeStyleOptions {
  dashed?: boolean
  arrow?: boolean
}

/**
 * Visual style props for a Graphite edge of the given kind, baked for `mode`.
 * Geometry (x/y/points or bindings) is the caller's responsibility — this only
 * returns colors, stroke, roundness, arrowheads and the semantic tag, so a
 * dagre-routed materializer and the binding-based spec path can share styling.
 */
export function edgeStyle(kind: EdgeKind, mode: Mode, opts: EdgeStyleOptions = {}): Record<string, unknown> {
  const t = theme(mode)
  const tag: GraphiteTag = { kind: 'edge', edgeKind: kind, ...(opts.dashed ? { dashed: true } : {}) }
  return {
    strokeColor: t.edge,
    strokeWidth: 1.3,
    roughness: 0,
    strokeStyle: opts.dashed ? 'dashed' : 'solid',
    // branch = crisp, trackable elbow polyline (sharp corners along the route);
    // curve = smooth proportional bend. Geometry comes from the caller's points.
    roundness: kind === 'curve' ? { type: ROUNDNESS_PROPORTIONAL } : null,
    endArrowhead: opts.arrow === false ? null : 'triangle',
    startArrowhead: null,
    customData: { graphite: tag },
  }
}

export interface EdgeSpec {
  fromId: string
  toId: string
  kind?: EdgeKind
  dashed?: boolean
  label?: string
  arrow?: boolean
}

/** Binding-based edge skeleton (spec path; geometry resolved by Excalidraw). */
export function edgeElement(e: EdgeSpec, mode: Mode): Record<string, unknown> {
  const t = theme(mode)
  const kind = e.kind ?? 'branch'
  const el: Record<string, unknown> = {
    type: 'arrow',
    ...edgeStyle(kind, mode, { dashed: e.dashed, arrow: e.arrow }),
    start: { id: e.fromId },
    end: { id: e.toId },
    ...(kind === 'branch' ? { elbowed: true } : {}),
  }
  if (e.label) el.label = { text: e.label, fontSize: GRAPHITE_FONT.edgeLabel, fontFamily: HELVETICA, strokeColor: t.labelText }
  return el
}

/** Dashed, fill-less grouping container. */
export function groupElement(x: number, y: number, w: number, h: number, mode: Mode): Record<string, unknown> {
  return {
    type: 'rectangle',
    x,
    y,
    width: w,
    height: h,
    strokeColor: theme(mode).groupStroke,
    backgroundColor: 'transparent',
    strokeWidth: 1.1,
    strokeStyle: 'dashed',
    roughness: 0,
    roundness: { type: ROUNDNESS_ADAPTIVE },
    customData: { graphite: { kind: 'group' } as GraphiteTag },
  }
}

/* ---------------- display-time recolor ---------------- */

interface GraphiteTaggedElement {
  id?: string
  type?: string
  containerId?: string | null
  strokeColor?: string
  backgroundColor?: string
  strokeWidth?: number
  customData?: { graphite?: GraphiteTag } | null
}

export function readGraphiteTag(element: unknown): GraphiteTag | null {
  const tag = (element as GraphiteTaggedElement | null)?.customData?.graphite
  return tag && typeof tag === 'object' && 'kind' in tag ? tag : null
}

/** True when a scene carries any Graphite-tagged element (opt-in for recolor). */
export function hasGraphiteElements(elements: readonly unknown[]): boolean {
  return elements.some((element) => readGraphiteTag(element) !== null)
}

/**
 * Re-derive every Graphite element's colors for `mode`, returning a new array
 * (untagged elements pass through untouched). Pure: no Excalidraw imports, so it
 * is safe to call from the display layer on every theme toggle.
 *
 * Bound label text lives in a separate element (`containerId` → container), so
 * we first index containers by id to recolor their labels by the container's
 * own role / channel.
 */
export function applyGraphiteTheme<T>(elements: readonly T[], mode: Mode): T[] {
  const t = theme(mode)
  const containerTag = new Map<string, GraphiteTag>()
  for (const element of elements) {
    const tag = readGraphiteTag(element)
    const id = (element as GraphiteTaggedElement).id
    if (tag && typeof id === 'string') containerTag.set(id, tag)
  }

  return elements.map((element) => {
    const el = element as GraphiteTaggedElement
    const tag = readGraphiteTag(element)

    if (tag?.kind === 'node') {
      const r = roleStyle(tag.role, mode)
      return { ...element, strokeColor: r.stroke, backgroundColor: r.fill, strokeWidth: r.strokeWidth }
    }
    if (tag?.kind === 'edge') {
      return { ...element, strokeColor: t.edge }
    }
    if (tag?.kind === 'group') {
      return { ...element, strokeColor: t.groupStroke }
    }
    if (tag?.kind === 'title') {
      return { ...element, strokeColor: t.labelText }
    }

    // Bound text labels: recolor by their container's channel.
    if (el.type === 'text' && el.containerId) {
      const owner = containerTag.get(el.containerId)
      if (owner?.kind === 'node') return { ...element, strokeColor: roleStyle(owner.role, mode).text }
      if (owner?.kind === 'edge') return { ...element, strokeColor: t.labelText }
    }
    return element
  })
}

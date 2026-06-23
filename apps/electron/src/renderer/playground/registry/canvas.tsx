import * as React from 'react'
import './canvas.css'
import type { ComponentEntry } from './types'

type EdgeStyle = 'direct' | 'elbow' | 'mixed'
type SurfaceTone = 'subtle' | 'elevated' | 'contrast'

interface ZoCanvasNodeEdgeStyleProps {
  edgeStyle: EdgeStyle
  surfaceTone: SurfaceTone
  showPorts: boolean
}

interface NodeSpec {
  id: string
  label: string
  tone: 'neutral' | 'accent' | 'success' | 'warning' | 'purple'
  x: number
  y: number
  width: number
  height: number
}

const nodes: NodeSpec[] = [
  { id: 'request', label: 'Request', tone: 'neutral', x: 92, y: 126, width: 156, height: 64 },
  { id: 'plan', label: 'Plan', tone: 'purple', x: 330, y: 126, width: 156, height: 64 },
  { id: 'tool', label: 'Tool call', tone: 'accent', x: 568, y: 126, width: 164, height: 64 },
  { id: 'result', label: 'Result', tone: 'success', x: 330, y: 284, width: 156, height: 64 },
  { id: 'review', label: 'Review', tone: 'neutral', x: 568, y: 284, width: 164, height: 64 },
]

const states: NodeSpec[] = [
  { id: 'idle', label: 'Idle', tone: 'neutral', x: 92, y: 438, width: 130, height: 52 },
  { id: 'active', label: 'Active', tone: 'accent', x: 278, y: 438, width: 130, height: 52 },
  { id: 'input', label: 'Needs input', tone: 'warning', x: 464, y: 438, width: 130, height: 52 },
  { id: 'done', label: 'Done', tone: 'success', x: 650, y: 438, width: 130, height: 52 },
]

function nodeCenter(node: NodeSpec) {
  return {
    x: node.x + node.width / 2,
    y: node.y + node.height / 2,
  }
}

function right(node: NodeSpec) {
  return { x: node.x + node.width, y: node.y + node.height / 2 }
}

function left(node: NodeSpec) {
  return { x: node.x, y: node.y + node.height / 2 }
}

function top(node: NodeSpec) {
  return { x: node.x + node.width / 2, y: node.y }
}

function bottom(node: NodeSpec) {
  return { x: node.x + node.width / 2, y: node.y + node.height }
}

function pathBetween(from: { x: number; y: number }, to: { x: number; y: number }, edgeStyle: EdgeStyle, bend = 0) {
  if (edgeStyle === 'direct') return `M ${from.x} ${from.y} L ${to.x} ${to.y}`

  const midX = from.x + (to.x - from.x) / 2 + bend
  if (edgeStyle === 'elbow') {
    return `M ${from.x} ${from.y} L ${midX} ${from.y} L ${midX} ${to.y} L ${to.x} ${to.y}`
  }

  return `M ${from.x} ${from.y} C ${midX} ${from.y}, ${midX} ${to.y}, ${to.x} ${to.y}`
}

function ZoCanvasNodeEdgeStyle({
  edgeStyle,
  surfaceTone,
  showPorts,
}: ZoCanvasNodeEdgeStyleProps) {
  const request = nodes[0]
  const plan = nodes[1]
  const tool = nodes[2]
  const result = nodes[3]
  const review = nodes[4]

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <div className="border-b border-border/50 px-4 py-3">
        <div className="text-sm font-medium text-foreground">Node & edge style</div>
        <div className="mt-1 text-xs text-muted-foreground">
          Product-native canvas primitives for tuning Zo agent nodes and connectors.
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 border-b border-border/40 px-4 py-2 text-[11px] text-muted-foreground">
        <TokenPill label="Renderer" value="SVG" />
        <TokenPill label="Node" value="quiet surface" />
        <TokenPill label="Stroke" value="1px" />
        <TokenPill label="Radius" value="10px" />
        <TokenPill label="Edge" value={edgeStyle} />
        <TokenPill label="Ports" value={showPorts ? 'visible' : 'hidden'} />
      </div>

      <div className="min-h-0 flex-1 p-4">
        <div className={`zo-canvas-lab zo-canvas-lab--${surfaceTone}`}>
          <svg className="h-full w-full" viewBox="0 0 900 560" role="img" aria-label="Zo canvas node and edge style sample">
            <defs>
              <marker id="zo-arrow" markerWidth="10" markerHeight="10" refX="8.2" refY="5" orient="auto" markerUnits="strokeWidth">
                <path d="M 1 1.5 L 8 5 L 1 8.5 Z" className="zo-canvas-arrowhead" />
              </marker>
              <marker id="zo-arrow-accent" markerWidth="10" markerHeight="10" refX="8.2" refY="5" orient="auto" markerUnits="strokeWidth">
                <path d="M 1 1.5 L 8 5 L 1 8.5 Z" className="zo-canvas-arrowhead-accent" />
              </marker>
            </defs>

            <rect x="44" y="58" width="792" height="332" rx="18" className="zo-canvas-group" />
            <text x="72" y="92" className="zo-canvas-caption">Agent work loop</text>

            <Edge path={pathBetween(right(request), left(plan), edgeStyle)} label="analyze" labelX={286} labelY={150} />
            <Edge path={pathBetween(right(plan), left(tool), edgeStyle)} label="invoke" labelX={524} labelY={150} tone="accent" />
            <Edge path={pathBetween(bottom(tool), right(result), edgeStyle, -54)} label="return" labelX={512} labelY={252} tone="success" />
            <Edge path={pathBetween(right(result), left(review), edgeStyle)} label="inspect" labelX={524} labelY={308} />
            <Edge path={pathBetween(top(review), top(plan), edgeStyle, 48)} label="refine" labelX={500} labelY={238} tone="purple" dashed />

            {nodes.map((item) => (
              <CanvasNode key={item.id} node={item} showPorts={showPorts} />
            ))}

            <text x="72" y="420" className="zo-canvas-caption">State variants</text>
            {states.map((item) => (
              <CanvasNode key={item.id} node={item} showPorts={showPorts} compact />
            ))}
            <Edge path={pathBetween(right(states[0]), left(states[1]), edgeStyle)} tone="muted" />
            <Edge path={pathBetween(right(states[1]), left(states[2]), edgeStyle)} tone="warning" dashed />
            <Edge path={pathBetween(right(states[2]), left(states[3]), edgeStyle)} tone="success" />
          </svg>
        </div>
      </div>
    </div>
  )
}

function CanvasNode({ node, showPorts, compact = false }: { node: NodeSpec; showPorts: boolean; compact?: boolean }) {
  const center = nodeCenter(node)

  return (
    <g className={`zo-canvas-node zo-canvas-node--${node.tone}`}>
      <rect x={node.x} y={node.y} width={node.width} height={node.height} rx={compact ? 8 : 10} />
      <text x={center.x} y={center.y} dominantBaseline="middle" textAnchor="middle">
        {node.label}
      </text>
      {showPorts && (
        <>
          <circle cx={node.x} cy={center.y} r="3" className="zo-canvas-port" />
          <circle cx={node.x + node.width} cy={center.y} r="3" className="zo-canvas-port" />
        </>
      )}
    </g>
  )
}

function Edge({
  path,
  label,
  labelX,
  labelY,
  tone = 'muted',
  dashed = false,
}: {
  path: string
  label?: string
  labelX?: number
  labelY?: number
  tone?: 'muted' | 'accent' | 'success' | 'warning' | 'purple'
  dashed?: boolean
}) {
  return (
    <g className={`zo-canvas-edge zo-canvas-edge--${tone}`}>
      <path d={path} className={dashed ? 'zo-canvas-edge-path zo-canvas-edge-path--dashed' : 'zo-canvas-edge-path'} markerEnd={tone === 'accent' ? 'url(#zo-arrow-accent)' : 'url(#zo-arrow)'} />
      {label && labelX != null && labelY != null && (
        <text x={labelX} y={labelY} className="zo-canvas-edge-label" textAnchor="middle">
          {label}
        </text>
      )}
    </g>
  )
}

function TokenPill({ label, value }: { label: string; value: string }) {
  return (
    <span className="inline-flex h-6 items-center gap-1.5 rounded-[6px] bg-foreground/[0.035] px-2">
      <span className="text-muted-foreground/70">{label}</span>
      <span className="font-mono text-foreground/70">{value}</span>
    </span>
  )
}

export const canvasComponents: ComponentEntry[] = [
  {
    id: 'canvas-node-edge-style',
    name: 'Node & Edge Style',
    category: 'Canvas',
    description: 'Canvas primitives for tuning Zo agent node and connector visual language.',
    component: ZoCanvasNodeEdgeStyle,
    layout: 'full',
    previewOverflow: 'hidden',
    props: [
      {
        name: 'edgeStyle',
        description: 'Connector routing style to preview.',
        control: {
          type: 'select',
          options: [
            { label: 'Direct', value: 'direct' },
            { label: 'Elbow', value: 'elbow' },
            { label: 'Mixed', value: 'mixed' },
          ],
        },
        defaultValue: 'mixed',
      },
      {
        name: 'surfaceTone',
        description: 'Canvas surface contrast level.',
        control: {
          type: 'select',
          options: [
            { label: 'Subtle', value: 'subtle' },
            { label: 'Elevated', value: 'elevated' },
            { label: 'Contrast', value: 'contrast' },
          ],
        },
        defaultValue: 'subtle',
      },
      {
        name: 'showPorts',
        description: 'Show connector port dots on node edges.',
        control: { type: 'boolean' },
        defaultValue: false,
      },
    ],
    variants: [
      { name: 'Mixed connectors', props: { edgeStyle: 'mixed', surfaceTone: 'subtle', showPorts: false } },
      { name: 'Direct flow', props: { edgeStyle: 'direct', surfaceTone: 'subtle', showPorts: false } },
      { name: 'Elbow routing', props: { edgeStyle: 'elbow', surfaceTone: 'elevated', showPorts: true } },
    ],
  },
]

import * as React from 'react'
import './excalidraw-assets'
import { FONT_FAMILY, ROUNDNESS, convertToExcalidrawElements } from '@excalidraw/excalidraw'
import type { AppState, BinaryFiles } from '@excalidraw/excalidraw/types'
import type { ExcalidrawElement } from '@excalidraw/excalidraw/element/types'
import {
  TurnCard,
  UserMessageBubble,
  type ActivityItem,
  type ResponseContent,
} from '@craft-agent/ui'
import { useTheme } from '../../context/ThemeContext'
import type { ComponentEntry } from './types'

interface ExcalidrawSceneData {
  type: 'excalidraw'
  version: number
  source: string
  elements: readonly ExcalidrawElement[]
  appState?: Partial<AppState>
  files?: BinaryFiles
}

function getCanvasPalette(isDarkMode: boolean) {
  if (isDarkMode) {
    return {
      text: '#ececf0',
      muted: '#8e95a3',
      line: '#8a92a2',
      node: '#252a35',
      nodeStroke: '#596273',
      accentFill: '#22304a',
      accentStroke: '#6ea4e8',
      successFill: '#173625',
      successStroke: '#55b77e',
      purpleFill: '#302646',
      purpleStroke: '#a18cec',
    }
  }

  return {
    text: '#242733',
    muted: '#727987',
    line: '#7d8492',
    node: '#ffffff',
    nodeStroke: '#d7dbe4',
    accentFill: '#edf5ff',
    accentStroke: '#4d8bcc',
    successFill: '#eaf7ef',
    successStroke: '#42a66b',
    purpleFill: '#f3efff',
    purpleStroke: '#8a73d6',
  }
}

function productNode(id: string, x: number, y: number, width: number, height: number, text: string, fill: string, stroke: string, textColor: string) {
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
      fontSize: 17,
      fontFamily: FONT_FAMILY.Helvetica,
      strokeColor: textColor,
    },
  }
}

function productArrow(id: string, x: number, y: number, width: number, height: number, label: string, color: string, dashed = false) {
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

function productText(id: string, x: number, y: number, text: string, color: string) {
  return {
    type: 'text' as const,
    id,
    x,
    y,
    text,
    fontSize: 13,
    fontFamily: FONT_FAMILY.Helvetica,
    strokeColor: color,
    backgroundColor: 'transparent',
    roughness: 0,
  }
}

function createCanvasPreviewScene(isDarkMode: boolean): ExcalidrawSceneData {
  const palette = getCanvasPalette(isDarkMode)

  return {
    type: 'excalidraw',
    version: 2,
    source: 'craft-agent-playground',
    elements: convertToExcalidrawElements(
      [
        productText('group-title', 24, 34, 'Agent work loop', palette.muted),
        productNode('request', 48, 96, 138, 58, 'Request', palette.node, palette.nodeStroke, palette.text),
        productNode('plan', 270, 96, 138, 58, 'Plan', palette.purpleFill, palette.purpleStroke, palette.text),
        productNode('tool', 492, 96, 154, 58, 'Tool call', palette.accentFill, palette.accentStroke, palette.text),
        productNode('result', 270, 198, 138, 58, 'Result', palette.successFill, palette.successStroke, palette.text),
        productNode('review', 492, 198, 154, 58, 'Review', palette.node, palette.nodeStroke, palette.text),
        productArrow('edge-request-plan', 186, 125, 84, 0, 'analyze', palette.line),
        productArrow('edge-plan-tool', 408, 125, 84, 0, 'invoke', palette.accentStroke),
        productArrow('edge-tool-result', 569, 154, -161, 44, 'return', palette.successStroke),
        productArrow('edge-result-review', 408, 227, 84, 0, 'inspect', palette.line),
        productArrow('edge-review-plan', 492, 198, -84, -44, 'refine', palette.purpleStroke, true),
      ],
      { regenerateIds: false },
    ) as ExcalidrawElement[],
    appState: {
      currentItemFontFamily: FONT_FAMILY.Helvetica,
      gridModeEnabled: false,
      theme: isDarkMode ? 'dark' : 'light',
      viewBackgroundColor: 'transparent',
    } as Partial<AppState>,
    files: {},
  }
}

const canvasPreviewActivities: ActivityItem[] = [
  {
    id: 'canvas-preview-activity',
    type: 'intermediate',
    status: 'completed',
    content: 'Preparing canvas preview.',
    timestamp: Date.now() - 5000,
  },
  {
    id: 'canvas-preview-render',
    type: 'tool',
    status: 'completed',
    toolName: 'canvas.preview',
    displayName: 'Render canvas',
    intent: 'Rendering canvas preview',
    toolInput: {
      artifactType: 'excalidraw',
      elements: 12,
    },
    timestamp: Date.now() - 3000,
  },
]

function createCanvasPreviewResponse(readonly: boolean, scene: ExcalidrawSceneData): ResponseContent {
  const blockSpec = {
    title: 'Canvas preview',
    readonly,
    height: 320,
    scene,
  }

  return {
    text: [
      'Canvas preview:',
      '',
      '```excalidraw',
      JSON.stringify(blockSpec, null, 2),
      '```',
    ].join('\n'),
    isStreaming: false,
  }
}

function ExcalidrawCanvasInTurnCard({
  readonly,
}: {
  readonly: boolean
}) {
  const { isDark } = useTheme()
  const isDomDark = typeof document !== 'undefined' && document.documentElement.classList.contains('dark')
  const isDarkMode = isDark || isDomDark
  const scene = React.useMemo(() => createCanvasPreviewScene(isDarkMode), [isDarkMode])
  const response = React.useMemo(() => createCanvasPreviewResponse(readonly, scene), [readonly, scene])

  return (
    <div className="mx-auto flex w-full max-w-[860px] flex-col gap-4 px-4 py-6">
      <UserMessageBubble content="Show a canvas preview in this turn." />

      <TurnCard
        key={isDarkMode ? 'dark' : 'light'}
        sessionId="playground-excalidraw-canvas"
        turnId="playground-excalidraw-canvas-turn"
        activities={canvasPreviewActivities}
        response={response}
        isStreaming={false}
        isComplete={true}
        defaultExpanded={true}
        displayMode="informative"
        compactMode
        onOpenFile={(path) => console.log('[Playground] Open file:', path)}
        onOpenUrl={(url) => console.log('[Playground] Open URL:', url)}
        onOpenActivityDetails={(activity) => console.log('[Playground] Open activity details:', activity.id, activity.toolName)}
      />
    </div>
  )
}

export const excalidrawComponents: ComponentEntry[] = [
  {
    id: 'turn-card-excalidraw-canvas',
    name: 'Excalidraw Canvas',
    category: 'TurnCard Modes',
    description: 'TurnCard response state with an embedded Excalidraw canvas block.',
    component: ExcalidrawCanvasInTurnCard,
    layout: 'top',
    previewOverflow: 'auto',
    props: [
      {
        name: 'readonly',
        description: 'Toggle the embedded canvas view mode.',
        control: { type: 'boolean' },
        defaultValue: true,
      },
    ],
    variants: [
      { name: 'Readonly', props: { readonly: true } },
      { name: 'Editable', props: { readonly: false } },
    ],
  },
]

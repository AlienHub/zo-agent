import * as React from 'react'
import './excalidraw-assets'
import { FONT_FAMILY, convertToExcalidrawElements } from '@excalidraw/excalidraw'
import type { AppState, BinaryFiles } from '@excalidraw/excalidraw/types'
import type { ExcalidrawElement } from '@excalidraw/excalidraw/element/types'
import {
  PlatformProvider,
  TurnCard,
  UserMessageBubble,
  type ActivityItem,
  type ResponseContent,
} from '@craft-agent/ui'
import { useTheme } from '../../context/ThemeContext'
import {
  edgeStyle,
  nodeElement,
  theme as graphiteTheme,
  type EdgeKind,
  type Role,
  type Shape,
} from '@craft-agent/ui/excalidraw/canvasScene'
import type { ExcalidrawElementSkeleton } from '@excalidraw/excalidraw/data/transform'
import type { ComponentEntry } from './types'

const GRAPHITE_MODE = 'light' as const

function pNode(id: string, x: number, y: number, w: number, h: number, text: string, role: Role = 'default', shape: Shape = 'rect') {
  return nodeElement({ id, x, y, w, h, text, role, shape }, GRAPHITE_MODE)
}

function pNote(id: string, x: number, y: number, value: string) {
  return {
    type: 'text' as const,
    id,
    x,
    y,
    text: value,
    fontSize: 14,
    fontFamily: FONT_FAMILY.Helvetica,
    strokeColor: graphiteTheme(GRAPHITE_MODE).labelText,
    backgroundColor: 'transparent',
    roughness: 0,
    customData: { graphite: { kind: 'title' } },
  }
}

function pEdge(id: string, x: number, y: number, w: number, h: number, label: string, kind: EdgeKind = 'branch', dashed = false) {
  const style = edgeStyle(kind, GRAPHITE_MODE, { dashed })
  return {
    ...style,
    type: 'arrow' as const,
    id,
    x,
    y,
    points: [[0, 0], [w, h]] as [number, number][],
    customData: { ...(style.customData as object), productGeneratedLine: true },
    ...(label
      ? { label: { text: label, fontSize: 13, fontFamily: FONT_FAMILY.Helvetica, strokeColor: graphiteTheme(GRAPHITE_MODE).labelText } }
      : {}),
  }
}

interface ExcalidrawSceneData {
  type: 'excalidraw'
  version: number
  source: string
  elements: readonly ExcalidrawElement[]
  appState?: Partial<AppState>
  files?: BinaryFiles
}

function createCanvasPreviewScene(isDarkMode: boolean): ExcalidrawSceneData {
  // Bake the canonical light scene with Graphite semantic tags; the display
  // recolors to the active light/dark mode at view time.
  return {
    type: 'excalidraw',
    version: 2,
    source: 'craft-agent-playground',
    elements: convertToExcalidrawElements(
      [
        pNote('group-title', 24, 34, 'Agent work loop'),
        pNode('request', 48, 96, 138, 58, 'Request', 'default', 'ellipse'),
        pNode('plan', 270, 96, 138, 58, 'Plan', 'accent'),
        pNode('tool', 492, 96, 154, 58, 'Tool call'),
        pNode('result', 270, 198, 138, 58, 'Result'),
        pNode('review', 492, 198, 154, 58, 'Review', 'default', 'diamond'),
        pEdge('edge-request-plan', 186, 125, 84, 0, 'analyze'),
        pEdge('edge-plan-tool', 408, 125, 84, 0, 'invoke'),
        pEdge('edge-tool-result', 569, 154, -161, 44, 'return'),
        pEdge('edge-result-review', 408, 227, 84, 0, 'inspect'),
        pEdge('edge-review-plan', 492, 198, -84, -44, 'refine', 'branch', true),
      ] as unknown as ExcalidrawElementSkeleton[],
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

// File-reference model: the agent (here, the demo) references a .excalidraw
// file by path. The playground serves it from an in-memory mock onReadFile.
const PLAYGROUND_CANVAS_SRC = 'playground://canvas/agent-loop.excalidraw'

function createCanvasPreviewResponse(readonly: boolean): ResponseContent {
  const blockSpec = {
    src: PLAYGROUND_CANVAS_SRC,
    title: 'Canvas preview',
    readonly,
    height: 320,
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
  const response = React.useMemo(() => createCanvasPreviewResponse(readonly), [readonly])
  const platformActions = React.useMemo(() => ({
    onReadFile: async (path: string) => {
      if (path !== PLAYGROUND_CANVAS_SRC) throw new Error(`Mock canvas not found for: ${path}`)
      return JSON.stringify(scene)
    },
  }), [scene])

  return (
    <PlatformProvider actions={platformActions}>
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
    </PlatformProvider>
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

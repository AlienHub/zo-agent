import * as React from 'react'
import './excalidraw-assets'
import { FONT_FAMILY, convertToExcalidrawElements } from '@excalidraw/excalidraw'
import type { AppState, BinaryFiles } from '@excalidraw/excalidraw/types'
import type { ExcalidrawElement } from '@excalidraw/excalidraw/element/types'
import {
  TurnCard,
  UserMessageBubble,
  type ActivityItem,
  type ResponseContent,
} from '@craft-agent/ui'
import { useTheme } from '../../context/ThemeContext'
import {
  LIGHT_PALETTE,
  arrow as sceneArrow,
  node as sceneNode,
  text as sceneText,
} from '@craft-agent/ui/excalidraw/canvasScene'
import type { ComponentEntry } from './types'

interface ExcalidrawSceneData {
  type: 'excalidraw'
  version: number
  source: string
  elements: readonly ExcalidrawElement[]
  appState?: Partial<AppState>
  files?: BinaryFiles
}

function createCanvasPreviewScene(isDarkMode: boolean): ExcalidrawSceneData {
  const palette = LIGHT_PALETTE

  return {
    type: 'excalidraw',
    version: 2,
    source: 'craft-agent-playground',
    elements: convertToExcalidrawElements(
      [
        sceneText('group-title', 24, 34, 'Agent work loop', palette.muted),
        sceneNode('request', 48, 96, 138, 58, 'Request', palette.surface, palette.stroke, palette.text),
        sceneNode('plan', 270, 96, 138, 58, 'Plan', palette.purpleFill, palette.purpleStroke, palette.text),
        sceneNode('tool', 492, 96, 154, 58, 'Tool call', palette.blueFill, palette.blueStroke, palette.text),
        sceneNode('result', 270, 198, 138, 58, 'Result', palette.greenFill, palette.greenStroke, palette.text),
        sceneNode('review', 492, 198, 154, 58, 'Review', palette.surface, palette.stroke, palette.text),
        sceneArrow('edge-request-plan', 186, 125, 84, 0, 'analyze', palette.line),
        sceneArrow('edge-plan-tool', 408, 125, 84, 0, 'invoke', palette.blueStroke),
        sceneArrow('edge-tool-result', 569, 154, -161, 44, 'return', palette.greenStroke),
        sceneArrow('edge-result-review', 408, 227, 84, 0, 'inspect', palette.line),
        sceneArrow('edge-review-plan', 492, 198, -84, -44, 'refine', palette.purpleStroke, true),
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

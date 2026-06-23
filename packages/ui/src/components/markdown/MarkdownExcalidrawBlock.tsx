/**
 * MarkdownExcalidrawBlock - Renders ```excalidraw code blocks as inline canvas previews.
 *
 * Expected JSON shape:
 * {
 *   "title": "Workflow canvas",
 *   "readonly": true,
 *   "height": 320,
 *   "scene": {
 *     "type": "excalidraw",
 *     "version": 2,
 *     "source": "agent",
 *     "elements": [],
 *     "appState": {},
 *     "files": {}
 *   }
 * }
 *
 * For convenience, a raw Excalidraw scene object with top-level `elements` is
 * accepted as well.
 */

import * as React from 'react'
import { Maximize2, PencilLine, Eye } from 'lucide-react'
import { cn } from '../../lib/utils'
import { CodeBlock } from './CodeBlock'
import { FullscreenOverlayBase } from '../overlay/FullscreenOverlayBase'
import {
  EditableExcalidrawCanvas,
  ExcalidrawCanvas,
  hashExcalidrawSceneKey,
  useDocumentDarkMode,
  type CanvasScene,
} from '../excalidraw'
import type { AppState, BinaryFiles } from '@excalidraw/excalidraw/types'
import type { ExcalidrawElement } from '@excalidraw/excalidraw/element/types'

interface ExcalidrawSceneData {
  type?: 'excalidraw'
  version?: number
  source?: string
  elements?: readonly ExcalidrawElement[]
  appState?: Partial<AppState>
  files?: BinaryFiles
}

interface ExcalidrawPreviewSpec {
  title?: string
  readonly?: boolean
  height?: number
  scene?: ExcalidrawSceneData
  elements?: readonly ExcalidrawElement[]
  appState?: Partial<AppState>
  files?: BinaryFiles
}

export interface MarkdownExcalidrawBlockProps {
  code: string
  className?: string
}

class ExcalidrawBlockErrorBoundary extends React.Component<
  { children: React.ReactNode; fallback: React.ReactNode },
  { hasError: boolean }
> {
  state = { hasError: false }
  static getDerivedStateFromError() { return { hasError: true } }
  componentDidCatch(error: Error) {
    console.warn('[MarkdownExcalidrawBlock] Render failed, falling back to CodeBlock:', error)
  }
  render() {
    if (this.state.hasError) return this.props.fallback
    return this.props.children
  }
}

function parseSpec(code: string): ExcalidrawPreviewSpec | null {
  try {
    const raw = JSON.parse(code) as ExcalidrawPreviewSpec
    const scene = raw.scene ?? raw
    if (!scene || !Array.isArray(scene.elements)) return null
    return raw
  } catch {
    return null
  }
}

function clampHeight(value: unknown, fallback: number) {
  return Math.min(Math.max(typeof value === 'number' ? value : fallback, 220), 720)
}

export function MarkdownExcalidrawBlock({ code, className }: MarkdownExcalidrawBlockProps) {
  const spec = React.useMemo(() => parseSpec(code), [code])
  const [isFullscreenOpen, setIsFullscreenOpen] = React.useState(false)
  const [fullscreenMode, setFullscreenMode] = React.useState<'view' | 'edit'>('view')
  const isDarkMode = useDocumentDarkMode()

  // Fullscreen opens read-only every time; the user clicks Edit to edit.
  React.useEffect(() => {
    if (!isFullscreenOpen) setFullscreenMode('view')
  }, [isFullscreenOpen])

  const fallback = <CodeBlock code={code} language="json" mode="full" className={className} />

  if (!spec) return fallback

  const scene = spec.scene ?? spec
  const title = spec.title || 'Canvas'
  const readonly = spec.readonly ?? true
  const baseHeight = clampHeight(spec.height, 320)
  const canvasTheme = isDarkMode ? 'dark' : 'light'
  const sceneKey = React.useMemo(() => `markdown:${hashExcalidrawSceneKey(code)}`, [code])
  const sceneBackground = scene.appState?.viewBackgroundColor
  const appState = React.useMemo<Partial<AppState>>(() => ({
    ...scene.appState,
    theme: canvasTheme,
    gridModeEnabled: false,
    viewBackgroundColor: sceneBackground && sceneBackground !== '#ffffff'
      ? sceneBackground
      : 'transparent',
  }), [canvasTheme, isDarkMode, scene.appState, sceneBackground])

  const fullscreenScene: CanvasScene = {
    type: 'excalidraw',
    version: spec.scene?.version ?? 2,
    source: spec.scene?.source ?? 'agent',
    elements: scene.elements ?? [],
    appState,
    files: scene.files ?? {},
  }

  return (
    <ExcalidrawBlockErrorBoundary fallback={fallback}>
      <div className={cn('relative group overflow-hidden rounded-[8px] border border-border/50 bg-background shadow-minimal', className)}>
        <button
          onClick={() => setIsFullscreenOpen(true)}
          className={cn(
            "absolute right-2 top-2 z-10 p-1.5 rounded-[6px] transition-all select-none",
            "bg-background/80 shadow-minimal backdrop-blur-sm",
            "text-muted-foreground/50 hover:text-foreground",
            "focus:outline-none focus-visible:ring-1 focus-visible:ring-ring focus-visible:opacity-100",
            "opacity-0 group-hover:opacity-100",
          )}
          title="Open fullscreen"
          aria-label="Open Excalidraw fullscreen"
        >
          <Maximize2 className="w-3.5 h-3.5" />
        </button>

        {/* Inline canvas is always read-only; editing happens only in fullscreen. */}
        <ExcalidrawCanvas
          scene={scene}
          appState={appState}
          sceneKey={`inline:${sceneKey}`}
          viewModeEnabled
          style={{ height: baseHeight }}
        />
      </div>

      <FullscreenOverlayBase
        isOpen={isFullscreenOpen}
        onClose={() => setIsFullscreenOpen(false)}
        accessibleTitle={`${title} fullscreen preview`}
        title={title}
      >
        <div className="relative mx-auto h-[calc(100vh-96px)] w-[calc(100vw-48px)] overflow-hidden rounded-[8px] border border-border/50 bg-background shadow-minimal">
          {/* Editing is only offered in fullscreen, and only when the block allows it. */}
          {!readonly && (
            <button
              onClick={() => setFullscreenMode(current => (current === 'edit' ? 'view' : 'edit'))}
              className={cn(
                "absolute right-2 top-2 z-10 inline-flex items-center gap-1 rounded-[6px] px-2 py-1 text-xs font-medium transition-all select-none",
                "bg-background/80 shadow-minimal backdrop-blur-sm",
                fullscreenMode === 'edit' ? "text-foreground" : "text-muted-foreground hover:text-foreground",
                "focus:outline-none focus-visible:ring-1 focus-visible:ring-ring",
              )}
              title={fullscreenMode === 'edit' ? 'Switch to read-only' : 'Edit canvas'}
              aria-label={fullscreenMode === 'edit' ? 'Switch canvas to read-only' : 'Edit canvas'}
            >
              {fullscreenMode === 'edit' ? <Eye className="w-3.5 h-3.5" /> : <PencilLine className="w-3.5 h-3.5" />}
              {fullscreenMode === 'edit' ? 'Done' : 'Edit'}
            </button>
          )}
          <EditableExcalidrawCanvas
            scene={fullscreenScene}
            sceneKey={`fullscreen:${sceneKey}`}
            mode={readonly ? 'view' : fullscreenMode}
            className="h-full w-full"
          />
        </div>
      </FullscreenOverlayBase>
    </ExcalidrawBlockErrorBoundary>
  )
}

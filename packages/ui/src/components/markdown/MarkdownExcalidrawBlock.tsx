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
import { Maximize2 } from 'lucide-react'
import { Excalidraw } from '@excalidraw/excalidraw'
import '@excalidraw/excalidraw/index.css'
import './MarkdownExcalidrawBlock.css'
import { cn } from '../../lib/utils'
import { CodeBlock } from './CodeBlock'
import { FullscreenOverlayBase } from '../overlay/FullscreenOverlayBase'
import type { AppState, BinaryFiles, UIOptions } from '@excalidraw/excalidraw/types'
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

interface ExcalidrawCanvasSurfaceProps {
  scene: ExcalidrawSceneData
  appState: Partial<AppState>
  canvasTheme: 'light' | 'dark'
  readonly: boolean
  isDarkMode: boolean
  className?: string
  style?: React.CSSProperties
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

const excalidrawCanvasUiOptions: Partial<UIOptions> = {
  canvasActions: {
    changeViewBackgroundColor: false,
    clearCanvas: false,
    export: false,
    loadScene: false,
    saveAsImage: false,
    saveToActiveFile: false,
    toggleTheme: false,
  },
  tools: {
    image: false,
  },
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

function hashString(value: string) {
  let hash = 0
  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash << 5) - hash + value.charCodeAt(index)) | 0
  }
  return hash.toString(36)
}

function useDocumentDarkMode() {
  const [isDarkMode, setIsDarkMode] = React.useState(() => (
    typeof document !== 'undefined' && document.documentElement.classList.contains('dark')
  ))

  React.useEffect(() => {
    if (typeof document === 'undefined') return

    const update = () => {
      setIsDarkMode(document.documentElement.classList.contains('dark'))
    }

    update()
    const observer = new MutationObserver(update)
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
    return () => observer.disconnect()
  }, [])

  return isDarkMode
}

function ExcalidrawCanvasSurface({
  scene,
  appState,
  canvasTheme,
  readonly,
  isDarkMode,
  className,
  style,
}: ExcalidrawCanvasSurfaceProps) {
  const handleContextMenu = React.useCallback((event: React.MouseEvent) => {
    event.preventDefault()
    event.stopPropagation()
  }, [])
  const handleMouseDownCapture = React.useCallback((event: React.MouseEvent) => {
    if (event.button !== 2) return
    event.preventDefault()
    event.stopPropagation()
  }, [])

  return (
    <div
      data-ca-excalidraw-surface
      onContextMenu={handleContextMenu}
      onContextMenuCapture={handleContextMenu}
      onMouseDownCapture={handleMouseDownCapture}
      className={cn(
        'ca-excalidraw-block',
        isDarkMode ? 'ca-excalidraw-block--dark' : 'ca-excalidraw-block--light',
        className,
      )}
      style={style}
    >
      <Excalidraw
        initialData={{
          elements: scene.elements ?? [],
          appState,
          files: scene.files ?? {},
          scrollToContent: true,
        }}
        theme={canvasTheme}
        viewModeEnabled={readonly}
        zenModeEnabled
        gridModeEnabled={false}
        autoFocus={false}
        UIOptions={excalidrawCanvasUiOptions}
      />
    </div>
  )
}

export function MarkdownExcalidrawBlock({ code, className }: MarkdownExcalidrawBlockProps) {
  const spec = React.useMemo(() => parseSpec(code), [code])
  const [isFullscreenOpen, setIsFullscreenOpen] = React.useState(false)
  const isDarkMode = useDocumentDarkMode()

  const fallback = <CodeBlock code={code} language="json" mode="full" className={className} />

  if (!spec) return fallback

  const scene = spec.scene ?? spec
  const title = spec.title || 'Canvas'
  const readonly = spec.readonly ?? true
  const baseHeight = clampHeight(spec.height, 320)
  const canvasTheme = isDarkMode ? 'dark' : 'light'
  const sceneKey = React.useMemo(() => `${canvasTheme}:${hashString(code)}`, [canvasTheme, code])
  const sceneBackground = scene.appState?.viewBackgroundColor
  const appState = React.useMemo<Partial<AppState>>(() => ({
    ...scene.appState,
    theme: canvasTheme,
    gridModeEnabled: false,
    viewBackgroundColor: sceneBackground && sceneBackground !== '#ffffff'
      ? sceneBackground
      : 'transparent',
  }), [canvasTheme, isDarkMode, scene.appState, sceneBackground])

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

        <ExcalidrawCanvasSurface
          key={`inline:${sceneKey}`}
          scene={scene}
          appState={appState}
          canvasTheme={canvasTheme}
          readonly={readonly}
          isDarkMode={isDarkMode}
          style={{ height: baseHeight }}
        />
      </div>

      <FullscreenOverlayBase
        isOpen={isFullscreenOpen}
        onClose={() => setIsFullscreenOpen(false)}
        accessibleTitle={`${title} fullscreen preview`}
        title={title}
      >
        <div className="mx-auto h-[calc(100vh-96px)] w-[calc(100vw-48px)] overflow-hidden rounded-[8px] border border-border/50 bg-background shadow-minimal">
          <ExcalidrawCanvasSurface
            key={`fullscreen:${sceneKey}`}
            scene={scene}
            appState={appState}
            canvasTheme={canvasTheme}
            readonly={readonly}
            isDarkMode={isDarkMode}
            className="h-full w-full"
          />
        </div>
      </FullscreenOverlayBase>
    </ExcalidrawBlockErrorBoundary>
  )
}

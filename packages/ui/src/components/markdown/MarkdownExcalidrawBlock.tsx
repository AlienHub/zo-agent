/**
 * MarkdownExcalidrawBlock - Renders ```excalidraw code blocks by loading a
 * referenced .excalidraw FILE (not inline JSON).
 *
 * Expected block body (JSON):
 * {
 *   "src": "/absolute/path/to/diagram.excalidraw",
 *   "title": "Architecture",   // optional
 *   "height": 320,             // optional
 *   "readonly": true           // optional (default true)
 * }
 *
 * Inline canvas JSON (a body carrying `elements`/`scene` instead of `src`) is
 * intentionally rejected with a dedicated failure card — the canvas must be a
 * persisted .excalidraw file so it has a stable identity for editing, locking,
 * and comments.
 *
 * The .excalidraw file content is a standard Excalidraw scene
 * ({ type, version, source, elements, appState, files }). It is loaded via
 * `usePlatform().onReadFile` and rendered through the shared canvas components
 * (read-only inline; fullscreen Edit toggle + Island comments).
 */

import * as React from 'react'
import { Maximize2, PencilLine, Eye } from 'lucide-react'
import { cn } from '../../lib/utils'
import { CodeBlock } from './CodeBlock'
import { usePlatform } from '../../context/PlatformContext'
import { FullscreenOverlayBase } from '../overlay/FullscreenOverlayBase'
import {
  EditableExcalidrawCanvas,
  ExcalidrawBlockFailure,
  ExcalidrawCanvas,
  hashExcalidrawSceneKey,
  useDocumentDarkMode,
  type CanvasScene,
  type ExcalidrawFailureReason,
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

interface ExcalidrawFileSpec {
  src: string
  title?: string
  height?: number
  readonly?: boolean
}

type SpecResult =
  | { kind: 'file'; spec: ExcalidrawFileSpec }
  | { kind: 'inline' }
  | { kind: 'not-json' }

type SceneResult =
  | { kind: 'scene'; scene: ExcalidrawSceneData }
  | { kind: 'parse-error' }
  | { kind: 'invalid-scene' }

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
    console.warn('[MarkdownExcalidrawBlock] Render failed:', error)
  }
  render() {
    if (this.state.hasError) return this.props.fallback
    return this.props.children
  }
}

function parseSpec(code: string): SpecResult {
  let raw: unknown
  try {
    raw = JSON.parse(code)
  } catch {
    return { kind: 'not-json' }
  }
  if (raw && typeof raw === 'object' && typeof (raw as ExcalidrawFileSpec).src === 'string' && (raw as ExcalidrawFileSpec).src) {
    return { kind: 'file', spec: raw as ExcalidrawFileSpec }
  }
  // Valid JSON, but no file reference → inline canvas, which is unsupported.
  return { kind: 'inline' }
}

function parseScene(content: string): SceneResult {
  let raw: { scene?: ExcalidrawSceneData } & ExcalidrawSceneData
  try {
    raw = JSON.parse(content)
  } catch {
    return { kind: 'parse-error' }
  }
  const scene = raw?.scene ?? raw
  if (!scene || !Array.isArray(scene.elements)) return { kind: 'invalid-scene' }
  return { kind: 'scene', scene }
}

function clampHeight(value: unknown, fallback: number) {
  return Math.min(Math.max(typeof value === 'number' ? value : fallback, 220), 720)
}

export function serializeExcalidrawSceneForFile(scene: CanvasScene): string {
  return JSON.stringify({
    type: 'excalidraw',
    version: scene.version ?? 2,
    source: scene.source ?? 'agent',
    elements: scene.elements ?? [],
    appState: scene.appState ?? {},
    files: scene.files ?? {},
  }, null, 2)
}

export function MarkdownExcalidrawBlock({ code, className }: MarkdownExcalidrawBlockProps) {
  const { onReadFile, onWriteFile, onResourceUpdated } = usePlatform()
  const isDarkMode = useDocumentDarkMode()
  const [isFullscreenOpen, setIsFullscreenOpen] = React.useState(false)
  const [fullscreenMode, setFullscreenMode] = React.useState<'view' | 'edit'>('view')
  const [content, setContent] = React.useState<string | null>(null)
  const [loading, setLoading] = React.useState(false)
  const [loadError, setLoadError] = React.useState<string | null>(null)
  const [reloadNonce, setReloadNonce] = React.useState(0)
  const suppressedResourceUpdatesRef = React.useRef(0)
  const suppressResetTimerRef = React.useRef<number | null>(null)
  const latestSerializedSceneRef = React.useRef<string | null>(null)
  const lastPersistedSerializedSceneRef = React.useRef<string | null>(null)
  const isFullscreenOpenRef = React.useRef(false)
  const saveSequenceRef = React.useRef(0)
  const saveChainRef = React.useRef<Promise<unknown>>(Promise.resolve())

  const specResult = React.useMemo(() => parseSpec(code), [code])
  const src = specResult.kind === 'file' ? specResult.spec.src : undefined

  // Fullscreen opens read-only every time; the user clicks Edit to edit.
  React.useEffect(() => {
    isFullscreenOpenRef.current = isFullscreenOpen
    if (!isFullscreenOpen) setFullscreenMode('view')
  }, [isFullscreenOpen])

  // Load the referenced .excalidraw file.
  React.useEffect(() => {
    if (!src || !onReadFile) return
    let cancelled = false
    setLoading(true)
    setLoadError(null)
    onReadFile(src)
      .then(next => { if (!cancelled) setContent(next) })
      .catch((err: unknown) => { if (!cancelled) setLoadError(err instanceof Error ? err.message : 'Failed to read the canvas file') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [src, onReadFile, reloadNonce])

  // Reload when the file changes on disk (e.g. agent updated it).
  React.useEffect(() => {
    if (!src || !onResourceUpdated) return
    return onResourceUpdated(src, () => {
      if (suppressedResourceUpdatesRef.current > 0) {
        suppressedResourceUpdatesRef.current -= 1
        if (suppressedResourceUpdatesRef.current === 0 && suppressResetTimerRef.current) {
          window.clearTimeout(suppressResetTimerRef.current)
          suppressResetTimerRef.current = null
        }
        return
      }
      setReloadNonce(previous => previous + 1)
    })
  }, [src, onResourceUpdated])

  React.useEffect(() => () => {
    if (suppressResetTimerRef.current) {
      window.clearTimeout(suppressResetTimerRef.current)
      suppressResetTimerRef.current = null
    }
  }, [])

  React.useEffect(() => {
    if (isFullscreenOpen) return
    if (lastPersistedSerializedSceneRef.current == null) return
    const persisted = lastPersistedSerializedSceneRef.current
    setContent(persisted)
    lastPersistedSerializedSceneRef.current = null
    if (latestSerializedSceneRef.current === persisted) {
      latestSerializedSceneRef.current = null
    }
  }, [isFullscreenOpen])

  const reload = React.useCallback(() => {
    setContent(null)
    setLoadError(null)
    setReloadNonce(previous => previous + 1)
  }, [])

  const handleFullscreenSceneChange = React.useCallback((nextScene: CanvasScene) => {
    if (!src || !onWriteFile) return
    const serialized = serializeExcalidrawSceneForFile(nextScene)
    latestSerializedSceneRef.current = serialized
    suppressedResourceUpdatesRef.current += 1
    if (suppressResetTimerRef.current) {
      window.clearTimeout(suppressResetTimerRef.current)
    }
    suppressResetTimerRef.current = window.setTimeout(() => {
      suppressedResourceUpdatesRef.current = 0
      suppressResetTimerRef.current = null
    }, 1000)

    const saveSequence = saveSequenceRef.current + 1
    saveSequenceRef.current = saveSequence
    const writePromise = saveChainRef.current
      .catch(() => undefined)
      .then(() => onWriteFile(src, serialized))
    saveChainRef.current = writePromise.catch(() => undefined)
    void writePromise.then(() => {
      if (latestSerializedSceneRef.current !== serialized) return
      lastPersistedSerializedSceneRef.current = serialized
      if (!isFullscreenOpenRef.current) {
        setContent(serialized)
        latestSerializedSceneRef.current = null
        lastPersistedSerializedSceneRef.current = null
      }
    }).catch((err: unknown) => {
      if (saveSequence !== saveSequenceRef.current) return
      suppressedResourceUpdatesRef.current = 0
      if (suppressResetTimerRef.current) {
        window.clearTimeout(suppressResetTimerRef.current)
        suppressResetTimerRef.current = null
      }
      console.warn('[MarkdownExcalidrawBlock] Save failed:', err)
    })
  }, [src, onWriteFile])

  const sceneResult = React.useMemo<SceneResult | null>(
    () => (content != null ? parseScene(content) : null),
    [content],
  )
  const scene = sceneResult?.kind === 'scene' ? sceneResult.scene : null

  const canvasTheme = isDarkMode ? 'dark' : 'light'
  const sceneBackground = scene?.appState?.viewBackgroundColor
  const sceneKey = React.useMemo(
    () => `markdown:${hashExcalidrawSceneKey(`${src ?? ''}:${reloadNonce}:${content ?? ''}`)}`,
    [src, reloadNonce, content],
  )
  const appState = React.useMemo<Partial<AppState>>(() => ({
    ...scene?.appState,
    theme: canvasTheme,
    gridModeEnabled: false,
    viewBackgroundColor: sceneBackground && sceneBackground !== '#ffffff' ? sceneBackground : 'transparent',
  }), [canvasTheme, scene?.appState, sceneBackground])

  // --- Non-canvas render branches -------------------------------------------
  if (specResult.kind === 'not-json') {
    // Not even a JSON spec — leave the raw fence as a code block.
    return <CodeBlock code={code} language="json" mode="full" className={className} />
  }

  const failureHeight = clampHeight(specResult.kind === 'file' ? specResult.spec.height : undefined, 320)
  const renderFailure = (reason: ExcalidrawFailureReason, detail?: string, withReload = true) => (
    <ExcalidrawBlockFailure
      reason={reason}
      detail={detail}
      onReload={withReload ? reload : undefined}
      className={className}
      style={{ minHeight: failureHeight }}
    />
  )

  if (specResult.kind === 'inline') {
    return renderFailure('inline-not-supported', undefined, false)
  }
  if (!onReadFile) {
    return renderFailure('file-read-error', 'Canvas loading is unavailable in this view.')
  }
  if (loadError) {
    return renderFailure('file-read-error', loadError)
  }
  if (content == null) {
    return (
      <div
        className={cn('flex items-center justify-center rounded-[8px] border border-border/60 bg-background text-sm text-muted-foreground shadow-minimal', className)}
        style={{ minHeight: failureHeight }}
      >
        {loading ? 'Loading canvas…' : ''}
      </div>
    )
  }
  if (!scene || sceneResult?.kind !== 'scene') {
    return renderFailure(sceneResult?.kind === 'parse-error' ? 'parse-error' : 'invalid-scene')
  }

  // --- Canvas render --------------------------------------------------------
  const { spec } = specResult
  const title = spec.title || 'Canvas'
  const readonly = spec.readonly ?? true
  const baseHeight = clampHeight(spec.height, 320)
  const canEdit = !readonly && Boolean(src && onWriteFile)

  const fullscreenScene: CanvasScene = {
    type: 'excalidraw',
    version: scene.version ?? 2,
    source: scene.source ?? 'agent',
    elements: scene.elements ?? [],
    appState,
    files: scene.files ?? {},
  }

  return (
    <ExcalidrawBlockErrorBoundary fallback={renderFailure('render-error')}>
      <div className={cn('relative group overflow-hidden rounded-[8px] border border-border/50 bg-background shadow-minimal', className)}>
        <button
          onClick={() => setIsFullscreenOpen(true)}
          className={cn(
            'absolute right-2 top-2 z-10 p-1.5 rounded-[6px] transition-all select-none',
            'bg-background/80 shadow-minimal backdrop-blur-sm',
            'text-muted-foreground/50 hover:text-foreground',
            'focus:outline-none focus-visible:ring-1 focus-visible:ring-ring focus-visible:opacity-100',
            'opacity-0 group-hover:opacity-100',
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
          {canEdit && (
            <button
              onClick={() => setFullscreenMode(current => (current === 'edit' ? 'view' : 'edit'))}
              className={cn(
                'absolute right-2 top-2 z-10 inline-flex items-center gap-1 rounded-[6px] px-2 py-1 text-xs font-medium transition-all select-none',
                'bg-background/80 shadow-minimal backdrop-blur-sm',
                fullscreenMode === 'edit' ? 'text-foreground' : 'text-muted-foreground hover:text-foreground',
                'focus:outline-none focus-visible:ring-1 focus-visible:ring-ring',
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
            mode={canEdit ? fullscreenMode : 'view'}
            onChange={handleFullscreenSceneChange}
            className="h-full w-full"
          />
        </div>
      </FullscreenOverlayBase>
    </ExcalidrawBlockErrorBoundary>
  )
}

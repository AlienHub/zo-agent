import * as React from 'react'
import './excalidraw-assets'
import { Excalidraw } from '@excalidraw/excalidraw'
import '@excalidraw/excalidraw/index.css'
import './ExcalidrawCanvas.css'
import { cn } from '../../lib/utils'
import { applyGraphiteTheme, hasGraphiteElements } from './graphiteStyle'
import { ZoomControls } from '../overlay/ZoomControls'
import { RICH_BLOCK_DEFAULTS } from '../overlay/rich-block-interaction-spec'
import { clampScale, zoomStepScale } from '../overlay/useRichBlockInteractions'
import type { ExcalidrawElement } from '@excalidraw/excalidraw/element/types'
import type { AppState, BinaryFiles, ExcalidrawImperativeAPI, UIOptions } from '@excalidraw/excalidraw/types'

export interface ExcalidrawSceneData {
  type?: 'excalidraw'
  version?: number
  source?: string
  elements?: readonly ExcalidrawElement[]
  appState?: Partial<AppState>
  files?: BinaryFiles
}

export interface ExcalidrawCanvasProps {
  scene: ExcalidrawSceneData
  appState?: Partial<AppState>
  sceneKey?: string
  className?: string
  style?: React.CSSProperties
  viewModeEnabled?: boolean
  autoFocus?: boolean
  excalidrawAPI?: (api: ExcalidrawImperativeAPI) => void
  onChange?: (
    elements: readonly ExcalidrawElement[],
    appState: AppState,
    files: BinaryFiles,
  ) => void
  children?: React.ReactNode
}

export const canvasUiOptions: Partial<UIOptions> = {
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

export function useDocumentDarkMode() {
  const [isDarkMode, setIsDarkMode] = React.useState(() => (
    typeof document !== 'undefined' && document.documentElement.classList.contains('dark')
  ))

  React.useEffect(() => {
    if (typeof document === 'undefined') return

    const update = () => setIsDarkMode(document.documentElement.classList.contains('dark'))
    update()

    const observer = new MutationObserver(update)
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
    return () => observer.disconnect()
  }, [])

  return isDarkMode
}

export function hashExcalidrawSceneKey(value: string) {
  let hash = 0
  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash << 5) - hash + value.charCodeAt(index)) | 0
  }
  return hash.toString(36)
}

export function ExcalidrawCanvas({
  scene,
  appState,
  sceneKey,
  className,
  style,
  viewModeEnabled = true,
  autoFocus = false,
  excalidrawAPI,
  onChange,
  children,
}: ExcalidrawCanvasProps) {
  const isDarkMode = useDocumentDarkMode()
  const canvasTheme = isDarkMode ? 'dark' : 'light'

  // Graphite scenes carry semantic tags so the display can re-derive colors for
  // the active mode (Graphite's "derive, don't store" principle). On disk the
  // scene is baked light; in read mode we recolor to the active mode and pin
  // Excalidraw's theme to `light` to disable its global invert filter — the
  // hand-tuned dark palette then renders as authored. Edit mode passes through
  // the canonical light colors untouched so saves stay mode-agnostic.
  const sourceElements = scene.elements ?? []
  const isGraphiteView = viewModeEnabled && hasGraphiteElements(sourceElements)
  const themedElements = React.useMemo(
    () => (isGraphiteView ? applyGraphiteTheme(sourceElements, isDarkMode ? 'dark' : 'light') : sourceElements),
    [isGraphiteView, sourceElements, isDarkMode],
  )
  const excalidrawTheme = isGraphiteView ? 'light' : canvasTheme

  const sceneBackground = appState?.viewBackgroundColor ?? scene.appState?.viewBackgroundColor
  const mergedAppState = React.useMemo<Partial<AppState>>(() => ({
    ...scene.appState,
    ...appState,
    theme: excalidrawTheme,
    gridModeEnabled: false,
    viewBackgroundColor: sceneBackground && sceneBackground !== '#ffffff'
      ? sceneBackground
      : 'transparent',
  }), [appState, excalidrawTheme, scene.appState, sceneBackground])

  const initialData = React.useMemo(() => ({
    elements: themedElements,
    appState: mergedAppState,
    files: scene.files ?? {},
    scrollToContent: true,
  }), [mergedAppState, themedElements, scene.files])

  const handleContextMenu = React.useCallback((event: React.MouseEvent) => {
    event.preventDefault()
    event.stopPropagation()
  }, [])

  const handleMouseDownCapture = React.useCallback((event: React.MouseEvent) => {
    if (event.button !== 2) return
    event.preventDefault()
    event.stopPropagation()
  }, [])

  // Read-mode canvases mount inside containers that often settle their size
  // after first paint (TurnCard expand, panel resize, fonts). Excalidraw then
  // renders its bitmap at the wrong size — blurry until a click forces a
  // redraw — and the diagram isn't zoomed to fit. refresh() re-syncs the canvas
  // dimensions (sharp), and scrollToContent({ fitToContent }) zooms it to fit.
  // We only do this in view mode so it never fights an editing session.
  const containerRef = React.useRef<HTMLDivElement>(null)
  const apiRef = React.useRef<ExcalidrawImperativeAPI | null>(null)
  const [scale, setScale] = React.useState(1)

  const syncScale = React.useCallback(() => {
    const value = apiRef.current?.getAppState().zoom.value
    if (typeof value === 'number') setScale(value)
  }, [])

  const fitToView = React.useCallback(() => {
    const api = apiRef.current
    if (!api) return
    api.refresh()
    const elements = api.getSceneElements()
    if (elements.length === 0) return
    api.scrollToContent(elements, { fitToContent: true, maxZoom: 1, animate: false })
    syncScale()
  }, [syncScale])

  // Hover zoom controls drive Excalidraw's own zoom (never CSS scale — that
  // would blur the canvas), keeping the focal point at the viewport center.
  const applyZoom = React.useCallback((nextZoom: number) => {
    const api = apiRef.current
    if (!api) return
    const state = api.getAppState()
    const current = state.zoom.value
    const target = clampScale(nextZoom, RICH_BLOCK_DEFAULTS.minScale, RICH_BLOCK_DEFAULTS.maxScale)
    if (Math.abs(target - current) < 1e-3) return
    const rect = containerRef.current?.getBoundingClientRect()
    const width = rect?.width ?? 0
    const height = rect?.height ?? 0
    const recenter = (scroll: number, extent: number) => scroll + (extent / 2) * (1 / target - 1 / current)
    api.updateScene({
      appState: {
        zoom: { value: target as AppState['zoom']['value'] },
        scrollX: recenter(state.scrollX, width),
        scrollY: recenter(state.scrollY, height),
      },
    })
    setScale(target)
  }, [])

  const stepZoom = React.useCallback((direction: 'in' | 'out') => {
    const current = apiRef.current?.getAppState().zoom.value ?? scale
    applyZoom(zoomStepScale(current, direction, RICH_BLOCK_DEFAULTS.zoomStepFactor, RICH_BLOCK_DEFAULTS.minScale, RICH_BLOCK_DEFAULTS.maxScale))
  }, [applyZoom, scale])

  const handleAPI = React.useCallback((api: ExcalidrawImperativeAPI) => {
    apiRef.current = api
    excalidrawAPI?.(api)
    syncScale()
    if (viewModeEnabled) {
      // Two frames so layout + initial scene render have settled first.
      requestAnimationFrame(() => requestAnimationFrame(fitToView))
    }
  }, [excalidrawAPI, fitToView, syncScale, viewModeEnabled])

  const handleChange = React.useCallback((
    elements: readonly ExcalidrawElement[],
    nextAppState: AppState,
    files: BinaryFiles,
  ) => {
    setScale(nextAppState.zoom.value)
    onChange?.(elements, nextAppState, files)
  }, [onChange])

  React.useEffect(() => {
    if (!viewModeEnabled) return
    const node = containerRef.current
    if (!node || typeof ResizeObserver === 'undefined') return
    let raf = 0
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(fitToView)
    })
    observer.observe(node)
    return () => {
      cancelAnimationFrame(raf)
      observer.disconnect()
    }
  }, [fitToView, viewModeEnabled])

  return (
    <div
      ref={containerRef}
      data-ca-excalidraw-surface
      onContextMenu={handleContextMenu}
      onContextMenuCapture={handleContextMenu}
      onMouseDownCapture={handleMouseDownCapture}
      className={cn(
        'ca-excalidraw-canvas group',
        isDarkMode && 'ca-excalidraw-canvas--dark',
        className,
      )}
      style={style}
    >
      <Excalidraw
        key={`${sceneKey ?? 'scene'}:${isGraphiteView ? `graphite-${canvasTheme}` : canvasTheme}`}
        excalidrawAPI={handleAPI}
        initialData={initialData}
        theme={excalidrawTheme}
        viewModeEnabled={viewModeEnabled}
        zenModeEnabled
        gridModeEnabled={false}
        autoFocus={autoFocus}
        UIOptions={canvasUiOptions}
        onChange={handleChange}
      />
      {children}
      {/* Zoom controls reveal on hover; they drive Excalidraw's own zoom. */}
      <div
        className={cn(
          'pointer-events-none absolute right-2 top-2 opacity-0 transition-opacity duration-150',
          'group-hover:pointer-events-auto group-hover:opacity-100',
          'focus-within:pointer-events-auto focus-within:opacity-100',
        )}
        style={{ zIndex: 'var(--z-floating-menu, 400)' }}
      >
        <ZoomControls
          scale={scale}
          minScale={RICH_BLOCK_DEFAULTS.minScale}
          maxScale={RICH_BLOCK_DEFAULTS.maxScale}
          zoomPresets={RICH_BLOCK_DEFAULTS.zoomPresets}
          onZoomIn={() => stepZoom('in')}
          onZoomOut={() => stepZoom('out')}
          onZoomToPreset={(preset) => applyZoom(preset / 100)}
          onZoomToFit={fitToView}
          onReset={() => applyZoom(1)}
          resetDisabled={Math.abs(scale - 1) < 0.005}
        />
      </div>
    </div>
  )
}

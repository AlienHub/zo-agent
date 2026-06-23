import * as React from 'react'
import './excalidraw-assets'
import { Excalidraw } from '@excalidraw/excalidraw'
import '@excalidraw/excalidraw/index.css'
import './ExcalidrawCanvas.css'
import { cn } from '../../lib/utils'
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
  const sceneBackground = appState?.viewBackgroundColor ?? scene.appState?.viewBackgroundColor
  const mergedAppState = React.useMemo<Partial<AppState>>(() => ({
    ...scene.appState,
    ...appState,
    theme: canvasTheme,
    gridModeEnabled: false,
    viewBackgroundColor: sceneBackground && sceneBackground !== '#ffffff'
      ? sceneBackground
      : 'transparent',
  }), [appState, canvasTheme, scene.appState, sceneBackground])

  const initialData = React.useMemo(() => ({
    elements: scene.elements ?? [],
    appState: mergedAppState,
    files: scene.files ?? {},
    scrollToContent: true,
  }), [mergedAppState, scene.elements, scene.files])

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
        'ca-excalidraw-canvas',
        isDarkMode && 'ca-excalidraw-canvas--dark',
        className,
      )}
      style={style}
    >
      <Excalidraw
        key={`${sceneKey ?? 'scene'}:${canvasTheme}`}
        excalidrawAPI={excalidrawAPI}
        initialData={initialData}
        theme={canvasTheme}
        viewModeEnabled={viewModeEnabled}
        zenModeEnabled
        gridModeEnabled={false}
        autoFocus={autoFocus}
        UIOptions={canvasUiOptions}
        onChange={onChange}
      />
      {children}
    </div>
  )
}

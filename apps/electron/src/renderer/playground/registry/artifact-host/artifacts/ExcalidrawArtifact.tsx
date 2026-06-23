import * as React from 'react'
import {
  EditableExcalidrawCanvas,
  hashExcalidrawSceneKey,
  type CanvasScene,
} from '@craft-agent/ui/excalidraw'
import type { ArtifactRenderProps } from '../types'
import { canvasSeedScenes } from '../seedScenes'

function parseCanvasContent(content: string): CanvasScene {
  try {
    const parsed = JSON.parse(content) as Partial<CanvasScene>
    if (Array.isArray(parsed.elements)) {
      return {
        type: 'excalidraw',
        version: parsed.version ?? 2,
        source: parsed.source ?? 'craft-agent-playground',
        elements: parsed.elements,
        appState: parsed.appState ?? {},
        files: parsed.files ?? {},
      }
    }
  } catch {
    // Fall through to the default seed.
  }

  return JSON.parse(canvasSeedScenes['product-map']) as CanvasScene
}

function serializeCanvasScene(scene: CanvasScene) {
  return JSON.stringify({
    type: 'excalidraw',
    version: 2,
    source: 'craft-agent-playground',
    elements: scene.elements,
    appState: {
      ...scene.appState,
      gridModeEnabled: false,
      viewBackgroundColor: scene.appState.viewBackgroundColor ?? 'transparent',
    },
    files: scene.files,
  })
}

/**
 * Canvas artifact adapter: maps the host's string content <-> Excalidraw scene
 * and delegates all rendering/editing to the shared EditableExcalidrawCanvas.
 * Read/edit is driven by the host viewMode; Comment lives in view mode only.
 */
export function ExcalidrawArtifact({
  content,
  editable,
  viewMode,
  annotationSurface,
  onChange,
}: ArtifactRenderProps) {
  const lastEmittedContentRef = React.useRef<string | null>(null)
  const [seed, setSeed] = React.useState(() => ({
    scene: parseCanvasContent(content),
    key: hashExcalidrawSceneKey(content),
  }))

  React.useEffect(() => {
    if (content === lastEmittedContentRef.current) return
    setSeed({ scene: parseCanvasContent(content), key: hashExcalidrawSceneKey(content) })
  }, [content])

  const handleChange = React.useCallback((scene: CanvasScene) => {
    const serialized = serializeCanvasScene(scene)
    lastEmittedContentRef.current = serialized
    onChange(serialized)
  }, [onChange])

  const mode = editable && viewMode === 'edit' ? 'edit' : 'view'

  return (
    <EditableExcalidrawCanvas
      scene={seed.scene}
      sceneKey={seed.key}
      mode={mode}
      onChange={handleChange}
      annotationSurface={annotationSurface}
      className="rounded-[8px] border border-border/60 bg-background shadow-minimal"
    />
  )
}

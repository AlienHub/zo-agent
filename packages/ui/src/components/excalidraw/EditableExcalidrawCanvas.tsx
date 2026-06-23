/**
 * EditableExcalidrawCanvas - the shared canvas editing surface.
 *
 * One source of truth for canvas capabilities, used by the Artifact host and by
 * the fullscreen chat canvas. Mode-driven affordances:
 *   - view: read-only canvas. A transparent comment-hotspot overlay sits over
 *     each node; clicking one opens the product annotation Island above it (the
 *     same Island the markdown surface uses). Excalidraw's view mode disables
 *     element selection, so comment targeting goes through this overlay rather
 *     than Excalidraw selection.
 *   - edit: Connect / Delete toolbar on the natively-selected node. The Island
 *     is intentionally absent: deleting a node would orphan its comment.
 *
 * The component owns the live Excalidraw state and reseeds atomically when
 * `sceneKey` changes; the caller keeps `sceneKey` stable across its own echoes.
 */
import * as React from 'react'
import { GitBranch, Trash2 } from 'lucide-react'
import { CaptureUpdateAction } from '@excalidraw/excalidraw'
import { cn } from '../../lib/utils'
import { ExcalidrawCanvas } from './ExcalidrawCanvas'
import {
  NODE_ACTION_EDGE_INSET,
  NODE_ACTION_GAP,
  PRODUCT_CANVAS_CONNECTION_STYLE,
  type CanvasScene,
  type NodeHotspot,
  createUserConnectionElement,
  getNodeHotspots,
  getSceneAppState,
  getSelectedElements,
  getSelectionOverlay,
  isLinearElement,
  normalizeProductLineElements,
} from './canvasScene'
import { AnnotationIslandMenu } from '../annotations/AnnotationIslandMenu'
import { useAnnotationInteractionController } from '../annotations/use-annotation-interaction-controller'
import { useAnnotationIslandPresentation } from '../annotations/use-annotation-island-presentation'
import { getAnnotationInteractionAnchor, getAnnotationInteractionSourceKey } from '../annotations/interaction-selectors'
import { buildAnnotationChipEntryTransition } from '../annotations/island-motion'
import type { AnnotationV1 } from '@craft-agent/core'
import type { AppState, BinaryFiles, ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types'
import type { ExcalidrawElement } from '@excalidraw/excalidraw/element/types'

const CHANGE_FLUSH_DELAY_MS = 120

function ToolbarButton({
  title,
  ariaLabel,
  onClick,
  destructive,
  children,
}: {
  title: string
  ariaLabel: string
  onClick: () => void
  destructive?: boolean
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={ariaLabel}
      onClick={onClick}
      className={cn(
        'inline-flex size-8 items-center justify-center rounded-[6px] transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-ring',
        destructive
          ? 'text-destructive hover:bg-destructive/10'
          : 'text-muted-foreground hover:bg-foreground/5 hover:text-foreground',
      )}
    >
      {children}
    </button>
  )
}

export interface CanvasAnnotationSurface {
  enabled: boolean
  sessionId: string
  messageId: string
  annotations: AnnotationV1[]
  onAddAnnotation(messageId: string, annotation: AnnotationV1): void | Promise<void>
  onRemoveAnnotation(messageId: string, annotationId: string): void | Promise<void>
  onUpdateAnnotation?(messageId: string, annotationId: string, patch: Partial<AnnotationV1>): void | Promise<void>
  onSaveAndSendFollowUp(target: {
    messageId: string
    annotationId: string
    note: string
    selectedText: string
  }): void
}

export interface EditableExcalidrawCanvasProps {
  scene: CanvasScene
  sceneKey: string
  mode: 'view' | 'edit'
  onChange?: (scene: CanvasScene) => void
  annotationSurface?: CanvasAnnotationSurface
  className?: string
}

type FollowUpTarget = { messageId: string; annotationId: string; note: string; selectedText: string }

function getAnnotationNoteText(annotation: AnnotationV1) {
  const note = annotation.body.find((body): body is Extract<AnnotationV1['body'][number], { type: 'note' }> => body.type === 'note')
  return note?.text ?? ''
}

function getAnnotationPreview(annotation: AnnotationV1) {
  const preview = annotation.meta?.preview
  return typeof preview === 'string' ? preview : 'Canvas node'
}

function getCanvasElementId(annotation: AnnotationV1) {
  const selector = annotation.target.selectors.find(
    (candidate): candidate is Extract<AnnotationV1['target']['selectors'][number], { type: 'canvas-element' }> => (
      candidate.type === 'canvas-element'
    ),
  )
  return selector?.elementId
}

function createCanvasAnnotation({
  surface,
  elementId,
  preview,
  note,
}: {
  surface: CanvasAnnotationSurface
  elementId: string
  preview: string
  note: string
}): AnnotationV1 {
  const now = Date.now()
  return {
    id: `canvas-annotation-${elementId}-${now}`,
    schemaVersion: 1,
    createdAt: now,
    updatedAt: now,
    body: [
      {
        type: 'note',
        text: note,
        format: 'plain',
      },
    ],
    intent: 'comment',
    target: {
      source: {
        sessionId: surface.sessionId,
        messageId: surface.messageId,
      },
      selectors: [
        {
          type: 'canvas-element',
          elementId,
        },
      ],
    },
    meta: {
      elementId,
      preview,
    },
  }
}

export function EditableExcalidrawCanvas({
  scene,
  sceneKey,
  mode,
  onChange,
  annotationSurface,
  className,
}: EditableExcalidrawCanvasProps) {
  const editable = mode === 'edit'
  const annotationsEnabled = mode === 'view' && Boolean(annotationSurface?.enabled)
  const containerRef = React.useRef<HTMLDivElement | null>(null)
  const toolbarRef = React.useRef<HTMLDivElement | null>(null)
  const apiRef = React.useRef<ExcalidrawImperativeAPI | null>(null)
  const pendingSceneRef = React.useRef<{
    elements: readonly ExcalidrawElement[]
    appState: Partial<AppState>
    files: BinaryFiles
  } | null>(null)
  const flushTimerRef = React.useRef<number | null>(null)

  const [seed, setSeed] = React.useState(() => ({ scene, key: sceneKey }))
  const [elements, setElements] = React.useState<readonly ExcalidrawElement[]>(scene.elements)
  const [appState, setAppState] = React.useState<Partial<AppState>>(scene.appState)
  const [files, setFiles] = React.useState<BinaryFiles>(scene.files)
  const [toolbarSize, setToolbarSize] = React.useState({ width: 0, height: 0 })
  const [pendingConnectionSourceId, setPendingConnectionSourceId] = React.useState<string | null>(null)
  const pendingConnectionSourceIdRef = React.useRef<string | null>(null)
  const [commentTarget, setCommentTarget] = React.useState<{ elementId: string; label: string } | null>(null)

  const selectionOverlay = React.useMemo(() => getSelectionOverlay(elements, appState), [appState, elements])

  const annotationsByElement = React.useMemo(() => {
    const map = new Map<string, AnnotationV1[]>()
    if (!annotationSurface) return map
    for (const annotation of annotationSurface.annotations) {
      const elementId = getCanvasElementId(annotation)
      if (!elementId) continue
      const list = map.get(elementId) ?? []
      list.push(annotation)
      map.set(elementId, list)
    }
    return map
  }, [annotationSurface])

  const hotspots = React.useMemo(
    () => (annotationsEnabled ? getNodeHotspots(elements, appState) : []),
    [annotationsEnabled, elements, appState],
  )

  // --- Product annotation Island (shared with the markdown surface) ---------
  const {
    state: islandState,
    setDraft,
    openFromSelection,
    openFollowUpFromSelection,
    openFromAnnotation,
    requestEdit,
    cancelFollowUp,
    closeAll,
    markSubmitSuccess,
    markDeleteSuccess,
  } = useAnnotationInteractionController()
  const [islandNonce, setIslandNonce] = React.useState(0)
  const [islandTransition] = React.useState(() => buildAnnotationChipEntryTransition())
  const islandAnchor = getAnnotationInteractionAnchor(islandState)
  const islandSourceKey = getAnnotationInteractionSourceKey(islandState, annotationSurface?.messageId)
  const islandPresentation = useAnnotationIslandPresentation({ anchor: islandAnchor, sourceKey: islandSourceKey })

  const setPendingConnectionSource = React.useCallback((sourceId: string | null) => {
    pendingConnectionSourceIdRef.current = sourceId
    setPendingConnectionSourceId(sourceId)
  }, [])

  const closeIsland = React.useCallback(() => {
    setCommentTarget(null)
    closeAll()
  }, [closeAll])

  const flushChange = React.useCallback(() => {
    const pending = pendingSceneRef.current
    if (!pending) return
    pendingSceneRef.current = null
    onChange?.({
      ...seed.scene,
      elements: pending.elements,
      appState: pending.appState,
      files: pending.files,
    })
  }, [onChange, seed.scene])

  const scheduleChange = React.useCallback((
    nextElements: readonly ExcalidrawElement[],
    nextAppState: Partial<AppState>,
    nextFiles: BinaryFiles,
  ) => {
    pendingSceneRef.current = { elements: nextElements, appState: nextAppState, files: nextFiles }
    if (flushTimerRef.current) return
    flushTimerRef.current = window.setTimeout(() => {
      flushTimerRef.current = null
      flushChange()
    }, CHANGE_FLUSH_DELAY_MS)
  }, [flushChange])

  // Reseed atomically when the scene identity changes (caller keeps key stable
  // across its own echoes so live edits are not clobbered).
  React.useEffect(() => {
    if (seed.key === sceneKey) return
    setSeed({ scene, key: sceneKey })
    setElements(scene.elements)
    setAppState(scene.appState)
    setFiles(scene.files)
    setPendingConnectionSource(null)
    closeIsland()
  }, [scene, sceneKey, seed.key, setPendingConnectionSource, closeIsland])

  // Close the Island when annotations are not available (e.g. switching to edit).
  React.useEffect(() => {
    if (!annotationsEnabled) closeIsland()
  }, [annotationsEnabled, closeIsland])

  React.useEffect(() => () => {
    if (flushTimerRef.current) {
      window.clearTimeout(flushTimerRef.current)
      flushTimerRef.current = null
      flushChange()
    }
  }, [flushChange])

  React.useLayoutEffect(() => {
    if (!toolbarRef.current || !selectionOverlay) return
    const rect = toolbarRef.current.getBoundingClientRect()
    setToolbarSize(current => (
      current.width === rect.width && current.height === rect.height
        ? current
        : { width: rect.width, height: rect.height }
    ))
  }, [selectionOverlay, editable])

  const handleHotspotClick = React.useCallback((hotspot: NodeHotspot) => {
    const container = containerRef.current
    if (!container) return
    const rect = container.getBoundingClientRect()
    const anchorX = rect.left + hotspot.left + hotspot.width / 2
    const anchorY = rect.top + hotspot.top
    setIslandNonce(previous => previous + 1)
    setCommentTarget({ elementId: hotspot.elementId, label: hotspot.label })

    const existing = annotationsByElement.get(hotspot.elementId)?.[0]
    if (existing) {
      openFromAnnotation(
        { annotationId: existing.id, index: 1, anchorX, anchorY },
        getAnnotationNoteText(existing),
        'view',
      )
    } else {
      openFromSelection({ anchorX, anchorY, start: 0, end: 0, selectedText: hotspot.label, prefix: '', suffix: '' })
    }
  }, [annotationsByElement, openFromAnnotation, openFromSelection])

  const saveCanvasFollowUp = React.useCallback((note: string): FollowUpTarget | null => {
    if (!annotationSurface?.enabled) return null
    const trimmed = note.trim()
    const { activeAnnotationDetail, pendingSelection } = islandState

    if (activeAnnotationDetail) {
      annotationSurface.onUpdateAnnotation?.(annotationSurface.messageId, activeAnnotationDetail.annotationId, {
        body: [{ type: 'note', text: trimmed, format: 'plain' }],
        updatedAt: Date.now(),
      })
      markSubmitSuccess()
      if (!trimmed) return null
      const existing = annotationSurface.annotations.find(annotation => annotation.id === activeAnnotationDetail.annotationId)
      return {
        messageId: annotationSurface.messageId,
        annotationId: activeAnnotationDetail.annotationId,
        note: trimmed,
        selectedText: existing ? getAnnotationPreview(existing) : 'Canvas node',
      }
    }

    if (pendingSelection && commentTarget) {
      const annotation = createCanvasAnnotation({
        surface: annotationSurface,
        elementId: commentTarget.elementId,
        preview: commentTarget.label,
        note: trimmed,
      })
      annotationSurface.onAddAnnotation(annotationSurface.messageId, annotation)
      markSubmitSuccess()
      if (!trimmed) return null
      return {
        messageId: annotationSurface.messageId,
        annotationId: annotation.id,
        note: trimmed,
        selectedText: commentTarget.label,
      }
    }

    closeIsland()
    return null
  }, [annotationSurface, islandState, commentTarget, markSubmitSuccess, closeIsland])

  const handleIslandCancel = React.useCallback(() => {
    setCommentTarget(null)
    cancelFollowUp()
  }, [cancelFollowUp])

  const handleIslandSubmit = React.useCallback((note: string) => {
    saveCanvasFollowUp(note)
    setCommentTarget(null)
  }, [saveCanvasFollowUp])

  const handleIslandSubmitAndSend = React.useCallback((note: string) => {
    const saved = saveCanvasFollowUp(note)
    if (saved) annotationSurface?.onSaveAndSendFollowUp(saved)
    setCommentTarget(null)
  }, [saveCanvasFollowUp, annotationSurface])

  const handleIslandDelete = React.useCallback(() => {
    const detail = islandState.activeAnnotationDetail
    if (annotationSurface?.enabled && detail) {
      annotationSurface.onRemoveAnnotation(annotationSurface.messageId, detail.annotationId)
      markDeleteSuccess()
    }
    setCommentTarget(null)
  }, [annotationSurface, islandState.activeAnnotationDetail, markDeleteSuccess])

  const handleExcalidrawApi = React.useCallback((api: ExcalidrawImperativeAPI) => {
    apiRef.current = api
  }, [])

  const handleChange = React.useCallback((
    nextElements: readonly ExcalidrawElement[],
    nextAppState: AppState,
    nextFiles: BinaryFiles,
  ) => {
    const normalized = normalizeProductLineElements(nextElements)
    const nextSelected = getSelectedElements(normalized.elements, nextAppState)
    const pendingSourceId = pendingConnectionSourceIdRef.current
    const source = pendingSourceId
      ? normalized.elements.find(element => !element.isDeleted && element.id === pendingSourceId)
      : null
    const target = pendingSourceId
      ? nextSelected.find(element => element.id !== pendingSourceId && !isLinearElement(element))
      : null

    if (pendingSourceId && !source) {
      setPendingConnectionSource(null)
    }

    if (editable && source && target) {
      const connection = createUserConnectionElement(source, target)
      const nextSceneElements = [...normalized.elements, connection]
      const selectedConnectionIds: Record<string, true> = { [connection.id]: true }
      const nextSceneAppState = { ...nextAppState, selectedElementIds: selectedConnectionIds }
      setPendingConnectionSource(null)
      apiRef.current?.updateScene({
        elements: nextSceneElements,
        appState: nextSceneAppState,
        captureUpdate: CaptureUpdateAction.IMMEDIATELY,
      })
      setElements(nextSceneElements)
      setAppState(nextSceneAppState)
      setFiles(nextFiles)
      scheduleChange(nextSceneElements, nextSceneAppState, nextFiles)
      apiRef.current?.setToast({ message: 'Connection added.' })
      return
    }

    if (editable && normalized.changed) {
      apiRef.current?.updateScene({
        elements: normalized.elements,
        captureUpdate: CaptureUpdateAction.EVENTUALLY,
      })
    }

    setElements(normalized.elements)
    setAppState(nextAppState)
    setFiles(nextFiles)
    // Only edits dirty the caller; view-mode pan/zoom keeps the hotspot overlay
    // aligned but must not mark the artifact dirty.
    if (editable) scheduleChange(normalized.elements, nextAppState, nextFiles)
  }, [editable, scheduleChange, setPendingConnectionSource])

  const handleConnect = React.useCallback(() => {
    const selected = getSelectedElements(
      apiRef.current?.getSceneElements() ?? elements,
      apiRef.current?.getAppState() ?? appState,
    ).find(element => !isLinearElement(element))

    if (!selected) {
      apiRef.current?.setToast({ message: 'Select a node before connecting.' })
      return
    }

    setPendingConnectionSource(selected.id)
    const selectedSourceIds: Record<string, true> = { [selected.id]: true }
    apiRef.current?.updateScene({
      appState: {
        currentItemStrokeColor: PRODUCT_CANVAS_CONNECTION_STYLE.strokeColor,
        currentItemStrokeWidth: PRODUCT_CANVAS_CONNECTION_STYLE.strokeWidth,
        currentItemStrokeStyle: PRODUCT_CANVAS_CONNECTION_STYLE.strokeStyle,
        currentItemRoughness: PRODUCT_CANVAS_CONNECTION_STYLE.roughness,
        currentItemStartArrowhead: null,
        currentItemEndArrowhead: PRODUCT_CANVAS_CONNECTION_STYLE.endArrowhead,
        currentItemRoundness: PRODUCT_CANVAS_CONNECTION_STYLE.arrowType,
        currentItemArrowType: PRODUCT_CANVAS_CONNECTION_STYLE.arrowType,
        activeTool: { type: 'selection', customType: null, locked: false, lastActiveTool: null },
        selectedElementIds: selectedSourceIds,
      },
      captureUpdate: CaptureUpdateAction.NEVER,
    })
    apiRef.current?.setActiveTool({ type: 'selection' })
    apiRef.current?.setToast({ message: 'Click another node to connect.' })
  }, [appState, elements, setPendingConnectionSource])

  const handleDelete = React.useCallback(() => {
    const api = apiRef.current
    if (!api || !editable) return

    const currentAppState = api.getAppState()
    const selectedIds = currentAppState.selectedElementIds ?? {}
    const nextElements = api.getSceneElements().map((element: ExcalidrawElement) => (
      selectedIds[element.id]
        ? { ...element, isDeleted: true, updated: Date.now(), version: element.version + 1 }
        : element
    ))

    api.updateScene({
      elements: nextElements,
      appState: { selectedElementIds: {} },
      captureUpdate: CaptureUpdateAction.IMMEDIATELY,
    })
    const nextAppState = { ...currentAppState, selectedElementIds: {} }
    setElements(nextElements)
    setAppState(nextAppState)
    scheduleChange(nextElements, nextAppState, files)
  }, [editable, files, scheduleChange])

  const toolbarStyle = React.useMemo<React.CSSProperties | undefined>(() => {
    if (!selectionOverlay) return undefined

    const containerWidth = containerRef.current?.clientWidth ?? 0
    const halfToolbarWidth = toolbarSize.width / 2
    const leftMin = halfToolbarWidth + NODE_ACTION_EDGE_INSET
    const leftMax = containerWidth > 0
      ? containerWidth - halfToolbarWidth - NODE_ACTION_EDGE_INSET
      : selectionOverlay.left
    const left = Math.min(Math.max(selectionOverlay.left, leftMin), Math.max(leftMin, leftMax))
    const aboveTop = selectionOverlay.top - NODE_ACTION_GAP
    const shouldFlipBelow = toolbarSize.height > 0 && aboveTop - toolbarSize.height < NODE_ACTION_EDGE_INSET

    return {
      left,
      top: shouldFlipBelow ? selectionOverlay.bottom + NODE_ACTION_GAP : aboveTop,
      transform: shouldFlipBelow ? 'translateX(-50%)' : 'translate(-50%, -100%)',
      zIndex: 'var(--z-floating-menu, 400)',
    }
  }, [selectionOverlay, toolbarSize])

  const currentScene = React.useMemo<CanvasScene>(() => ({
    ...seed.scene,
    elements,
    appState,
    files,
  }), [appState, elements, files, seed.scene])
  const sceneAppState = React.useMemo(() => getSceneAppState(currentScene), [currentScene])

  const showEditToolbar = editable && Boolean(selectionOverlay) && !pendingConnectionSourceId

  return (
    <div ref={containerRef} className={cn('relative h-full min-h-0 overflow-hidden', className)}>
      <ExcalidrawCanvas
        scene={currentScene}
        appState={sceneAppState}
        sceneKey={seed.key}
        className="h-full w-full"
        viewModeEnabled={!editable}
        excalidrawAPI={handleExcalidrawApi}
        onChange={handleChange}
      >
        {showEditToolbar && (
          <div
            ref={toolbarRef}
            className="pointer-events-auto absolute z-popover flex items-center gap-1 rounded-[8px] border border-border/60 bg-background px-1 py-1 shadow-minimal"
            style={toolbarStyle}
            aria-label={`Canvas actions for ${selectionOverlay?.label ?? ''}`}
          >
            <ToolbarButton title="Connect" ariaLabel="Canvas connect nodes" onClick={handleConnect}>
              <GitBranch className="size-4" />
            </ToolbarButton>
            <ToolbarButton title="Delete" ariaLabel="Canvas delete selection" onClick={handleDelete} destructive>
              <Trash2 className="size-4" />
            </ToolbarButton>
          </div>
        )}

        {annotationsEnabled && hotspots.length > 0 && (
          <div className="pointer-events-none absolute inset-0" style={{ zIndex: 'var(--z-floating-menu, 400)' }}>
            {hotspots.map(hotspot => {
              const count = annotationsByElement.get(hotspot.elementId)?.length ?? 0
              const active = commentTarget?.elementId === hotspot.elementId
              return (
                <button
                  key={hotspot.elementId}
                  type="button"
                  onClick={() => handleHotspotClick(hotspot)}
                  aria-label={count > 0 ? `View comment on ${hotspot.label}` : `Comment on ${hotspot.label}`}
                  className={cn(
                    'pointer-events-auto absolute cursor-pointer rounded-[8px] transition-colors',
                    'hover:bg-foreground/[0.04] focus:outline-none focus-visible:ring-1 focus-visible:ring-ring',
                    active && 'ring-1 ring-ring',
                  )}
                  style={{ left: hotspot.left, top: hotspot.top, width: hotspot.width, height: hotspot.height }}
                >
                  {count > 0 && (
                    <span className="absolute -right-1.5 -top-1.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-foreground px-1 text-[10px] font-semibold text-background shadow-minimal">
                      {count}
                    </span>
                  )}
                </button>
              )
            })}
          </div>
        )}
      </ExcalidrawCanvas>

      {annotationsEnabled && (
        <AnnotationIslandMenu
          anchor={islandPresentation.renderAnchor}
          sourceKey={islandPresentation.renderSourceKey}
          replayNonce={islandNonce}
          isVisible={islandPresentation.isVisible}
          activeView={islandState.selectionMenuView}
          mode={islandState.followUpMode}
          draft={islandState.followUpDraft}
          onDraftChange={setDraft}
          onOpenFollowUp={openFollowUpFromSelection}
          onCancel={handleIslandCancel}
          onRequestEdit={requestEdit}
          onSubmit={handleIslandSubmit}
          onSubmitAndSend={handleIslandSubmitAndSend}
          onDelete={handleIslandDelete}
          transitionConfig={islandTransition}
          onExitComplete={islandPresentation.handleExitComplete}
        />
      )}
    </div>
  )
}

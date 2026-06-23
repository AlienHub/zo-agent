import * as React from 'react'
import { GitBranch, Trash2 } from 'lucide-react'
import '../excalidraw-assets'
import {
  CaptureUpdateAction,
  Excalidraw,
  FONT_FAMILY,
  ROUNDNESS,
  convertToExcalidrawElements,
} from '@excalidraw/excalidraw'
import '@excalidraw/excalidraw/index.css'
import './excalidrawCanvas.css'
import { Button } from '@/components/ui/button'
import type { AppState, BinaryFiles, ExcalidrawImperativeAPI, UIOptions } from '@excalidraw/excalidraw/types'
import type { ExcalidrawElement } from '@excalidraw/excalidraw/element/types'
import type { CanvasAgentScenario, ExcalidrawCanvasState } from './canvasTypes'

interface AgentCanvasScene {
  elements: readonly ExcalidrawElement[]
  appState: Partial<AppState>
  files: BinaryFiles
}

interface SelectionOverlay {
  label: string
  elementId: string
  left: number
  top: number
  bottom: number
}

const NODE_ACTION_GAP = 16
const NODE_ACTION_EDGE_INSET = 8
const PRODUCT_CANVAS_CONNECTION_STYLE = {
  strokeColor: '#7d8492',
  strokeWidth: 1,
  strokeStyle: 'solid' as const,
  roughness: 0,
  roundness: null,
  endArrowhead: 'triangle' as const,
  arrowType: 'sharp' as const,
}

const canvasUiOptions: Partial<UIOptions> = {
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

function useDocumentDarkMode() {
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

function getPalette(isDarkMode: boolean) {
  if (isDarkMode) {
    return {
      text: '#ececf0',
      muted: '#8e95a3',
      line: '#8a92a2',
      surface: '#252a35',
      stroke: '#596273',
      blueFill: '#22304a',
      blueStroke: '#6ea4e8',
      greenFill: '#173625',
      greenStroke: '#55b77e',
      purpleFill: '#302646',
      purpleStroke: '#a18cec',
      amberFill: '#3d3018',
      amberStroke: '#d2a247',
    }
  }

  return {
    text: '#242733',
    muted: '#727987',
    line: '#7d8492',
    surface: '#ffffff',
    stroke: '#d7dbe4',
    blueFill: '#edf5ff',
    blueStroke: '#4d8bcc',
    greenFill: '#eaf7ef',
    greenStroke: '#42a66b',
    purpleFill: '#f3efff',
    purpleStroke: '#8a73d6',
    amberFill: '#fff7e5',
    amberStroke: '#d59b2d',
  }
}

function node(
  id: string,
  x: number,
  y: number,
  width: number,
  height: number,
  text: string,
  fill: string,
  stroke: string,
  textColor: string,
) {
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
      fontSize: 16,
      fontFamily: FONT_FAMILY.Helvetica,
      strokeColor: textColor,
    },
  }
}

function arrow(id: string, x: number, y: number, width: number, height: number, label: string, color: string, dashed = false) {
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
    customData: {
      productGeneratedLine: true,
    },
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

function text(id: string, x: number, y: number, value: string, color: string) {
  return {
    type: 'text' as const,
    id,
    x,
    y,
    text: value,
    fontSize: 13,
    fontFamily: FONT_FAMILY.Helvetica,
    strokeColor: color,
    backgroundColor: 'transparent',
    roughness: 0,
  }
}

function createAgentScene(scenario: CanvasAgentScenario, isDarkMode: boolean): AgentCanvasScene {
  const palette = getPalette(isDarkMode)

  const scenarioElements = {
    'product-map': [
      text('agent-note', 40, 36, 'Agent authored canvas structure', palette.muted),
      node('user-object', 56, 96, 172, 70, 'Current object\nDocument / board / browser', palette.surface, palette.stroke, palette.text),
      node('artifact-host', 316, 96, 172, 70, 'Artifact host\nPanel chrome + identity', palette.blueFill, palette.blueStroke, palette.text),
      node('agent-control', 576, 96, 184, 70, 'Agent control\nOpen / focus / patch', palette.purpleFill, palette.purpleStroke, palette.text),
      node('human-review', 316, 226, 172, 70, 'Human review\nResize nodes + connect lines', palette.greenFill, palette.greenStroke, palette.text),
      node('store-boundary', 576, 226, 184, 70, 'Store boundary\nContent outside route URL', palette.amberFill, palette.amberStroke, palette.text),
      arrow('edge-object-host', 228, 131, 88, 0, 'mount', palette.line),
      arrow('edge-host-agent', 488, 131, 88, 0, 'protocol', palette.purpleStroke),
      arrow('edge-host-review', 402, 166, 0, 60, 'turn', palette.greenStroke),
      arrow('edge-review-store', 488, 261, 88, 0, 'save', palette.amberStroke),
      arrow('edge-store-agent', 668, 226, 0, -60, 'context', palette.line, true),
    ],
    workflow: [
      text('agent-note', 40, 36, 'Agent creates the working canvas; user edits the structure', palette.muted),
      node('brief', 56, 120, 160, 64, 'Brief', palette.surface, palette.stroke, palette.text),
      node('decompose', 296, 120, 160, 64, 'Decompose', palette.blueFill, palette.blueStroke, palette.text),
      node('draft', 536, 120, 160, 64, 'Draft board', palette.purpleFill, palette.purpleStroke, palette.text),
      node('review', 296, 244, 160, 64, 'Review', palette.greenFill, palette.greenStroke, palette.text),
      node('revise', 536, 244, 160, 64, 'Revise', palette.amberFill, palette.amberStroke, palette.text),
      arrow('edge-brief-decompose', 216, 152, 80, 0, '', palette.line),
      arrow('edge-decompose-draft', 456, 152, 80, 0, '', palette.line),
      arrow('edge-draft-review', 616, 184, -160, 60, '', palette.greenStroke),
      arrow('edge-review-revise', 456, 276, 80, 0, '', palette.amberStroke),
      arrow('edge-revise-draft', 616, 244, 0, -60, 'iterate', palette.purpleStroke, true),
    ],
    review: [
      text('agent-note', 40, 36, 'Agent adds review notes to the selected canvas area', palette.muted),
      node('surface', 80, 116, 186, 72, 'Canvas surface\nagent generated', palette.blueFill, palette.blueStroke, palette.text),
      node('risk', 344, 76, 188, 72, 'Risk\navoid full editor complexity', palette.amberFill, palette.amberStroke, palette.text),
      node('human-scope', 344, 220, 188, 72, 'Human scope\nread, resize, connect', palette.greenFill, palette.greenStroke, palette.text),
      node('next', 610, 148, 188, 72, 'Next\nwire MCP / skill actions', palette.purpleFill, palette.purpleStroke, palette.text),
      arrow('edge-surface-risk', 266, 152, 78, -40, 'review', palette.amberStroke),
      arrow('edge-surface-scope', 266, 152, 78, 104, 'edit limits', palette.greenStroke),
      arrow('edge-risk-next', 532, 112, 78, 72, '', palette.purpleStroke),
      arrow('edge-scope-next', 532, 256, 78, -72, '', palette.purpleStroke),
    ],
  } satisfies Record<CanvasAgentScenario, unknown[]>

  const selectedElementIds = { 'artifact-host': true }
  const elements = convertToExcalidrawElements(scenarioElements[scenario], { regenerateIds: false }) as ExcalidrawElement[]

  return {
    elements,
    appState: {
      currentItemFontFamily: FONT_FAMILY.Helvetica,
      currentItemRoughness: 0,
      gridModeEnabled: false,
      selectedElementIds,
      theme: isDarkMode ? 'dark' : 'light',
      viewBackgroundColor: 'transparent',
    } as Partial<AppState>,
    files: {},
  }
}

function getSceneAppState(scene: AgentCanvasScene) {
  return {
    currentItemFontFamily: scene.appState.currentItemFontFamily ?? FONT_FAMILY.Helvetica,
    currentItemStrokeColor: PRODUCT_CANVAS_CONNECTION_STYLE.strokeColor,
    currentItemStrokeWidth: PRODUCT_CANVAS_CONNECTION_STYLE.strokeWidth,
    currentItemStrokeStyle: PRODUCT_CANVAS_CONNECTION_STYLE.strokeStyle,
    currentItemRoughness: scene.appState.currentItemRoughness ?? 0,
    currentItemStartArrowhead: null,
    currentItemEndArrowhead: PRODUCT_CANVAS_CONNECTION_STYLE.endArrowhead,
    currentItemRoundness: PRODUCT_CANVAS_CONNECTION_STYLE.arrowType,
    currentItemArrowType: PRODUCT_CANVAS_CONNECTION_STYLE.arrowType,
    gridModeEnabled: false,
    selectedElementIds: scene.appState.selectedElementIds ?? {},
    theme: scene.appState.theme ?? 'light',
    viewBackgroundColor: scene.appState.viewBackgroundColor ?? 'transparent',
  }
}

function getSelectedElements(elements: readonly ExcalidrawElement[], appState: Partial<AppState>) {
  const selectedIds = appState.selectedElementIds ?? {}
  return elements.filter(element => !element.isDeleted && selectedIds[element.id])
}

function getElementLabel(element: ExcalidrawElement) {
  const maybeText = element as ExcalidrawElement & { text?: string; customData?: { label?: string } }
  return maybeText.text || maybeText.customData?.label || element.id
}

function getSelectionOverlay(elements: readonly ExcalidrawElement[], appState: Partial<AppState>): SelectionOverlay | null {
  const [selected] = getSelectedElements(elements, appState)
  if (!selected) return null

  const zoom = typeof appState.zoom?.value === 'number' ? appState.zoom.value : 1
  const scrollX = typeof appState.scrollX === 'number' ? appState.scrollX : 0
  const scrollY = typeof appState.scrollY === 'number' ? appState.scrollY : 0

  return {
    label: getElementLabel(selected),
    elementId: selected.id,
    left: (selected.x + scrollX + selected.width / 2) * zoom,
    top: (selected.y + scrollY) * zoom,
    bottom: (selected.y + scrollY + selected.height) * zoom,
  }
}

function isLinearElement(element: ExcalidrawElement) {
  return element.type === 'arrow' || element.type === 'line'
}

function isProductArrowElement(element: ExcalidrawElement) {
  return element.type === 'arrow'
    && element.endArrowhead === PRODUCT_CANVAS_CONNECTION_STYLE.endArrowhead
    && ('elbowed' in element ? element.elbowed === false : true)
}

function shouldPreserveLineStyle(element: ExcalidrawElement) {
  return Boolean((element as ExcalidrawElement & { customData?: { productGeneratedLine?: boolean } }).customData?.productGeneratedLine)
}

function getProductLineStrokeColor(element: ExcalidrawElement) {
  return shouldPreserveLineStyle(element) ? element.strokeColor : PRODUCT_CANVAS_CONNECTION_STYLE.strokeColor
}

function getProductLineStrokeStyle(element: ExcalidrawElement) {
  return shouldPreserveLineStyle(element) ? element.strokeStyle : PRODUCT_CANVAS_CONNECTION_STYLE.strokeStyle
}

function hasProductLineStyle(element: ExcalidrawElement) {
  if (!isLinearElement(element)) return true

  return element.strokeColor === getProductLineStrokeColor(element)
    && element.strokeWidth === PRODUCT_CANVAS_CONNECTION_STYLE.strokeWidth
    && element.strokeStyle === getProductLineStrokeStyle(element)
    && element.roughness === PRODUCT_CANVAS_CONNECTION_STYLE.roughness
    && element.roundness === PRODUCT_CANVAS_CONNECTION_STYLE.roundness
    && (element.type !== 'arrow' || isProductArrowElement(element))
}

function normalizeProductLineElement(element: ExcalidrawElement) {
  if (!isLinearElement(element)) return element
  if (hasProductLineStyle(element)) return element

  return {
    ...element,
    strokeColor: getProductLineStrokeColor(element),
    strokeWidth: PRODUCT_CANVAS_CONNECTION_STYLE.strokeWidth,
    strokeStyle: getProductLineStrokeStyle(element),
    roughness: PRODUCT_CANVAS_CONNECTION_STYLE.roughness,
    roundness: PRODUCT_CANVAS_CONNECTION_STYLE.roundness,
    ...(element.type === 'arrow'
      ? {
        elbowed: false,
        endArrowhead: PRODUCT_CANVAS_CONNECTION_STYLE.endArrowhead,
      }
      : {}),
  } as ExcalidrawElement
}

function normalizeProductLineElements(elements: readonly ExcalidrawElement[]) {
  let changed = false
  const normalizedElements = elements.map(element => {
    const nextElement = normalizeProductLineElement(element)
    if (nextElement !== element) changed = true
    return nextElement
  })

  return {
    changed,
    elements: normalizedElements,
  }
}

function getElementCenter(element: ExcalidrawElement) {
  return {
    x: element.x + element.width / 2,
    y: element.y + element.height / 2,
  }
}

function getConnectionPoints(source: ExcalidrawElement, target: ExcalidrawElement) {
  const sourceCenter = getElementCenter(source)
  const targetCenter = getElementCenter(target)
  const dx = targetCenter.x - sourceCenter.x
  const dy = targetCenter.y - sourceCenter.y

  if (Math.abs(dx) >= Math.abs(dy)) {
    return {
      start: {
        x: dx >= 0 ? source.x + source.width : source.x,
        y: sourceCenter.y,
      },
      end: {
        x: dx >= 0 ? target.x : target.x + target.width,
        y: targetCenter.y,
      },
    }
  }

  return {
    start: {
      x: sourceCenter.x,
      y: dy >= 0 ? source.y + source.height : source.y,
    },
    end: {
      x: targetCenter.x,
      y: dy >= 0 ? target.y : target.y + target.height,
    },
  }
}

function createUserConnectionElement(source: ExcalidrawElement, target: ExcalidrawElement) {
  const { start, end } = getConnectionPoints(source, target)
  const [connection] = convertToExcalidrawElements([{
    type: 'arrow' as const,
    id: `user-connection-${source.id}-${target.id}-${Date.now()}`,
    x: start.x,
    y: start.y,
    width: end.x - start.x,
    height: end.y - start.y,
    strokeColor: PRODUCT_CANVAS_CONNECTION_STYLE.strokeColor,
    strokeWidth: PRODUCT_CANVAS_CONNECTION_STYLE.strokeWidth,
    strokeStyle: PRODUCT_CANVAS_CONNECTION_STYLE.strokeStyle,
    roughness: PRODUCT_CANVAS_CONNECTION_STYLE.roughness,
    roundness: PRODUCT_CANVAS_CONNECTION_STYLE.roundness,
    endArrowhead: PRODUCT_CANVAS_CONNECTION_STYLE.endArrowhead,
  }], { regenerateIds: false }) as ExcalidrawElement[]

  return normalizeProductLineElement({
    ...connection,
    startBinding: { elementId: source.id, focus: 0, gap: 0 },
    endBinding: { elementId: target.id, focus: 0, gap: 0 },
  } as ExcalidrawElement)
}

export function ExcalidrawCanvasEditor({
  agentScenario,
  onStateChange,
}: {
  agentScenario: CanvasAgentScenario
  onStateChange(state: ExcalidrawCanvasState): void
}) {
  const isDarkMode = useDocumentDarkMode()
  const containerRef = React.useRef<HTMLDivElement | null>(null)
  const toolbarRef = React.useRef<HTMLDivElement | null>(null)
  const apiRef = React.useRef<ExcalidrawImperativeAPI | null>(null)
  const initialScene = React.useMemo(() => createAgentScene(agentScenario, isDarkMode), [agentScenario, isDarkMode])
  const [elements, setElements] = React.useState<readonly ExcalidrawElement[]>(initialScene.elements)
  const [appState, setAppState] = React.useState<Partial<AppState>>(initialScene.appState)
  const [toolbarSize, setToolbarSize] = React.useState({ width: 0, height: 0 })
  const [pendingConnectionSourceId, setPendingConnectionSourceId] = React.useState<string | null>(null)
  const pendingConnectionSourceIdRef = React.useRef<string | null>(null)
  const lastHostStateKeyRef = React.useRef('')
  const initialData = React.useMemo(() => ({
    elements: initialScene.elements,
    appState: initialScene.appState,
    files: initialScene.files,
    scrollToContent: true,
  }), [initialScene])
  const selectionOverlay = React.useMemo(() => getSelectionOverlay(elements, appState), [elements, appState])

  const setPendingConnectionSource = React.useCallback((sourceId: string | null) => {
    pendingConnectionSourceIdRef.current = sourceId
    setPendingConnectionSourceId(sourceId)
  }, [])

  React.useLayoutEffect(() => {
    if (!toolbarRef.current || !selectionOverlay) return
    const rect = toolbarRef.current.getBoundingClientRect()
    setToolbarSize(current => (
      current.width === rect.width && current.height === rect.height
        ? current
        : { width: rect.width, height: rect.height }
    ))
  }, [selectionOverlay])

  React.useEffect(() => {
    setElements(initialScene.elements)
    setAppState(initialScene.appState)
    setPendingConnectionSource(null)
    apiRef.current?.updateScene({
      elements: initialScene.elements,
      appState: getSceneAppState(initialScene),
      captureUpdate: CaptureUpdateAction.NEVER,
    })
    apiRef.current?.scrollToContent(initialScene.elements, { fitToViewport: true, viewportZoomFactor: 0.78 })
  }, [initialScene, setPendingConnectionSource])

  React.useEffect(() => {
    const selected = getSelectedElements(elements, appState)
    const hostState = {
      elementCount: elements.filter(element => !element.isDeleted).length,
      selectedLabel: selected[0] ? getElementLabel(selected[0]) : 'Nothing selected',
      autoSaveLabel: 'Saved',
    }
    const hostStateKey = `${hostState.elementCount}:${hostState.selectedLabel}:${hostState.autoSaveLabel}`
    if (lastHostStateKeyRef.current === hostStateKey) return

    lastHostStateKeyRef.current = hostStateKey
    onStateChange(hostState)
  }, [appState, elements, onStateChange])

  const handleChange = React.useCallback((nextElements: readonly ExcalidrawElement[], nextAppState: AppState) => {
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

    if (source && target) {
      const connection = createUserConnectionElement(source, target)
      const nextSceneElements = [...normalized.elements, connection]
      const selectedConnectionIds: Record<string, true> = { [connection.id]: true }
      const nextSceneAppState = {
        ...nextAppState,
        selectedElementIds: selectedConnectionIds,
      }
      setPendingConnectionSource(null)
      apiRef.current?.updateScene({
        elements: nextSceneElements,
        appState: nextSceneAppState,
        captureUpdate: CaptureUpdateAction.IMMEDIATELY,
      })
      setElements(nextSceneElements)
      setAppState(nextSceneAppState)
      apiRef.current?.setToast({ message: 'Connection added.' })
      return
    }

    if (normalized.changed) {
      apiRef.current?.updateScene({
        elements: normalized.elements,
        captureUpdate: CaptureUpdateAction.EVENTUALLY,
      })
    }

    setElements(normalized.elements)
    setAppState(nextAppState)
  }, [setPendingConnectionSource])

  const handleExcalidrawApi = React.useCallback((api: ExcalidrawImperativeAPI) => {
    apiRef.current = api
  }, [])

  const handleContextMenu = React.useCallback((event: React.MouseEvent) => {
    event.preventDefault()
    event.stopPropagation()
  }, [])

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
    if (!api) return

    const currentAppState = api.getAppState()
    const selectedIds = currentAppState.selectedElementIds ?? {}
    const nextElements = api.getSceneElements().map(element => (
      selectedIds[element.id]
        ? { ...element, isDeleted: true, updated: Date.now(), version: element.version + 1 }
        : element
    ))

    api.updateScene({
      elements: nextElements,
      appState: { selectedElementIds: {} },
      captureUpdate: CaptureUpdateAction.IMMEDIATELY,
    })
  }, [])

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
      top: shouldFlipBelow
        ? selectionOverlay.bottom + NODE_ACTION_GAP
        : aboveTop,
      transform: shouldFlipBelow ? 'translateX(-50%)' : 'translate(-50%, -100%)',
      zIndex: 'var(--z-floating-menu, 400)',
    }
  }, [selectionOverlay, toolbarSize])

  return (
    <div
      ref={containerRef}
      className="ca-artifact-excalidraw h-full w-full overflow-hidden"
      onContextMenu={handleContextMenu}
      onContextMenuCapture={handleContextMenu}
    >
      <Excalidraw
        key={`${agentScenario}:${isDarkMode ? 'dark' : 'light'}`}
        excalidrawAPI={handleExcalidrawApi}
        initialData={initialData}
        theme={isDarkMode ? 'dark' : 'light'}
        viewModeEnabled={false}
        zenModeEnabled
        gridModeEnabled={false}
        autoFocus={false}
        UIOptions={canvasUiOptions}
        onChange={handleChange}
      />

      {selectionOverlay && !pendingConnectionSourceId && (
        <div
          ref={toolbarRef}
          className="pointer-events-auto absolute z-popover flex items-center gap-1 rounded-[8px] border border-border/60 bg-background px-1 py-1 shadow-minimal"
          style={toolbarStyle}
          aria-label={`Canvas actions for ${selectionOverlay.label}`}
        >
          <Button variant="ghost" size="icon" className="size-8" title="Connect" aria-label="Canvas connect nodes" onClick={handleConnect}>
            <GitBranch className="size-4" />
          </Button>
          <div className="mx-1 h-5 w-px bg-border/70" />
          <Button variant="ghost" size="icon" className="size-8 text-destructive hover:bg-destructive/10" title="Delete" aria-label="Canvas delete selection" onClick={handleDelete}>
            <Trash2 className="size-4" />
          </Button>
        </div>
      )}
    </div>
  )
}

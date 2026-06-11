/**
 * PanelResizeSash
 *
 * A thin drag handle between adjacent content panels in the split view.
 * Reuses the existing resize gradient style for visual consistency
 * with the sidebar/navigator sash handles.
 *
 * - Drag to resize the two adjacent panels
 * - Double-click to reset both panels to equal share of their combined proportion
 * - Enforces PANEL_MIN_WIDTH on both sides during drag
 * - Reads stored panel basis widths on drag start and falls back to measured
 *   DOM widths only for panels that have not been resized yet.
 */

import { useCallback, useRef } from 'react'
import { useSetAtom, useAtomValue } from 'jotai'
import { panelStackAtom, resizePanelsAtom } from '@/atoms/panel-stack'
import { useResizeGradient } from '@/hooks/useResizeGradient'
import {
  PANEL_MIN_WIDTH,
  PANEL_SASH_FLEX_MARGIN,
  PANEL_SASH_HALF_HIT_WIDTH,
  PANEL_SASH_LINE_WIDTH,
  PANEL_STACK_VERTICAL_OVERFLOW,
} from './panel-constants'
import {
  computeResizedPanelWidths,
  resolveResizeStartWidths,
} from './panel-resize'

export { PANEL_MIN_WIDTH }

interface PanelResizeSashProps {
  /** Index of the panel to the left of this sash (in panelStack) */
  leftIndex: number
  /** Index of the panel to the right of this sash (in panelStack) */
  rightIndex: number
}

export function PanelResizeSash({
  leftIndex,
  rightIndex,
}: PanelResizeSashProps) {
  const resizePanels = useSetAtom(resizePanelsAtom)
  const panelStack = useAtomValue(panelStackAtom)
  const { ref, handlers, gradientStyle } = useResizeGradient()
  const startXRef = useRef(0)
  const startLeftWidthRef = useRef(0)
  const startRightWidthRef = useRef(0)
  const combinedProportionRef = useRef(0)

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    handlers.onMouseDown()

    const stack = panelStack
    const leftEntry = stack[leftIndex]
    const rightEntry = stack[rightIndex]
    if (!leftEntry || !rightEntry) return

    const sashEl = ref.current
    const measuredWidths = sashEl?.parentElement
      ? Array.from(
          sashEl.parentElement.querySelectorAll<HTMLElement>('[data-panel-role="content"]'),
          panel => panel.getBoundingClientRect().width,
        )
      : []
    const startWidths = resolveResizeStartWidths({
      storedWidths: stack.map(p => p.width),
      measuredWidths,
      minWidth: PANEL_MIN_WIDTH,
      measuredFirstIndices: [stack.length - 1],
    })

    // Use stored basis widths when present. Measured DOM widths can include
    // flex-grown free space; writing that back would accumulate on each drag.
    startXRef.current = e.clientX
    startLeftWidthRef.current = startWidths[leftIndex] ?? PANEL_MIN_WIDTH
    startRightWidthRef.current = startWidths[rightIndex] ?? PANEL_MIN_WIDTH

    const leftProp = leftEntry.proportion
    const rightProp = rightEntry.proportion
    combinedProportionRef.current = leftProp + rightProp

    const handleMouseMove = (e: MouseEvent) => {
      const delta = e.clientX - startXRef.current

      const { leftWidth: newLeftWidth, rightWidth: newRightWidth } =
        computeResizedPanelWidths({
          startLeftWidth: startLeftWidthRef.current,
          startRightWidth: startRightWidthRef.current,
          delta,
          minWidth: PANEL_MIN_WIDTH,
        })

      // Convert pixel ratio to proportions, preserving the combined proportion.
      const combined = combinedProportionRef.current
      const total = newLeftWidth + newRightWidth
      const leftProportion = (newLeftWidth / total) * combined
      const rightProportion = combined - leftProportion

      resizePanels({
        leftIndex,
        rightIndex,
        leftProportion,
        rightProportion,
        leftWidth: Math.round(newLeftWidth),
        rightWidth: rightIndex === stack.length - 1 ? null : Math.round(newRightWidth),
      })
    }

    const handleMouseUp = () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
      document.body.style.userSelect = ''
      document.body.style.cursor = ''
    }

    document.body.style.userSelect = 'none'
    document.body.style.cursor = 'col-resize'
    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
  }, [leftIndex, rightIndex, panelStack, resizePanels, handlers, ref])

  const handleDoubleClick = useCallback(() => {
    // Reset the two adjacent panels to equal share of their combined proportion
    const left = panelStack[leftIndex]
    const right = panelStack[rightIndex]
    if (!left || !right) return
    const combined = left.proportion + right.proportion
    const half = combined / 2
    resizePanels({
      leftIndex,
      rightIndex,
      leftProportion: half,
      rightProportion: half,
      leftWidth: null,
      rightWidth: null,
    })
  }, [leftIndex, rightIndex, panelStack, resizePanels])

  return (
    <div
      ref={ref}
      className="relative z-panel w-0 h-full cursor-col-resize flex justify-center shrink-0 pointer-events-none"
      style={{ margin: `0 ${PANEL_SASH_FLEX_MARGIN}px` }}
      onMouseDown={handleMouseDown}
      onMouseMove={handlers.onMouseMove}
      onMouseLeave={handlers.onMouseLeave}
      onDoubleClick={handleDoubleClick}
    >
      {/* Touch area — wider than visible line for easier grabbing */}
      <div
        className="absolute inset-y-0 flex justify-center cursor-col-resize pointer-events-auto"
        style={{ left: -PANEL_SASH_HALF_HIT_WIDTH, right: -PANEL_SASH_HALF_HIT_WIDTH }}
      >
        <div
          className="absolute left-1/2 -translate-x-1/2"
          style={{
            ...gradientStyle,
            width: PANEL_SASH_LINE_WIDTH,
            top: PANEL_STACK_VERTICAL_OVERFLOW,
            bottom: PANEL_STACK_VERTICAL_OVERFLOW,
          }}
        />
      </div>
    </div>
  )
}

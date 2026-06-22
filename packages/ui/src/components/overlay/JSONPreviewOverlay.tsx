/**
 * JSONPreviewOverlay - Interactive JSON tree viewer overlay
 *
 * Uses @uiw/react-json-view for expand/collapse tree navigation.
 * Wraps PreviewOverlay for consistent presentation with other overlays.
 */

import * as React from 'react'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import JsonView from '@uiw/react-json-view'
import { ContentFrame } from './ContentFrame'

/**
 * Recursively parse stringified JSON within JSON values.
 * Handles nested patterns like {"result": "{\"nested\": \"value\"}"}
 * so they display as expandable tree nodes instead of plain strings.
 */
/**
 * Size threshold (bytes of raw JSON text) for large-file protection.
 *
 * @uiw/react-json-view is NOT virtualized: a fully-expanded large tree creates
 * tens of thousands of DOM nodes synchronously and freezes the main thread.
 * Above this threshold we (1) skip the full-tree `deepParseJson` rebuild and
 * (2) collapse the tree to its top level so initial DOM stays bounded — the
 * user can drill in node-by-node. App.tsx routes truly huge files (see
 * JSON_TREE_MAX_BYTES) to the plain code viewer before they ever reach here.
 */
const JSON_LARGE_BYTES = 256 * 1024

function deepParseJson(value: unknown): unknown {
  // Handle null/undefined
  if (value === null || value === undefined) return value

  // If it's a string, try to parse it as JSON
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (
      (trimmed.startsWith('{') && trimmed.endsWith('}')) ||
      (trimmed.startsWith('[') && trimmed.endsWith(']'))
    ) {
      try {
        // Recursively parse the result in case of multiple nesting levels
        return deepParseJson(JSON.parse(trimmed))
      } catch {
        // Not valid JSON, return original string
        return value
      }
    }
    return value
  }

  // If it's an array, recursively process each element
  if (Array.isArray(value)) {
    return value.map(deepParseJson)
  }

  // If it's an object, recursively process each property
  if (typeof value === 'object') {
    const result: Record<string, unknown> = {}
    for (const [key, val] of Object.entries(value)) {
      result[key] = deepParseJson(val)
    }
    return result
  }

  // Primitives (number, boolean) - return as-is
  return value
}
import { vscodeTheme } from '@uiw/react-json-view/vscode'
import { githubLightTheme } from '@uiw/react-json-view/githubLight'
import { Braces, Copy, Check } from 'lucide-react'
import { PreviewOverlay } from './PreviewOverlay'

export interface JSONPreviewOverlayProps {
  /** Whether the overlay is visible */
  isOpen: boolean
  /** Callback when the overlay should close */
  onClose: () => void
  /** Parsed JSON data to display */
  data: unknown
  /** File path — shows dual-trigger menu badge with "Open" + "Reveal in {file manager}" */
  filePath?: string
  /** Title to display in header (fallback when no filePath) */
  title?: string
  /** Theme mode */
  theme?: 'light' | 'dark'
  /** Optional error message */
  error?: string
  /**
   * Byte length of the raw JSON text, used for large-file protection.
   * When omitted (e.g. playground/embedded callers with small data), the
   * viewer keeps its full expand-all behavior.
   */
  contentBytes?: number
  /** Render inline without dialog (for playground) */
  embedded?: boolean
  /** Hide embedded header chrome and let parent provide page-level controls */
  hideHeader?: boolean
}

/**
 * Custom theme that adapts to our app's CSS variables.
 * Falls back to VS Code dark theme colors for JSON-specific styling.
 */
const craftAgentDarkTheme = {
  ...vscodeTheme,
  '--w-rjv-font-family': 'var(--font-mono, ui-monospace, monospace)',
  '--w-rjv-background-color': 'transparent',
}

const craftAgentLightTheme = {
  ...githubLightTheme,
  '--w-rjv-font-family': 'var(--font-mono, ui-monospace, monospace)',
  '--w-rjv-background-color': 'transparent',
}

export function JSONPreviewOverlay({
  isOpen,
  onClose,
  data,
  filePath,
  title = 'JSON',
  theme = 'dark',
  error,
  embedded,
  hideHeader,
  contentBytes,
}: JSONPreviewOverlayProps) {
  const { t } = useTranslation()
  // Select theme based on mode
  const jsonTheme = useMemo(() => {
    return theme === 'dark' ? craftAgentDarkTheme : craftAgentLightTheme
  }, [theme])

  // Large files get the non-virtualized tree's two protections (see JSON_LARGE_BYTES).
  const isLarge = contentBytes != null && contentBytes > JSON_LARGE_BYTES

  // Recursively parse any stringified JSON within the data for better display.
  // Guard: @uiw/react-json-view crashes on null/undefined/primitive values — wrap them
  // in an object so the viewer can render them safely.
  // For large files we skip deepParseJson: it rebuilds the entire tree (O(n) alloc +
  // a JSON.parse attempt per string), pure overhead at scale.
  const processedData = useMemo(() => {
    const parsed = isLarge ? data : deepParseJson(data)
    if (parsed === null || parsed === undefined) return { '(empty)': null }
    if (typeof parsed !== 'object') return { '(root)': parsed }
    return parsed as object
  }, [data, isLarge])

  // Collapse large trees to the top level so initial DOM stays bounded.
  const collapsed: boolean | number = isLarge ? 1 : false

  return (
    <PreviewOverlay
      isOpen={isOpen}
      onClose={onClose}
      typeBadge={{
        icon: Braces,
        label: 'JSON',
        variant: 'blue',
      }}
      filePath={filePath}
      title={title}
      theme={theme}
      error={error ? { label: t('preview.parseError'), message: error } : undefined}
      embedded={embedded}
      hideHeader={hideHeader}
      className="bg-foreground-3"
    >
      <ContentFrame title="JSON">
        <div className="flex-1 overflow-y-auto min-h-0 p-4">
          <div className="p-4">
            <JsonView
              value={processedData}
              style={jsonTheme}
              collapsed={collapsed}
              enableClipboard={true}
              displayDataTypes={false}
              shortenTextAfterLength={100}
            >
              {/* Custom copy icon using lucide-react */}
              <JsonView.Copied
                render={(props) => {
                  // Type assertion needed - @uiw/react-json-view types don't include data-copied
                  const isCopied = (props as Record<string, unknown>)['data-copied']
                  return isCopied ? (
                    <Check
                      className="ml-1.5 inline-flex cursor-pointer text-green-500"
                      size={10}
                      onClick={props.onClick}
                    />
                  ) : (
                    <Copy
                      className="ml-1.5 inline-flex cursor-pointer text-muted-foreground hover:text-foreground"
                      size={10}
                      onClick={props.onClick}
                    />
                  )
                }}
              />
            </JsonView>
          </div>
        </div>
      </ContentFrame>
    </PreviewOverlay>
  )
}

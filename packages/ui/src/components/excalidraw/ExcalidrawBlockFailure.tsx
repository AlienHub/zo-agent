import * as React from 'react'
import { AlertTriangle, RotateCw } from 'lucide-react'
import { cn } from '../../lib/utils'

export type ExcalidrawFailureReason =
  | 'inline-not-supported'
  | 'file-read-error'
  | 'parse-error'
  | 'invalid-scene'
  | 'render-error'

const FAILURE_MESSAGES: Record<ExcalidrawFailureReason, string> = {
  'inline-not-supported': "Inline canvas JSON isn't supported — reference a .excalidraw file.",
  'file-read-error': "Couldn't load the canvas file.",
  'parse-error': "The canvas file isn't valid JSON.",
  'invalid-scene': 'The canvas file has no drawable content.',
  'render-error': 'The canvas failed to render.',
}

export interface ExcalidrawBlockFailureProps {
  reason: ExcalidrawFailureReason
  detail?: string
  onReload?: () => void
  className?: string
  style?: React.CSSProperties
}

/**
 * Dedicated failure card for the canvas block — shown in place of the canvas
 * when the referenced .excalidraw file is missing, malformed, or unrenderable
 * (instead of dumping the raw code). `inline-not-supported` is a permanent spec
 * error and offers no reload.
 */
export function ExcalidrawBlockFailure({ reason, detail, onReload, className, style }: ExcalidrawBlockFailureProps) {
  const canReload = Boolean(onReload) && reason !== 'inline-not-supported'

  return (
    <div
      className={cn(
        'flex min-h-[180px] flex-col items-center justify-center gap-3 rounded-[8px] border border-border/60 bg-background p-6 text-center shadow-minimal',
        className,
      )}
      style={style}
      role="alert"
    >
      <div className="flex size-10 items-center justify-center rounded-[8px] bg-foreground/5 text-muted-foreground">
        <AlertTriangle className="size-5" />
      </div>
      <div className="space-y-1">
        <p className="text-sm font-medium text-foreground">{FAILURE_MESSAGES[reason]}</p>
        {detail && <p className="text-xs text-muted-foreground">{detail}</p>}
      </div>
      {canReload && (
        <button
          type="button"
          onClick={onReload}
          className={cn(
            'inline-flex items-center gap-1.5 rounded-[6px] px-2.5 py-1 text-xs font-medium transition-colors',
            'text-muted-foreground hover:bg-foreground/5 hover:text-foreground',
            'focus:outline-none focus-visible:ring-1 focus-visible:ring-ring',
          )}
        >
          <RotateCw className="size-3.5" />
          Reload
        </button>
      )}
    </div>
  )
}

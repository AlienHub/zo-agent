import * as React from 'react'
import { FileText, Monitor, RefreshCw } from 'lucide-react'
import { Spinner } from '@craft-agent/ui'
import { cn } from '@/lib/utils'
import type { BrowserInstanceInfo, SessionArtifactTarget } from '../../../shared/types'

export interface BrowserArtifactRuntimeProps {
  title: string
  artifact: SessionArtifactTarget
  instance: BrowserInstanceInfo | null
  isEnsuring: boolean
  error: string | null
  onShowBrowser: () => void | Promise<void>
  onReload: () => void | Promise<void>
  onBackToPreview: () => void
}

function RuntimeStatus({
  instance,
  isEnsuring,
}: {
  instance: BrowserInstanceInfo | null
  isEnsuring: boolean
}) {
  if (isEnsuring) return <span>Connecting</span>
  if (instance?.isLoading) return <span>Loading</span>
  if (instance) return <span>{instance.isVisible ? 'Visible' : 'Ready'}</span>
  return <span>Not Started</span>
}

export function BrowserArtifactRuntime({
  title,
  artifact,
  instance,
  isEnsuring,
  error,
  onShowBrowser,
  onReload,
  onBackToPreview,
}: BrowserArtifactRuntimeProps) {
  return (
    <div className="h-full bg-foreground-3 p-4">
      <div className="mx-auto flex h-full w-full max-w-[1100px] items-center justify-center overflow-hidden rounded-[16px] bg-background shadow-strong">
        <div className="w-full max-w-[640px] space-y-4 px-8 text-center">
          <div className="inline-flex items-center gap-2 rounded-full border border-border/60 bg-muted/30 px-3 py-1 text-xs font-medium text-muted-foreground">
            <Monitor className="h-3.5 w-3.5" />
            <RuntimeStatus instance={instance} isEnsuring={isEnsuring} />
          </div>

          <div className="space-y-2">
            <div className="text-xl font-semibold text-foreground">{title}</div>
            <div className="break-all text-sm text-muted-foreground">{artifact.target}</div>
          </div>

          <div className="rounded-[14px] border border-border/60 bg-muted/20 px-4 py-4 text-left">
            <div className="flex items-center justify-between gap-4">
              <div className="min-w-0">
                <div className="truncate text-sm font-medium text-foreground">
                  {instance ? (instance.title || 'Browser window') : 'Browser window'}
                </div>
                <div className="mt-1 truncate text-xs text-muted-foreground">
                  {instance?.url || artifact.target}
                </div>
              </div>
              {isEnsuring && <Spinner className="h-4 w-4 shrink-0 text-muted-foreground" />}
            </div>
          </div>

          {error && (
            <div className="rounded-[12px] border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm text-destructive">
              {error}
            </div>
          )}

          <div className="flex flex-wrap items-center justify-center gap-3">
            <button
              type="button"
              onClick={() => { void onShowBrowser() }}
              className={cn(
                'inline-flex items-center gap-2 rounded-[10px] border border-border/70 bg-background px-4 py-2',
                'text-sm font-medium text-foreground shadow-minimal transition-colors hover:bg-muted',
              )}
            >
              <Monitor className="h-4 w-4" />
              <span>{instance ? 'Show Browser' : 'Launch Browser'}</span>
            </button>
            <button
              type="button"
              onClick={() => { void onReload() }}
              className={cn(
                'inline-flex items-center gap-2 rounded-[10px] border border-border/70 bg-background px-4 py-2',
                'text-sm font-medium text-foreground shadow-minimal transition-colors hover:bg-muted',
              )}
            >
              <RefreshCw className="h-4 w-4" />
              <span>Reload</span>
            </button>
            <button
              type="button"
              onClick={onBackToPreview}
              className={cn(
                'inline-flex items-center gap-2 rounded-[10px] border border-border/70 bg-background px-4 py-2',
                'text-sm font-medium text-foreground shadow-minimal transition-colors hover:bg-muted',
              )}
            >
              <FileText className="h-4 w-4" />
              <span>Preview</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

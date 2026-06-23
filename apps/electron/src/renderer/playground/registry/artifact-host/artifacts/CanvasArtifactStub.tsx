import { Layers3 } from 'lucide-react'
import type { ArtifactRenderProps } from '../types'

export function CanvasArtifactStub(_props: ArtifactRenderProps) {
  return (
    <div className="flex h-full min-h-0 items-center justify-center rounded-[8px] border border-border/60 bg-background shadow-minimal">
      <div className="flex flex-col items-center gap-3 text-center">
        <div className="flex size-10 items-center justify-center rounded-[8px] bg-foreground/5 text-muted-foreground">
          <Layers3 className="size-5" />
        </div>
        <div>
          <p className="text-sm font-medium text-foreground">Canvas renderer registered</p>
          <p className="mt-1 text-xs text-muted-foreground">Open Agent Canvas Artifact for the Excalidraw panel surface.</p>
        </div>
      </div>
    </div>
  )
}

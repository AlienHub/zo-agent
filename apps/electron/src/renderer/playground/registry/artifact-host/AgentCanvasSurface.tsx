import * as React from 'react'
import { PanelHeader } from '@/components/app-shell/PanelHeader'
import type {
  CanvasAgentScenario,
  ExcalidrawCanvasState,
} from './canvasTypes'

const ExcalidrawCanvasEditor = React.lazy(() =>
  import('./ExcalidrawCanvasEditor').then(module => ({
    default: module.ExcalidrawCanvasEditor,
  }))
)

const initialCanvasState: ExcalidrawCanvasState = {
  elementCount: 0,
  selectedLabel: 'Nothing selected',
  autoSaveLabel: 'Saved',
}

export function AgentCanvasSurface({
  agentScenario = 'product-map',
}: {
  agentScenario?: CanvasAgentScenario
}) {
  const [, setCanvasState] = React.useState(initialCanvasState)

  return (
    <div className="flex h-full min-h-0 flex-col bg-background text-foreground">
      <PanelHeader
        title="Canvas Artifact"
        badge={<span className="rounded-[8px] border border-border/60 bg-foreground/3 px-2 py-0.5 text-xs font-medium text-muted-foreground">Auto saved</span>}
      />

      <div className="flex min-h-0 flex-1 border-t border-border/60 bg-foreground-3">
        <main className="relative min-w-0 flex-1 overflow-hidden">
          <React.Suspense fallback={<div className="flex h-full items-center justify-center text-sm text-muted-foreground">Loading canvas...</div>}>
            <ExcalidrawCanvasEditor agentScenario={agentScenario} onStateChange={setCanvasState} />
          </React.Suspense>
        </main>
      </div>
    </div>
  )
}

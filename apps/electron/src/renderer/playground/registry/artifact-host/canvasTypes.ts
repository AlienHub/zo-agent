export interface ExcalidrawCanvasState {
  elementCount: number
  selectedLabel: string
  autoSaveLabel: string
}

export type CanvasAgentScenario = 'product-map' | 'workflow' | 'review'

export interface CanvasAgentAuthoredScene {
  title: string
  description: string
}

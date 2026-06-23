import type { CanvasAgentScenario } from './canvasTypes'
import { createCanvasSeedScene } from './canvasScene'

export const canvasSeedScenes: Record<CanvasAgentScenario, string> = {
  'product-map': JSON.stringify(createCanvasSeedScene('product-map'), null, 2),
  workflow: JSON.stringify(createCanvasSeedScene('workflow'), null, 2),
  review: JSON.stringify(createCanvasSeedScene('review'), null, 2),
}

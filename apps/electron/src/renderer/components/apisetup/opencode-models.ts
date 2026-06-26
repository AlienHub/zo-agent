import type { ModelDefinition } from '@craft-agent/shared/config'
import {
  getOpenCodeZenModels,
  getOpenCodeGoModels,
} from '@config/opencode-provider'

export const OPEN_CODE_PRESET_KEYS = [
  'opencode-zen',
  'opencode-go',
] as const

export type OpenCodePresetKey = (typeof OPEN_CODE_PRESET_KEYS)[number]

export function isOpenCodePresetKey(value: string): value is OpenCodePresetKey {
  return (OPEN_CODE_PRESET_KEYS as readonly string[]).includes(value)
}

export function getOpenCodeStaticModelsForPreset(preset: string): ModelDefinition[] {
  switch (preset) {
    case 'opencode-zen':
      return getOpenCodeZenModels()
    case 'opencode-go':
      return getOpenCodeGoModels()
    default:
      return []
  }
}

function findOpenCodeModelId(
  models: ModelDefinition[],
  preferredIds: string[],
  fallbackPattern?: RegExp
): string {
  const byId = new Map(models.map((model) => [model.id, model]))
  for (const id of preferredIds) {
    if (byId.has(id)) return id
  }

  if (fallbackPattern) {
    const match = models.find((model) => fallbackPattern.test(`${model.id} ${model.name}`))
    if (match) return match.id
  }

  return models[0]?.id ?? ''
}

export function resolveOpenCodeDefaultModels(models: ModelDefinition[]): { best: string; default_: string; cheap: string } {
  const glm = findOpenCodeModelId(models, ['glm-5.2', 'glm-5.1', 'glm-5'], /\bglm\b/i)
  const fast = findOpenCodeModelId(
    models,
    ['deepseek-v4-flash', 'deepseek-v4-flash-free'],
    /deepseek.*flash/i
  )
  const fallback = models[0]?.id ?? ''

  return {
    best: glm || fallback,
    default_: glm || fallback,
    cheap: fast || glm || fallback,
  }
}

export function getOpenCodeModelIdsForSubmit(models: ModelDefinition[]): string[] {
  const seen = new Set<string>()
  const ids: string[] = []
  for (const model of models) {
    if (!model.id || seen.has(model.id)) continue
    seen.add(model.id)
    ids.push(model.id)
  }
  return ids
}

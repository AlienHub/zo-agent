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

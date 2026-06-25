import { describe, expect, it } from 'bun:test'
import {
  resolveCustomEndpointPayload,
  resolvePiAuthProviderForSubmit,
  resolvePresetStateForBaseUrlChange,
} from '../submit-helpers'
import { pickTierDefaults, resolveTierModels } from '../tier-models'

const MODELS = [
  { id: 'pi/zai-best', name: 'Best', costInput: 10, costOutput: 20, contextWindow: 200000, reasoning: true },
  { id: 'pi/zai-balanced', name: 'Balanced', costInput: 5, costOutput: 10, contextWindow: 200000, reasoning: true },
  { id: 'pi/zai-fast', name: 'Fast', costInput: 1, costOutput: 2, contextWindow: 128000, reasoning: false },
]

describe('ApiKeyInput tier hydration helpers', () => {
  it('resolveTierModels keeps saved tier selections when all are valid', () => {
    const saved = ['pi/zai-fast', 'pi/zai-balanced', 'pi/zai-best']
    const resolved = resolveTierModels(MODELS, saved)

    expect(resolved).toEqual({
      best: 'pi/zai-fast',
      default_: 'pi/zai-balanced',
      cheap: 'pi/zai-best',
    })
  })

  it('resolveTierModels preserves duplicate tiers when saved models are valid', () => {
    const saved = ['pi/zai-best', 'pi/zai-best', 'pi/zai-fast']
    const resolved = resolveTierModels(MODELS, saved)

    expect(resolved).toEqual({
      best: 'pi/zai-best',
      default_: 'pi/zai-best',
      cheap: 'pi/zai-fast',
    })
  })

  it('resolveTierModels falls back per-slot for invalid/missing saved values', () => {
    const resolved = resolveTierModels(MODELS, ['pi/zai-best', 'pi/not-real'])
    const defaults = pickTierDefaults(MODELS)

    expect(resolved).toEqual({
      best: 'pi/zai-best',
      default_: defaults.default_,
      cheap: defaults.cheap,
    })
  })
})

describe('resolvePiAuthProviderForSubmit', () => {
  it('preserves the last non-custom provider when custom endpoint mode is selected', () => {
    expect(resolvePiAuthProviderForSubmit('custom', 'openai')).toBe('openai')
  })

  it('defaults custom endpoint mode to anthropic routing when none was selected yet', () => {
    expect(resolvePiAuthProviderForSubmit('custom', null)).toBe('anthropic')
  })

  it('passes through non-custom presets unchanged', () => {
    expect(resolvePiAuthProviderForSubmit('google', 'anthropic')).toBe('google')
  })
})

describe('resolvePresetStateForBaseUrlChange', () => {
  it('updates the remembered provider when the typed URL matches a known preset', () => {
    expect(resolvePresetStateForBaseUrlChange({
      matchedPreset: 'openrouter',
      activePreset: 'custom',
      activePresetHasEmptyUrl: true,
      lastNonCustomPreset: 'anthropic',
    })).toEqual({
      activePreset: 'openrouter',
      lastNonCustomPreset: 'openrouter',
    })
  })

  it('preserves provider routing when editing a provider with an empty default URL', () => {
    expect(resolvePresetStateForBaseUrlChange({
      matchedPreset: 'custom',
      activePreset: 'azure-openai-responses',
      activePresetHasEmptyUrl: true,
      lastNonCustomPreset: 'azure-openai-responses',
    })).toEqual({
      activePreset: 'azure-openai-responses',
      lastNonCustomPreset: 'azure-openai-responses',
    })
  })

  it('falls back to custom while keeping the most recent matched provider', () => {
    expect(resolvePresetStateForBaseUrlChange({
      matchedPreset: 'custom',
      activePreset: 'openrouter',
      activePresetHasEmptyUrl: false,
      lastNonCustomPreset: 'openrouter',
    })).toEqual({
      activePreset: 'custom',
      lastNonCustomPreset: 'openrouter',
    })
  })
})

describe('resolveCustomEndpointPayload', () => {
  const BRANDED = new Set(['manifest'])
  const NO_BRANDED_ANTHROPIC = new Set<string>()
  const NO_ROUTING_SLUGS = new Set<string>()

  it('routes branded openai-compat presets through openai-completions regardless of toggle', () => {
    expect(resolveCustomEndpointPayload({
      activePreset: 'manifest',
      baseUrl: 'https://app.manifest.build/v1',
      customApi: 'anthropic-messages',
      brandedOpenAiCompatPresets: BRANDED,
      brandedAnthropicCompatPresets: NO_BRANDED_ANTHROPIC,
      brandedRoutingSlugPresets: NO_ROUTING_SLUGS,
      fallbackPiAuthProvider: undefined,
    })).toEqual({
      customEndpoint: { api: 'openai-completions' },
      piAuthProvider: 'openai',
    })
  })

  it('honors the protocol toggle for the generic custom preset', () => {
    expect(resolveCustomEndpointPayload({
      activePreset: 'custom',
      baseUrl: 'https://my-endpoint.example.com',
      customApi: 'anthropic-messages',
      brandedOpenAiCompatPresets: BRANDED,
      brandedAnthropicCompatPresets: NO_BRANDED_ANTHROPIC,
      brandedRoutingSlugPresets: NO_ROUTING_SLUGS,
      fallbackPiAuthProvider: undefined,
    })).toEqual({
      customEndpoint: { api: 'anthropic-messages' },
      piAuthProvider: 'anthropic',
    })
  })

  it('returns no customEndpoint for a standard preset, passing through the fallback piAuth', () => {
    expect(resolveCustomEndpointPayload({
      activePreset: 'openrouter',
      baseUrl: 'https://openrouter.ai/api/v1',
      customApi: 'openai-completions',
      brandedOpenAiCompatPresets: BRANDED,
      brandedAnthropicCompatPresets: NO_BRANDED_ANTHROPIC,
      brandedRoutingSlugPresets: NO_ROUTING_SLUGS,
      fallbackPiAuthProvider: 'openrouter',
    })).toEqual({
      customEndpoint: undefined,
      piAuthProvider: 'openrouter',
    })
  })

  it('treats branded preset with empty URL as non-custom (no customEndpoint)', () => {
    expect(resolveCustomEndpointPayload({
      activePreset: 'manifest',
      baseUrl: '',
      customApi: 'openai-completions',
      brandedOpenAiCompatPresets: BRANDED,
      brandedAnthropicCompatPresets: NO_BRANDED_ANTHROPIC,
      brandedRoutingSlugPresets: NO_ROUTING_SLUGS,
      fallbackPiAuthProvider: undefined,
    })).toEqual({
      customEndpoint: undefined,
      piAuthProvider: undefined,
    })
  })

  it('routes OpenCode Zen anthropic preset through anthropic-messages with its routing slug', () => {
    const OPENCODE = new Set(['opencode-zen-anthropic', 'opencode-zen-openai', 'opencode-go-anthropic', 'opencode-go-openai'])
    const ANTHROPIC_COMPAT = new Set(['opencode-zen-anthropic', 'opencode-go-anthropic'])
    expect(resolveCustomEndpointPayload({
      activePreset: 'opencode-zen-anthropic',
      baseUrl: 'https://opencode.ai/zen/v1',
      customApi: 'openai-completions',
      brandedOpenAiCompatPresets: new Set(['opencode-zen-openai', 'opencode-go-openai']),
      brandedAnthropicCompatPresets: ANTHROPIC_COMPAT,
      brandedRoutingSlugPresets: OPENCODE,
      fallbackPiAuthProvider: 'opencode-zen-anthropic',
    })).toEqual({
      customEndpoint: { api: 'anthropic-messages' },
      piAuthProvider: 'opencode-zen-anthropic',
    })
  })

  it('routes OpenCode Go openai preset through openai-completions with its routing slug', () => {
    const OPENCODE = new Set(['opencode-zen-anthropic', 'opencode-zen-openai', 'opencode-go-anthropic', 'opencode-go-openai'])
    expect(resolveCustomEndpointPayload({
      activePreset: 'opencode-go-openai',
      baseUrl: 'https://opencode.ai/zen/go/v1',
      customApi: 'anthropic-messages',
      brandedOpenAiCompatPresets: new Set(['opencode-zen-openai', 'opencode-go-openai']),
      brandedAnthropicCompatPresets: new Set(['opencode-zen-anthropic', 'opencode-go-anthropic']),
      brandedRoutingSlugPresets: OPENCODE,
      fallbackPiAuthProvider: 'opencode-go-openai',
    })).toEqual({
      customEndpoint: { api: 'openai-completions' },
      piAuthProvider: 'opencode-go-openai',
    })
  })
})

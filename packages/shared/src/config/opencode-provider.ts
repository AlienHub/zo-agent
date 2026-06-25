/**
 * Static OpenCode provider snapshot for June 2026.
 * Captures the opencode.ai/docs/zen and /docs/go catalogs until a dynamic /v1/models fetcher replaces it in a later commit.
 * GPT 5.x is excluded here because Zen serves it from /zen/v1/responses, and the pi_compat adapter only speaks openai-completions (Chat Completions).
 */

import type { ModelDefinition } from './models.ts';

export const OPENCODE_ZEN_BASE_URL = 'https://opencode.ai/zen/v1';
export const OPENCODE_GO_BASE_URL = 'https://opencode.ai/zen/go/v1';
export const OPENCODE_AUTH_URL = 'https://opencode.ai/auth';
export const OPENCODE_GO_MODELS_ENDPOINT = 'https://opencode.ai/zen/go/v1/models';
export const OPENCODE_ZEN_MODELS_ENDPOINT = 'https://opencode.ai/zen/v1/models';

const OPENCODE_GO_OPENAI_MODELS: ModelDefinition[] = [
  {
    id: 'glm-5.2',
    name: 'GLM 5.2',
    shortName: 'GLM 5.2',
    description: 'OpenCode Go subscription — open model',
    provider: 'pi',
    contextWindow: 128_000,
    supportsThinking: true,
  },
  {
    id: 'glm-5.1',
    name: 'GLM 5.1',
    shortName: 'GLM 5.1',
    description: 'OpenCode Go subscription — open model',
    provider: 'pi',
    contextWindow: 128_000,
    supportsThinking: true,
  },
  {
    id: 'kimi-k2.7',
    name: 'Kimi K2.7',
    shortName: 'Kimi K2.7',
    description: 'OpenCode Go subscription — open coding model',
    provider: 'pi',
    contextWindow: 256_000,
    supportsThinking: true,
  },
  {
    id: 'kimi-k2.6',
    name: 'Kimi K2.6',
    shortName: 'Kimi K2.6',
    description: 'OpenCode Go subscription — open model',
    provider: 'pi',
    contextWindow: 256_000,
    supportsThinking: true,
  },
  {
    id: 'deepseek-v4-pro',
    name: 'DeepSeek V4 Pro',
    shortName: 'DeepSeek V4 Pro',
    description: 'OpenCode Go subscription — open model',
    provider: 'pi',
    contextWindow: 128_000,
    supportsThinking: true,
  },
  {
    id: 'deepseek-v4-flash',
    name: 'DeepSeek V4 Flash',
    shortName: 'DeepSeek V4 Flash',
    description: 'OpenCode Go subscription — fast open model',
    provider: 'pi',
    contextWindow: 128_000,
    supportsThinking: false,
  },
  {
    id: 'mimo-v2.5',
    name: 'MiMo-V2.5',
    shortName: 'MiMo-V2.5',
    description: 'OpenCode Go subscription — free open model',
    provider: 'pi',
    contextWindow: 128_000,
    supportsThinking: false,
  },
  {
    id: 'mimo-v2.5-pro',
    name: 'MiMo-V2.5 Pro',
    shortName: 'MiMo-V2.5 Pro',
    description: 'OpenCode Go subscription — open model',
    provider: 'pi',
    contextWindow: 128_000,
    supportsThinking: true,
  },
];

const OPENCODE_GO_ANTHROPIC_MODELS: ModelDefinition[] = [
  {
    id: 'minimax-m3',
    name: 'MiniMax M3',
    shortName: 'MiniMax M3',
    description: 'OpenCode Go subscription — open model',
    provider: 'anthropic',
    contextWindow: 200_000,
    supportsThinking: false,
  },
  {
    id: 'minimax-m2.7',
    name: 'MiniMax M2.7',
    shortName: 'MiniMax M2.7',
    description: 'OpenCode Go subscription — open model',
    provider: 'anthropic',
    contextWindow: 200_000,
    supportsThinking: false,
  },
  {
    id: 'minimax-m2.5',
    name: 'MiniMax M2.5',
    shortName: 'MiniMax M2.5',
    description: 'OpenCode Go subscription — open model',
    provider: 'anthropic',
    contextWindow: 200_000,
    supportsThinking: false,
  },
  {
    id: 'qwen3.7-max',
    name: 'Qwen3.7 Max',
    shortName: 'Qwen3.7 Max',
    description: 'OpenCode Go subscription — open model',
    provider: 'anthropic',
    contextWindow: 256_000,
    supportsThinking: true,
  },
  {
    id: 'qwen3.7-plus',
    name: 'Qwen3.7 Plus',
    shortName: 'Qwen3.7 Plus',
    description: 'OpenCode Go subscription — open model',
    provider: 'anthropic',
    contextWindow: 256_000,
    supportsThinking: true,
  },
  {
    id: 'qwen3.6-plus',
    name: 'Qwen3.6 Plus',
    shortName: 'Qwen3.6 Plus',
    description: 'OpenCode Go subscription — open model',
    provider: 'anthropic',
    contextWindow: 256_000,
    supportsThinking: true,
  },
];

const OPENCODE_ZEN_OPENAI_MODELS: ModelDefinition[] = [
  {
    id: 'deepseek-v4-pro',
    name: 'DeepSeek V4 Pro',
    shortName: 'DeepSeek V4 Pro',
    description: 'OpenCode Zen pay-per-token — open model',
    provider: 'pi',
    contextWindow: 128_000,
    supportsThinking: true,
  },
  {
    id: 'deepseek-v4-flash',
    name: 'DeepSeek V4 Flash',
    shortName: 'DeepSeek V4 Flash',
    description: 'OpenCode Zen pay-per-token — fast open model',
    provider: 'pi',
    contextWindow: 128_000,
    supportsThinking: false,
  },
  {
    id: 'deepseek-v4-flash-free',
    name: 'DeepSeek V4 Flash Free',
    shortName: 'DeepSeek V4 Flash Free',
    description: 'OpenCode Zen free trial — open model',
    provider: 'pi',
    contextWindow: 128_000,
    supportsThinking: false,
  },
  {
    id: 'minimax-m2.7',
    name: 'MiniMax M2.7',
    shortName: 'MiniMax M2.7',
    description: 'OpenCode Zen pay-per-token — open model',
    provider: 'pi',
    contextWindow: 200_000,
    supportsThinking: false,
  },
  {
    id: 'minimax-m2.5',
    name: 'MiniMax M2.5',
    shortName: 'MiniMax M2.5',
    description: 'OpenCode Zen pay-per-token — open model',
    provider: 'pi',
    contextWindow: 200_000,
    supportsThinking: false,
  },
  {
    id: 'glm-5.2',
    name: 'GLM 5.2',
    shortName: 'GLM 5.2',
    description: 'OpenCode Zen pay-per-token — open model',
    provider: 'pi',
    contextWindow: 128_000,
    supportsThinking: true,
  },
  {
    id: 'glm-5.1',
    name: 'GLM 5.1',
    shortName: 'GLM 5.1',
    description: 'OpenCode Zen pay-per-token — open model',
    provider: 'pi',
    contextWindow: 128_000,
    supportsThinking: true,
  },
  {
    id: 'glm-5',
    name: 'GLM 5',
    shortName: 'GLM 5',
    description: 'OpenCode Zen pay-per-token — legacy open model',
    provider: 'pi',
    contextWindow: 128_000,
    supportsThinking: true,
  },
  {
    id: 'kimi-k2.6',
    name: 'Kimi K2.6',
    shortName: 'Kimi K2.6',
    description: 'OpenCode Zen pay-per-token — open model',
    provider: 'pi',
    contextWindow: 256_000,
    supportsThinking: true,
  },
  {
    id: 'kimi-k2.5',
    name: 'Kimi K2.5',
    shortName: 'Kimi K2.5',
    description: 'OpenCode Zen pay-per-token — legacy open model',
    provider: 'pi',
    contextWindow: 256_000,
    supportsThinking: true,
  },
  {
    id: 'grok-build-0.1',
    name: 'Grok Build 0.1',
    shortName: 'Grok Build 0.1',
    description: 'OpenCode Zen pay-per-token — open model',
    provider: 'pi',
    contextWindow: 128_000,
    supportsThinking: true,
  },
  {
    id: 'big-pickle',
    name: 'Big Pickle',
    shortName: 'Big Pickle',
    description: 'OpenCode Zen free trial — stealth open model',
    provider: 'pi',
    contextWindow: 128_000,
    supportsThinking: false,
  },
  {
    id: 'mimo-v2.5-free',
    name: 'MiMo-V2.5 Free',
    shortName: 'MiMo-V2.5 Free',
    description: 'OpenCode Zen free trial — open model',
    provider: 'pi',
    contextWindow: 128_000,
    supportsThinking: false,
  },
  {
    id: 'north-mini-code-free',
    name: 'North Mini Code Free',
    shortName: 'North Mini Code Free',
    description: 'OpenCode Zen free trial — open model',
    provider: 'pi',
    contextWindow: 128_000,
    supportsThinking: false,
  },
  {
    id: 'nemotron-3-ultra-free',
    name: 'Nemotron 3 Ultra Free',
    shortName: 'Nemotron 3 Ultra Free',
    description: 'OpenCode Zen free trial — open model',
    provider: 'pi',
    contextWindow: 128_000,
    supportsThinking: false,
  },
];

const OPENCODE_ZEN_ANTHROPIC_MODELS: ModelDefinition[] = [
  {
    id: 'claude-fable-5',
    name: 'Fable 5',
    shortName: 'Fable',
    description: 'OpenCode Zen — Claude Fable 5',
    provider: 'anthropic',
    contextWindow: 1_000_000,
    supportsThinking: true,
  },
  {
    id: 'claude-opus-4-8',
    name: 'Opus 4.8',
    shortName: 'Opus',
    description: 'OpenCode Zen — Claude Opus 4.8',
    provider: 'anthropic',
    contextWindow: 1_000_000,
    supportsThinking: true,
  },
  {
    id: 'claude-opus-4-7',
    name: 'Opus 4.7',
    shortName: 'Opus',
    description: 'OpenCode Zen — Claude Opus 4.7',
    provider: 'anthropic',
    contextWindow: 1_000_000,
    supportsThinking: true,
  },
  {
    id: 'claude-opus-4-6',
    name: 'Opus 4.6',
    shortName: 'Opus',
    description: 'OpenCode Zen — Claude Opus 4.6 (deprecated)',
    provider: 'anthropic',
    contextWindow: 1_000_000,
    supportsThinking: true,
  },
  {
    id: 'claude-opus-4-5',
    name: 'Opus 4.5',
    shortName: 'Opus',
    description: 'OpenCode Zen — Claude Opus 4.5 (deprecated)',
    provider: 'anthropic',
    contextWindow: 1_000_000,
    supportsThinking: true,
  },
  {
    id: 'claude-opus-4-1',
    name: 'Opus 4.1',
    shortName: 'Opus',
    description: 'OpenCode Zen — Claude Opus 4.1 (deprecated)',
    provider: 'anthropic',
    contextWindow: 200_000,
    supportsThinking: true,
  },
  {
    id: 'claude-sonnet-4-6',
    name: 'Sonnet 4.6',
    shortName: 'Sonnet',
    description: 'OpenCode Zen — Claude Sonnet 4.6',
    provider: 'anthropic',
    contextWindow: 200_000,
    supportsThinking: true,
  },
  {
    id: 'claude-sonnet-4-5',
    name: 'Sonnet 4.5',
    shortName: 'Sonnet',
    description: 'OpenCode Zen — Claude Sonnet 4.5 (deprecated)',
    provider: 'anthropic',
    contextWindow: 200_000,
    supportsThinking: true,
  },
  {
    id: 'claude-sonnet-4',
    name: 'Sonnet 4',
    shortName: 'Sonnet',
    description: 'OpenCode Zen — Claude Sonnet 4 (deprecated)',
    provider: 'anthropic',
    contextWindow: 200_000,
    supportsThinking: true,
  },
  {
    id: 'claude-haiku-4-5',
    name: 'Haiku 4.5',
    shortName: 'Haiku',
    description: 'OpenCode Zen — Claude Haiku 4.5',
    provider: 'anthropic',
    contextWindow: 200_000,
    supportsThinking: false,
  },
  {
    id: 'claude-3-5-haiku',
    name: 'Claude 3.5 Haiku',
    shortName: 'Haiku 3.5',
    description: 'OpenCode Zen — Claude 3.5 Haiku (legacy)',
    provider: 'anthropic',
    contextWindow: 200_000,
    supportsThinking: false,
  },
  {
    id: 'qwen3.7-max',
    name: 'Qwen3.7 Max',
    shortName: 'Qwen3.7 Max',
    description: 'OpenCode Zen — open model via Anthropic-Messages',
    provider: 'anthropic',
    contextWindow: 256_000,
    supportsThinking: true,
  },
  {
    id: 'qwen3.7-plus',
    name: 'Qwen3.7 Plus',
    shortName: 'Qwen3.7 Plus',
    description: 'OpenCode Zen — open model via Anthropic-Messages',
    provider: 'anthropic',
    contextWindow: 256_000,
    supportsThinking: true,
  },
  {
    id: 'qwen3.6-plus',
    name: 'Qwen3.6 Plus',
    shortName: 'Qwen3.6 Plus',
    description: 'OpenCode Zen — open model via Anthropic-Messages',
    provider: 'anthropic',
    contextWindow: 256_000,
    supportsThinking: true,
  },
  {
    id: 'qwen3.5-plus',
    name: 'Qwen3.5 Plus',
    shortName: 'Qwen3.5 Plus',
    description: 'OpenCode Zen — open model via Anthropic-Messages',
    provider: 'anthropic',
    contextWindow: 256_000,
    supportsThinking: true,
  },
];

export function getOpenCodeGoOpenAiModels(): ModelDefinition[] {
  return [...OPENCODE_GO_OPENAI_MODELS];
}

export function getOpenCodeGoAnthropicModels(): ModelDefinition[] {
  return [...OPENCODE_GO_ANTHROPIC_MODELS];
}

export function getOpenCodeZenOpenAiModels(): ModelDefinition[] {
  return [...OPENCODE_ZEN_OPENAI_MODELS];
}

export function getOpenCodeZenAnthropicModels(): ModelDefinition[] {
  return [...OPENCODE_ZEN_ANTHROPIC_MODELS];
}

export function getOpenCodeModels(): ModelDefinition[] {
  return [
    ...OPENCODE_GO_OPENAI_MODELS,
    ...OPENCODE_GO_ANTHROPIC_MODELS,
    ...OPENCODE_ZEN_OPENAI_MODELS,
    ...OPENCODE_ZEN_ANTHROPIC_MODELS,
  ];
}

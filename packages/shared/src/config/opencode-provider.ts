/**
 * Static OpenCode provider snapshot for June 2026.
 * Captures the opencode.ai/docs/zen and /docs/go catalogs. The static arrays
 * below act as the seeded/offline fallback; the dynamic `fetchOpenCodeModels()`
 * below refreshes them from the live `GET <base>/v1/models` endpoint so new
 * models picked up by OpenCode are surfaced without an app update.
 *
 * Each model's API protocol is recorded in OPENCODE_MODEL_API_MAP so the
 * Pi subprocess can route per-model (some use Anthropic Messages, others
 * OpenAI Chat Completions) within a single pi_compat connection.
 *
 * GPT 5.x is excluded from the static arrays because Zen serves it from
 * /zen/v1/responses, and the pi_compat adapter only speaks openai-completions
 * (Chat Completions). The dynamic fetcher does NOT filter — it trusts the live
 * endpoint. Callers that need to exclude /responses-only models must do so
 * themselves.
 */

import type { ModelDefinition } from './models.ts';
import type { ModelFetchResult } from './model-fetcher.ts';

export const OPENCODE_ZEN_BASE_URL = 'https://opencode.ai/zen/v1';
export const OPENCODE_GO_BASE_URL = 'https://opencode.ai/zen/go/v1';
export const OPENCODE_AUTH_URL = 'https://opencode.ai/auth';
export const OPENCODE_GO_MODELS_ENDPOINT = 'https://opencode.ai/zen/go/v1/models';
export const OPENCODE_ZEN_MODELS_ENDPOINT = 'https://opencode.ai/zen/v1/models';

// ============================================================
// Per-model API protocol map
// ============================================================

/**
 * Which streaming protocol each OpenCode model uses.
 * `anthropic-messages` → Zen's `/v1/messages` or Go's `/go/v1/messages`.
 * `openai-completions` → Zen's `/v1/chat/completions` or Go's `/go/v1/chat/completions`.
 *
 * Used by the Pi subprocess to set `api` per-model when registering under
 * the custom-endpoint provider, so a single connection can route models
 * through the correct protocol adaptor without the user having to know
 * about the protocol split.
 */
export const OPENCODE_MODEL_API_MAP: Record<string, 'openai-completions' | 'anthropic-messages'> = {
  // --- Go: Anthropic Messages endpoint ---
  'minimax-m3':     'anthropic-messages',
  'minimax-m2.7':   'anthropic-messages',
  'minimax-m2.5':   'anthropic-messages',
  'qwen3.7-max':    'anthropic-messages',
  'qwen3.7-plus':   'anthropic-messages',
  'qwen3.6-plus':   'anthropic-messages',

  // --- Go: OpenAI Chat Completions endpoint ---
  'glm-5.2':         'openai-completions',
  'glm-5.1':         'openai-completions',
  'kimi-k2.7':       'openai-completions',
  'kimi-k2.6':       'openai-completions',
  'deepseek-v4-pro':  'openai-completions',
  'deepseek-v4-flash': 'openai-completions',
  'mimo-v2.5':       'openai-completions',
  'mimo-v2.5-pro':   'openai-completions',

  // --- Zen: Anthropic Messages endpoint ---
  'claude-fable-5':     'anthropic-messages',
  'claude-opus-4-8':    'anthropic-messages',
  'claude-opus-4-7':    'anthropic-messages',
  'claude-opus-4-6':    'anthropic-messages',
  'claude-opus-4-5':    'anthropic-messages',
  'claude-opus-4-1':    'anthropic-messages',
  'claude-sonnet-4-6':  'anthropic-messages',
  'claude-sonnet-4-5':  'anthropic-messages',
  'claude-sonnet-4':    'anthropic-messages',
  'claude-haiku-4-5':   'anthropic-messages',
  'claude-3-5-haiku':   'anthropic-messages',

  // --- Zen: OpenAI Chat Completions endpoint ---
  'deepseek-v4-flash-free': 'openai-completions',
  'grok-build-0.1':     'openai-completions',
  'big-pickle':         'openai-completions',
  'mimo-v2.5-free':     'openai-completions',
  'north-mini-code-free':   'openai-completions',
  'nemotron-3-ultra-free':  'openai-completions',
  'glm-5':              'openai-completions',
  'kimi-k2.5':          'openai-completions',
};

// ============================================================
// Merged catalog arrays (all models per subscription)
// ============================================================

export const OPENCODE_GO_MODELS: ModelDefinition[] = [
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

export const OPENCODE_ZEN_MODELS: ModelDefinition[] = [
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

// ============================================================
// Getters
// ============================================================

export function getOpenCodeGoModels(): ModelDefinition[] {
  return [...OPENCODE_GO_MODELS];
}

export function getOpenCodeZenModels(): ModelDefinition[] {
  return [...OPENCODE_ZEN_MODELS];
}

/**
 * @deprecated Superseded by getOpenCodeGoModels() which returns all models
 *             regardless of protocol. Use OPENCODE_MODEL_API_MAP if you need
 *             per-model protocol routing in the Pi subprocess.
 */
export function getOpenCodeGoAnthropicModels(): ModelDefinition[] {
  return OPENCODE_GO_MODELS.filter(m => OPENCODE_MODEL_API_MAP[m.id] === 'anthropic-messages');
}

/**
 * @deprecated Superseded by getOpenCodeGoModels().
 */
export function getOpenCodeGoOpenAiModels(): ModelDefinition[] {
  return OPENCODE_GO_MODELS.filter(m => OPENCODE_MODEL_API_MAP[m.id] === 'openai-completions');
}

/**
 * @deprecated Superseded by getOpenCodeZenModels().
 */
export function getOpenCodeZenAnthropicModels(): ModelDefinition[] {
  return OPENCODE_ZEN_MODELS.filter(m => OPENCODE_MODEL_API_MAP[m.id] === 'anthropic-messages');
}

/**
 * @deprecated Superseded by getOpenCodeZenModels().
 */
export function getOpenCodeZenOpenAiModels(): ModelDefinition[] {
  return OPENCODE_ZEN_MODELS.filter(m => OPENCODE_MODEL_API_MAP[m.id] === 'openai-completions');
}

export function getOpenCodeModels(): ModelDefinition[] {
  return [
    ...OPENCODE_GO_MODELS,
    ...OPENCODE_ZEN_MODELS,
  ];
}

// ============================================================
// Dynamic model discovery (GET <base>/v1/models)
// ============================================================

/**
 * Given an OpenCode base URL (`https://opencode.ai/zen/v1` or
 * `.../zen/go/v1`), fetch `GET <base>/models` and map the result to
 * ModelDefinition[]. Tolerates both `{data:[...]}` (OpenAI-compatible) and
 * `{models:[...]}` response shapes. Falls back to a flat array if neither
 * key is present. Each entry is normalised via the same ModelDefinition
 * shape used by the static arrays.
 *
 * Throws on network/HTTP failure — callers should catch and keep the
 * static catalog as the fallback.
 *
 * The endpoint accepts `Authorization: Bearer <apiKey>` (same as the
 * chat/messages endpoints). No key is required for unknown/local mirrors.
 */
export async function fetchOpenCodeModels(args: {
  baseUrl: string;
  apiKey?: string;
  timeoutMs?: number;
}): Promise<ModelFetchResult> {
  const base = args.baseUrl.replace(/\/+$/, '');
  const url = `${base}/models`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), args.timeoutMs ?? 15_000);

  try {
    const headers: Record<string, string> = { accept: 'application/json' };
    if (args.apiKey && args.apiKey.trim()) {
      headers.authorization = `Bearer ${args.apiKey.trim()}`;
    }

    const res = await fetch(url, { method: 'GET', signal: controller.signal, headers });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`OpenCode models API ${res.status}: ${text.slice(0, 300)}`);
    }

    const data = await res.json() as Record<string, unknown>;
    const raw = (Array.isArray(data.models) ? data.models
      : Array.isArray(data.data) ? data.data
      : Array.isArray(data) ? data
      : []) as Array<Record<string, unknown>>;

    const models: ModelDefinition[] = raw
      .filter((m): m is Record<string, unknown> => !!m && typeof m === 'object')
      .map(m => {
        const id = (typeof m.id === 'string' ? m.id : '').trim();
        const name = (typeof m.name === 'string' ? m.name : id).trim() || id;
        const lastPart = name.split(/[\s-]/).pop() ?? name;
        const shortName = name.length > 20 ? lastPart : name;
        const contextWindowRaw =
          (m.context_window as number | undefined) ??
          (m.contextWindow as number | undefined) ??
          ((m.capabilities as Record<string, unknown> | undefined)?.limits as Record<string, unknown> | undefined)?.max_context_window_tokens as number | undefined;
        const supportsThinking = Array.isArray(m.supported_reasoning_efforts)
          ? m.supported_reasoning_efforts.length > 0
          : typeof m.supports_thinking === 'boolean' ? m.supports_thinking : true;
        const api = typeof m.api === 'string' ? m.api : undefined;
        const provider: ModelDefinition['provider'] =
          api === 'anthropic-messages' ? 'anthropic' : 'pi';
        return {
          id,
          name,
          shortName,
          description: '',
          provider,
          contextWindow: typeof contextWindowRaw === 'number' && contextWindowRaw > 0 ? contextWindowRaw : 200_000,
          supportsThinking,
        };
      })
      .filter(m => m.id.length > 0);

    return { models };
  } finally {
    clearTimeout(timer);
  }
}

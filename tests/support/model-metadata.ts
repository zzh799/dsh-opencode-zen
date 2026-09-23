/** Small, offline models.dev fixtures. Most ids deliberately do not come from
 * pi-ai; kimi-k2.6 is the exception - matching pi-ai's builtin id is what pulls
 * in its established `thinkingFormat: 'deepseek'` wire quirk (see below). */
export const MODELS_METADATA_URL = 'https://models.dev/api.json'

export function modelMetadata(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    name: 'Future model',
    reasoning: true,
    // Mirrors the live models.dev record for deepseek-v4.1-flash: effort levels
    // only, no way to turn thinking off. pi-ai's Zen builtin table says the
    // same for the deepseek-flash family (`off: null`), so the `off` level stays
    // unsupported here; tests that need it override reasoning_options themselves.
    reasoning_options: [{ type: 'effort', values: ['low', 'high', 'max'] }],
    modalities: { input: ['text', 'image'], output: ['text'] },
    limit: { context: 262144, output: 131072 },
    cost: { input: 0, output: 0, cache_read: 0 },
    ...overrides,
  }
}

export function metadataDocument(models?: Record<string, unknown>): Record<string, unknown> {
  return {
    'opencode': {
      npm: '@ai-sdk/openai-compatible',
      models: models ?? {
        'deepseek-v4-flash': modelMetadata({ name: 'DeepSeek V4 Flash', family: 'deepseek-flash', modalities: { input: ['text'] } }),
        'deepseek-v4.1-flash': modelMetadata({ name: 'DeepSeek V4.1 Flash', family: 'deepseek-flash' }),
        'kimi-k3': modelMetadata({ name: 'Kimi K3' }),
        // Pure toggle, exactly like the live models.dev record. Its pi-ai builtin
        // is the only Zen model keeping `thinkingFormat: 'deepseek'`, so this is
        // the model where selecting `off` must emit `thinking: {type:'disabled'}`
        // and never a reasoning_effort value.
        'kimi-k2.6': modelMetadata({ name: 'Kimi K2.6', reasoning_options: [{ type: 'toggle' }] }),
        'minimax-m3': modelMetadata({ name: 'MiniMax-M3', provider: { npm: '@ai-sdk/anthropic' } }),
        'union-alpha': modelMetadata({ name: 'Union Alpha Free', provider: { npm: '@ai-sdk/anthropic' }, reasoning_options: [] }),
      },
    },
  }
}

/**
 * A models.dev document carrying only the Go plan's record. `qwen3.8-max` is
 * deliberate: it lives in pi-ai's `opencode-go` table and not in `opencode`,
 * so a catalog reading the wrong record cannot accidentally resolve it.
 */
export function goMetadataDocument(models?: Record<string, unknown>): Record<string, unknown> {
  return {
    'opencode-go': {
      npm: '@ai-sdk/openai-compatible',
      models: models ?? {
        'deepseek-v4-flash': modelMetadata({ name: 'DeepSeek V4 Flash', family: 'deepseek-flash', modalities: { input: ['text'] } }),
        'qwen3.8-max': modelMetadata({ name: 'Qwen3.8 Max', provider: { npm: '@ai-sdk/anthropic' } }),
        'kimi-k3': modelMetadata({ name: 'Kimi K3' }),
      },
    },
  }
}

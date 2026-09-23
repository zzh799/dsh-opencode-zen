/**
 * Both plans on one mount. Zen keeps the top-level document; Go lives in the
 * `go` sub-object and gets its own route, catalog, remote namespace and picker
 * facts. The point of these cases is that the two never leak into each other:
 * a shared endpoint, a shared default credential and two overlapping pi-ai
 * builtin tables all invite exactly that.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import LlmRuntime from '@deepseek-ai/dsh-llm'
import { apply } from '../src/index.ts'
import { closeMockGateways, listingBody, mockGateway } from './mock-gateway.ts'
import { configOf } from './config-of.ts'
import { goMetadataDocument, metadataDocument, modelMetadata, MODELS_METADATA_URL } from './support/model-metadata.ts'

/** The Zen listing: five ids, all with a models.dev record. */
const zenIds = ['deepseek-v4-flash', 'deepseek-v4.1-flash', 'kimi-k3', 'kimi-k2.6', 'minimax-m3']
/** The Go listing: `glm-5.3` and `qwen3.8-max` serve only on this plan. */
const goIds = ['deepseek-v4-flash', 'glm-5.3', 'qwen3.8-max']
/** Deprecated in the Go record only, so the visibility switch is provably per plan. */
const goRetiredId = 'hy3'

/** Serve both plans' models.dev records, so neither adapter reaches the network. */
function serveMetadata(goModels?: Record<string, unknown>): void {
  const network = globalThis.fetch
  const go = goMetadataDocument(goModels)
  vi.stubGlobal('fetch', (input: string | URL | Request, init?: RequestInit) => String(input) === MODELS_METADATA_URL
    ? Promise.resolve(Response.json({ ...metadataDocument(), ...go }))
    : network(input, init))
}

/** Two gateways with disjoint listings, plus the Go record that marks one id retired. */
async function twoGateways(): Promise<{
  zen: Awaited<ReturnType<typeof mockGateway>>
  go: Awaited<ReturnType<typeof mockGateway>>
}> {
  serveMetadata({
    'deepseek-v4-flash': modelMetadata({ name: 'DeepSeek V4 Flash', family: 'deepseek-flash', modalities: { input: ['text'] } }),
    'glm-5.3': modelMetadata({ name: 'GLM-5.3' }),
    'qwen3.8-max': modelMetadata({ name: 'Qwen3.8 Max', provider: { npm: '@ai-sdk/anthropic' } }),
    [goRetiredId]: modelMetadata({ name: 'Hy3', status: 'deprecated' }),
  })
  return {
    zen: await mockGateway({ status: 200, body: listingBody(zenIds) }),
    go: await mockGateway({ status: 200, body: listingBody([...goIds, goRetiredId]) }),
  }
}

/** Mount the plugin against two gateways with the given per-plan overrides. */
async function mount(
  zen: string,
  go: string,
  overrides: Parameters<typeof configOf>[1] = {},
): Promise<Context> {
  const { go: goOverrides, ...rest } = overrides
  const ctx = new Context()
  await ctx.plugin(LlmRuntime)
  apply(ctx, configOf(zen, {
    apiKeyEnv: 'ZEN_KEY',
    ...rest,
    go: { enabled: true, baseURL: go, apiKeyEnv: 'ZEN_KEY', ...goOverrides },
  }))
  return ctx
}

const idsOf = async (ctx: Context, provider: string): Promise<string[]> =>
  (await ctx.llm.listModels(provider)).map(model => model.id)

afterEach(async () => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  await closeMockGateways()
})

describe('two plans on one mount', () => {
  it('registers both routes and serves each plan its own catalog', async () => {
    vi.stubEnv('ZEN_KEY', 'shared-key')
    const { zen, go } = await twoGateways()
    const ctx = await mount(zen.url, go.url)

    await expect.poll(() => ctx.llm.listProviders()).toEqual([
      { id: 'opencode-zen', name: 'OpenCode Zen' },
      { id: 'opencode-go', name: 'OpenCode Go' },
    ])

    // The overlap (`deepseek-v4-flash` is in both builtin tables) is what makes
    // this meaningful: each list is its own gateway's, not a shared one.
    expect(await idsOf(ctx, 'opencode-zen')).toEqual(zenIds)
    expect(await idsOf(ctx, 'opencode-go')).toEqual(goIds)
    expect(zen.paths).toEqual(['/models'])
    expect(go.paths).toEqual(['/models'])
  })

  it('stamps each plan on the models it lists', async () => {
    vi.stubEnv('ZEN_KEY', 'shared-key')
    const { zen, go } = await twoGateways()
    const ctx = await mount(zen.url, go.url)

    expect((await ctx.llm.listModels('opencode-go')).every(model => model.provider === 'opencode-go')).toBe(true)
    expect((await ctx.llm.listModels('opencode-zen')).every(model => model.provider === 'opencode-zen')).toBe(true)
  })

  it('keeps the picker whitelist and the deprecation switch per plan', async () => {
    vi.stubEnv('ZEN_KEY', 'shared-key')
    const { zen, go } = await twoGateways()
    const ctx = await mount(zen.url, go.url, {
      enabledModels: ['kimi-k3'],
      go: { enabledModels: [goRetiredId, 'glm-5.3'] },
    })

    // Zen's whitelist is the top-level field, Go's is its own; neither narrows the other.
    expect(await idsOf(ctx, 'opencode-zen')).toEqual(['kimi-k3'])
    // Go's whitelist names a retired model, which its own switch still hides.
    expect(await idsOf(ctx, 'opencode-go')).toEqual(['glm-5.3'])
  })

  it('withdraws only the plan whose switch or whitelist says so', async () => {
    vi.stubEnv('ZEN_KEY', 'shared-key')
    const { zen, go } = await twoGateways()
    const ctx = await mount(zen.url, go.url, { go: { enabled: false } })

    await expect.poll(() => ctx.llm.listProviders()).toEqual([{ id: 'opencode-zen', name: 'OpenCode Zen' }])
    expect(await idsOf(ctx, 'opencode-zen')).toEqual(zenIds)

    // An empty Go whitelist retires the Go route the same way, leaving Zen alone.
    const emptyGo = await mount(zen.url, go.url, { go: { enabledModels: [] } })
    await expect.poll(() => emptyGo.llm.listProviders()).toEqual([{ id: 'opencode-zen', name: 'OpenCode Zen' }])
  })

  it('registers each plan only while its own credential resolves', async () => {
    const { zen, go } = await twoGateways()

    vi.stubEnv('ZEN_KEY', 'shared-key')
    const both = await mount(zen.url, go.url)
    await expect.poll(() => both.llm.listProviders()).toEqual([
      { id: 'opencode-zen', name: 'OpenCode Zen' },
      { id: 'opencode-go', name: 'OpenCode Go' },
    ])

    // Only the Go reference is set: Zen's route must stay out of the picker.
    vi.unstubAllEnvs()
    vi.stubEnv('GO_ONLY_KEY', 'go-key')
    const goOnly = await mount(zen.url, go.url, { go: { apiKeyEnv: 'GO_ONLY_KEY' } })
    await expect.poll(() => goOnly.llm.listProviders()).toEqual([{ id: 'opencode-go', name: 'OpenCode Go' }])
    expect(await idsOf(goOnly, 'opencode-go')).toEqual(goIds)

    // Only the Zen reference is set: the Go route must stay out.
    vi.unstubAllEnvs()
    vi.stubEnv('ZEN_ONLY_KEY', 'zen-key')
    const zenOnly = await mount(zen.url, go.url, { apiKeyEnv: 'ZEN_ONLY_KEY', go: { apiKeyEnv: 'GO_ONLY_KEY' } })
    await expect.poll(() => zenOnly.llm.listProviders()).toEqual([{ id: 'opencode-zen', name: 'OpenCode Zen' }])
  })

  it('routes discovery by provider id and by endpoint, refusing anyone else', async () => {
    vi.stubEnv('ZEN_KEY', 'shared-key')
    const { zen, go } = await twoGateways()
    const ctx = await mount(zen.url, go.url)

    expect((await ctx.llm.discoverModels('llm-opencode-zen', { provider: 'opencode-go' })).map(model => model.id))
      .toEqual([...goIds, goRetiredId])
    expect((await ctx.llm.discoverModels('llm-opencode-zen', { provider: 'opencode-zen' })).map(model => model.id))
      .toEqual(zenIds)
    // A draft that names only an endpoint is matched on the segment that
    // separates the plans, then served from that plan's own configured catalog.
    expect((await ctx.llm.discoverModels('llm-opencode-zen', { baseURL: 'https://opencode.ai/zen/go/v1' })).map(m => m.id))
      .toEqual([...goIds, goRetiredId])
    expect((await ctx.llm.discoverModels('llm-opencode-zen', { baseURL: 'https://opencode.ai/zen/v1' })).map(m => m.id))
      .toEqual(zenIds)
    await expect(ctx.llm.discoverModels('llm-opencode-zen', { baseURL: 'https://gateway.example/v1' }))
      .rejects.toMatchObject({ code: 'DISCOVERY_UNSUPPORTED' })
    await expect(ctx.llm.discoverModels('llm-opencode-zen', { provider: 'someone-else' }))
      .rejects.toMatchObject({ code: 'DISCOVERY_UNSUPPORTED' })
  })
})

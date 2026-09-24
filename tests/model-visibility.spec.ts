import { registerZenRemotes } from '../src/remotes.ts'
import { afterEach, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Gateway from '@deepseek-ai/dsh-api-gateway'
import Registry from '@deepseek-ai/dsh-typert-registry'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { OpencodeZenAdapter } from '../src/adapter.ts'
import { OpencodeZenCatalog } from '../src/catalog.ts'
import {
  GO_MONTHLY_REQUESTS_URL,
  GoModelsService,
  parseGoMonthlyRequestEstimates,
  ZenModelsService,
} from '../src/models.ts'
import { PlainConfig } from '../src/config.ts'
import { formatModelPrice, isNewModel, priceDetail, sortModels } from '../src/models-contract.ts'
import { GO_ROUTE } from '../src/providers.ts'
import { closeMockGateways, listingBody, mockGateway, textEvents } from './mock-gateway.ts'
import { goMetadataDocument, metadataDocument, modelMetadata, MODELS_METADATA_URL } from './support/model-metadata.ts'
import { configOf } from './config-of.ts'

afterEach(closeMockGateways)

const estimatedRequestsHTML = `<!doctype html><table>
  <thead><tr><th>Model</th><th>requests per 5 hour</th><th>requests per week</th><th>requests per month</th></tr></thead>
  <tbody>
    <tr><td>Kimi K3</td><td>110</td><td>250</td><td>490</td></tr>
    <tr><td>DeepSeek V4.1 Flash<br><small>4x · Ends Sep 27</small></td><td><del>6,500</del><br><strong>26,000</strong></td><td><del>16,250</del><br><strong>65,000</strong></td><td><del>32,500</del><br><strong>130,000</strong></td></tr>
    <tr><td>Space Bunny Free</td><td>Unlimited</td><td>Unlimited</td><td>Unlimited</td></tr>
  </tbody>
</table>`

it('parses current monthly estimates while ignoring struck-through and promotional values', () => {
  const estimates = parseGoMonthlyRequestEstimates(estimatedRequestsHTML)

  expect(estimates.get('kimik3')).toBe(490)
  expect(estimates.get('deepseekv41flash')).toBe(130_000)
  expect(estimates.get('spacebunnyfree')).toBe('unlimited')
  expect(() => parseGoMonthlyRequestEstimates('<table><tr><th>requests per month</th></tr></table>')).toThrow(/empty/)
})

it('merges Go estimates without making a documentation outage break the model list', async () => {
  const originalFetch = globalThis.fetch
  let docsStatus = 200
  let docsRequests = 0
  vi.stubGlobal('fetch', (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input)
    if (url === GO_MONTHLY_REQUESTS_URL) {
      docsRequests += 1
      return Promise.resolve(new Response(docsStatus === 200 ? estimatedRequestsHTML : 'unavailable', {
        status: docsStatus,
        headers: { 'content-type': 'text/html; charset=utf-8' },
      }))
    }
    if (url === MODELS_METADATA_URL) {
      return Promise.resolve(Response.json(goMetadataDocument({
        'kimi-k3': modelMetadata({ name: 'Kimi K3' }),
        'deepseek-v4.1-flash': modelMetadata({ name: 'DeepSeek V4.1 Flash' }),
        'space-bunny-free': modelMetadata({ name: 'Space Bunny Free' }),
        unpublished: modelMetadata({ name: 'Unpublished Model' }),
      })))
    }
    return originalFetch(input, init)
  })
  const gateway = await mockGateway({
    status: 200,
    body: listingBody(['kimi-k3', 'deepseek-v4.1-flash', 'space-bunny-free', 'unpublished']),
  })
  const catalog = new OpencodeZenCatalog(gateway.url, 60_000, () => {}, () => {}, GO_ROUTE)
  const ctx = new Context()
  const service = new GoModelsService(ctx, { catalog: () => catalog })
  const now = vi.spyOn(Date, 'now').mockReturnValue(1_000_000)
  const emptyCtx = new Context()
  const byId = (models: readonly { id: string; estimatedMonthlyRequests?: number | 'unlimited' | null }[]) =>
    new Map(models.map(model => [model.id, model.estimatedMonthlyRequests]))
  try {
    const first = await service.read()
    expect(first.every(model => !Object.hasOwn(model, 'pricePer100m'))).toBe(true)
    expect(byId(first)).toEqual(new Map([
      ['kimi-k3', 490],
      ['deepseek-v4.1-flash', 130_000],
      ['space-bunny-free', 'unlimited'],
      // A successful table with no row is distinct from a failed first read.
      ['unpublished', null],
    ]))

    await service.read()
    expect(docsRequests).toBe(1)
    now.mockReturnValue(1_000_000 + 24 * 60 * 60 * 1000)
    await service.read()
    expect(docsRequests).toBe(2)

    docsStatus = 503
    const kept = await service.refresh()
    expect(docsRequests).toBe(3)
    expect(byId(kept).get('kimi-k3')).toBe(490)

    const failedCtx = new Context()
    const failedFirst = new GoModelsService(failedCtx, { catalog: () => catalog })
    await failedFirst.read()
    expect(docsRequests).toBe(4)
    docsStatus = 200
    const recovered = await failedFirst.read()
    expect(docsRequests).toBe(5)
    expect(byId(recovered).get('kimi-k3')).toBe(490)
    docsStatus = 503

    const neverLoaded = new GoModelsService(emptyCtx, { catalog: () => catalog })
    const bare = await neverLoaded.read()
    expect(bare.every(model => model.estimatedMonthlyRequests === undefined)).toBe(true)
    await failedCtx.fiber.dispose()
  } finally {
    now.mockRestore()
    vi.unstubAllGlobals()
    await emptyCtx.fiber.dispose()
    await ctx.fiber.dispose()
  }
})

it('sorts settings models by the selected metric while keeping retired rows last', () => {
  const models = [
    { id: 'old', name: 'Old', deprecated: true, releaseDate: '2025-01-01', pricePer100m: { source: 0.1, actual: 0.01 } },
    { id: 'new', name: 'New', releaseDate: '2026-01-01', pricePer100m: { source: 2, actual: 0.3 } },
    { id: 'cheap', name: 'Cheap', releaseDate: '2024-01-01', pricePer100m: { source: 1, actual: 0.1 } },
    { id: 'unlimited', name: 'Unlimited', releaseDate: '2023-01-01', estimatedMonthlyRequests: 'unlimited' as const },
    { id: 'many', name: 'Many', estimatedMonthlyRequests: 100 },
    { id: 'unknown', name: 'Unknown', estimatedMonthlyRequests: null },
  ]

  expect(sortModels(models, Date.parse('2026-01-02'), 'price').map(model => model.id)).toEqual(['cheap', 'new', 'many', 'unknown', 'unlimited', 'old'])
  expect(sortModels(models, Date.parse('2026-01-02'), 'release').map(model => model.id)).toEqual(['new', 'cheap', 'unlimited', 'many', 'unknown', 'old'])
  expect(sortModels(models, Date.parse('2026-01-02'), 'monthly').map(model => model.id)).toEqual(['unlimited', 'many', 'cheap', 'new', 'unknown', 'old'])
})

it('keeps settings gateway-only and filters deprecated picker entries without disabling their requests', async () => {
  const original = globalThis.fetch
  let metadataDown = false
  vi.stubGlobal('fetch', (input: string | URL | Request, init?: RequestInit) => String(input) === MODELS_METADATA_URL
    ? Promise.resolve(metadataDown ? new Response('', { status: 503 }) : Response.json(metadataDocument({
      current: modelMetadata({ release_date: '2026-09-22', cost: { input: 0.1, output: 0.2, cache_read: 0.002 } }),
      old: modelMetadata({ status: 'deprecated' }),
      absent: modelMetadata({ status: 'deprecated' }),
    }))) : original(input, init))
  const gateway = await mockGateway({ status: 200, body: listingBody(['current', 'old']) })
  const config = configOf(`${gateway.url}/v1`)
  expect(PlainConfig({}).showDeprecatedModels).toBe(false)
  const adapter = new OpencodeZenAdapter({ config: () => config, resolveApiKey: async () => 'test-key' })
  const ctx = new Context()
  await ctx.plugin(Registry)
  await ctx.plugin(Gateway)
  registerZenRemotes(ctx)
  await ctx.plugin(ZenModelsService, { catalog: () => adapter.catalogOf(config) })
  try {
    const read = () => ctx.typertGateway.invoke({ namespace: 'opencodeZenModels', method: 'read', args: {} })
    expect(await read()).toEqual([
      expect.objectContaining({ id: 'current', releaseDate: '2026-09-22', contextWindow: 262144,
        pricePer100m: expect.any(Object) }),
      expect.objectContaining({ id: 'old', deprecated: true }),
    ])
    expect((await adapter.listModels('opencode-zen')).map(m => m.id)).toEqual(['current'])
    config.showDeprecatedModels = true
    expect((await adapter.listModels('opencode-zen')).map(m => m.id)).toEqual(['current', 'old'])
    config.showDeprecatedModels = false
    // Hiding affects pickers; existing conversations can keep using the served model.
    gateway.pushCompletions({ events: textEvents })
    const chunks = []
    for await (const chunk of adapter.stream({ provider: 'opencode-zen', model: 'old',
      messages: [createUserMessage({ content: [{ type: 'text', text: 'hello' }], source: { kind: 'plugin', plugin: 'test' } })] })) chunks.push(chunk)
    expect(chunks.length).toBeGreaterThan(0)
    metadataDown = true
    expect((await adapter.listModels('opencode-zen')).map(m => m.id)).toEqual(['current'])
    config.showDeprecatedModels = true
    gateway.setModelListing(200, listingBody(['current']))
    expect((await read() as Array<{ id: string }>).map(m => m.id)).toEqual(['current'])
    expect((await adapter.listModels('opencode-zen')).map(m => m.id)).toEqual(['current'])
  } finally { await ctx.fiber.dispose() }
})

it('uses actual release dates for the seven-day badge and sorts deprecated models last', () => {
  const now = Date.parse('2026-09-22T12:00:00Z')
  expect(isNewModel({ id: 'a', releaseDate: '2026-09-16' }, now)).toBe(true)
  for (const releaseDate of ['2026-09-15', '2026-09-23', '2026-02-30', undefined]) {
    expect(isNewModel({ id: 'a', releaseDate }, now)).toBe(false)
  }
  expect(sortModels([
    { id: 'old', deprecated: true, releaseDate: '2026-09-22' },
    { id: 'normal' }, { id: 'new', releaseDate: '2026-09-22' },
  ], now).map(m => m.id)).toEqual(['new', 'normal', 'old'])
})

it('reports the price badge and the arithmetic behind its hover', () => {
  expect(formatModelPrice(3)).toBe('$3.00')
  expect(formatModelPrice(0.0872)).toBe('$0.09')
  // Sub-cent prices keep four digits; at two, cheap models would all read $0.00.
  expect(formatModelPrice(0.004)).toBe('$0.0040')
  // Charging the source price leaves no ratio to report.
  expect(priceDetail({ source: 3, actual: 3 })).toEqual({ badge: '$3.00', perMillion: '$0.0300' })
  expect(priceDetail({ source: 0.5219, actual: 0.0872 }))
    .toEqual({ badge: '$0.09', perMillion: '$0.0009', ratio: '17%' })
  // A zero source price cannot serve as the baseline for a percentage.
  expect(priceDetail({ source: 0, actual: 0 })).toEqual({ badge: '$0.00', perMillion: '$0.0000' })
})

it('round-trips the picker whitelist, keeping "never set" distinct from "none"', () => {
  // The upgrade posture: a document that predates the field parses to nothing
  // at all, which is what "every model visible" is read from. A schema default
  // of `[]` would have turned every upgrade into "nothing checked".
  expect(PlainConfig({}).enabledModels).toBeUndefined()
  expect(PlainConfig({ enabledModels: null }).enabledModels).toBeNull()
  expect(PlainConfig({ enabledModels: ['a', 'b'] }).enabledModels).toEqual(['a', 'b'])
  expect(PlainConfig({ enabledModels: [] }).enabledModels).toEqual([])
  expect(() => PlainConfig({ enabledModels: 'a' })).toThrow(/expected/)
})

it('filters picker entries by the whitelist without blocking explicit model ids', async () => {
  const original = globalThis.fetch
  vi.stubGlobal('fetch', (input: string | URL | Request, init?: RequestInit) => String(input) === MODELS_METADATA_URL
    ? Promise.resolve(Response.json(metadataDocument({
      alpha: modelMetadata({ name: 'Alpha' }),
      beta: modelMetadata({ name: 'Beta' }),
      old: modelMetadata({ name: 'Old', status: 'deprecated' }),
    }))) : original(input, init))
  const gateway = await mockGateway({ status: 200, body: listingBody(['alpha', 'beta', 'old']) })
  const config = configOf(`${gateway.url}/v1`)
  const adapter = new OpencodeZenAdapter({ config: () => config, resolveApiKey: async () => 'test-key' })
  const visible = async (): Promise<string[]> => (await adapter.listModels('opencode-zen')).map(model => model.id)
  try {
    // Never set: every model the gateway serves stays in the picker.
    expect(await visible()).toEqual(['alpha', 'beta'])

    config.enabledModels = ['beta']
    expect(await visible()).toEqual(['beta'])

    // Whitelist and deprecated switch are orthogonal: the whitelist never
    // resurrects a deprecated model, and the switch never adds one the
    // whitelist left out.
    config.showDeprecatedModels = true
    expect(await visible()).toEqual(['beta'])
    config.enabledModels = ['beta', 'old', 'gamma']
    expect(await visible()).toEqual(['beta', 'old'])

    // An id the catalog no longer serves is not listed, and never throws.
    config.enabledModels = ['gamma', 'alpha']
    expect(await visible()).toEqual(['alpha'])

    // Nothing checked is an empty picker list, not a failure.
    config.enabledModels = []
    expect(await visible()).toEqual([])

    // The whitelist filters the picker alone: an explicitly named id still runs.
    gateway.pushCompletions({ events: textEvents })
    const chunks = []
    for await (const chunk of adapter.stream({ provider: 'opencode-zen', model: 'alpha',
      messages: [createUserMessage({ content: [{ type: 'text', text: 'hello' }], source: { kind: 'plugin', plugin: 'test' } })] })) chunks.push(chunk)
    expect(chunks.find(chunk => chunk.type === 'finish')).toMatchObject({ reason: { kind: 'stop' } })
    expect(await adapter.resolveModel('opencode-zen', 'alpha')).toMatchObject({ id: 'alpha' })
  } finally { await closeMockGateways() }
})

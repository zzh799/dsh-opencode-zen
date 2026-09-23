import { registerZenRemotes } from '../src/remotes.ts'
import { afterEach, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Gateway from '@deepseek-ai/dsh-api-gateway'
import Registry from '@deepseek-ai/dsh-typert-registry'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { OpencodeZenAdapter } from '../src/adapter.ts'
import { ZenModelsService } from '../src/models.ts'
import { PlainConfig } from '../src/config.ts'
import { isNewModel, sortModels } from '../src/models-contract.ts'
import { closeMockGateways, listingBody, mockGateway, textEvents } from './mock-gateway.ts'
import { metadataDocument, modelMetadata, MODELS_METADATA_URL } from './support/model-metadata.ts'
import { configOf } from './config-of.ts'

afterEach(closeMockGateways)

it('keeps settings gateway-only and filters deprecated picker entries without disabling their requests', async () => {
  const original = globalThis.fetch
  let metadataDown = false
  vi.stubGlobal('fetch', (input: string | URL | Request, init?: RequestInit) => String(input) === MODELS_METADATA_URL
    ? Promise.resolve(metadataDown ? new Response('', { status: 503 }) : Response.json(metadataDocument({
      current: modelMetadata({ release_date: '2026-09-22' }),
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
      expect.objectContaining({ id: 'current', releaseDate: '2026-09-22', contextWindow: 262144 }),
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

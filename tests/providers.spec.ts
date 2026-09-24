import { describe, expect, it } from 'vitest'
import { getBuiltinModels } from '@earendil-works/pi-ai/providers/all'
import { calculatePricePer100m, readModelMetadata } from '../src/model-metadata.ts'
import { GO_ROUTE, ZEN_ROUTE } from '../src/providers.ts'
import { goMetadataDocument, metadataDocument } from './support/model-metadata.ts'

const builtinTable = (key: string): Map<string, ReturnType<typeof getBuiltinModels>[number]> =>
  new Map(getBuiltinModels(key).map(model => [model.id, model]))

describe('route descriptors', () => {
  it('names both plans, their endpoints and their source keys', () => {
    expect(ZEN_ROUTE).toEqual({
      id: 'opencode-zen', displayName: 'OpenCode Zen',
      defaultBaseURL: 'https://opencode.ai/zen/v1', builtinKey: 'opencode', metadataKey: 'opencode',
    })
    expect(GO_ROUTE).toEqual({
      id: 'opencode-go', displayName: 'OpenCode Go',
      defaultBaseURL: 'https://opencode.ai/zen/go/v1', builtinKey: 'opencode-go', metadataKey: 'opencode-go',
    })
  })

  it('addresses a different source for every plan', () => {
    expect(GO_ROUTE.id).not.toBe(ZEN_ROUTE.id)
    expect(GO_ROUTE.defaultBaseURL).not.toBe(ZEN_ROUTE.defaultBaseURL)
    expect(GO_ROUTE.builtinKey).not.toBe(ZEN_ROUTE.builtinKey)
    expect(GO_ROUTE.metadataKey).not.toBe(ZEN_ROUTE.metadataKey)
  })
})

describe('the shipped pi-ai tables', () => {
  it('gives each plan its own table with ids the other one lacks', () => {
    const zen = builtinTable(ZEN_ROUTE.builtinKey)
    const go = builtinTable(GO_ROUTE.builtinKey)
    expect(zen.size).toBeGreaterThan(0)
    expect(go.size).toBeGreaterThan(0)
    // The tables overlap, so distinctness is what matters, not disjointness.
    expect([...go.keys()].sort()).not.toEqual([...zen.keys()].sort())
    expect(go.has('qwen3.8-max')).toBe(true)
    expect(zen.has('qwen3.8-max')).toBe(false)
  })
})

describe('model price summary', () => {
  it('applies the supplied weighted 100M-token formula and plan multiplier', () => {
    const price = calculatePricePer100m({ input: 0.1, output: 0.2, cacheRead: 0.002, cacheWrite: 0 })
    expect(price.source).toBeCloseTo(0.5219084, 7)
    expect(price.actual).toBeCloseTo(0.0871587028, 9)
  })
})

describe('readModelMetadata on one route', () => {
  it('reads the Go record and stamps the Go provider id on every model', () => {
    const metadata = readModelMetadata(
      goMetadataDocument(), GO_ROUTE.defaultBaseURL, builtinTable(GO_ROUTE.builtinKey), GO_ROUTE,
    )
    expect([...metadata.models.keys()].sort()).toEqual(['deepseek-v4-flash', 'kimi-k3', 'qwen3.8-max'])
    expect(metadata.errors.size).toBe(0)
    expect(metadata.models.get('qwen3.8-max')?.provider).toBe(GO_ROUTE.id)
    expect(metadata.models.get('qwen3.8-max')?.api).toBe('anthropic-messages')
    // The Anthropic SDK appends /v1/messages itself, so the Go plan's
    // .../zen/go/v1 base loses its /v1 while an OpenAI-protocol model keeps it.
    expect(metadata.models.get('qwen3.8-max')?.baseUrl).toBe('https://opencode.ai/zen/go')
    expect(metadata.models.get('deepseek-v4-flash')?.baseUrl).toBe(GO_ROUTE.defaultBaseURL)
  })

  it('refuses a document carrying only the sibling plan\'s record', () => {
    expect(() => readModelMetadata(
      metadataDocument(), GO_ROUTE.defaultBaseURL, builtinTable(GO_ROUTE.builtinKey), GO_ROUTE,
    )).toThrow(/no opencode-go models object/)
    expect(() => readModelMetadata(
      goMetadataDocument(), ZEN_ROUTE.defaultBaseURL, builtinTable(ZEN_ROUTE.builtinKey),
    )).toThrow(/no opencode models object/)
  })
})

import { describe, expect, it } from 'vitest'
import { Config, PlainConfig, readConfig, assertBaseURL, DEFAULT_API_KEY_ENV, DEFAULT_REFRESH_MINUTES, DEFAULT_STREAM_IDLE_TIMEOUT_MS } from '../src/config.ts'
import {
  DEFAULT_MAX_REQUEST_IMAGE_BYTES,
  DEFAULT_REQUEST_IMAGE_MAX_BYTES,
  DEFAULT_REQUEST_IMAGE_PIXEL_BUDGET,
} from '../src/conversion/index.ts'
import { GO_ROUTE, ZEN_ROUTE } from '../src/providers.ts'

/** An exact 0.2.0-shaped document: the top-level fields as that release wrote them. */
const zenDocument = {
  enabled: false,
  showDeprecatedModels: true,
  enabledModels: ['kimi-k3'],
  apiKeyEnv: 'MY_ZEN_KEY',
  baseURL: 'https://example.test/zen/v1',
  refreshMinutes: 15,
  streamIdleTimeoutMs: 1_234,
  maxRequestImageBytes: 11,
  requestImagePixelBudget: 22,
  requestImageMaxBytes: 33,
  modelLimits: { 'kimi-k3': { contextWindow: 42, maxTokens: null } },
}

describe('the Go plan in the plain document', () => {
  it('defaults to a usable plan on the shared credential', () => {
    const plain = PlainConfig({})
    expect(plain.go).toEqual({
      enabled: true,
      showDeprecatedModels: false,
      apiKeyEnv: DEFAULT_API_KEY_ENV,
      baseURL: GO_ROUTE.defaultBaseURL,
      modelLimits: {},
    })
    expect(plain.go.enabledModels).toBeUndefined()
  })

  it('keeps the sibling defaults when only one Go field is written', () => {
    const plain = PlainConfig({ go: { enabled: false } })
    expect(plain.go.enabled).toBe(false)
    expect(plain.go.baseURL).toBe(GO_ROUTE.defaultBaseURL)
    expect(plain.go.apiKeyEnv).toBe(DEFAULT_API_KEY_ENV)
  })

  it('reads the top-level fields exactly as the previous release wrote them', () => {
    const plain = PlainConfig(zenDocument)
    expect(plain).toMatchObject(zenDocument)
    expect(plain.baseURL).toBe('https://example.test/zen/v1')
    expect(plain.go.baseURL).toBe(GO_ROUTE.defaultBaseURL)
  })

  it('applies the schema defaults to an empty top level', () => {
    const plain = PlainConfig({ go: {} })
    expect(plain.enabled).toBe(true)
    expect(plain.showDeprecatedModels).toBe(false)
    expect(plain.apiKeyEnv).toBe(DEFAULT_API_KEY_ENV)
    expect(plain.baseURL).toBe(ZEN_ROUTE.defaultBaseURL)
    expect(plain.refreshMinutes).toBe(DEFAULT_REFRESH_MINUTES)
    expect(plain.streamIdleTimeoutMs).toBe(DEFAULT_STREAM_IDLE_TIMEOUT_MS)
    expect(plain.maxRequestImageBytes).toBe(DEFAULT_MAX_REQUEST_IMAGE_BYTES)
    expect(plain.requestImagePixelBudget).toBe(DEFAULT_REQUEST_IMAGE_PIXEL_BUDGET)
    expect(plain.requestImageMaxBytes).toBe(DEFAULT_REQUEST_IMAGE_MAX_BYTES)
    expect(plain.modelLimits).toEqual({})
  })

  it('refuses a wrongly typed nested field instead of coercing it', () => {
    expect(() => PlainConfig({ go: { baseURL: 123 } })).toThrow()
    expect(() => PlainConfig({ go: { enabled: 'yes' } })).toThrow()
    expect(() => PlainConfig({ go: { modelLimits: { m: { contextWindow: 0 } } } })).toThrow()
  })
})

describe('the Go plan in the live document', () => {
  it('carries a reference per leaf and unpacks back to plain values', () => {
    const live = Config({ go: { enabled: false, apiKeyEnv: 'GO_KEY' } })
    // The leaves are references; the container must stay an ordinary object,
    // because schemastery refuses a volatile field inside a volatile one.
    expect(typeof live.go.enabled.get).toBe('function')
    expect(live.go.enabled.get()).toBe(false)
    expect(live.go.apiKeyEnv.get()).toBe('GO_KEY')

    const plain = readConfig(live)
    expect(plain.go.enabled).toBe(false)
    expect(plain.go.apiKeyEnv).toBe('GO_KEY')
    expect(plain.go.baseURL).toBe(GO_ROUTE.defaultBaseURL)
    expect(plain.go.modelLimits).toEqual({})
    expect(plain.enabled).toBe(true)
    expect(plain.baseURL).toBe(ZEN_ROUTE.defaultBaseURL)
    expect(plain.refreshMinutes).toBe(DEFAULT_REFRESH_MINUTES)
  })

  it('reads a live document whose Go block was never written', () => {
    const plain = readConfig(Config({ baseURL: 'https://example.test/zen/v1' }))
    expect(plain.baseURL).toBe('https://example.test/zen/v1')
    expect(plain.go.enabled).toBe(true)
    expect(plain.go.baseURL).toBe(GO_ROUTE.defaultBaseURL)
  })
})

describe('assertBaseURL labels the field it refuses', () => {
  it('names the nested field in the refusal', () => {
    expect(() => assertBaseURL('not a url', 'go.baseURL')).toThrow(/go\.baseURL "not a url" is not a valid URL/)
    expect(() => assertBaseURL('ftp://x.test', 'go.baseURL')).toThrow(/go\.baseURL "ftp:\/\/x.test" must be http or https/)
    expect(() => assertBaseURL('https://x.test/?q=1', 'go.baseURL')).toThrow(/must not carry a query or fragment/)
  })

  it('still defaults to the top-level field name', () => {
    expect(() => assertBaseURL('not a url')).toThrow(/baseURL "not a url"/)
    expect(assertBaseURL('https://x.test/v1/')).toBe('https://x.test/v1')
  })
})

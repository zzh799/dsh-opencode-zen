import type { OpencodeGoConfig, OpencodeZenConfig } from '../src/config.ts'
import { GO_ROUTE } from '../src/providers.ts'

/** The Go plan's schema defaults, restated so a test can name them explicitly. */
export const goConfigDefaults: OpencodeGoConfig = {
  enabled: true,
  showDeprecatedModels: false,
  apiKeyEnv: 'OPENCODE_API_KEY',
  baseURL: GO_ROUTE.defaultBaseURL,
  modelLimits: {},
}

/** A partial override for either half of the document. */
export interface ConfigOverrides extends Partial<Omit<OpencodeZenConfig, 'go'>> {
  go?: Partial<OpencodeGoConfig>
}

/**
 * One resolved configuration for direct adapter construction or a plugin
 * mount: every field the schema would default is spelled out, so a test's
 * effective values never depend on defaults it never read.
 *
 * The one deliberate divergence from the schema defaults is `go.enabled`,
 * which is false here and true in production. Both plans default to the same
 * credential reference, so in a composition that stubs `OPENCODE_API_KEY` a
 * schema-defaulted Go route would register too, reach the real
 * `https://opencode.ai/zen/go/v1` over the network, and break every exact
 * provider-list assertion. A test that wants the Go plan opts in through
 * `overrides.go`, and `goConfigDefaults` names the value it then departs from.
 */
export function configOf(baseURL: string, overrides: ConfigOverrides = {}): OpencodeZenConfig {
  const { go, ...rest } = overrides
  return {
    enabled: true,
    showDeprecatedModels: false,
    apiKeyEnv: 'OPENCODE_API_KEY',
    baseURL,
    refreshMinutes: 60,
    streamIdleTimeoutMs: 5_000,
    maxRequestImageBytes: 20 * 1024 * 1024,
    requestImagePixelBudget: 2048 * 2048,
    requestImageMaxBytes: 1024 * 1024,
    modelLimits: {},
    ...rest,
    go: { ...goConfigDefaults, ...go },
  }
}

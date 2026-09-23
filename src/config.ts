/**
 * Configuration schema for the OpenCode adapter plugin. One document configures
 * both plans it serves: the top-level fields describe OpenCode Zen and the
 * `go` sub-object overrides the same knobs for the OpenCode Go subscription.
 * The section is installed under the `llm-opencode-zen` settings namespace on
 * DSH 0.1.5/0.1.6; DSH 0.1.7 edits the `opencode-zen` profile entry through
 * live references. Both paths update field by field without a restart, nested
 * fields included: every leaf carries its own reference and the Loader commits
 * the changed paths in place. Self-contained constraints (URL shape, numeric
 * bounds) fail at load for the composition layer and refuse the write for the
 * settings layer.
 *
 * @module dsh-opencode-zen/config
 */

import { MAX_TIMER_DELAY_MS } from '@deepseek-ai/dsh-timeout'
import {
  DEFAULT_MAX_REQUEST_IMAGE_BYTES,
  DEFAULT_REQUEST_IMAGE_MAX_BYTES,
  DEFAULT_REQUEST_IMAGE_PIXEL_BUDGET,
} from './conversion/index.ts'
import z from '@deepseek-ai/schemastery'
import { ZEN_ROUTE, GO_ROUTE } from './providers.ts'

/** Environment variable resolving the OpenCode API key. Both plans default to it. */
export const DEFAULT_API_KEY_ENV = 'OPENCODE_API_KEY'

/** Runtime request cache lifetime; model listing/discovery always revalidates immediately. */
export const DEFAULT_REFRESH_MINUTES = 60

/** Default maximum idle interval while a stream read is outstanding. */
export const DEFAULT_STREAM_IDLE_TIMEOUT_MS = 300_000

/**
 * One model's configured capacities. Every field is optional so a deployment
 * can override only the value it needs. Null explicitly selects the catalog
 * value even when a lower profile/settings layer supplies an override.
 */
export interface OpencodeZenModelLimit {
  /** Context window in tokens, overriding what the catalog advertised. */
  contextWindow?: number | null
  /** Output cap per request, overriding what the catalog advertised. */
  maxTokens?: number | null
}

/** Per-model capacities; a null entry selects both original catalog values. */
export type OpencodeZenModelLimits = Record<string, OpencodeZenModelLimit | null>

/**
 * The OpenCode Go subscription's own fields. Only what must differ per plan
 * lives here: the route switch, its credential, its endpoint, its picker
 * whitelist and its capacity overrides. Global knobs stay top-level and apply
 * to both plans.
 */
export interface OpencodeGoConfig {
  /**
   * Whether the plugin serves the `opencode-go` route at all. Defaults to true,
   * so the plan is usable the moment the account has one; a reader without the
   * subscription turns it off here rather than in every picker. Registration
   * still requires `go.apiKeyEnv` to resolve: see the plugin's route gate.
   */
  enabled: boolean
  /** Include models marked deprecated by models.dev in the Go pickers. */
  showDeprecatedModels: boolean
  /** Picker whitelist for the Go plan; the same semantics as the top-level field. */
  enabledModels?: string[] | null
  /** Credential reference for the Go plan; defaults to the shared OpenCode key. */
  apiKeyEnv: string
  /** The Go gateway endpoint; also the base of its live model listing. */
  baseURL: string
  /** Per-model capacity overrides for the Go plan; an absent field inherits the catalog value. */
  modelLimits: OpencodeZenModelLimits
}

/** Runtime configuration for one plugin mount. */
export interface OpencodeZenConfig {
  /**
   * Whether this adapter serves its route at all. False withdraws the
   * `opencode-zen` route and its models from every picker without unloading the
   * plugin, so the settings page that owns this switch stays reachable to turn
   * it back on. Independent of the credential: a key present while this is
   * false registers nothing.
   */
  enabled: boolean
  /** Include models marked deprecated by models.dev in conversation pickers. */
  showDeprecatedModels: boolean
  /**
   * Picker whitelist: the model ids conversation pickers may offer. Absent means
   * the field was never set, which admits every model the gateway serves: the
   * read of a document written before this field existed. An empty array is a
   * deliberate "none" and withdraws the provider from the pickers rather than
   * leaving an empty shell in them.
   *
   * The whitelist filters the picker's list only. A model id named anywhere
   * else (a headless patch, an agent default, a running conversation) is served
   * exactly as before, and an unchecked model never becomes an error.
   *
   * `null` is the schema's other spelling of an absent field and reads the same
   * way, so a hand-edited document cannot accidentally mean "no model".
   */
  enabledModels?: string[] | null
  /** Credential reference: the environment variable the key resolves from. */
  apiKeyEnv: string
  /** The gateway endpoint; also the base of the live model listing. */
  baseURL: string
  /** Runtime request cache lifetime in minutes; explicit catalog reads bypass it. */
  refreshMinutes: number
  /** Largest idle gap between stream events before the request fails. */
  streamIdleTimeoutMs: number
  /** Request-level bound on base64-encoded image payload, in bytes. */
  maxRequestImageBytes: number
  /** Total-pixel budget for one request image. */
  requestImagePixelBudget: number
  /** Raw encoded-byte target for one request image before base64 expansion. */
  requestImageMaxBytes: number
  /** Per-model capacity overrides; an absent field inherits the catalog value. */
  modelLimits: OpencodeZenModelLimits
  /** The OpenCode Go subscription plan, served alongside the Zen fields above. */
  go: OpencodeGoConfig
}

/** Per-model capacities schema. Built fresh per owner: two plans each get one. */
const modelLimitsSchema = (): z<OpencodeZenModelLimits> => z.dict(z.union([z.const(null), z.object({
  contextWindow: z.union([z.const(null), z.number().step(1).min(1).max(Number.MAX_SAFE_INTEGER)]),
  maxTokens: z.union([z.const(null), z.number().step(1).min(1).max(Number.MAX_SAFE_INTEGER)]),
})])).default({})

// Deliberately nullable rather than defaulted: a plain `z.array()` resolves an
// absent field to `[]`, which would erase the difference between a document
// that predates the whitelist (every model visible) and a stored empty list
// (a deliberate "none") on the first upgrade. `z.const(null)` is the same
// spelling the per-model overrides already use for an explicit reset.
const enabledModelsSchema = () => z.union([z.const(null), z.array(z.string())])

/**
 * The fields the top-level document carries: OpenCode Zen plus the knobs both
 * plans share. Field order here is the order the settings page renders.
 */
const zenFields = {
  enabled: z.boolean().default(true),
  showDeprecatedModels: z.boolean().default(false),
  enabledModels: enabledModelsSchema(),
  apiKeyEnv: z.string().role('credential-ref').default(DEFAULT_API_KEY_ENV),
  baseURL: z.string().default(ZEN_ROUTE.defaultBaseURL),
  refreshMinutes: z.number().step(1).min(1).max(7 * 24 * 60).default(DEFAULT_REFRESH_MINUTES),
  streamIdleTimeoutMs: z.number().min(Number.MIN_VALUE).max(MAX_TIMER_DELAY_MS).default(DEFAULT_STREAM_IDLE_TIMEOUT_MS),
  // The image defaults are the generic pi-ai adapter's: one normalized
  // request image fits the budget, and fifteen of them fit the payload cap.
  maxRequestImageBytes: z.number().step(1).min(1).default(DEFAULT_MAX_REQUEST_IMAGE_BYTES),
  requestImagePixelBudget: z.number().step(1).min(1).default(DEFAULT_REQUEST_IMAGE_PIXEL_BUDGET),
  requestImageMaxBytes: z.number().step(1).min(1).default(DEFAULT_REQUEST_IMAGE_MAX_BYTES),
  // null explicitly selects catalog values, overriding even inherited profile limits.
  modelLimits: modelLimitsSchema(),
}

/** The OpenCode Go plan's fields. Defaults make the plan usable out of the box. */
const goFields = {
  enabled: z.boolean().default(true),
  showDeprecatedModels: z.boolean().default(false),
  enabledModels: enabledModelsSchema(),
  apiKeyEnv: z.string().role('credential-ref').default(DEFAULT_API_KEY_ENV),
  baseURL: z.string().default(GO_ROUTE.defaultBaseURL),
  modelLimits: modelLimitsSchema(),
}

/** Plain values used by the adapter and by pre-0.1.7 settings documents. */
export const PlainConfig: z<OpencodeZenConfig> = z.object({ ...zenFields, go: z.object(goFields) })

/** A stable reference to the Go plan's fields; one per leaf, never to the container. */
export type LiveGoConfig = { [K in keyof OpencodeGoConfig]: { get(): OpencodeGoConfig[K] } }

/**
 * 0.1.7's Loader retains these references when profile fields change. The `go`
 * container itself is an ordinary object: schemastery refuses a volatile field
 * inside a volatile one ("volatile fields require a fixed object path without
 * an enclosing volatile field"), so only the leaves carry references and the
 * Loader commits `["go", field]` paths in place.
 */
export type LiveConfig = {
  [K in Exclude<keyof OpencodeZenConfig, 'go'>]: { get(): OpencodeZenConfig[K] }
} & { go: LiveGoConfig }
export const Config = z.object({
  ...Object.fromEntries(Object.entries(zenFields).map(([key, schema]) => [key, schema.volatile()])),
  go: z.object(Object.fromEntries(Object.entries(goFields).map(([key, schema]) => [key, schema.volatile()]))),
}) as z<Partial<OpencodeZenConfig>, LiveConfig>

/** Keep the Loader's references: reparsing them would detach live updates. */
export function readConfig(config: LiveConfig): OpencodeZenConfig {
  const { go, ...rest } = config as LiveConfig & Record<string, { get(): unknown }>
  const plain = Object.fromEntries(Object.entries(rest).map(([key, ref]) => [key, ref.get()]))
  const goPlain = Object.fromEntries(Object.entries(go).map(([key, ref]) => [key, ref.get()]))
  return { ...plain, go: goPlain } as unknown as OpencodeZenConfig
}

/**
 * Whether one model id may appear in a conversation picker. An absent
 * whitelist admits every id: the field was never set, which is what an
 * upgraded document looks like.
 * @param whitelist - the configured picker whitelist; null and undefined both mean "never set".
 * @param id - the gateway model id to test.
 * @returns whether the picker may list the model.
 */
export function modelInPickerWhitelist(whitelist: readonly string[] | null | undefined, id: string): boolean {
  return whitelist == null || whitelist.includes(id)
}

/**
 * Whether the whitelist withdraws the provider from the pickers entirely. A
 * deliberate empty list is "no model picked", and a provider with nothing to
 * offer must leave the picker rather than sit in it as an empty shell.
 * @param whitelist - the configured picker whitelist; null and undefined both mean "never set".
 * @returns whether every picker should drop the provider.
 */
export function withdrawsFromPickers(whitelist: readonly string[] | null | undefined): boolean {
  return whitelist != null && whitelist.length === 0
}

/**
 * Accept only an http(s) base without a query or fragment. Runs at load for
 * the composition layer and as the settings section's write validator, so a
 * bad URL fails where it is written, never at first request.
 * @param raw - the configured base URL.
 * @param label - the field name to name in the refusal; the top-level field defaults.
 * @returns the normalized base URL without trailing slashes.
 */
export function assertBaseURL(raw: string, label = 'baseURL'): string {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new Error(`llm-opencode-zen: ${label} "${raw}" is not a valid URL`)
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error(`llm-opencode-zen: ${label} "${raw}" must be http or https`)
  }
  if (url.search.length > 0 || url.hash.length > 0) {
    throw new Error(`llm-opencode-zen: ${label} "${raw}" must not carry a query or fragment`)
  }
  return url.toString().replace(/\/+$/, '')
}

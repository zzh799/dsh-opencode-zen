/**
 * The two OpenCode gateway plans this plugin serves. Both belong to the same
 * platform and resolve the same API key by default, but they are different
 * endpoints with different model sets and different metadata keys - everything
 * that varies between them lives here, so the catalog, the metadata reader,
 * the adapter and the plugin each stay a single implementation parameterized
 * by one descriptor.
 *
 * @module dsh-opencode-zen/providers
 */
import type { getBuiltinModels } from '@earendil-works/pi-ai/providers/all'

/**
 * The keys pi-ai actually ships a builtin table for. Tightening the descriptor
 * to this union turns a mistyped table name into a compile error instead of a
 * silent fallback to an empty catalog at runtime.
 */
export type BuiltinTableKey = Parameters<typeof getBuiltinModels>[0]

/**
 * Static identity of one LLM route. The four keys let every source be
 * addressed: the route id for DSH, the builtin key for pi-ai's shipped table,
 * the metadata key for models.dev's record.
 */
export interface RouteDescriptor {
  /** LLM route id, also the provider id conversation pickers use. */
  readonly id: string
  /** Display name in pickers and on the settings page. */
  readonly displayName: string
  /** Schema default endpoint; also the base of the live model listing. */
  readonly defaultBaseURL: string
  /** pi-ai builtin-table key: the outage fallback and the source of wire quirks. */
  readonly builtinKey: BuiltinTableKey
  /** models.dev record key: the source of "how to call it" metadata. */
  readonly metadataKey: string
}

/** Pay-as-you-go plan. The top-level configuration fields describe this one. */
export const ZEN_ROUTE: RouteDescriptor = {
  id: 'opencode-zen',
  displayName: 'OpenCode Zen',
  defaultBaseURL: 'https://opencode.ai/zen/v1',
  builtinKey: 'opencode',
  metadataKey: 'opencode',
}

/**
 * Subscription plan. Configured through the `go` sub-object because the
 * top-level fields already mean Zen; the global knobs (refresh interval,
 * stream timeout, image budgets) are shared by both plans.
 */
export const GO_ROUTE: RouteDescriptor = {
  id: 'opencode-go',
  displayName: 'OpenCode Go',
  defaultBaseURL: 'https://opencode.ai/zen/go/v1',
  builtinKey: 'opencode-go',
  metadataKey: 'opencode-go',
}

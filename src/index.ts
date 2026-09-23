/**
 * Dedicated OpenCode adapter plugin. Registers two routes, `opencode-zen` and
 * `opencode-go`, whose catalogs follow each gateway's live model listing and
 * models.dev metadata, and installs the `llm-opencode-zen` settings section:
 * the Web UI renders it as its own settings page with a panel per plan, where
 * the API keys and every knob are edited, and a change reaches the next
 * request without a restart. The plugin exists because the gateway has wire
 * requirements a generic pi-ai route cannot express: a mandatory
 * per-conversation `x-opencode-session` routing header and a model list that
 * rotates faster than any shipped catalog.
 *
 * DSH 0.1.5/0.1.6 layer the settings document over the composition entry;
 * 0.1.7 edits live configuration fields on the profile entry directly.
 *
 * ```yaml
 * - id: llm-opencode-zen
 *   name: 'dsh-opencode-zen'
 *   config:
 *     enabled: true                     # Zen: false withdraws that route; the plugin stays mounted
 *     apiKeyEnv: OPENCODE_API_KEY       # Zen credential; default
 *     baseURL: https://opencode.ai/zen/v1   # Zen endpoint; default
 *     refreshMinutes: 60                # live catalog re-resolution interval, both plans
 *     enabledModels: []                 # absent = every model; empty = the route withdraws
 *     go:                               # the OpenCode Go subscription plan
 *       enabled: true                   # default
 *       apiKeyEnv: OPENCODE_API_KEY     # default; set it apart to bill Go separately
 *       baseURL: https://opencode.ai/zen/go/v1
 * ```
 *
 * Each plan registers its route only while its own credential resolves, so
 * pointing `go.apiKeyEnv` at a reference nobody set withdraws exactly that
 * route. Credentials resolve per request through the credentials seam, falling
 * back to the process environment: the same reference semantics the generic
 * pi-ai adapter uses. A route registers atomically: if another adapter family
 * already owns it (a profile in `llm-pi-ai`, for example), the refusal is
 * logged with the reason and everything else this plugin does still works.
 *
 * @module dsh-opencode-zen
 */

import type { Context } from '@deepseek-ai/cordis'
import { launchEnvironmentOf } from '@deepseek-ai/dsh-launch-environment'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { LlmError, assertUsableApiKey, resolveImageAttachmentAccess } from '@deepseek-ai/dsh-llm'
import type { AdapterRegistrationHandle, LlmModelDiscoveryRequest } from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-fs'
import type {} from '@deepseek-ai/dsh-settings'
import { OpencodeZenAdapter } from './adapter.ts'
import type { OpencodeZenImageAccess } from './adapter.ts'
import { discoverCatalogModels } from './catalog.ts'
import { Config, PlainConfig, readConfig, assertBaseURL, withdrawsFromPickers } from './config.ts'
import type { LiveConfig, OpencodeZenConfig } from './config.ts'
import { GoModelsService, ZenModelsService } from './models.ts'
import { GO_ROUTE, ZEN_ROUTE, type RouteDescriptor } from './providers.ts'
import { registerZenRemotes } from './remotes.ts'
import { GoUsageService } from './usage.ts'

declare module '@deepseek-ai/cordis' {
  interface Events {
    'loader/volatile-update'(paths: readonly (readonly string[])[]): void
  }
}

export { OpencodeZenAdapter } from './adapter.ts'
export type { OpencodeZenAdapterOptions, OpencodeZenImageAccess } from './adapter.ts'
export {
  DEFAULT_BASE_URL,
  DISPLAY_NAME,
  PROVIDER_ID,
  OpencodeZenCatalog,
  discoverCatalogModels,
  readLiveModelIds,
} from './catalog.ts'
export { GO_ROUTE, ZEN_ROUTE } from './providers.ts'
export type { RouteDescriptor } from './providers.ts'
export { Config, PlainConfig, assertBaseURL } from './config.ts'
export type { OpencodeGoConfig, OpencodeZenConfig } from './config.ts'

export const name = 'llm-opencode-zen'
export const inject = ['llm']

/** Settings namespace this plugin installs and the Web page edits. */
export const NS = 'llm-opencode-zen'

/**
 * Identity of one configuration's picker whitelist, for change detection: the
 * settings layer hands out a fresh array on every read, so what a change is
 * compared on is the members, not the reference.
 * @param config - the configuration in force.
 * @returns a stable string standing for the whitelist, absence included.
 */
function whitelistKey(config: OpencodeZenConfig): string {
  return JSON.stringify(config.enabledModels ?? null)
}

/**
 * One plan's configuration: its own fields over the knobs both plans share, so
 * the adapter and the catalog read a uniform document and never branch on
 * which plan they serve.
 * @param config - the document in force.
 * @returns the Go plan's projection; the Zen plan's projection is the document.
 */
function goConfigOf(config: OpencodeZenConfig): OpencodeZenConfig {
  return { ...config, ...config.go }
}

/**
 * One plan's live wiring: the adapter, its registration handle, and the two
 * picker facts a change is compared on.
 */
interface Plan {
  readonly route: RouteDescriptor
  readonly adapter: OpencodeZenAdapter
  readonly config: () => OpencodeZenConfig
  /** Register while the switch is on, a model is listed, and the credential resolves. */
  apply(configured: boolean): void
  /** Follow the picker-relevant facts and the credential the plan names. */
  sync(): void
  dispose(): void
}

/**
 * Register both routes, their discovery, the settings section, and their
 * teardown for one mount. Configuration starts as the cordis.yml entry and is
 * replaced by the settings section's resolved value once the settings
 * provider attaches; each adapter re-reads it at every operation.
 */
export function apply(ctx: Context, raw?: OpencodeZenConfig | LiveConfig): void {
  const config = raw && typeof raw.enabled === 'object' ? raw as LiveConfig : Config(raw)
  const entry = readConfig(config)
  // Self-contained misconfiguration fails at load; a bad stored value instead
  // refuses the write through the section's validate hook.
  assertBaseURL(entry.baseURL)
  assertBaseURL(entry.go.baseURL, 'go.baseURL')
  let current: () => OpencodeZenConfig = () => readConfig(config)

  /** The Zen plan's projection: the top-level fields already describe it. */
  const zenConfig = (): OpencodeZenConfig => current()
  const goConfig = (): OpencodeZenConfig => goConfigOf(current())

  const resolveApiKeyFor = (ref: () => string) => async (): Promise<string | undefined> => {
    const env = ref()
    const credentials = ctx.get('credentials')
    const hit = credentials !== undefined
      ? (await credentials.resolve(credentialRef(env)))?.value
      // Without the seam the environment is the whole credential plane.
      : launchEnvironmentOf(ctx).get(env)?.value
    if (hit !== undefined && hit.length > 0) return assertUsableApiKey(hit, name, env)
    throw new LlmError(
      `llm-opencode-zen: no credential; the profile resolves ${env}, which is not set - store ${env} through the`
      + ' credentials service or export it',
      'MISSING_CREDENTIAL',
    )
  }
  registerZenRemotes(ctx)
  const logger = {
    fallback: ({ url, error }: { url: string; error: unknown; kept: number }): void => {
      ctx.logger.warn(`llm-opencode-zen: could not refresh ${url}; using last-known model data (${String(error)})`)
    },
    omitted: (ids: readonly string[]): void => {
      ctx.logger.warn(`llm-opencode-zen: gateway models awaiting usable online metadata: ${ids.join(', ')}`)
    },
  }
  const imageAccess: OpencodeZenImageAccess = {
    resolveAttachments: () => ctx.get('attachments'),
    resolveImageAccess: (attachments, ref) => resolveImageAttachmentAccess(
      attachments,
      hostPath => ctx.get('fs')?.processPathFromHostPath(hostPath),
      ref,
    ),
  }

  /**
   * Build one plan's adapter and route lifecycle. The route registers while
   * its switch is on, its whitelist still lists a model, and its own credential
   * resolves, and drops when any of them says no. A route with no key would
   * otherwise sit in every model picker and read as a usable provider to
   * first-run onboarding, the dormancy llm-pi-ai keeps by resolving zero routes
   * until configured. Without the credentials seam the environment answers
   * synchronously, so registration is too.
   *
   * Nothing else is torn down with the route: model discovery, the settings
   * section, and the credentials listener all stay mounted, so the page that
   * owns the switch stays reachable to turn it back on.
   */
  const makePlan = (
    route: RouteDescriptor,
    planConfig: () => OpencodeZenConfig,
    apiKeyRef: () => string,
  ): Plan => {
    const adapter = new OpencodeZenAdapter({
      provider: route,
      config: planConfig,
      resolveApiKey: resolveApiKeyFor(apiKeyRef),
      imageAccess,
      onFallback: logger.fallback,
      onOmitted: logger.omitted,
      onReplayDegrade: (reason) => {
        ctx.logger.warn(`llm-opencode-zen: unusable replay state on assistant history for ${route.id}; sending provider-neutral content (${reason})`)
      },
    })
    let registration: AdapterRegistrationHandle | undefined
    let pickerVisibility = planConfig().showDeprecatedModels
    let pickerWhitelist = whitelistKey(planConfig())
    /** Whether this plan's configuration leaves the pickers anything to offer. */
    const servesPickers = (): boolean =>
      planConfig().enabled && !withdrawsFromPickers(planConfig().enabledModels)
    const apply = (configured: boolean): void => {
      if (configured && servesPickers() && registration === undefined) {
        try {
          registration = ctx.llm.registerAdapter([route.id], adapter)
        } catch (error: unknown) {
          // Most likely DUPLICATE_ADAPTER: a profile in another family
          // (llm-pi-ai) or the standalone Go plugin already owns the route. The
          // refusal names the route; discovery still registers below, and
          // everything else about the mount keeps working.
          ctx.logger.error(`llm-opencode-zen: not registering the "${route.id}" route (${String(error)})`)
        }
      } else if ((!configured || !servesPickers()) && registration !== undefined) {
        registration()
        registration = undefined
        if (!planConfig().enabled) {
          ctx.logger.info(`llm-opencode-zen: ${route.id} disabled by configuration; the route and its models are withdrawn`)
        } else if (withdrawsFromPickers(planConfig().enabledModels)) {
          ctx.logger.info(`llm-opencode-zen: no model is selected for the ${route.id} pickers; the route and its models are withdrawn`)
        }
      }
    }
    const sync = (): void => {
      const visibility = planConfig().showDeprecatedModels
      const whitelist = whitelistKey(planConfig())
      if (pickerVisibility !== visibility || pickerWhitelist !== whitelist) {
        pickerVisibility = visibility
        pickerWhitelist = whitelist
        // Replacing the owned route notifies every session picker without a restart.
        registration?.replace([route.id])
      }
      const credentials = ctx.get('credentials')
      if (credentials === undefined) {
        apply(launchEnvironmentOf(ctx).get(apiKeyRef())?.value !== undefined)
        return
      }
      void credentials.describe(credentialRef(apiKeyRef()))
        .then((info) => { apply(info.configured) })
        .catch((error: unknown) => {
          ctx.logger.error(`llm-opencode-zen: credential describe failed for ${route.id}; keeping the previous route state (${String(error)})`)
        })
    }
    return {
      route,
      adapter,
      config: planConfig,
      apply,
      sync,
      /* v8 ignore next 3 -- plugin unload never runs in tests: no Context disposal API is exercised */
      dispose: () => { registration?.() },
    }
  }

  const zenPlan = makePlan(ZEN_ROUTE, zenConfig, () => current().apiKeyEnv)
  const goPlan = makePlan(GO_ROUTE, goConfig, () => current().go.apiKeyEnv)
  const plans = [zenPlan, goPlan]
  const syncAll = (): void => { for (const plan of plans) plan.sync() }

  ctx.plugin(ZenModelsService, { catalog: () => zenPlan.adapter.catalogOf(zenConfig()) })
  ctx.plugin(GoModelsService, { catalog: () => goPlan.adapter.catalogOf(goConfig()) })
  // The Go plan's quota display. It reads the plan's own credential and
  // endpoint, and its result never reaches the route gate.
  ctx.plugin(GoUsageService, {
    baseURL: () => current().go.baseURL,
    resolveApiKey: resolveApiKeyFor(() => current().go.apiKeyEnv),
  })
  syncAll()
  const undiscover = ctx.llm.registerModelDiscovery(name, async (request: LlmModelDiscoveryRequest) => {
    // Both plans answer on opencode.ai, so the provider id is what separates
    // them; a bare endpoint is matched on the /zen/go/ segment only the Go
    // plan's base URL carries.
    if (request.provider === GO_ROUTE.id) return discoverCatalogModels(goPlan.adapter.catalogOf(goConfig()))
    if (request.provider === ZEN_ROUTE.id) return discoverCatalogModels(zenPlan.adapter.catalogOf(zenConfig()))
    const url = request.baseURL ?? ''
    if (url.includes('/zen/go/')) return discoverCatalogModels(goPlan.adapter.catalogOf(goConfig()))
    if (url.includes('opencode.ai')) return discoverCatalogModels(zenPlan.adapter.catalogOf(zenConfig()))
    throw new LlmError(
      'llm-opencode-zen discovers only OpenCode zen endpoints; enter this provider\'s models by hand',
      'DISCOVERY_UNSUPPORTED',
    )
  })
  ctx.effect(() => () => {
    /* v8 ignore start -- plugin unload never runs in tests: no Context disposal API is exercised */
    for (const plan of plans) plan.dispose()
    undiscover()
    /* v8 ignore stop */
  })
  // Settings-backed configuration: the section starts from the cordis.yml
  // entry as its base layer and follows the settings provider while attached.
  // Without a settings provider the plugin still loads and serves the entry.
  ctx.inject(['settings'], (settingsCtx) => {
    if ('configure' in settingsCtx.settings) {
      const settings = settingsCtx.settings as unknown as {
        configure(policy: { auto: boolean }, owner: typeof ctx.fiber): () => void
      }
      settingsCtx.effect(() => settings.configure({ auto: false }, ctx.fiber))
      return
    }
    settingsCtx.settings.installSection(ctx, NS, PlainConfig, entry, {
      validate: (value) => {
        assertBaseURL(value.baseURL)
        assertBaseURL(value.go.baseURL, 'go.baseURL')
      },
      setSource: (source) => {
        current = source
      },
      onChange: () => {
        // The registered route set follows the credentials the section names;
        // every other fact is per-request and reaches it through `current`.
        syncAll()
      },
    })
  })
  // Validate before 0.1.7 persists a profile edit, then follow committed refs.
  ctx.on('internal/config', function (_raw, next) {
    const value = next()
    if (this === ctx.fiber) {
      const plain = PlainConfig(value)
      assertBaseURL(plain.baseURL)
      assertBaseURL(plain.go.baseURL, 'go.baseURL')
    }
    return value
  })
  // The event is absent on older Loaders; registering it is harmless there.
  ctx.on('loader/volatile-update', syncAll)
  // A key stored or removed anywhere - the settings page's write-only control
  // included - flips the route's presence; the event names the reference.
  ctx.inject(['credentials'], (credentialsCtx) => {
    credentialsCtx.on('credentials/reference-updated', (ref) => {
      if (ref === current().apiKeyEnv || ref === current().go.apiKeyEnv) syncAll()
    })
    // The seam becomes visible only once its provider is active, which can be
    // after this plugin applied: the boot-time call above then found no seam
    // and fell back to the environment. Sync again here so a credential
    // already stored in the seam registers the route at boot instead of
    // waiting for its next write.
    syncAll()
  })
  ctx.logger.info(`llm-opencode-zen: routes "${ZEN_ROUTE.id}" and "${GO_ROUTE.id}" registered as ${ZEN_ROUTE.displayName} and ${GO_ROUTE.displayName}`)
}

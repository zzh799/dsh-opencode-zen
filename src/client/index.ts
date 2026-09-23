/**
 * OpenCode settings plugin, browser half. Registers the "OpenCode" settings
 * page over the `llm-opencode-zen` namespace: one panel per plan (the Zen
 * pay-as-you-go gateway and the Go subscription), the API keys (stored
 * write-only through the credentials domain), each gateway's current model
 * listing, and the adapter knobs behind the page's advanced disclosure. The
 * Host settings and credential contracts stay behind their existing wire APIs.
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
// Type-only: pulls the shell's SlotMap merge (the 'settings.section' entry).
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type { SettingsScope } from './settings.ts'
// Type-only: pulls the slot registry Context merge (ctx.slots).
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: pulls the ctx.remote merge (the forwarded credentials event key)
// into this program.
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import { OpencodeZenSection } from './Section.tsx'
import type { OpencodeZenSectionInjected } from './Section.tsx'
import {
  OpencodeZenSectionController,
  type OpencodeZenSettings,
  type OpencodeZenSources,
} from './section-controller.ts'
import { en, zh } from './locales.ts'
import { registerUsagePill } from './usage.ts'
import { zenRemote } from '../remote-contract.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The OpenCode settings page copy, both plans on one page. */
    'settings.opencode-zen': keyof typeof en
  }
}

/** Dictionary namespace owned by this plugin. */
const NS = 'settings.opencode-zen'

export type { OpencodeZenSectionProps } from './Section.tsx'
export type {
  GoUsageState,
  OpencodeGoPanelState,
  OpencodeGoSettings,
  OpencodeZenPanelState,
  OpencodeZenSectionState,
  OpencodeZenSettings,
  Plan,
} from './section-controller.ts'
export { OPENCODE_ZEN_NS } from './section-controller.ts'
export type { OpencodeZenKey } from './locales.ts'

/**
 * Required services (cordis fiber inject). The target slot is declared by
 * ui-settings' apply, whose activation order relative to this one is NOT
 * constrained; registration depends on each slot through `slots.inject()`.
 * The page reads the two model listings and the Go quota through namespaces
 * this plugin mounts itself (see `sourcesOf`), so they must NOT be listed
 * here: a fiber-level inject on a namespace that only exists after this
 * entry's own apply would never be satisfied, and the entry would sit pending
 * forever. `apply` injects them on the scopes that read them instead.
 */
export const inject = ['slots', 'locale', 'remote', 'remote.credentials', 'remote.llm']

/**
 * Register the section once the `settings.section` declaration is on the
 * ledger, and keep the credential badges fresh on Host-reported key changes
 * written from any surface.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'llm-opencode-zen: copy dictionaries')
  // The Go plan's quota also rides the conversation composer, so a reader who
  // is mid-conversation sees how much of the current window is left.
  registerUsagePill(ctx)
  const modelsReady = ctx.remote.$mount(zenRemote)
  ctx.effect(async () => await modelsReady)
  const ready = ['remote.opencodeZenModels', 'remote.opencodeGoModels', 'remote.opencodeGoUsage']
  ctx.inject(['configForms', ...ready], child => {
    const forms = child.get('configForms') as { get<T>(id: string): SettingsScope<T> }
    // Profile forms use the bundle entry id, not the legacy settings namespace.
    mountSettings(child, forms.get<OpencodeZenSettings>('opencode-zen'), sourcesOf(child, modelsReady))
  })
  ctx.inject(['settingsScope', ...ready], child => {
    mountSettings(child, child.settingsScope.bind({
      namespace: 'llm-opencode-zen',
      decode: (section): OpencodeZenSettings | undefined =>
        typeof section === 'object' && section !== null ? section as OpencodeZenSettings : undefined,
    }), sourcesOf(child, modelsReady))
  })
}

/**
 * The page's three reads, bound to the scope that injected the namespaces.
 * Every read waits for the mount: a page that renders before the namespaces
 * exist would report the gateways as unreachable rather than as not yet asked.
 * The scope is the injected child, never the entry's own context - the tracked
 * access guard refuses a namespace read on a context that did not inject it,
 * and the entry deliberately does not inject the namespaces it mounts itself.
 * @param ctx - the context whose inject list carries the three namespaces.
 * @param modelsReady - the pending mount of this plugin's remote contribution.
 * @returns the sources the OpenCode page reads through.
 */
function sourcesOf(ctx: ClientContext, modelsReady: Promise<unknown>): OpencodeZenSources {
  return {
    models: async () => { await modelsReady; return ctx.remote.opencodeZenModels.read() },
    goModels: async () => { await modelsReady; return ctx.remote.opencodeGoModels.read() },
    usage: async () => { await modelsReady; return ctx.remote.opencodeGoUsage.read() },
  }
}

function mountSettings(ctx: ClientContext, scope: SettingsScope<OpencodeZenSettings>, sources: OpencodeZenSources): void {
  const controller = new OpencodeZenSectionController(scope, ctx, sources)
  ctx.effect(() => () => controller.dispose())
  const t = ctx.locale.bind(NS) as OpencodeZenSectionInjected['t']
  const injected = (): OpencodeZenSectionInjected => ({ ...controller.inject(), t })

  ctx.effect(() => {
    const refresh = (ref: string): void => { controller.refreshCredential(ref) }
    const dispose = ctx.remote.$on('credentials/reference-updated', refresh)
    /* v8 ignore next -- fiber teardown never runs in unit tests */
    return () => { dispose() }
  }, 'llm-opencode-zen: pushed credential invalidations')

  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'opencode-zen',
    order: 20,
    label: () => t('nav'),
    inject: injected,
  }, OpencodeZenSection))
}

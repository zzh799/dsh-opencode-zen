/**
 * OpenCode Zen settings plugin, browser half. Registers the "OpenCode Zen"
 * settings page over the `llm-opencode-zen` namespace: the API key (stored
 * write-only through the credentials domain), the gateway's current model
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
import { OpencodeZenSectionController, type OpencodeZenSettings } from './section-controller.ts'
import { en, zh } from './locales.ts'
import { zenRemote } from '../remote-contract.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The OpenCode Zen settings page copy. */
    'settings.opencode-zen': keyof typeof en
  }
}

/** Dictionary namespace owned by this plugin. */
const NS = 'settings.opencode-zen'

export type { OpencodeZenSectionProps } from './Section.tsx'
export type { OpencodeZenSectionState, OpencodeZenSettings } from './section-controller.ts'
export { OPENCODE_ZEN_NS } from './section-controller.ts'
export type { OpencodeZenKey } from './locales.ts'

/**
 * Required services (cordis fiber inject). The target slot is declared by
 * ui-settings' apply, whose activation order relative to this one is NOT
 * constrained; registration depends on each slot through `slots.inject()`.
 * `remote.llm` is the discovery namespace the page reads the model listing
 * through.
 */
export const inject = ['slots', 'locale', 'remote', 'remote.credentials', 'remote.llm']

/**
 * Register the section once the `settings.section` declaration is on the
 * ledger, and keep the credential badge fresh on Host-reported key changes
 * written from any surface.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'llm-opencode-zen: copy dictionaries')
  const modelsReady = ctx.remote.$mount(zenRemote)
  ctx.effect(async () => await modelsReady)
  ctx.inject(['configForms', 'remote.opencodeZenModels'], child => {
    const forms = child.get('configForms') as { get<T>(id: string): SettingsScope<T> }
    // Profile forms use the bundle entry id, not the legacy settings namespace.
    mountSettings(child, forms.get<OpencodeZenSettings>('opencode-zen'), modelsReady)
  })
  ctx.inject(['settingsScope', 'remote.opencodeZenModels'], child => {
    mountSettings(child, child.settingsScope.bind({
      namespace: 'llm-opencode-zen',
      decode: (section): OpencodeZenSettings | undefined =>
        typeof section === 'object' && section !== null ? section as OpencodeZenSettings : undefined,
    }), modelsReady)
  })
}

function mountSettings(ctx: ClientContext, scope: SettingsScope<OpencodeZenSettings>, modelsReady: Promise<unknown>): void {
  const controller = new OpencodeZenSectionController(scope, ctx, async () => {
    await modelsReady
    return ctx.remote.opencodeZenModels.read()
  })
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

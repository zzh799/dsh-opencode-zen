/**
 * The browser-half entry: locale registration, the bound settings scope, the
 * credential invalidation subscription, and the `settings.section`
 * registration for the OpenCode Zen page.
 */

import { describe, expect, it, vi } from 'vitest'
import { stubSettingsScope } from './support/client.ts'
import { apply } from '../src/client/index.ts'
import { OpencodeZenSection } from '../src/client/Section.tsx'
import { en } from '../src/client/locales.ts'

interface ClientHarness {
  ctx: Record<string, unknown>
  slotsInject: ReturnType<typeof vi.fn>
  slotsRegister: ReturnType<typeof vi.fn>
  localeRegister: ReturnType<typeof vi.fn>
  credentialListeners: Array<(ref: string) => void>
  emitCredential: (ref: string) => void
  runInjectCallback: () => unknown
}

/** The namespaces this entry mounts itself; only an injected scope may read them. */
const SELF_MOUNTED = ['opencodeZenModels', 'opencodeGoModels', 'opencodeGoUsage'] as const

/** A client root context scripted down to the services the entry reaches. */
function clientHarness(): ClientHarness {
  const scope = stubSettingsScope().scope
  const slotsInject = vi.fn()
  const slotsRegister = vi.fn(() => () => {})
  const localeRegister = vi.fn(() => () => {})
  const credentialListeners: Array<(ref: string) => void> = []
  let injectCallback: (() => unknown) | undefined
  const remote: Record<string, unknown> = {
    $mount: vi.fn(async () => () => {}),
    credentials: {
      describe: vi.fn(() => Promise.resolve({ ok: true, value: {} })),
      set: vi.fn(() => Promise.resolve({ ok: true, value: undefined })),
    },
    llm: {
      discoverModels: vi.fn(() => Promise.resolve({ ok: true, value: [] })),
    },
    $on: vi.fn((_key: string, listener: (ref: string) => void) => {
      credentialListeners.push(listener)
      return () => {}
    }),
  }
  /**
   * The real `remote` service refuses a namespace read unless the reading
   * context injected it, so the root context carries none of the self-mounted
   * namespaces: a read through the root context fails here exactly as it fails
   * in the browser. Only a scope that asked for them gets them.
   */
  const scoped = (services: readonly string[]): Record<string, unknown> => {
    const child: Record<string, unknown> = { ...remote }
    for (const name of SELF_MOUNTED) {
      if (services.includes(`remote.${name}`)) child[name] = { read: async () => ({ ok: true, value: [] }) }
    }
    return child
  }
  const ctx = {
    inject: vi.fn((services: string[], callback: (child: unknown) => void) => {
      if (services.includes('settingsScope')) {
        callback({ ...ctx, remote: scoped(services) })
      }
    }),
    effect: (fn: () => unknown) => {
      fn()
      return () => {}
    },
    locale: {
      register: localeRegister,
      bind: () => (key: string) => en[key as keyof typeof en] ?? key,
    },
    settingsScope: {
      bind: vi.fn((spec: { decode?: (section: unknown) => unknown }) => {
        // Exercise the decoder both ways so the entry's narrowing is covered.
        spec.decode?.({ baseURL: 'https://opencode.ai/zen/v1' })
        spec.decode?.('not-an-object')
        return scope
      }),
    },
    remote,
    slots: {
      inject: (slot: string, callback: () => unknown) => {
        slotsInject(slot)
        injectCallback = callback
      },
      register: slotsRegister,
    },
  }
  return {
    ctx,
    slotsInject,
    slotsRegister,
    localeRegister,
    credentialListeners,
    emitCredential: (ref) => {
      for (const listener of credentialListeners) listener(ref)
    },
    runInjectCallback: () => {
      if (injectCallback === undefined) throw new Error('no inject callback registered')
      return injectCallback()
    },
  }
}

describe('client entry', () => {
  /**
   * The fiber-level `inject` gates the entry's activation; the plugin's own
   * remote namespaces come into existence only when this entry's apply mounts
   * them. Listing them as required services therefore deadlocks the entry: the
   * browser boot reports it as pending forever and the OpenCode page never
   * appears. Reads gate on the mount promise instead.
   */
  it('never requires the remote namespaces its own apply mounts', async () => {
    const { inject } = await import('../src/client/index.ts')
    const selfMounted = ['remote.opencodeZenModels', 'remote.opencodeGoModels', 'remote.opencodeGoUsage']

    expect(inject.filter(service => selfMounted.includes(service))).toEqual([])
  })

  it('registers the copy dictionaries, the scope, and the section slot', () => {
    const harness = clientHarness()

    apply(harness.ctx as never)

    expect(harness.localeRegister).toHaveBeenCalledWith('settings.opencode-zen', expect.objectContaining({
      en,
      zh: expect.any(Object) as Record<string, string>,
    }))
    expect(harness.slotsInject).toHaveBeenCalledWith('settings.section')

    harness.runInjectCallback()
    const registration = harness.slotsRegister.mock.calls[0]?.[0] as {
      name: string
      id: string
      label: () => string
      inject: () => { t: (key: string) => string; loadModels: () => void }
    }
    expect(registration).toMatchObject({ name: 'settings.section', id: 'opencode-zen' })
    expect(registration.label()).toBe(en.nav)
    expect(registration.inject().t('nav')).toBe(en.nav)
    expect(registration.inject().loadModels).toBeTypeOf('function')
    expect(harness.slotsRegister.mock.calls[0]?.[1]).toBe(OpencodeZenSection)
  })

  /**
   * Both listings and the quota live behind namespaces this entry mounts, so
   * the reads must run on the scope that injected them. A read bound to the
   * entry's own context throws `cannot get property … without inject` and the
   * page reports both gateways as unreachable - the root context in this
   * harness carries none of the self-mounted namespaces for exactly that
   * reason.
   */
  it('reads both listings through the scope that injected the namespaces', async () => {
    const harness = clientHarness()
    apply(harness.ctx as never)
    harness.runInjectCallback()

    const registration = harness.slotsRegister.mock.calls[0]?.[0] as {
      inject: () => {
        loadModels: () => void
        loadGoModels: () => void
        hooks: { opencodeZen: { getSnapshot: () => { models: { status: string }; go: { models: { status: string } } } } }
      }
    }
    const face = registration.inject()
    face.loadModels()
    face.loadGoModels()

    await vi.waitFor(() => {
      const state = face.hooks.opencodeZen.getSnapshot()
      expect(state.models.status).toBe('ready')
      expect(state.go.models.status).toBe('ready')
    })
  })

  it('subscribes to credential invalidations for the page controller', () => {
    const harness = clientHarness()
    apply(harness.ctx as never)

    expect(harness.credentialListeners).toHaveLength(1)
    // The listener delegates to the controller; exercising it must not throw
    // for any reference name.
    harness.emitCredential('OPENCODE_API_KEY')
    harness.emitCredential('SOMEWHERE_ELSE')
  })
})

// @vitest-environment jsdom

/**
 * The OpenCode Zen settings page component: the key control and its badge, the
 * gateway model listing it reads on mount, the advanced disclosure that holds
 * the tuning fields, the save/discard actions, and the unavailable posture.
 */

import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { bindSnapshotSelector } from './support/client.ts'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { OpencodeZenSection } from '../src/client/Section.tsx'
import type { OpencodeZenSectionProps, OpencodeZenSectionState } from '../src/client/Section.tsx'
import {
  OpencodeZenSectionController,
  type OpencodeGoPanelState,
  type OpencodeZenSettings,
} from '../src/client/section-controller.ts'
import { stubSettingsScope } from './support/client.ts'
import { en } from '../src/client/locales.ts'

afterEach(cleanup)

const t = (key: keyof typeof en, params?: Record<string, unknown>): string =>
  Object.entries(params ?? {}).reduce(
    (text, [name, value]) => text.replaceAll(`{${name}}`, String(value)),
    en[key],
  )

function field(text: string, rest: Partial<OpencodeZenSectionState['baseURL']> = {}): OpencodeZenSectionState['baseURL'] {
  return { text, overridden: false, invalid: false, ...rest }
}

type SectionField = 'baseURL' | 'apiKeyEnv' | 'refreshMinutes' | 'streamIdleTimeoutMs'
  | 'maxRequestImageBytes' | 'requestImagePixelBudget' | 'requestImageMaxBytes' | 'apiKey' | 'models'
  | 'modelLimits' | 'modelLimitDraft' | 'checkedModels' | 'go'

const settled: Omit<OpencodeZenSectionState, SectionField> = {
  available: true,
  writable: true,
  dirty: false,
  invalid: false,
  saving: false,
  failed: false,
  enabled: true,
  showDeprecatedModels: false,
  checkedCount: 0,
  apiKeyConfigured: false,
  apiKeyWritable: true,
}

type ModelEntry = import('../src/models-contract.ts').ZenModel

function listing(entries: readonly ModelEntry[]) {
  return {
    status: 'ready' as const,
    count: entries.length,
    preview: entries.map(entry => entry.name ?? entry.id),
    entries,
  }
}

/**
 * The Go plan's panel. A settled case starts with its listing unread and its
 * quota unprobed, which is what the page finds before it asks.
 */
function goPanel(overrides: Partial<OpencodeGoPanelState> = {}): OpencodeGoPanelState {
  return {
    enabled: true,
    showDeprecatedModels: false,
    checkedModels: [],
    checkedCount: 0,
    apiKeyEnv: field('OPENCODE_API_KEY'),
    baseURL: field('https://opencode.ai/zen/go/v1'),
    apiKey: field(''),
    apiKeyConfigured: false,
    apiKeyWritable: true,
    models: { status: 'idle' },
    modelLimits: field(''),
    modelLimitDraft: {},
    usage: { status: 'idle' },
    ...overrides,
  }
}

function stateOf(overrides: Partial<OpencodeZenSectionState> = {}): OpencodeZenSectionState {
  return {
    ...settled,
    apiKeyEnv: field('OPENCODE_API_KEY'),
    baseURL: field('https://opencode.ai/zen/v1'),
    refreshMinutes: field('60'),
    streamIdleTimeoutMs: field('300000'),
    maxRequestImageBytes: field('20971520'),
    requestImagePixelBudget: field('4194304'),
    requestImageMaxBytes: field('1048576'),
    apiKey: field(''),
    modelLimits: field(''),
    modelLimitDraft: {},
    models: { status: 'idle' },
    checkedModels: [],
    go: goPanel(),
    ...overrides,
  }
}

function actions() {
  return {
    edit: vi.fn(),
    resetField: vi.fn(),
    save: vi.fn(),
    discard: vi.fn(),
    loadModels: vi.fn(),
    setModelChecked: vi.fn(),
    clearModelChecks: vi.fn(),
    loadGoModels: vi.fn(),
    setGoModelChecked: vi.fn(),
    clearGoModelChecks: vi.fn(),
    loadUsage: vi.fn(),
  }
}

function renderSection(state: OpencodeZenSectionState, overrides: Partial<ReturnType<typeof actions>> = {}) {
  const store = createSnapshotStore(state)
  const props = {
    ...actions(),
    ...overrides,
    t,
    useOpencodeZen: bindSnapshotSelector(store),
  } as unknown as OpencodeZenSectionProps
  render(<OpencodeZenSection {...props} />)
  return store
}

/** The page's advanced disclosure starts collapsed; open it before its fields. */
function openAdvanced(): void {
  fireEvent.click(screen.getByText(en.advancedLabel))
}

/** The model-capacity disclosure starts collapsed; open it before its table. */
function openModelLimits() {
  // Capacity editing is always visible in the combined model list.

}

describe('OpencodeZenSection', () => {
  it('renders nothing until every injected seat is present', () => {
    const { container } = render(<OpencodeZenSection t={t} />)
    expect(container.innerHTML).toBe('')
  })

  it('shows the unavailable posture while the namespace is not served', () => {
    const reading = actions()
    renderSection(stateOf({ available: false }), reading)
    expect(screen.getByText(en.unavailable)).toBeTruthy()
    // Nothing is served, so there is no listing to ask the gateway for.
    expect(reading.loadModels).not.toHaveBeenCalled()
  })

  it('reads the model listing once on mount, and not again when one is already held', () => {
    const reading = actions()
    renderSection(stateOf(), reading)
    expect(reading.loadModels).toHaveBeenCalledTimes(1)

    cleanup()
    const held = actions()
    renderSection(stateOf({ models: listing([{ id: 'deepseek-v4.1-flash', name: 'DeepSeek V4.1 Flash' }]) }), held)
    expect(held.loadModels).not.toHaveBeenCalled()
  })

  it('reflects the switch state and stages the flip for the next save', () => {
    const reading = actions()
    renderSection(stateOf({ enabled: true }), reading)

    const control = screen.getByRole('switch', { name: en.enabledLabel })
    expect(control.getAttribute('aria-checked')).toBe('true')
    expect(screen.getByText(en.enabledHint)).toBeTruthy()

    // The switch is staged with everything else on the page: one save writes
    // the whole form, so nothing reaches the Host on the click itself.
    fireEvent.click(control)
    expect(reading.edit).toHaveBeenCalledWith('enabled', 'false')
    expect(reading.save).not.toHaveBeenCalled()
  })

  it('explains the withdrawn state while the switch is off', () => {
    renderSection(stateOf({ enabled: false }))

    expect(screen.getByRole('switch', { name: en.enabledLabel }).getAttribute('aria-checked')).toBe('false')
    expect(screen.getByText(en.enabledOff)).toBeTruthy()
  })

  it('locks the switch with the same read-only document that locks the form', () => {
    renderSection(stateOf({ writable: false }))

    expect(screen.getByRole('switch', { name: en.enabledLabel }).hasAttribute('disabled')).toBe(true)
  })

  it('shows the key state and the models the gateway serves', () => {
    renderSection(stateOf({
      apiKeyConfigured: true,
      models: listing([
        { id: 'deepseek-v4.1-flash', name: 'DeepSeek V4.1 Flash' },
        { id: 'kimi-k2', name: 'Kimi K2' },
      ]),
    }))

    expect(screen.getByText(en.keyConfigured)).toBeTruthy()
    expect(screen.getByText(t('modelsCount', { count: 2 }))).toBeTruthy()
    openModelLimits()
    expect(screen.getByRole('button', { name: /DeepSeek V4\.1 Flash/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: /Kimi K2/ })).toBeTruthy()
  })

  it('keeps deprecated gateway models configurable and stages the visibility flip', () => {
    const acts = actions()
    renderSection(stateOf({ models: listing([{ id: 'old', name: 'Old model', deprecated: true }]),
      modelLimitDraft: { absent: { maxTokens: 10 } },
    }), acts)
    expect(screen.queryByRole('button', { name: /absent/ })).toBeNull()
    expect(screen.getByLabelText(t('limitsOutputLabel', { name: 'Old model' })).hasAttribute('disabled')).toBe(false)
    const toggle = screen.getByRole('switch', { name: en.showDeprecatedLabel })
    expect(toggle.getAttribute('aria-checked')).toBe('false')
    fireEvent.click(toggle)
    expect(acts.edit).toHaveBeenCalledWith('showDeprecatedModels', 'true')
    // A deprecated model is still configurable while it is out of the pickers.
    expect(acts.save).not.toHaveBeenCalled()
  })

  it('shows the default order and replaces status filters with sorting choices', () => {
    renderSection(stateOf({ models: listing([
      { id: 'old', name: 'Old', deprecated: true, releaseDate: '2020-01-01' },
      { id: 'normal', name: 'Normal', releaseDate: '2025-01-01', pricePer100m: { source: 0.5219, actual: 0.0872 } },
      { id: 'new', name: 'New', releaseDate: new Date().toISOString().slice(0, 10), pricePer100m: { source: 1, actual: 0.2 } },
    ]) }))
    const nav = () => screen.getByRole('navigation', { name: en.modelsLabel })
    expect(within(nav()).getAllByRole('button').map(button => button.textContent?.split(' ')[0])).toEqual(['New', 'Normal', 'Old'])
    expect(screen.getAllByRole('combobox')).toHaveLength(2)
    const sort = screen.getAllByLabelText(en.sortBy)[0] as HTMLSelectElement
    expect([...sort.options].map(option => option.value)).toEqual(['default', 'price', 'release'])
    expect(within(nav()).getByRole('button', { name: /Normal/ }).textContent).toContain('$0.52')

    fireEvent.change(sort, { target: { value: 'release' } })
    expect(within(nav()).getAllByRole('button').map(button => button.textContent?.split(' ')[0])).toEqual(['New', 'Normal', 'Old'])
    fireEvent.change(screen.getByLabelText(en.limitsFilterLabel), { target: { value: 'does-not-exist' } })
    expect(screen.queryByRole('navigation')).toBeNull()
  })

  it('shows one selected model editor immediately alongside the searchable list', () => {
    renderSection(stateOf({ models: listing([{ id: 'm', name: 'Model' }]) }))
    expect(screen.getByRole('navigation', { name: en.modelsLabel })).toBeTruthy()
    expect(screen.getByLabelText(t('limitsContextLabel', { name: 'Model' }))).toBeTruthy()
    expect(screen.queryByRole('button', { name: en.limitsLabel })).toBeNull()
    // The section title names both jobs the list does now.
    expect(screen.getByText(en.limitsLabel)).toBeTruthy()
  })

  it('renders a checkbox per listed model and stages the toggle without disturbing the row button', () => {
    const acts = actions()
    renderSection(stateOf({ models: listing([{ id: 'a', name: 'Alpha' }, { id: 'b', name: 'Beta' }]),
      checkedModels: ['a', 'b'], checkedCount: 2,
    }), acts)

    const alpha = screen.getByRole('checkbox', { name: t('modelVisibleLabel', { name: 'Alpha' }) }) as HTMLInputElement
    expect(alpha.checked).toBe(true)
    fireEvent.click(alpha)
    expect(acts.setModelChecked).toHaveBeenCalledWith('a', false)
    // Picking a model is a separate control from picking the row.
    expect(acts.edit).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: /Beta/ }))
    expect(acts.setModelChecked).toHaveBeenCalledTimes(1)
    expect(acts.edit).not.toHaveBeenCalled()
  })

  it('renders models outside the whitelist unchecked and reports how many the pickers offer', () => {
    renderSection(stateOf({ models: listing([{ id: 'a', name: 'Alpha' }, { id: 'b', name: 'Beta' }]),
      checkedModels: ['a'], checkedCount: 1,
    }))

    expect((screen.getByRole('checkbox', { name: t('modelVisibleLabel', { name: 'Beta' }) }) as HTMLInputElement).checked)
      .toBe(false)
    expect(screen.getByText(t('limitsCheckedSummary', { count: 1, total: 2 }))).toBeTruthy()
  })

  it('clears every check from the batch action, which is inert when nothing is checked', () => {
    const acts = actions()
    renderSection(stateOf({ models: listing([{ id: 'a', name: 'Alpha' }]), checkedModels: ['a'], checkedCount: 1 }), acts)
    fireEvent.click(screen.getByRole('button', { name: en.clearChecked }))
    expect(acts.clearModelChecks).toHaveBeenCalledTimes(1)

    cleanup()
    renderSection(stateOf({ models: listing([{ id: 'a', name: 'Alpha' }]), checkedModels: [], checkedCount: 0 }))
    expect(screen.getByRole('button', { name: en.clearChecked }).hasAttribute('disabled')).toBe(true)
  })

  it('locks the checkboxes and the batch action with the read-only document', () => {
    renderSection(stateOf({ writable: false, models: listing([{ id: 'a', name: 'Alpha' }]),
      checkedModels: ['a'], checkedCount: 1,
    }))
    expect(screen.getByRole('checkbox', { name: t('modelVisibleLabel', { name: 'Alpha' }) })
      .hasAttribute('disabled')).toBe(true)
    expect(screen.getByRole('button', { name: en.clearChecked }).hasAttribute('disabled')).toBe(true)
  })

  it('makes model capacities searchable and stages numeric edits', () => {
    const edits = actions()
    renderSection(stateOf({
      models: listing([
        { id: 'deepseek-v4.1-flash', name: 'DeepSeek V4.1 Flash', contextWindow: 262_144, maxTokens: 32_768 },
        { id: 'kimi-k2', name: 'Kimi K2', contextWindow: 131_072, maxTokens: 16_384 },
      ]),
      modelLimitDraft: { 'deepseek-v4.1-flash': { contextWindow: 131_072 } },
    }), edits)

    openModelLimits()
    expect(screen.getByRole('region', { name: en.modelDetails })).toBeTruthy()
    const context = screen.getByLabelText(t('limitsContextLabel', { name: 'DeepSeek V4.1 Flash' })) as HTMLInputElement
    expect(context.type).toBe('number')
    expect(context.value).toBe('131072')

    fireEvent.change(context, { target: { value: '262144' } })
    expect(edits.edit).toHaveBeenCalledWith(
      'modelLimits',
      '{"deepseek-v4.1-flash":{"contextWindow":262144}}',
    )

    const filter = screen.getByLabelText(en.limitsFilterLabel)
    fireEvent.change(filter, { target: { value: 'kimi' } })
    expect(screen.queryByRole('button', { name: /DeepSeek V4\.1 Flash/ })).toBeNull()
    expect(screen.getByRole('button', { name: /Kimi K2/ })).toBeTruthy()

    fireEvent.change(filter, { target: { value: 'not-there' } })
    expect(screen.getByText(t('limitsNoMatches', { query: 'not-there' }))).toBeTruthy()
  })

  it('offers a clear action that returns a model to its catalog capacities', () => {
    const edits = actions()
    renderSection(stateOf({
      models: listing([{ id: 'deepseek-v4.1-flash', name: 'DeepSeek V4.1 Flash', contextWindow: 262_144 }]),
      modelLimitDraft: { 'deepseek-v4.1-flash': { contextWindow: 131_072 } },
    }), edits)

    openModelLimits()
    fireEvent.click(screen.getByRole('button', { name: en.limitsResetModel }))
    expect(edits.edit).toHaveBeenCalledWith('modelLimits', '{"deepseek-v4.1-flash":null}')
  })

  it('stages clearing one field without dropping the other or restoring an inherited value', () => {
    const edits = actions()
    renderSection(stateOf({
      models: listing([{ id: 'm', name: 'Model' }]),
      modelLimitDraft: { m: { contextWindow: 123456, maxTokens: 1024 }, previous: null },
    }), edits)
    openModelLimits()
    fireEvent.change(screen.getByLabelText(t('limitsContextLabel', { name: 'Model' })), { target: { value: '' } })
    expect(edits.edit).toHaveBeenCalledWith('modelLimits', '{"m":{"contextWindow":null,"maxTokens":1024},"previous":null}')
    fireEvent.click(screen.getByRole('button', { name: en.limitsResetAll }))
    expect(edits.edit).toHaveBeenCalledWith('modelLimits', '{"m":null,"previous":null}')
  })

  it('does not count explicit catalog resets as customized models', () => {
    renderSection(stateOf({ models: listing([{ id: 'm', name: 'Model' }]), modelLimitDraft: { m: null } }))
    openModelLimits()
    expect(screen.getByText(t('limitsSummary', { count: 0 }))).toBeTruthy()
    expect(screen.queryByRole('button', { name: en.limitsResetModel })).toBeNull()
    expect(screen.queryByRole('button', { name: en.limitsResetAll })).toBeNull()
  })

  it('never invents gateway membership from offline saved overrides, but permits clearing them', () => {
    const edits = actions()
    renderSection(stateOf({ models: { status: 'failed', message: 'offline' },
      modelLimitDraft: { retired: { maxTokens: 1024 }, reset: null },
    }), edits)
    expect(screen.queryByRole('button', { name: /retired/ })).toBeNull()
    expect(screen.getByText(t('limitsSummary', { count: 0 }))).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: en.limitsResetAll }))
    expect(edits.edit).toHaveBeenCalledWith('modelLimits', '{"retired":null,"reset":null}')
  })

  it('reports a reading listing, an empty listing, and a failed one', () => {
    renderSection(stateOf())
    expect(screen.getByText(en.modelsLoading)).toBeTruthy()

    cleanup()
    renderSection(stateOf({ models: listing([]) }))
    expect(screen.getByText(en.modelsEmpty)).toBeTruthy()

    cleanup()
    renderSection(stateOf({ models: { status: 'failed', message: 'the live model listing is unreachable' } }))
    expect(screen.getByText(en.modelsFailed)).toBeTruthy()
    expect(screen.getByText('the live model listing is unreachable')).toBeTruthy()
  })

  it('re-reads the listing on demand, and refuses a second read while one is outstanding', () => {
    const reading = actions()
    renderSection(stateOf({ models: listing([{ id: 'a' }]) }), reading)
    fireEvent.click(screen.getByText(en.modelsRefresh))
    expect(reading.loadModels).toHaveBeenCalledTimes(1)

    cleanup()
    const pending = actions()
    renderSection(stateOf({ models: { status: 'loading' } }), pending)
    expect(screen.getByText<HTMLButtonElement>(en.modelsRefresh).disabled).toBe(true)
  })

  it('keeps the tuning fields collapsed until the disclosure is opened', () => {
    renderSection(stateOf({ refreshMinutes: field('30', { overridden: true }) }))

    expect(screen.queryByLabelText(en.baseURLLabel)).toBeNull()
    // The collapsed row still says a tuning field carries a user value.
    expect(screen.getByRole('button', { name: new RegExp(en.advancedLabel) }).textContent).toContain(en.overridden)
    expect(screen.queryByText(en.advancedHint)).toBeNull()

    openAdvanced()
    expect(screen.getByLabelText(en.baseURLLabel)).toHaveProperty('value', 'https://opencode.ai/zen/v1')
    expect(screen.getByLabelText(en.refreshMinutesLabel)).toHaveProperty('value', '30')
    expect(screen.getByText(en.keyLabel)).toBeTruthy()
  })

  it('ties the advanced disclosure to the region it controls', () => {
    renderSection(stateOf())
    const trigger = screen.getByText(en.advancedLabel).closest('button') as HTMLButtonElement
    expect(trigger.getAttribute('aria-expanded')).toBe('false')
    expect(trigger.getAttribute('aria-controls')).toBe('opencode-zen-advanced')

    fireEvent.click(trigger)
    expect(trigger.getAttribute('aria-expanded')).toBe('true')
    expect(document.getElementById('opencode-zen-advanced')).not.toBeNull()
  })

  it('stages edits through the injected actions and resets on demand', () => {
    const edits = actions()
    renderSection(stateOf({ refreshMinutes: field('60', { overridden: true }) }), edits)
    openAdvanced()

    fireEvent.change(screen.getByLabelText(en.baseURLLabel), { target: { value: 'https://other.test/v1' } })
    expect(edits.edit).toHaveBeenCalledWith('baseURL', 'https://other.test/v1')

    fireEvent.click(screen.getByText(en.reset))
    expect(edits.resetField).toHaveBeenCalledWith('refreshMinutes')
  })

  it('enables save only for a dirty, valid form and shows the failure note', () => {
    const acts = actions()
    const { rerender } = render((
      <OpencodeZenSection {...{
        ...acts,
        t,
        useOpencodeZen: bindSnapshotSelector(createSnapshotStore(stateOf({ dirty: true }))),
      }}
      />
    ))
    const save = screen.getByText(en.save) as HTMLButtonElement
    const discard = screen.getByText(en.discard) as HTMLButtonElement
    expect(save.disabled).toBe(false)
    expect(discard.disabled).toBe(false)
    fireEvent.click(save)
    expect(acts.save).toHaveBeenCalled()

    rerender((
      <OpencodeZenSection {...{
        ...acts,
        t,
        useOpencodeZen: bindSnapshotSelector(createSnapshotStore(stateOf({ dirty: true, failed: true }))),
      }}
      />
    ))
    expect(screen.getByText(en.savedFailed)).toBeTruthy()
  })

  it('exercises every field control: edits, resets, invalid and numeric states', () => {
    const edits = actions()
    renderSection(stateOf({
      apiKeyEnv: field('OPENCODE_API_KEY', { overridden: true }),
      baseURL: field('https://opencode.ai/zen/v1', { overridden: true }),
      refreshMinutes: field('not-a-number', { overridden: true, invalid: true }),
      streamIdleTimeoutMs: field('300000', { overridden: true }),
      maxRequestImageBytes: field('20971520', { overridden: true }),
      requestImagePixelBudget: field('4194304', { overridden: true }),
      requestImageMaxBytes: field('1048576', { overridden: true }),
    }), edits)

    fireEvent.change(screen.getByLabelText(en.keyLabel), { target: { value: 'secret-value' } })
    expect(edits.edit).toHaveBeenCalledWith('apiKey', 'secret-value')

    openAdvanced()
    const fields: readonly (readonly [label: string, name: string, numeric: boolean])[] = [
      [en.apiKeyEnvLabel, 'apiKeyEnv', false],
      [en.baseURLLabel, 'baseURL', false],
      [en.refreshMinutesLabel, 'refreshMinutes', true],
      [en.streamIdleTimeoutMsLabel, 'streamIdleTimeoutMs', true],
      [en.maxRequestImageBytesLabel, 'maxRequestImageBytes', true],
      [en.requestImagePixelBudgetLabel, 'requestImagePixelBudget', true],
      [en.requestImageMaxBytesLabel, 'requestImageMaxBytes', true],
    ]
    const resets = screen.getAllByText(en.reset)
    expect(resets).toHaveLength(fields.length)
    fields.forEach(([label, name, numeric], index) => {
      const input = screen.getByLabelText(label) as HTMLInputElement
      expect(input.inputMode).toBe(numeric ? 'numeric' : '')
      expect(input.type).toBe(numeric ? 'number' : 'text')
      const nextValue = numeric ? '123' : `edited-${name}`
      fireEvent.change(input, { target: { value: nextValue } })
      expect(edits.edit).toHaveBeenCalledWith(name, nextValue)
      fireEvent.click(resets[index] as Element)
      expect(edits.resetField).toHaveBeenCalledWith(name)
    })

    // The invalid refresh draft renders the invalid style and copy.
    expect(screen.getByText(en.invalidValue)).toBeTruthy()
  })

  it('shows the saving state while a save crosses the wire', () => {
    renderSection(stateOf({ dirty: true, saving: true }))
    expect(screen.getByText<HTMLButtonElement>(en.saving).disabled).toBe(true)
    expect(screen.getByText<HTMLButtonElement>(en.discard).disabled).toBe(true)
  })

  it('disables the form for a read-only document but leaves the key state visible', () => {
    renderSection(stateOf({ writable: false, apiKeyConfigured: true }))
    expect(screen.getByText<HTMLButtonElement>(en.save).disabled).toBe(true)
    expect(screen.getByLabelText<HTMLInputElement>(en.keyLabel).disabled).toBe(false)
    expect(screen.getByText(en.readOnly)).toBeTruthy()

    openAdvanced()
    expect(screen.getByLabelText<HTMLInputElement>(en.baseURLLabel).disabled).toBe(true)
  })

  it('reports a key the deployment supplies from elsewhere as read-only', () => {
    renderSection(stateOf({ apiKeyWritable: false }))
    expect(screen.getByLabelText<HTMLInputElement>(en.keyLabel).disabled).toBe(true)
    expect(screen.getByText(en.keyNotWritable)).toBeTruthy()
  })
})

describe('OpencodeZenSectionController through the component', () => {
  /** A host that accepts every write, publishing as the real scope would. */
  function acceptingHost(host: ReturnType<typeof stubSettingsScope<OpencodeZenSettings>>): void {
    host.set.mockImplementation((field: string, value: unknown) => {
      const section = { ...host.scope.getSnapshot().value as object }
      const user = { ...host.scope.getSnapshot().user as object }
      host.publish({ value: { ...section, [field]: value }, user: { ...user, [field]: value } })
    })
    // A nested field is written as a path op, the way the Host applies one.
    host.mutate.mockImplementation((ops: readonly { op: 'set' | 'unset'; path: readonly string[]; value?: unknown }[]) => {
      const apply = (layer: unknown): Record<string, unknown> => {
        const next = structuredClone((layer ?? {}) as Record<string, unknown>)
        for (const op of ops) {
          const path = [...op.path]
          const leaf = path.pop()!
          let node = next
          for (const key of path) {
            if (typeof node[key] !== 'object' || node[key] === null) node[key] = {}
            node = node[key] as Record<string, unknown>
          }
          if (op.op === 'set') node[leaf] = op.value
          else delete node[leaf]
        }
        return next
      }
      host.publish({
        value: apply(host.scope.getSnapshot().value) as never,
        user: apply(host.scope.getSnapshot().user) as never,
      })
    })
  }

  function mount(controller: OpencodeZenSectionController) {
    const face = controller.inject()
    return render(<OpencodeZenSection {...face} t={t}
      useOpencodeZen={bindSnapshotSelector(face.hooks.opencodeZen)} />)
  }

  const alpha = (): HTMLInputElement =>
    screen.getByRole('checkbox', { name: t('modelVisibleLabel', { name: 'Alpha' }) }) as HTMLInputElement
  const beta = (): HTMLInputElement =>
    screen.getByRole('checkbox', { name: t('modelVisibleLabel', { name: 'Beta' }) }) as HTMLInputElement

  function modelHost(): ReturnType<typeof stubSettingsScope<OpencodeZenSettings>> {
    const host = stubSettingsScope<OpencodeZenSettings>()
    acceptingHost(host)
    return host
  }

  function controllerFor(host: ReturnType<typeof stubSettingsScope<OpencodeZenSettings>>) {
    return new OpencodeZenSectionController(host.scope, { remote: {
      credentials: { describe: async () => ({ ok: true, value: {} }) },
      llm: {
        discoverModels: async () => ({
          ok: true,
          value: [{ id: 'a', name: 'Alpha' }, { id: 'b', name: 'Beta' }],
        }),
      },
    } } as never)
  }

  it('stages the switches with the rest of the form, writing only on save', async () => {
    const host = stubSettingsScope<OpencodeZenSettings>()
    host.publish({ status: 'ready', writable: true, value: {}, user: {} })
    acceptingHost(host)
    const controller = new OpencodeZenSectionController(host.scope, { remote: {
      credentials: {
        describe: async () => ({ ok: true, value: { OPENCODE_API_KEY: { configured: true, writable: true } } }),
        set: async () => ({ ok: true, value: undefined }),
      },
      llm: { discoverModels: async () => ({ ok: true, value: [] }) },
    } } as never)
    mount(controller)
    try {
      await act(async () => { await Promise.resolve() })
      fireEvent.change(screen.getByLabelText(en.keyLabel), { target: { value: 'unsaved-key' } })
      const toggle = () => screen.getByRole('switch', { name: en.showDeprecatedLabel })
      fireEvent.click(toggle())
      // Staged: the page shows the asked-for state and the Host is untouched.
      expect(toggle().getAttribute('aria-checked')).toBe('true')
      expect(host.set).not.toHaveBeenCalled()
      expect(screen.getByLabelText(en.keyLabel)).toHaveProperty('value', 'unsaved-key')

      await act(async () => { screen.getByText(en.save).click() })
      expect(host.set).toHaveBeenCalledWith('showDeprecatedModels', true)
      expect(toggle().getAttribute('aria-checked')).toBe('true')
      // The Save button carries the feedback the switch used to: a write the
      // Host did not land keeps its draft and reports itself in the shared note.
      host.set.mockImplementationOnce(() => Promise.resolve())
      fireEvent.click(toggle())
      await act(async () => { screen.getByText(en.save).click() })
      expect(screen.getByText(en.savedFailed)).toBeTruthy()
      expect(toggle().getAttribute('aria-checked')).toBe('false')
    } finally { controller.dispose() }
  })

  it('materializes the whitelist on the first check and saves it with the switches', async () => {
    const host = modelHost()
    host.publish({ status: 'ready', writable: true, value: {}, user: {} })
    const controller = controllerFor(host)
    mount(controller)
    try {
      await act(async () => { await Promise.resolve() })
      // No whitelist stored yet, so every listed model reads as checked.
      expect(alpha().checked).toBe(true)
      expect(beta().checked).toBe(true)
      expect(screen.getByText(t('limitsCheckedSummary', { count: 2, total: 2 }))).toBeTruthy()

      fireEvent.click(beta())
      expect(beta().checked).toBe(false)
      expect(host.set).not.toHaveBeenCalled()
      expect(screen.getByText(t('limitsCheckedSummary', { count: 1, total: 2 }))).toBeTruthy()

      await act(async () => { screen.getByText(en.save).click() })
      // The materialized list is the whole listing minus the unchecked model.
      expect(host.scope.getSnapshot().value?.enabledModels).toEqual(['a'])
      expect(screen.getByText<HTMLButtonElement>(en.save).disabled).toBe(true)
    } finally { controller.dispose() }
  })

  it('keeps an id the listing no longer serves, and clears every check on the batch action', async () => {
    const host = modelHost()
    host.publish({ status: 'ready', writable: true, value: { enabledModels: ['retired', 'a'] }, user: {} })
    const controller = controllerFor(host)
    mount(controller)
    try {
      await act(async () => { await Promise.resolve() })
      expect(alpha().checked).toBe(true)
      expect(beta().checked).toBe(false)

      // Checking a model the stored list never named does not clean up the
      // stale id beside it: a retired model comes back checked if it returns.
      fireEvent.click(beta())
      await act(async () => { screen.getByText(en.save).click() })
      expect(host.scope.getSnapshot().value?.enabledModels).toEqual(['retired', 'a', 'b'])

      fireEvent.click(screen.getByRole('button', { name: en.clearChecked }))
      expect(screen.getByText(t('limitsCheckedSummary', { count: 0, total: 2 }))).toBeTruthy()
      await act(async () => { screen.getByText(en.save).click() })
      // An empty whitelist is stored as such; withdrawing the provider from the
      // pickers is the Host's read of it.
      expect(host.scope.getSnapshot().value?.enabledModels).toEqual([])
    } finally { controller.dispose() }
  })

  it('restores the whitelist and the switches on discard', async () => {
    const host = modelHost()
    host.publish({ status: 'ready', writable: true, value: { enabledModels: ['a'] }, user: {} })
    const controller = controllerFor(host)
    mount(controller)
    try {
      await act(async () => { await Promise.resolve() })
      fireEvent.click(beta())
      fireEvent.click(screen.getByRole('switch', { name: en.enabledLabel }))
      expect(screen.getByText<HTMLButtonElement>(en.save).disabled).toBe(false)

      fireEvent.click(screen.getByText(en.discard))
      // One gesture, no confirmation, back to what the Host holds.
      expect(alpha().checked).toBe(true)
      expect(beta().checked).toBe(false)
      expect(screen.getByRole('switch', { name: en.enabledLabel }).getAttribute('aria-checked')).toBe('true')
      expect(screen.getByText<HTMLButtonElement>(en.save).disabled).toBe(true)
      expect(host.set).not.toHaveBeenCalled()
    } finally { controller.dispose() }
  })

  it('arms the unsaved-changes prompt only while a save would write something', async () => {
    const added = vi.spyOn(window, 'addEventListener')
    const removed = vi.spyOn(window, 'removeEventListener')
    const host = modelHost()
    host.publish({ status: 'ready', writable: true, value: {}, user: {} })
    const controller = controllerFor(host)
    mount(controller)
    const unloadAdds = (): number => added.mock.calls.filter(([type]) => type === 'beforeunload').length
    const unloadRemoves = (): number => removed.mock.calls.filter(([type]) => type === 'beforeunload').length
    try {
      await act(async () => { await Promise.resolve() })
      expect(unloadAdds()).toBe(0)

      fireEvent.click(beta())
      expect(unloadAdds()).toBe(1)
      const guard = added.mock.calls.find(([type]) => type === 'beforeunload')?.[1] as (event: Event) => void
      const event = new Event('beforeunload', { cancelable: true })
      guard(event)
      expect(event.defaultPrevented).toBe(true)

      fireEvent.click(screen.getByText(en.discard))
      expect(unloadRemoves()).toBe(1)

      fireEvent.click(beta())
      await act(async () => { screen.getByText(en.save).click() })
      expect(unloadRemoves()).toBe(2)
      expect(unloadAdds()).toBe(2)
    } finally {
      controller.dispose()
      added.mockRestore()
      removed.mockRestore()
    }
  })

  it('saves, discards, and resets capacities while preserving explicit catalog choices', async () => {
    const host = stubSettingsScope<OpencodeZenSettings>()
    host.set.mockImplementation((field: string, value: unknown) => {
      host.publish({
        value: { ...host.scope.getSnapshot().value, [field]: structuredClone(value) },
        user: { ...host.scope.getSnapshot().user as object, [field]: structuredClone(value) },
      })
    })
    const controller = new OpencodeZenSectionController(host.scope, { remote: {
      credentials: { describe: async () => ({ ok: true, value: {} }) },
      llm: { discoverModels: async () => ({ ok: true, value: [{ id: 'm', name: 'Model', contextWindow: 262144, maxTokens: 32768 }] }) },
    } } as never)
    host.publish({ status: 'ready', writable: true,
      value: { modelLimits: { m: { contextWindow: 100000, maxTokens: 1024 } } }, user: {} })
    render(<OpencodeZenSection {...controller.inject()} t={t}
      useOpencodeZen={bindSnapshotSelector(controller.inject().hooks.opencodeZen)} />)
    try {
      await act(async () => { await Promise.resolve() })
      openModelLimits()
      const input = () => screen.getByLabelText<HTMLInputElement>(t('limitsContextLabel', { name: 'Model' }))
      fireEvent.change(input(), { target: { value: '200000' } })
      expect(host.set).not.toHaveBeenCalled()
      fireEvent.click(screen.getByText(en.discard))
      expect(input().value).toBe('100000')
      fireEvent.change(input(), { target: { value: '200000' } })
      await act(async () => { screen.getByText(en.save).click() })
      expect(host.scope.getSnapshot().value?.modelLimits?.m?.contextWindow).toBe(200000)
      expect(screen.getByText(t('capacityDefault', { value: '262,144' }) + ' · ' + en.overridden)).toBeTruthy()
      expect(screen.getByText<HTMLButtonElement>(en.save).disabled).toBe(true)

      fireEvent.click(screen.getByRole('button', { name: en.limitsResetModel }))
      expect(input().value).toBe('')
      fireEvent.click(screen.getByText(en.discard))
      expect(input().value).toBe('200000')
      fireEvent.click(screen.getByRole('button', { name: en.limitsResetAll }))
      await act(async () => { screen.getByText(en.save).click() })
      expect(host.scope.getSnapshot().value?.modelLimits).toEqual({ m: null })
      expect(screen.getByText(t('limitsSummary', { count: 0 }))).toBeTruthy()
      fireEvent.change(input(), { target: { value: '150000' } })
      await act(async () => { screen.getByText(en.save).click() })
      expect(host.scope.getSnapshot().value?.modelLimits).toEqual({ m: { contextWindow: 150000, maxTokens: null } })
    } finally {
      controller.dispose()
    }
  })

  it('drives a staged edit end to end against the stub scope', async () => {
    const host = stubSettingsScope<OpencodeZenSettings>()
    host.set.mockImplementation((field: string, value: unknown) => {
      const section = { ...host.scope.getSnapshot().value as object }
      const user = { ...host.scope.getSnapshot().user as object }
      host.publish({ value: { ...section, [field]: value }, user: { ...user, [field]: value } })
    })
    const ctx = {
      remote: {
        credentials: { describe: vi.fn(() => Promise.resolve({ ok: true, value: {} })), set: vi.fn() },
        llm: { discoverModels: vi.fn(() => Promise.resolve({ ok: true, value: [] })) },
      },
    } as never
    const controller = new OpencodeZenSectionController(host.scope, ctx)
    host.publish({ status: 'ready', writable: true, value: { baseURL: 'https://opencode.ai/zen/v1' }, user: {} })

    render((
      <OpencodeZenSection
        {...{
          ...controller.inject(),
          t,
          useOpencodeZen: bindSnapshotSelector(controller.inject().hooks.opencodeZen),
        }}
      />
    ))

    openAdvanced()
    fireEvent.change(screen.getByLabelText(en.baseURLLabel), { target: { value: 'https://edited.test/v1' } })
    await act(async () => { screen.getByText(en.save).click() })

    await vi.waitFor(() => { expect(host.set).toHaveBeenCalledWith('baseURL', 'https://edited.test/v1') })
  })

  it('stages the Go plan on its own switch and writes it as one nested path op', async () => {
    const host = modelHost()
    host.publish({ status: 'ready', writable: true, value: {}, user: {} })
    const controller = controllerFor(host)
    mount(controller)
    try {
      await act(async () => { await Promise.resolve() })
      openAdvanced()
      fireEvent.change(screen.getByLabelText(en.goBaseURLLabel), { target: { value: 'https://go.test/v1' } })
      fireEvent.click(screen.getByRole('switch', { name: en.goEnabledLabel }))

      // Staged: one save writes both plans, and nothing has reached the Host yet.
      expect(host.mutate).not.toHaveBeenCalled()
      expect(host.set).not.toHaveBeenCalled()

      await act(async () => { screen.getByText(en.save).click() })
      await vi.waitFor(() => {
        expect(host.mutate).toHaveBeenCalledWith([{ op: 'set', path: ['go', 'baseURL'], value: 'https://go.test/v1' }])
      })
      // The Go plan's switch is the nested one; Zen's stays its own top-level field.
      expect(host.mutate).toHaveBeenCalledWith([{ op: 'set', path: ['go', 'enabled'], value: false }])
      expect(host.set).not.toHaveBeenCalledWith('enabled', false)
    } finally {
      controller.dispose()
    }
  })

  it('keeps each plan whitelist apart', async () => {
    const host = modelHost()
    host.publish({ status: 'ready', writable: true, value: {}, user: {} })
    const controller = controllerFor(host)
    const face = controller.inject()
    mount(controller)
    try {
      await act(async () => { await Promise.resolve() })
      await vi.waitFor(() => { expect(screen.getAllByRole('checkbox').length).toBeGreaterThan(1) })

      // Neither plan's whitelist is stored yet, so both read as fully checked.
      const state = () => face.hooks.opencodeZen.getSnapshot()
      expect(state().checkedModels).toEqual(['a', 'b'])
      expect(state().go.checkedModels).toEqual(['a', 'b'])

      face.setModelChecked('b', false)
      expect(state().checkedModels).toEqual(['a'])
      expect(state().go.checkedModels).toEqual(['a', 'b'])

      face.setGoModelChecked('a', false)
      expect(state().go.checkedModels).toEqual(['b'])
      // Zen's own list was never narrowed by the Go panel's edit.
      expect(state().checkedModels).toEqual(['a'])
    } finally {
      controller.dispose()
    }
  })
})

describe('both plans on one page', () => {
  const goUsage = {
    rolling: { status: 'ok' as const, percent: 20, resetsAt: '2026-09-21T00:00:00Z' },
    weekly: { status: 'rate-limited' as const, percent: 100, resetsAt: '2026-09-22T00:00:00Z' },
    monthly: { status: 'ok' as const, percent: 41, resetsAt: '2026-09-30T00:00:00Z' },
  }

  it('gives each plan its own editor, landmarks and control ids', () => {
    renderSection(stateOf({
      models: listing([{ id: 'a', name: 'Alpha' }]),
      checkedModels: ['a'],
      go: goPanel({
        models: listing([{ id: 'g', name: 'Gamma' }]),
        checkedModels: ['g'],
        usage: { status: 'subscribed', usage: goUsage },
      }),
    }))

    const zenList = screen.getByRole('navigation', { name: en.modelsLabel })
    const goList = screen.getByRole('navigation', { name: en.goModelsLabel })
    expect(within(zenList).getByRole('checkbox', { name: t('modelVisibleLabel', { name: 'Alpha' }) })).toBeTruthy()
    expect(within(goList).getByRole('checkbox', { name: t('goModelVisibleLabel', { name: 'Gamma' }) })).toBeTruthy()
    // Two editors, two sets of ids: no control is addressed twice.
    for (const id of ['opencode-zen-model-filter', 'opencode-go-model-filter',
      'opencode-zen-contextWindow-a', 'opencode-go-contextWindow-g']) {
      expect(document.querySelectorAll(`#${id}`)).toHaveLength(1)
    }
    // The quota windows carry their own values and reset times.
    expect(screen.getByRole('progressbar', { name: en.usage_rolling }).getAttribute('value')).toBe('20')
    expect(screen.getByRole('progressbar', { name: en.usage_weekly }).getAttribute('value')).toBe('100')
    expect(screen.getByText(`${en.usageResets} ${new Date(goUsage.monthly.resetsAt).toLocaleString()}`)).toBeTruthy()
  })

  it('keeps Go rows to the name and monthly estimate while metadata stays in the detail pane', () => {
    renderSection(stateOf({ go: goPanel({
      models: listing([
        { id: 'kimi-k3', name: 'Kimi K3', estimatedMonthlyRequests: 1080, releaseDate: '2026-01-15' },
        { id: 'space-bunny-free', name: 'Space Bunny Free', estimatedMonthlyRequests: 'unlimited' },
        { id: 'old', name: 'Old Go model', deprecated: true, estimatedMonthlyRequests: null },
        { id: 'not-loaded', name: 'Not loaded' },
      ]),
      checkedModels: ['kimi-k3', 'space-bunny-free', 'old', 'not-loaded'],
      checkedCount: 4,
    }) }))

    const list = screen.getByRole('navigation', { name: en.goModelsLabel })
    const goSort = screen.getByLabelText(t('goSortBy')) as HTMLSelectElement
    expect([...goSort.options].map(option => option.value)).toEqual(['default', 'release', 'monthly'])
    const kimi = within(list).getByRole('button', { name: /Kimi K3/ })
    expect(within(kimi).getByText(t('goMonthlyRequests', { count: '1,080' }))).toBeTruthy()
    expect(within(kimi).queryByText('kimi-k3')).toBeNull()
    expect(within(kimi).queryByText(t('goReleasedOn', { date: '2026-01-15' }))).toBeNull()
    expect(within(list).getByText(en.goMonthlyRequestsUnlimited)).toBeTruthy()
    expect(within(list).getByText(en.goMonthlyRequestsUnpublished)).toBeTruthy()
    expect(within(list).getByRole('button', { name: 'Not loaded' }).textContent).toBe('Not loaded')
    fireEvent.change(goSort, { target: { value: 'monthly' } })
    expect(within(list).getAllByRole('button').map(button => button.textContent?.split(' ')[0]))
      .toEqual(['Space', 'Kimi', 'Not', 'Old'])

    fireEvent.click(within(list).getByRole('button', { name: /Kimi K3/ }))
    const details = screen.getByRole('region', { name: en.goModelDetails })
    expect(within(details).getByText('kimi-k3')).toBeTruthy()
    expect(within(details).getByText(t('goReleaseSource', { date: '2026-01-15' }))).toBeTruthy()
    fireEvent.click(within(list).getByRole('button', { name: /Old Go model/ }))
    expect(within(screen.getByRole('region', { name: en.goModelDetails })).getByText(en.goDeprecatedBadge)).toBeTruthy()
  })

  it('forces the Go model and estimate refresh only from the explicit refresh control', () => {
    const reading = actions()
    renderSection(stateOf(), reading)
    expect(reading.loadGoModels).toHaveBeenCalledTimes(1)
    expect(reading.loadGoModels).toHaveBeenCalledWith()

    fireEvent.click(screen.getByRole('button', { name: en.goModelsRefresh }))
    expect(reading.loadGoModels).toHaveBeenLastCalledWith(true)
  })

  it('words the Go quota by what the endpoint actually said', () => {
    renderSection(stateOf({ go: goPanel({ usage: { status: 'not-subscribed' } }) }))
    expect(screen.getByText(en.goQuotaNotSubscribed)).toBeTruthy()
    cleanup()

    renderSection(stateOf({ go: goPanel({ usage: { status: 'unknown', message: 'offline at 10.0.0.1' } }) }))
    expect(screen.getByText(en.goQuotaUnknown)).toBeTruthy()
    // The Host's diagnostic stays out of the page, the way a response body must.
    expect(screen.queryByText(/offline at/)).toBeNull()
    cleanup()

    renderSection(stateOf({ go: goPanel({ usage: { status: 'idle' } }) }))
    expect(screen.getByText(en.goQuotaIdle)).toBeTruthy()
  })
})

/**
 * The OpenCode settings page's staged form over the `llm-opencode-zen`
 * settings namespace, plus the two gateway model listings and the Go plan's
 * quota the page reports.
 *
 * One document carries both plans: the top-level fields are OpenCode Zen's and
 * the `go` block is the subscription's, so the page edits both through one
 * staged form and one save. The two credential controls are the only parts
 * that do not live in the section: their literals never ride a response, so
 * the page learns only whether one is configured and writes it through the
 * credentials domain, addressed by the reference each plan names.
 */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
// Type-only: pulls the ctx.remote merge into this program.
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type { ZenModel } from '../models-contract.ts'
import type { GoUsage, GoUsageProbe } from '../usage-contract.ts'
import type {} from '@deepseek-ai/dsh-api-settings-controller/remote'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { SettingsScope, SettingsScopeSnapshot } from './settings.ts'
import {
  StagedForm,
  booleanField,
  jsonField,
  numberField,
  textField,
  type FieldSpec,
  type FieldState,
  type FormActions,
  type FormShell,
} from './staged-form.ts'

/** Namespace of the OpenCode adapter. Spelled here rather than imported: a client package must not depend on a Host package. */
export const OPENCODE_ZEN_NS = 'llm-opencode-zen'

/** Credential reference a plan resolves when the section names none. */
const DEFAULT_API_KEY_REF = 'OPENCODE_API_KEY'

/** The two plans this page edits, in the order it renders them. */
export type Plan = 'zen' | 'go'

/** Document block the Go plan's fields live under. */
const GO_BLOCK = 'go'

/**
 * Route the Host's model discovery answers for, per plan. Spelled here for the
 * same reason as {@link OPENCODE_ZEN_NS}: a client package must not depend on a
 * Host package.
 */
const PROVIDER_OF: Record<Plan, string> = { zen: 'opencode-zen', go: 'opencode-go' }

/** Form field the Zen plan's credential control stages under. */
const API_KEY_FIELD = 'apiKey'
/** Form field the Go plan's credential control stages under. */
const GO_API_KEY_FIELD = 'goApiKey'

/** The form key one of a plan's fields stages under. */
function fieldKey(plan: Plan, leaf: string): string {
  return plan === GO_BLOCK ? `${GO_BLOCK}.${leaf}` : leaf
}

/** Where one of a plan's fields lives inside the section. */
function docPath(plan: Plan, leaf: string): readonly string[] {
  return plan === GO_BLOCK ? [GO_BLOCK, leaf] : [leaf]
}

/** The Go plan's own fields, as the page edits them. */
export interface OpencodeGoSettings {
  /** Whether the adapter serves the Go route. */
  enabled?: boolean
  /** Include gateway-served deprecated Go models in conversation pickers. */
  showDeprecatedModels?: boolean
  /** Picker whitelist for the Go plan. */
  enabledModels?: string[] | null
  /** Credential reference naming the Go plan's environment key. */
  apiKeyEnv?: string
  /** The Go gateway endpoint. */
  baseURL?: string
  /** Per-model capacity overrides for the Go plan. */
  modelLimits?: OpencodeZenModelLimits
}

/** The adapter fields this page edits. */
export interface OpencodeZenSettings {
  /** Whether the adapter serves its route; false withdraws it from every picker. */
  enabled?: boolean
  /** Include gateway-served deprecated models in conversation pickers. */
  showDeprecatedModels?: boolean
  /**
   * Picker whitelist: the model ids conversation pickers may offer. Absent (or
   * null) means the field was never set and every model stays visible; an empty
   * array is a deliberate "none" that withdraws the provider from the pickers.
   */
  enabledModels?: string[] | null
  /** Credential reference naming the environment key. */
  apiKeyEnv?: string
  /** The gateway endpoint; also the live listing base. */
  baseURL?: string
  /** Live catalog re-resolution interval, in minutes. */
  refreshMinutes?: number
  /** Largest idle gap between stream events, in milliseconds. */
  streamIdleTimeoutMs?: number
  /** Accumulated base64 image payload bound for one request. */
  maxRequestImageBytes?: number
  /** Total-pixel budget for one request image. */
  requestImagePixelBudget?: number
  /** Raw encoded-byte target for one request image. */
  requestImageMaxBytes?: number
  /** Per-model capacity overrides, keyed by the gateway model id. */
  modelLimits?: OpencodeZenModelLimits
  /** The OpenCode Go subscription plan, served alongside the Zen fields above. */
  go?: OpencodeGoSettings
}

/** The two capacity values the settings table can override. */
export interface OpencodeZenModelLimit {
  contextWindow?: number | null
  maxTokens?: number | null
}

export type OpencodeZenModelLimits = Record<string, OpencodeZenModelLimit | null>

/** What the credentials domain last reported, and for which reference. */
interface CredentialState {
  /** Reference this answer describes; a stale response for another one is dropped. */
  ref: string
  /** Whether any layer supplies a value for it. */
  configured: boolean
  /** Whether `credentials/set` can affect it; false disables the control. */
  writable: boolean
}

/** The gateway's model listing as the page reports it. */
export type OpencodeZenModels =
  /** Not asked for yet; the page asks once it mounts. */
  | { readonly status: 'idle' }
  /** A listing request is outstanding. */
  | { readonly status: 'loading' }
  /**
   * The gateway answered: a count/preview for the compact summary plus every
   * discovered entry used by the capacity editor.
   */
  | {
    readonly status: 'ready'
    readonly count: number
    readonly preview: readonly string[]
    readonly entries: readonly ZenModel[]
  }
  /** The listing could not be read; `message` is the Host's own diagnostic. */
  | { readonly status: 'failed'; readonly message: string }

/**
 * The Go plan's quota as the page reports it. `not-subscribed` and `unknown`
 * stay apart on purpose: only a definitive refusal may be worded as a verdict
 * about the account, and neither ever changes what the plan serves.
 */
export type GoUsageState =
  | { readonly status: 'idle' }
  | { readonly status: 'loading' }
  | { readonly status: 'subscribed'; readonly usage: GoUsage }
  | { readonly status: 'not-subscribed' }
  | { readonly status: 'unknown'; readonly message: string }

/** One plan's editable surface, as the page renders it. */
export interface OpencodeZenPanelState {
  /**
   * Whether the plan will serve its route once the staged form is saved.
   * Resolved from the draft over the section rather than written on the click:
   * every control on this page, the switches included, is one save.
   */
  enabled: boolean
  showDeprecatedModels: boolean
  /**
   * The picker whitelist as the page shows it. While the field was never set
   * this is every listed model: the unset state is "all visible", not "none",
   * so each row can render its checkbox from membership alone.
   */
  checkedModels: readonly string[]
  /** How many of the listed models the pickers would currently offer. */
  checkedCount: number
  /** Credential reference naming the environment key. */
  apiKeyEnv: FieldState
  /** The gateway endpoint. */
  baseURL: FieldState
  /** The staged credential, which starts blank on every load. */
  apiKey: FieldState
  /** Whether the Host reports a credential configured for the referenced key. */
  apiKeyConfigured: boolean
  /** Whether the credentials domain accepts a write for it; false disables the control. */
  apiKeyWritable: boolean
  /** The gateway's current model listing. */
  models: OpencodeZenModels
  /** The staged JSON field backing the capacity table. */
  modelLimits: FieldState
  /** The parsed overrides currently shown by the capacity table. */
  modelLimitDraft: OpencodeZenModelLimits
}

/** The Go plan's panel: its own fields plus the quota read from its endpoint. */
export interface OpencodeGoPanelState extends OpencodeZenPanelState {
  /** What the last probe of the plan's usage endpoint established. */
  usage: GoUsageState
}

/** What the settings page renders. */
export interface OpencodeZenSectionState extends FormShell, OpencodeZenPanelState {
  /** Live catalog re-resolution interval, in minutes; shared by both plans. */
  refreshMinutes: FieldState
  /** Largest idle gap between stream events, in milliseconds; shared. */
  streamIdleTimeoutMs: FieldState
  /** Accumulated base64 image payload bound for one request; shared. */
  maxRequestImageBytes: FieldState
  /** Total-pixel budget for one request image; shared. */
  requestImagePixelBudget: FieldState
  /** Raw encoded-byte target for one request image; shared. */
  requestImageMaxBytes: FieldState
  /** The OpenCode Go subscription plan. */
  go: OpencodeGoPanelState
}

/** The registration-side face the page's slot entry injects. */
export interface OpencodeZenSectionFace extends FormActions {
  hooks: {
    /** Page snapshot bound by the UI renderer as useOpencodeZen. */
    opencodeZen: SnapshotStore<OpencodeZenSectionState>
  }
  /** Read the Zen gateway's model listing, now or again after a failure. */
  loadModels: () => void
  /**
   * Stage one model's membership in the Zen picker whitelist. Saved with the
   * rest of the form; the pickers follow on the next open.
   * @param id - the gateway model id the checkbox names.
   * @param checked - the state the checkbox asks for.
   */
  setModelChecked: (id: string, checked: boolean) => void
  /**
   * Stage an empty Zen whitelist, which withdraws the provider from the
   * pickers rather than leaving an empty one there. Saved with the rest.
   */
  clearModelChecks: () => void
  /** Read the Go gateway's model listing, now or again after a failure. */
  loadGoModels: () => void
  /**
   * Stage one model's membership in the Go picker whitelist.
   * @param id - the gateway model id the checkbox names.
   * @param checked - the state the checkbox asks for.
   */
  setGoModelChecked: (id: string, checked: boolean) => void
  /** Stage an empty Go whitelist, withdrawing the Go provider from the pickers. */
  clearGoModelChecks: () => void
  /**
   * Probe the Go plan's quota. Informational only: it never withdraws a route
   * or writes configuration, so a failed probe cannot change what the plan
   * serves.
   */
  loadUsage: () => void
}

/** The Host reads one plan's listing and, for Go, its quota through. */
export interface OpencodeZenSources {
  /** The Zen plan's model listing. */
  models: () => Promise<RemoteResult<readonly ZenModel[]>>
  /** The Go plan's model listing. */
  goModels: () => Promise<RemoteResult<readonly ZenModel[]>>
  /** One probe of the Go plan's quota. */
  usage: () => Promise<RemoteResult<GoUsageProbe>>
}

/** Bridges the `llm-opencode-zen` scope and the credentials domain onto the page. */
export class OpencodeZenSectionController {
  private readonly form: StagedForm
  private readonly store: SnapshotStore<OpencodeZenSectionState>
  private readonly credentials: Record<Plan, CredentialState> = {
    zen: { ref: '', configured: false, writable: true },
    go: { ref: '', configured: false, writable: true },
  }
  private readonly listings: Record<Plan, OpencodeZenModels> = {
    zen: { status: 'idle' },
    go: { status: 'idle' },
  }
  private readonly listingRequests: Record<Plan, number> = { zen: 0, go: 0 }
  private usage: GoUsageState = { status: 'idle' }
  private usageRequest = 0
  private face: OpencodeZenSectionFace | undefined
  private readonly unsubscribe: () => void
  private readonly unsubscribeForm: () => void
  /** The live form listener behind the unsaved-changes prompt; absent while clean. */
  private unloadGuard: ((event: BeforeUnloadEvent) => void) | undefined

  /**
   * @param scope - the bound settings scope for the `llm-opencode-zen` namespace.
   * @param ctx - the page plugin's context, whose `remote.credentials` namespace
   *   answers for the references the section names.
   * @param sources - the Host reads behind the page's listings and quota; the
   *   discovery defaults exist for a bare mount and for tests.
   */
  constructor(
    private readonly scope: SettingsScope<OpencodeZenSettings>,
    private readonly ctx: ClientContext,
    private readonly sources: OpencodeZenSources = {
      models: () => ctx.remote.llm.discoverModels(OPENCODE_ZEN_NS, { provider: PROVIDER_OF.zen }),
      goModels: () => ctx.remote.llm.discoverModels(OPENCODE_ZEN_NS, { provider: PROVIDER_OF.go }),
      usage: () => ctx.remote.opencodeGoUsage.read(),
    },
  ) {
    this.form = new StagedForm(
      scope as SettingsScope<Record<string, unknown>>,
      [
        // The switches are staged like every other field: they are part of the
        // same save, so the page has no control that reaches the Host on a click.
        // A plan's fields carry both a form key and the document path they
        // address, which is how the Go block rides one form beside Zen.
        ...planFields('zen'),
        ...planFields('go'),
        numberField('refreshMinutes'),
        numberField('streamIdleTimeoutMs'),
        numberField('maxRequestImageBytes'),
        numberField('requestImagePixelBudget'),
        numberField('requestImageMaxBytes'),
      ],
      [
        { field: API_KEY_FIELD, write: text => this.writeKey('zen', text) },
        { field: GO_API_KEY_FIELD, write: text => this.writeKey('go', text) },
      ],
    )
    this.store = this.form.bind(() => this.projection())
    this.unsubscribe = scope.subscribe(() => { void this.readCredential() })
    this.unsubscribeForm = this.store.subscribe(() => { this.syncUnloadGuard() })
    void this.readCredential()
  }

  /** Release subscriptions without disposing the host's shared form. */
  dispose(): void {
    this.listingRequests.zen++
    this.listingRequests.go++
    this.usageRequest++
    this.unsubscribe()
    this.unsubscribeForm()
    this.syncUnloadGuard(false)
    this.form.dispose()
  }

  private projection(): OpencodeZenSectionState {
    return {
      ...this.form.shell(),
      ...this.panel('zen'),
      refreshMinutes: this.form.field('refreshMinutes'),
      streamIdleTimeoutMs: this.form.field('streamIdleTimeoutMs'),
      maxRequestImageBytes: this.form.field('maxRequestImageBytes'),
      requestImagePixelBudget: this.form.field('requestImagePixelBudget'),
      requestImageMaxBytes: this.form.field('requestImageMaxBytes'),
      go: { ...this.panel('go'), usage: this.usage },
    }
  }

  /** Read one plan's panel state. */
  private panel(plan: Plan): OpencodeZenPanelState {
    const key = (leaf: string): string => fieldKey(plan, leaf)
    return {
      enabled: this.stagedSwitch(plan, 'enabled', true),
      showDeprecatedModels: this.stagedSwitch(plan, 'showDeprecatedModels', false),
      checkedModels: this.visibleChecks(plan),
      checkedCount: this.checkedCount(plan),
      apiKeyEnv: this.form.field(key('apiKeyEnv')),
      baseURL: this.form.field(key('baseURL')),
      apiKey: this.form.field(plan === 'go' ? GO_API_KEY_FIELD : API_KEY_FIELD),
      apiKeyConfigured: this.credentials[plan].configured,
      apiKeyWritable: this.credentials[plan].writable,
      models: this.listings[plan],
      modelLimits: this.form.field(key('modelLimits')),
      modelLimitDraft: this.limitDraft(plan),
    }
  }

  /**
   * Read the overrides as the page currently shows them. A staged JSON draft
   * wins while it is valid; malformed text falls back to the last accepted
   * settings value so the table never renders phantom rows.
   */
  private limitDraft(plan: Plan): OpencodeZenModelLimits {
    const stored = modelLimitsOf(this.docValue(plan, 'modelLimits'))
    const staged = this.form.field(fieldKey(plan, 'modelLimits'))
    if (staged.invalid) return stored
    if (staged.overridden || this.form.shell().dirty) {
      try {
        return modelLimitsOf(JSON.parse(staged.text) as unknown)
      } catch {
        return stored
      }
    }
    return stored
  }

  /**
   * Read one switch as the page currently shows it: the staged draft when one
   * exists, over the resolved section's value, over the Host's own default.
   *
   * The switches are staged with everything else now, so the control reports
   * what a save would store rather than what the Host holds; the page's Save
   * button is the whole feedback loop.
   * @param plan - the plan whose switch this is.
   * @param leaf - the switch's field name inside the plan.
   * @param fallback - the state when neither the draft nor the section carries one.
   * @returns whether the switch reads as on.
   */
  private stagedSwitch(plan: Plan, leaf: 'enabled' | 'showDeprecatedModels', fallback: boolean): boolean {
    const staged = this.form.field(fieldKey(plan, leaf))
    // A field whose value is not a boolean formats as empty text, which is the
    // one case the fallback answers.
    return staged.text === '' ? fallback : staged.text === 'true'
  }

  /** Every id one plan's listing serves; empty until that listing has been read. */
  private listedIds(plan: Plan): readonly string[] {
    const listing = this.listings[plan]
    return listing.status === 'ready' ? listing.entries.map(entry => entry.id) : []
  }

  /**
   * The whitelist as staged or stored, or undefined while it was never set.
   *
   * A malformed draft falls back to the last accepted settings value, the same
   * way the capacity table reads its own JSON field, so a broken draft never
   * silently drops ids that are not on screen.
   */
  private checkedDraft(plan: Plan): string[] | undefined {
    const stored = idsOf(this.docValue(plan, 'enabledModels'))
    const staged = this.form.field(fieldKey(plan, 'enabledModels'))
    if (staged.invalid) return stored
    if (staged.text.trim() === '') return undefined
    try {
      return idsOf(JSON.parse(staged.text) as unknown)
    } catch {
      return stored
    }
  }

  /**
   * The whitelist as the page shows it. A never-set field is not an empty
   * selection: it means every model the gateway serves, so the listing answers
   * for it and every row renders checked.
   */
  private visibleChecks(plan: Plan): readonly string[] {
    return this.checkedDraft(plan) ?? this.listedIds(plan)
  }

  /** How many of one plan's listed models the pickers would offer. */
  private checkedCount(plan: Plan): number {
    const checked = new Set(this.visibleChecks(plan))
    return this.listedIds(plan).filter(id => checked.has(id)).length
  }

  /**
   * Stage one model's membership in a plan's picker whitelist.
   *
   * The first edit materializes the whitelist. A document without one means
   * "every model", and the only moment the page knows which models those are is
   * while the gateway listing is in hand, so the draft starts as the current
   * listing and this edit lands on top of it. From then on the stored list is
   * authoritative, which is exactly what keeps a model that appears later out of
   * the pickers until someone checks it.
   *
   * Nothing is cleaned up along the way: an id whose model has left the listing
   * stays in the list, so the model comes back checked if it returns.
   */
  setModelChecked(id: string, checked: boolean): void {
    this.stageCheck('zen', id, checked)
  }

  /** The Go plan's counterpart of {@link setModelChecked}. */
  setGoModelChecked(id: string, checked: boolean): void {
    this.stageCheck('go', id, checked)
  }

  /**
   * Stage an empty whitelist. Saved, that withdraws the plan from the pickers
   * entirely rather than leaving an empty one there.
   */
  clearModelChecks(): void {
    this.clearChecks('zen')
  }

  /** The Go plan's counterpart of {@link clearModelChecks}. */
  clearGoModelChecks(): void {
    this.clearChecks('go')
  }

  private stageCheck(plan: Plan, id: string, checked: boolean): void {
    if (!this.scope.getSnapshot().writable) return
    const current = this.checkedDraft(plan) ?? this.listedIds(plan)
    const next = new Set(current)
    if (checked) next.add(id)
    else next.delete(id)
    // An id already in the state the checkbox asks for stages nothing, so a
    // no-op click never makes the form dirty.
    if (next.size === current.length) return
    this.stageChecked(plan, [...next])
  }

  private clearChecks(plan: Plan): void {
    if (!this.scope.getSnapshot().writable) return
    if (this.checkedDraft(plan)?.length === 0) return
    this.stageChecked(plan, [])
  }

  /**
   * Stage the whitelist through the shared JSON field. The draft is indented
   * the way that field formats a stored value, so a draft that matches what is
   * already stored leaves the form clean instead of planning a cosmetic write.
   * @param plan - the plan whose whitelist this is.
   * @param ids - the ids the saved list should carry, in the order staged.
   */
  private stageChecked(plan: Plan, ids: readonly string[]): void {
    this.form.actions().edit(fieldKey(plan, 'enabledModels'), JSON.stringify(ids, undefined, 2))
  }

  /**
   * Keep the browser's unsaved-changes prompt in step with the staged form: it
   * is armed only while a save would write something, and disarmed the moment
   * the form is clean again.
   * @param dirty - whether the form holds edits; defaults to the store's own read.
   */
  private syncUnloadGuard(dirty = this.store.getSnapshot().dirty): void {
    // The client bundle only ever runs in a browser; the guard keeps the module
    // importable from a non-DOM test or build step.
    if (typeof window === 'undefined') return
    if (dirty === (this.unloadGuard !== undefined)) return
    if (!dirty) {
      window.removeEventListener('beforeunload', this.unloadGuard!)
      this.unloadGuard = undefined
      return
    }
    const guard = (event: BeforeUnloadEvent): void => {
      // Both spellings: preventDefault is the standard, and the legacy
      // returnValue is what older engines actually read.
      event.preventDefault()
      event.returnValue = ''
    }
    this.unloadGuard = guard
    window.addEventListener('beforeunload', guard)
  }

  /**
   * Read one plan's model listing through the Host. Called when that plan's
   * panel mounts and again from its refresh control. A rejection settles as a
   * failure too: the refresh control is disabled while loading and the next
   * read starts only from `idle`, so leaving the state loading would strand the
   * panel with no way to ask the gateway again.
   */
  loadModels(): void {
    this.readListing('zen')
  }

  /** The Go plan's counterpart of {@link loadModels}. */
  loadGoModels(): void {
    this.readListing('go')
  }

  private readListing(plan: Plan): void {
    const request = ++this.listingRequests[plan]
    this.listings[plan] = { status: 'loading' }
    this.store.set(this.projection())
    // A later read owns the panel: an answer or rejection for an earlier one
    // would report a listing the user already replaced. The source is called
    // synchronously, as its callers expect, but a source that throws outright
    // - a deployment whose remote namespace never mounted - is turned into a
    // rejection the panel can report instead of escaping this method.
    let pending: Promise<RemoteResult<readonly ZenModel[]>>
    try {
      pending = plan === 'go' ? this.sources.goModels() : this.sources.models()
    } catch (error: unknown) {
      pending = Promise.reject(error)
    }
    void pending
      .then((response) => {
        if (request !== this.listingRequests[plan]) return
        this.listings[plan] = response.ok
          ? {
            status: 'ready',
            count: response.value.length,
            preview: response.value.map(model => model.name ?? model.id),
            entries: response.value,
          }
          : { status: 'failed', message: response.error.message }
        this.store.set(this.projection())
      })
      .catch((error: unknown) => {
        if (request !== this.listingRequests[plan]) return
        this.listings[plan] = { status: 'failed', message: error instanceof Error ? error.message : String(error) }
        this.store.set(this.projection())
      })
  }

  /**
   * Probe the Go plan's quota for the settings panel. The answer is shown as
   * reported and nothing else consumes it: a failed probe leaves the plan's
   * route, models and pickers exactly as they were.
   */
  loadUsage(): void {
    const request = ++this.usageRequest
    this.usage = { status: 'loading' }
    this.store.set(this.projection())
    // Same contract as the listings: called synchronously, reported as a
    // failure rather than thrown when the seam behind it is absent.
    let pending: Promise<RemoteResult<GoUsageProbe>>
    try {
      pending = this.sources.usage()
    } catch (error: unknown) {
      pending = Promise.reject(error)
    }
    void pending
      .then((response) => {
        if (request !== this.usageRequest) return
        this.usage = response.ok ? response.value : { status: 'unknown', message: response.error.message }
        this.store.set(this.projection())
      })
      .catch((error: unknown) => {
        if (request !== this.usageRequest) return
        this.usage = { status: 'unknown', message: error instanceof Error ? error.message : String(error) }
        this.store.set(this.projection())
      })
  }

  /**
   * Ask the credentials domain about the references the section currently
   * names, for both plans in one call.
   *
   * Each answer is stored with the reference it describes: a reference can
   * change between the request and its response, and two reads can settle out
   * of order, so a response is published only while it still answers for the
   * reference in force. Both plans default to the same reference, and the
   * domain is asked once for each distinct name.
   */
  private async readCredential(): Promise<void> {
    const refs: Record<Plan, string> = { zen: refOf(this.scope.getSnapshot(), 'zen'), go: refOf(this.scope.getSnapshot(), 'go') }
    let republished = false
    for (const plan of ['zen', 'go'] as const) {
      if (refs[plan] !== this.credentials[plan].ref) {
        // A new reference knows nothing yet; keeping the old answer would claim
        // the key is configured under a name nobody has checked.
        this.credentials[plan] = { ref: refs[plan], configured: false, writable: true }
        republished = true
      }
    }
    if (republished) this.store.set(this.projection())
    const response = await this.ctx.remote.credentials.describe([...new Set([refs.zen, refs.go])])
    if (!response.ok) return
    for (const plan of ['zen', 'go'] as const) {
      if (refs[plan] !== refOf(this.scope.getSnapshot(), plan)) continue
      const view = response.value[refs[plan]]
      const next: CredentialState = {
        ref: refs[plan],
        configured: view?.configured ?? false,
        // An unknown reference is treated as writable: the control stays usable
        // and the Host is what refuses, rather than the page guessing a refusal.
        writable: view?.writable ?? true,
      }
      const previous = this.credentials[plan]
      if (next.configured === previous.configured && next.writable === previous.writable) continue
      this.credentials[plan] = next
      this.store.set(this.projection())
    }
  }

  /**
   * Re-read after the Host reports a change to a reference this page watches.
   *
   * A key can be written from somewhere else - the Models page addresses the
   * same reference - and the settings section does not change when it is, so
   * without this the badge keeps reporting a state the Host already replaced.
   * @param ref - the reference the Host reports as changed.
   */
  refreshCredential(ref: string): void {
    const watched = (['zen', 'go'] as const).some(plan => ref === this.credentials[plan].ref)
    if (!watched) return
    void this.readCredential()
  }

  /**
   * Build the face the page's slot registration injects. Built once: the store
   * is what changes, and the renderer binds the same callbacks across renders.
   * @returns the page snapshot and its form actions.
   */
  inject(): OpencodeZenSectionFace {
    this.face ??= {
      hooks: { opencodeZen: this.store },
      loadModels: () => { this.loadModels() },
      setModelChecked: (id, checked) => { this.setModelChecked(id, checked) },
      clearModelChecks: () => { this.clearModelChecks() },
      loadGoModels: () => { this.loadGoModels() },
      setGoModelChecked: (id, checked) => { this.setGoModelChecked(id, checked) },
      clearGoModelChecks: () => { this.clearGoModelChecks() },
      loadUsage: () => { this.loadUsage() },
      ...this.form.actions(),
    }
    return this.face
  }

  /**
   * Read one plan's stored field straight from the resolved section.
   * @param plan - the plan whose block to read.
   * @param leaf - the field name inside that block.
   * @returns the value the section carries, or undefined.
   */
  private docValue(plan: Plan, leaf: string): unknown {
    const root: unknown = this.scope.getSnapshot().value
    const path = docPath(plan, leaf)
    let current: unknown = root
    for (const key of path) {
      if (current === null || typeof current !== 'object') return undefined
      current = (current as Record<string, unknown>)[key]
    }
    return current
  }

  /**
   * Write one plan's staged key, then re-read whether the Host now holds it.
   * @param plan - the plan whose credential reference to write.
   * @param value - the staged credential literal.
   * @returns whether the Host reports a configured credential afterwards.
   */
  private async writeKey(plan: Plan, value: string): Promise<boolean> {
    // Refusals surface through the re-read below: the Host is the only
    // authority on whether the key now exists.
    await this.ctx.remote.credentials.set(refOf(this.scope.getSnapshot(), plan), value)
    await this.readCredential()
    return this.credentials[plan].configured
  }
}

/** The form fields one plan edits, keyed and pathed for its block. */
function planFields(plan: Plan): FieldSpec[] {
  return [
    booleanField(fieldKey(plan, 'enabled'), docPath(plan, 'enabled')),
    booleanField(fieldKey(plan, 'showDeprecatedModels'), docPath(plan, 'showDeprecatedModels')),
    textField(fieldKey(plan, 'apiKeyEnv'), docPath(plan, 'apiKeyEnv')),
    textField(fieldKey(plan, 'baseURL'), docPath(plan, 'baseURL')),
    jsonField(fieldKey(plan, 'modelLimits'), docPath(plan, 'modelLimits')),
    jsonField(fieldKey(plan, 'enabledModels'), docPath(plan, 'enabledModels')),
  ]
}

/**
 * Read a stored override map without trusting its hand-editable shape. Only
 * positive safe integers and explicit catalog resets are accepted by the table.
 */
function modelLimitsOf(value: unknown): OpencodeZenModelLimits {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return {}
  const limits: OpencodeZenModelLimits = {}
  for (const [id, entry] of Object.entries(value as Record<string, unknown>)) {
    if (entry === null) { limits[id] = null; continue }
    if (typeof entry !== 'object' || Array.isArray(entry)) continue
    const fields = entry as Record<string, unknown>
    const limit: OpencodeZenModelLimit = {}
    if (fields.contextWindow === null) limit.contextWindow = null
    if (fields.maxTokens === null) limit.maxTokens = null
    if (typeof fields.contextWindow === 'number' && Number.isSafeInteger(fields.contextWindow) && fields.contextWindow > 0) {
      limit.contextWindow = fields.contextWindow
    }
    if (typeof fields.maxTokens === 'number' && Number.isSafeInteger(fields.maxTokens) && fields.maxTokens > 0) {
      limit.maxTokens = fields.maxTokens
    }
    if (limit.contextWindow !== undefined || limit.maxTokens !== undefined) limits[id] = limit
  }
  return limits
}

/**
 * Read a stored whitelist without trusting its hand-editable shape. Only
 * non-empty strings survive, deduplicated in order; anything else reads as "the
 * field says nothing", which is undefined.
 * @param value - the stored field value.
 * @returns the ids it names, or undefined when it names none.
 */
function idsOf(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined
  const ids = value.filter((id): id is string => typeof id === 'string' && id.length > 0)
  return [...new Set(ids)]
}

/**
 * The credential reference one plan's block names, or the shared default.
 * @param snapshot - the current scope snapshot.
 * @param plan - the plan whose credential reference to read.
 * @returns the reference to address.
 */
function refOf(snapshot: SettingsScopeSnapshot<OpencodeZenSettings>, plan: Plan): string {
  const declared = plan === 'go' ? snapshot.value?.go?.apiKeyEnv : snapshot.value?.apiKeyEnv
  return declared !== undefined && declared.length > 0 ? declared : DEFAULT_API_KEY_REF
}

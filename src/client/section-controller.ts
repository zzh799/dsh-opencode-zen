/**
 * The OpenCode Zen settings page's staged form over the `llm-opencode-zen`
 * settings namespace, plus the gateway model listing the page reports.
 *
 * The key is the one control that does not live in the section: its literal
 * never rides a response, so the page learns only whether one is configured
 * and writes it through the credentials domain, addressed by the reference the
 * section names. It is still staged with the rest of the form, so one save
 * covers everything the page shows.
 */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
// Type-only: pulls the ctx.remote merge into this program.
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type { ZenModel } from '../models-contract.ts'
import type {} from '@deepseek-ai/dsh-api-settings-controller/remote'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { SettingsScope, SettingsScopeSnapshot } from './settings.ts'
import {
  StagedForm,
  booleanField,
  jsonField,
  numberField,
  textField,
  type FieldState,
  type FormActions,
  type FormShell,
} from './staged-form.ts'

/** Namespace of the OpenCode Zen adapter. Spelled here rather than imported: a client package must not depend on a Host package. */
export const OPENCODE_ZEN_NS = 'llm-opencode-zen'

/** Credential reference the provider resolves when the section names none. */
const DEFAULT_API_KEY_REF = 'OPENCODE_API_KEY'

/** Form field the credential control stages under. */
const API_KEY_FIELD = 'apiKey'

/**
 * Route the Host's model discovery answers for, spelled here for the same
 * reason as {@link OPENCODE_ZEN_NS}: a client package must not depend on a Host
 * package.
 */
const OPENCODE_ZEN_PROVIDER = 'opencode-zen'

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

/** What the settings page renders. */
export interface OpencodeZenSectionState extends FormShell {
  /**
   * Whether the adapter will serve its route once the staged form is saved.
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
  /** Live catalog re-resolution interval, in minutes. */
  refreshMinutes: FieldState
  /** Largest idle gap between stream events, in milliseconds. */
  streamIdleTimeoutMs: FieldState
  /** Accumulated base64 image payload bound for one request. */
  maxRequestImageBytes: FieldState
  /** Total-pixel budget for one request image. */
  requestImagePixelBudget: FieldState
  /** Raw encoded-byte target for one request image. */
  requestImageMaxBytes: FieldState
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

/** The registration-side face the page's slot entry injects. */
export interface OpencodeZenSectionFace extends FormActions {
  hooks: {
    /** Page snapshot bound by the UI renderer as useOpencodeZen. */
    opencodeZen: SnapshotStore<OpencodeZenSectionState>
  }
  /** Read the gateway's model listing, now or again after a failure. */
  loadModels: () => void
  /**
   * Stage one model's membership in the picker whitelist. Saved with the rest
   * of the form; the pickers follow on the next open.
   * @param id - the gateway model id the checkbox names.
   * @param checked - the state the checkbox asks for.
   */
  setModelChecked: (id: string, checked: boolean) => void
  /**
   * Stage an empty whitelist, which withdraws the provider from the pickers
   * rather than leaving an empty one there. Saved with the rest of the form.
   */
  clearModelChecks: () => void
}

/** Bridges the `llm-opencode-zen` scope and the credentials domain onto the page. */
export class OpencodeZenSectionController {
  private readonly form: StagedForm
  private readonly store: SnapshotStore<OpencodeZenSectionState>
  private credential: CredentialState = { ref: '', configured: false, writable: true }
  private models: OpencodeZenModels = { status: 'idle' }
  private modelsRequest = 0
  private face: OpencodeZenSectionFace | undefined
  private readonly unsubscribe: () => void
  private readonly unsubscribeForm: () => void
  /** The live form listener behind the unsaved-changes prompt; absent while clean. */
  private unloadGuard: ((event: BeforeUnloadEvent) => void) | undefined

  /**
   * @param scope - the bound settings scope for the `llm-opencode-zen` namespace.
   * @param ctx - the page plugin's context, whose `remote.credentials` namespace
   *   answers for the credential the section references.
   */
  constructor(
    private readonly scope: SettingsScope<OpencodeZenSettings>,
    private readonly ctx: ClientContext,
    private readonly readModels: () => Promise<RemoteResult<readonly ZenModel[]>> = () =>
      ctx.remote.llm.discoverModels(OPENCODE_ZEN_NS, { provider: OPENCODE_ZEN_PROVIDER }),
  ) {
    this.form = new StagedForm(
      scope as SettingsScope<Record<string, unknown>>,
      [
        // The switches are staged like every other field: they are part of the
        // same save, so the page has no control that reaches the Host on a click.
        booleanField('enabled'),
        booleanField('showDeprecatedModels'),
        textField('apiKeyEnv'),
        textField('baseURL'),
        numberField('refreshMinutes'),
        numberField('streamIdleTimeoutMs'),
        numberField('maxRequestImageBytes'),
        numberField('requestImagePixelBudget'),
        numberField('requestImageMaxBytes'),
        jsonField('modelLimits'),
        jsonField('enabledModels'),
      ],
      [{ field: API_KEY_FIELD, write: text => this.writeKey(text) }],
    )
    this.store = this.form.bind(() => this.projection())
    this.unsubscribe = scope.subscribe(() => { void this.readCredential() })
    this.unsubscribeForm = this.store.subscribe(() => { this.syncUnloadGuard() })
    void this.readCredential()
  }

  /** Release subscriptions without disposing the host's shared form. */
  dispose(): void {
    this.modelsRequest++
    this.unsubscribe()
    this.unsubscribeForm()
    this.syncUnloadGuard(false)
    this.form.dispose()
  }

  private projection(): OpencodeZenSectionState {
    return {
      ...this.form.shell(),
      enabled: this.stagedSwitch('enabled', true),
      showDeprecatedModels: this.stagedSwitch('showDeprecatedModels', false),
      checkedModels: this.visibleChecks(),
      checkedCount: this.checkedCount(),
      apiKeyEnv: this.form.field('apiKeyEnv'),
      baseURL: this.form.field('baseURL'),
      refreshMinutes: this.form.field('refreshMinutes'),
      streamIdleTimeoutMs: this.form.field('streamIdleTimeoutMs'),
      maxRequestImageBytes: this.form.field('maxRequestImageBytes'),
      requestImagePixelBudget: this.form.field('requestImagePixelBudget'),
      requestImageMaxBytes: this.form.field('requestImageMaxBytes'),
      apiKey: this.form.field(API_KEY_FIELD),
      apiKeyConfigured: this.credential.configured,
      apiKeyWritable: this.credential.writable,
      models: this.models,
      modelLimits: this.form.field('modelLimits'),
      modelLimitDraft: this.limitDraft(),
    }
  }

  /**
   * Read the overrides as the page currently shows them. A staged JSON draft
   * wins while it is valid; malformed text falls back to the last accepted
   * settings value so the table never renders phantom rows.
   */
  private limitDraft(): OpencodeZenModelLimits {
    const staged = this.form.field('modelLimits')
    if (staged.invalid) return modelLimitsOf(this.scope.getSnapshot().value?.modelLimits)
    if (staged.overridden || this.form.shell().dirty) {
      try {
        return modelLimitsOf(JSON.parse(staged.text) as unknown)
      } catch {
        return modelLimitsOf(this.scope.getSnapshot().value?.modelLimits)
      }
    }
    return modelLimitsOf(this.scope.getSnapshot().value?.modelLimits)
  }

  /**
   * Read one switch as the page currently shows it: the staged draft when one
   * exists, over the resolved section's value, over the Host's own default.
   *
   * Both switches are staged with everything else now, so the control reports
   * what a save would store rather than what the Host holds; the page's Save
   * button is the whole feedback loop.
   * @param field - the switch's field name.
   * @param fallback - the state when neither the draft nor the section carries one.
   * @returns whether the switch reads as on.
   */
  private stagedSwitch(field: 'enabled' | 'showDeprecatedModels', fallback: boolean): boolean {
    const staged = this.form.field(field)
    // A field whose value is not a boolean formats as empty text, which is the
    // one case the fallback answers.
    return staged.text === '' ? fallback : staged.text === 'true'
  }

  /** Every id the current listing serves; empty until a listing has been read. */
  private listedIds(): readonly string[] {
    return this.models.status === 'ready' ? this.models.entries.map(entry => entry.id) : []
  }

  /**
   * The whitelist as staged or stored, or undefined while it was never set.
   *
   * A malformed draft falls back to the last accepted settings value, the same
   * way the capacity table reads its own JSON field, so a broken draft never
   * silently drops ids that are not on screen.
   */
  private checkedDraft(): string[] | undefined {
    const staged = this.form.field('enabledModels')
    if (staged.invalid) return idsOf(this.scope.getSnapshot().value?.enabledModels)
    if (staged.text.trim() === '') return undefined
    try {
      return idsOf(JSON.parse(staged.text) as unknown)
    } catch {
      return idsOf(this.scope.getSnapshot().value?.enabledModels)
    }
  }

  /**
   * The whitelist as the page shows it. A never-set field is not an empty
   * selection: it means every model the gateway serves, so the listing answers
   * for it and every row renders checked.
   */
  private visibleChecks(): readonly string[] {
    return this.checkedDraft() ?? this.listedIds()
  }

  /** How many of the listed models the pickers would offer. */
  private checkedCount(): number {
    const checked = new Set(this.visibleChecks())
    return this.listedIds().filter(id => checked.has(id)).length
  }

  /**
   * Stage one model's membership in the picker whitelist.
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
   * @param id - the gateway model id the checkbox names.
   * @param checked - the state the checkbox asks for.
   */
  setModelChecked(id: string, checked: boolean): void {
    if (!this.scope.getSnapshot().writable) return
    const current = this.checkedDraft() ?? this.listedIds()
    const next = new Set(current)
    if (checked) next.add(id)
    else next.delete(id)
    // An id already in the state the checkbox asks for stages nothing, so a
    // no-op click never makes the form dirty.
    if (next.size === current.length) return
    this.stageChecked([...next])
  }

  /**
   * Stage an empty whitelist. Saved, that withdraws the provider from the
   * pickers entirely rather than leaving an empty one there.
   */
  clearModelChecks(): void {
    if (!this.scope.getSnapshot().writable) return
    if (this.checkedDraft()?.length === 0) return
    this.stageChecked([])
  }

  /**
   * Stage the whitelist through the shared JSON field. The draft is indented
   * the way that field formats a stored value, so a draft that matches what is
   * already stored leaves the form clean instead of planning a cosmetic write.
   * @param ids - the ids the saved list should carry, in the order staged.
   */
  private stageChecked(ids: readonly string[]): void {
    this.form.actions().edit('enabledModels', JSON.stringify(ids, undefined, 2))
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
   * Read the gateway's model listing through the Host's discovery for this
   * adapter. Called when the page mounts and again from its refresh control.
   * A rejection settles as a failure too: the refresh control is disabled
   * while loading and the next read starts only from `idle`, so leaving the
   * state loading would strand the page with no way to ask the gateway again.
   */
  loadModels(): void {
    const request = ++this.modelsRequest
    this.models = { status: 'loading' }
    this.store.set(this.projection())
    // A later read owns the page: an answer or rejection for an earlier one
    // would report a listing the user already replaced.
    void this.readModels()
      .then((response) => {
        if (request !== this.modelsRequest) return
        this.models = response.ok
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
        if (request !== this.modelsRequest) return
        this.models = { status: 'failed', message: error instanceof Error ? error.message : String(error) }
        this.store.set(this.projection())
      })
  }

  /**
   * Ask the credentials domain about the reference the section currently names.
   *
   * The answer is stored with the reference it describes: `apiKeyEnv` can
   * change between the request and its response, and two reads can settle out
   * of order, so a response is published only while it still answers for the
   * reference in force.
   */
  private async readCredential(): Promise<void> {
    const ref = refOf(this.scope.getSnapshot())
    if (ref !== this.credential.ref) {
      // A new reference knows nothing yet; keeping the old answer would claim
      // the key is configured under a name nobody has checked.
      this.credential = { ref, configured: false, writable: true }
      this.store.set(this.projection())
    }
    const response = await this.ctx.remote.credentials.describe([ref])
    if (!response.ok || ref !== refOf(this.scope.getSnapshot())) return
    const view = response.value[ref]
    const next: CredentialState = {
      ref,
      configured: view?.configured ?? false,
      // An unknown reference is treated as writable: the control stays usable
      // and the Host is what refuses, rather than the page guessing a refusal.
      writable: view?.writable ?? true,
    }
    if (next.configured === this.credential.configured && next.writable === this.credential.writable) return
    this.credential = next
    this.store.set(this.projection())
  }

  /**
   * Re-read after the Host reports a change to the reference this page watches.
   *
   * A key can be written from somewhere else — the Models page addresses the
   * same reference — and the settings section does not change when it is, so
   * without this the badge keeps reporting a state the Host already replaced.
   * @param ref - the reference the Host reports as changed.
   */
  refreshCredential(ref: string): void {
    if (ref !== this.credential.ref) return
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
      ...this.form.actions(),
    }
    return this.face
  }

  /**
   * Write the staged key, then re-read whether the Host now holds one.
   * @param value - the staged credential literal.
   * @returns whether the Host reports a configured credential afterwards.
   */
  private async writeKey(value: string): Promise<boolean> {
    // Refusals surface through the re-read below: the Host is the only
    // authority on whether the key now exists.
    await this.ctx.remote.credentials.set(refOf(this.scope.getSnapshot()), value)
    await this.readCredential()
    return this.credential.configured
  }
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
 * The credential reference the section names, or the provider's default.
 * @param snapshot - the current scope snapshot.
 * @returns the reference to address.
 */
function refOf(snapshot: SettingsScopeSnapshot<OpencodeZenSettings>): string {
  const declared = snapshot.value?.apiKeyEnv
  return declared !== undefined && declared.length > 0 ? declared : DEFAULT_API_KEY_REF
}

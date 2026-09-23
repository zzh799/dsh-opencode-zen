/**
 * The staged form behind the OpenCode Zen settings page.
 *
 * The page stages what the user types and writes it only when they save. Each
 * settings write is a durable, revision-fenced document mutation, so a control
 * that committed as it settled turned one edit into a write the user never
 * asked for and could not preview; staged text makes what is on screen exactly
 * what a save would store.
 *
 * A field shows its effective value - the user layer over the composition
 * layer over the schema default - and whether the user layer carries it. That
 * presence, not a value comparison, is what marks a field overridden: an
 * override equal to the composition default is still an override.
 *
 * Copied from the plugin-configuration card form (`ui-settings-plugins`): the
 * client bundle purity gate forbids importing it across packages, and the two
 * forms evolve independently anyway.
 */

import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-store'
// Type-only: the value a nested path op stores, derived rather than restated.
import type { SettingsPathOpView } from '@deepseek-ai/dsh-api-remotes/client'
import type { SettingsScope, SettingsScopeSnapshot } from './settings.ts'

/** The settings value a path op carries; a field's parse only ever yields these. */
type StoredValue = Extract<SettingsPathOpView, { op: 'set' }>['value']

/** The write one field's staged text performs when the page is saved. */
export type FieldWrite =
  | { kind: 'set'; value: unknown }
  | { kind: 'clear' }

/** How one section field converts between its stored value and its draft text. */
export interface FieldSpec {
  /** Field name inside the namespace section. */
  field: string
  /**
   * Where inside the section this field lives. Absent means the field name is
   * the whole path, which is every top-level field; the Go plan's fields sit
   * under `go` and address `['go', field]`. The form key stays `field` so a
   * page can name both plans' switches without them colliding.
   */
  path?: readonly string[]
  /** Render a stored value as draft text; the empty string when the section carries none. */
  format: (value: unknown) => string
  /**
   * The write this draft text stages, or undefined when the text is not a
   * value this field accepts - which blocks the save rather than discarding it.
   */
  parse: (text: string) => FieldWrite | undefined
}

/**
 * A control whose value is written outside the settings section. A credential
 * literal never rides a response, so its draft has nothing to seed from: it is
 * blank until typed, and a blank draft writes nothing.
 */
export interface SecretSpec {
  /** Field name addressing this control inside the page's form. */
  field: string
  /** Write the staged text; resolves to whether the Host accepted it. */
  write: (text: string) => Promise<boolean>
}

/** One field as the page's control renders it. */
export interface FieldState {
  /** Draft text the control renders. */
  text: string
  /**
   * Whether saving would leave a user-layer entry for this field. A staged
   * edit answers for itself, so the badge previews the save rather than
   * reporting a state the pending edit already contradicts.
   */
  overridden: boolean
  /** Whether the draft is not a value this field accepts, which blocks saving. */
  invalid: boolean
}

/** Form state the page shell shares across its controls. */
export interface FormShell {
  /** False while the namespace is not served to this client; the page renders nothing. */
  available: boolean
  /** Whether the Host document accepts writes. */
  writable: boolean
  /** Whether the form holds edits that a save would write. */
  dirty: boolean
  /** Whether any staged draft is invalid, which blocks the save. */
  invalid: boolean
  /** Whether a save is crossing the wire. */
  saving: boolean
  /** Whether the last save did not land as staged; cleared by the next edit or save. */
  failed: boolean
}

/** The write actions the page's slot entry injects. */
export interface FormActions {
  /** Stage draft text for one field. */
  edit: (field: string, text: string) => void
  /** Stage a clear, so saving lets the field re-inherit the composition layer. */
  resetField: (field: string) => void
  /** Write every staged edit, then re-seed from what the Host accepted. */
  save: () => void
  /** Drop every staged edit. */
  discard: () => void
}

/** One field's staged edit. */
interface StagedEdit {
  /** Draft text the control renders. */
  text: string
  /** True when this edit clears the field whatever text it shows. */
  clear: boolean
}

/** One staged edit resolved into the write a save performs. */
interface PlannedWrite {
  /** Field this entry writes. */
  field: string
  /**
   * Perform the write and report whether the Host holds the staged value
   * afterwards; undefined when the draft is not a value the field accepts.
   */
  run: (() => Promise<boolean>) | undefined
}

/**
 * Read a value at a path inside a settings layer. A layer that stops being an
 * object before the path is exhausted carries nothing there.
 * @param root - the layer's value.
 * @param path - the segments to walk.
 * @returns the value at the path, or undefined.
 */
function readAt(root: unknown, path: readonly string[]): unknown {
  let current: unknown = root
  for (const key of path) {
    if (current === null || typeof current !== 'object') return undefined
    current = (current as Record<string, unknown>)[key]
  }
  return current
}

/** Whether an object layer carries the path's own entry, as opposed to inheriting it. */
function hasAt(root: unknown, path: readonly string[]): boolean {
  let current: unknown = root
  for (const [index, key] of path.entries()) {
    if (current === null || typeof current !== 'object' || !Object.hasOwn(current, key)) return false
    current = (current as Record<string, unknown>)[key]
    if (index === path.length - 1) return true
  }
  return false
}

/**
 * A whole-number field. An empty draft clears the field; any other draft that
 * is not a finite number blocks the save.
 * @param field - field name inside the namespace section.
 * @param path - where inside the section the field lives; the field name alone when absent.
 * @returns the field's conversion spec.
 */
export function numberField(field: string, path?: readonly string[]): FieldSpec {
  return {
    field,
    ...path === undefined ? {} : { path },
    format: value => typeof value === 'number' ? String(value) : '',
    parse: (text) => {
      const trimmed = text.trim()
      if (trimmed === '') return { kind: 'clear' }
      const parsed = Number(trimmed)
      return Number.isFinite(parsed) ? { kind: 'set', value: parsed } : undefined
    },
  }
}

/**
 * A two-state field. Unlike the text fields, the draft is the boolean itself
 * rather than text: the control that renders it reports the state the user
 * asked for, and an unset section resolves to the composition default the
 * schema supplied. Its draft text is the state's string form so the shared
 * override and invalid tracking needs no second branch.
 * @param field - field name inside the namespace section.
 * @param path - where inside the section the field lives; the field name alone when absent.
 * @returns the field's conversion spec.
 */
export function booleanField(field: string, path?: readonly string[]): FieldSpec {
  return {
    field,
    ...path === undefined ? {} : { path },
    format: value => typeof value === 'boolean' ? String(value) : '',
    parse: (text) => {
      if (text === 'true') return { kind: 'set', value: true }
      if (text === 'false') return { kind: 'set', value: false }
      // The control only ever stages those two strings; anything else is a
      // wiring mistake, not a value to store.
      return undefined
    },
  }
}

/**
 * A free-text field. An empty draft clears the field, so emptying the control
 * and saving is the same gesture as resetting it.
 * @param field - field name inside the namespace section.
 * @param path - where inside the section the field lives; the field name alone when absent.
 * @returns the field's conversion spec.
 */
export function textField(field: string, path?: readonly string[]): FieldSpec {
  return {
    field,
    ...path === undefined ? {} : { path },
    format: value => typeof value === 'string' ? value : '',
    parse: (text) => {
      const trimmed = text.trim()
      return trimmed === '' ? { kind: 'clear' } : { kind: 'set', value: trimmed }
    },
  }
}

/**
 * A structured field edited as JSON text. Empty text clears the field and
 * malformed JSON blocks the save instead of reaching the Host as a string.
 * @param field - field name inside the namespace section.
 * @param path - where inside the section the field lives; the field name alone when absent.
 * @returns the field's conversion spec.
 */
export function jsonField(field: string, path?: readonly string[]): FieldSpec {
  return {
    field,
    ...path === undefined ? {} : { path },
    format: value => value === undefined || value === null ? '' : JSON.stringify(value, undefined, 2),
    parse: (text) => {
      const trimmed = text.trim()
      if (trimmed === '') return { kind: 'clear' }
      try {
        return { kind: 'set', value: JSON.parse(trimmed) as unknown }
      } catch {
        return undefined
      }
    },
  }
}

/**
 * Stages the page's edits over the `llm-opencode-zen` namespace and writes them
 * on save.
 *
 * The form publishes through a snapshot store because the slot component reads
 * through a snapshot selector, while both the scope and the local drafts
 * change underneath; every projection is rebuilt from the two together.
 */
export class StagedForm {
  private readonly specs: Map<string, FieldSpec>
  private readonly secretSpecs: Map<string, SecretSpec>
  private readonly staged = new Map<string, StagedEdit>()
  private readonly listeners = new Set<() => void>()
  private readonly unsubscribe: () => void
  private saving = false
  private failed = false

  /**
   * @param scope - the bound settings scope for this page's namespace.
   * @param specs - the section fields this page edits.
   * @param secrets - the page's write-only controls, written outside the section.
   */
  constructor(
    private readonly scope: SettingsScope<Record<string, unknown>>,
    specs: FieldSpec[],
    secrets: SecretSpec[] = [],
  ) {
    this.specs = new Map(specs.map(spec => [spec.field, spec]))
    this.secretSpecs = new Map(secrets.map(spec => [spec.field, spec]))
    this.unsubscribe = scope.subscribe(() => { this.publish() })
  }

  /** Shared 0.1.7 forms outlive individual settings pages. */
  dispose(): void {
    this.unsubscribe()
    this.listeners.clear()
  }

  /**
   * Publish a projection of this form, rebuilt whenever the scope or a draft changes.
   * @param project - build the page state from the form's current reads.
   * @returns the store the component reads through its bound selector.
   */
  bind<S>(project: () => S): SnapshotStore<S> {
    const store = createSnapshotStore(project())
    this.listeners.add(() => { store.set(project()) })
    return store
  }

  /**
   * Read the page-level state: what the Host serves, and what a save would do.
   * @returns the form state the page shell shares.
   */
  shell(): FormShell {
    const snapshot = this.scope.getSnapshot()
    const plan = this.plan()
    return {
      available: snapshot.status === 'ready',
      writable: snapshot.writable,
      dirty: plan.length > 0,
      invalid: plan.some(item => item.run === undefined),
      saving: this.saving,
      failed: this.failed,
    }
  }

  /**
   * Read one control's state.
   * @param field - field name of a section field or of a write-only control.
   * @returns the draft text, whether a save would leave an override, and whether it is invalid.
   */
  field(field: string): FieldState {
    const staged = this.staged.get(field)
    if (this.secretSpecs.has(field)) {
      return { text: staged?.text ?? '', overridden: false, invalid: false }
    }
    const spec = this.spec(field)
    if (staged === undefined) {
      return { text: spec.format(this.sectionValue(field)), overridden: this.stored(field), invalid: false }
    }
    const write = staged.clear ? { kind: 'clear' as const } : spec.parse(staged.text)
    return {
      text: staged.text,
      overridden: write?.kind === 'set',
      invalid: write === undefined,
    }
  }

  /**
   * Build the edit, reset, save, and discard actions bound to this form.
   * @returns the actions the page's slot entry injects.
   */
  actions(): FormActions {
    return {
      edit: (field, text) => { this.stage(field, { text, clear: false }) },
      resetField: (field) => {
        this.stage(field, { text: this.spec(field).format(this.baseValue(field)), clear: true })
      },
      save: () => { void this.save() },
      discard: () => {
        if (this.staged.size === 0 && !this.failed) return
        this.staged.clear()
        this.failed = false
        this.publish()
      },
    }
  }

  /**
   * Write every staged edit, then re-seed from what the Host accepted.
   *
   * The Host is the only authority on whether a value was accepted - its
   * validators own the constraints no schema can express - so the outcome is
   * read back from the section rather than predicted here. A save that did not
   * land keeps its drafts, so the user can correct them instead of retyping.
   */
  async save(): Promise<void> {
    const plan = this.plan()
    const writes = plan.flatMap(item => item.run === undefined ? [] : [item.run])
    if (plan.length === 0 || this.saving || writes.length !== plan.length) return
    this.saving = true
    this.failed = false
    this.publish()
    let landed = true
    for (const write of writes) {
      landed = await write() && landed
    }
    if (landed) this.staged.clear()
    this.saving = false
    this.failed = !landed
    this.publish()
  }

  /**
   * Every staged edit a save would write. An entry whose draft is not a value
   * its field accepts carries no write: the form is still dirty, and the save
   * refuses rather than dropping the edit.
   * @returns the planned writes, in the order the fields were staged.
   */
  private plan(): PlannedWrite[] {
    const plan: PlannedWrite[] = []
    for (const [field, staged] of this.staged) {
      const secret = this.secretSpecs.get(field)
      if (secret !== undefined) {
        const value = staged.text.trim()
        if (value !== '') plan.push({ field, run: () => secret.write(value) })
        continue
      }
      const spec = this.spec(field)
      if (staged.clear) {
        if (this.stored(field)) plan.push({ field, run: () => this.clear(field) })
        continue
      }
      if (staged.text === spec.format(this.sectionValue(field))) continue
      const write = spec.parse(staged.text)
      if (write === undefined) plan.push({ field, run: undefined })
      else if (write.kind === 'clear') plan.push({ field, run: () => this.clear(field) })
      else plan.push({ field, run: () => this.store(field, write.value) })
    }
    return plan
  }

  private async clear(field: string): Promise<boolean> {
    const path = this.pathOf(field)
    // The client scope's own set/unset address one segment, so a nested field
    // goes through the Host's path op instead.
    if (path.length === 1) await this.scope.unset(field)
    else await this.scope.mutate([{ op: 'unset', path: [...path] }])
    return !this.stored(field)
  }

  private async store(field: string, value: unknown): Promise<boolean> {
    const path = this.pathOf(field)
    if (path.length === 1) await this.scope.set(field, value)
    // The value came from this field's parse, which only yields JSON values;
    // the path op is typed to them because the Host documents must be JSON.
    else await this.scope.mutate([{ op: 'set', path: [...path], value: value as StoredValue }])
    return sameJsonValue(readAt(this.userLayer(), path), value)
  }

  private stage(field: string, edit: StagedEdit): void {
    this.staged.set(field, edit)
    this.failed = false
    this.publish()
  }

  private spec(field: string): FieldSpec {
    const spec = this.specs.get(field)
    // Every call site names a field this page declared; a missing one is a
    // wiring mistake that must not degrade into a silently inert control.
    if (spec === undefined) throw new Error(`opencode-zen settings page has no field ${field}`)
    return spec
  }

  /** Where one field lives inside the section. */
  private pathOf(field: string): readonly string[] {
    return this.spec(field).path ?? [field]
  }

  private snapshotOf(): SettingsScopeSnapshot<Record<string, unknown>> {
    return this.scope.getSnapshot()
  }

  private sectionValue(field: string): unknown {
    return readAt(this.snapshotOf().value, this.pathOf(field))
  }

  private baseValue(field: string): unknown {
    return readAt(this.snapshotOf().base, this.pathOf(field))
  }

  private userLayer(): Record<string, unknown> | undefined {
    return this.snapshotOf().user as Record<string, unknown> | undefined
  }

  private stored(field: string): boolean {
    return hasAt(this.userLayer(), this.pathOf(field))
  }

  private publish(): void {
    for (const listener of this.listeners) listener()
  }
}

/** Compare JSON-shaped settings values after a Host round-trip clone. */
function sameJsonValue(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true
  if (left === null || right === null || typeof left !== 'object' || typeof right !== 'object') return false
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false
    return left.every((value, index) => sameJsonValue(value, right[index]))
  }
  const leftRecord = left as Record<string, unknown>
  const rightRecord = right as Record<string, unknown>
  const leftKeys = Object.keys(leftRecord)
  const rightKeys = Object.keys(rightRecord)
  return leftKeys.length === rightKeys.length
    && leftKeys.every(key => Object.hasOwn(rightRecord, key) && sameJsonValue(leftRecord[key], rightRecord[key]))
}

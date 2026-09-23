import { useEffect, useState } from 'react'
import { Tag } from '@deepseek-ai/dsh-client-ui-primitives'
import { isNewModel, sortModels, type ZenModel } from '../models-contract.ts'
import type { OpencodeZenModelLimit, OpencodeZenModelLimits, OpencodeZenModels } from './section-controller.ts'
import type { EditorCopyKey, OpencodeZenKey, en } from './locales.ts'
import css from './Section.module.css'

type Translate = (key: keyof typeof en, params?: Record<string, unknown>) => string

/**
 * Keys for the strings a second editor on the same page must not repeat. The
 * values are dictionary keys rather than rendered text, so the editor keeps
 * interpolating `{name}`-style params itself.
 */
export type ModelEditorCopy = Partial<Record<EditorCopyKey, OpencodeZenKey>>

export function hasCapacityOverride(limit: OpencodeZenModelLimit | null | undefined): boolean {
  return limit?.contextWindow != null || limit?.maxTokens != null
}

/** One gateway-backed list, serving both picker membership and staged capacities. */
export function ModelEditor({ models, draft, checked, checkedCount, t, disabled, idPrefix = 'opencode-zen', copy, onEdit, onToggleCheck, onClearChecks }: {
  models: OpencodeZenModels
  draft: OpencodeZenModelLimits
  /** Ids the conversation pickers currently offer; every listed model while the whitelist was never set. */
  checked: readonly string[]
  /** How many of the listed models those are, for the batch action's state. */
  checkedCount: number
  t: Translate
  disabled: boolean
  /** Prefix for the control ids this editor renders; two editors need two prefixes. */
  idPrefix?: string
  /** Wording for the strings a second editor on the same page must not repeat. */
  copy?: ModelEditorCopy
  onEdit: (next: OpencodeZenModelLimits) => void
  onToggleCheck: (id: string, checked: boolean) => void
  onClearChecks: () => void
}) {
  const say = (key: EditorCopyKey, params?: Record<string, unknown>): string => t(copy?.[key] ?? key, params)
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState('all')
  const [selected, setSelected] = useState<string>()
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    const timer = setInterval(() => { setNow(Date.now()) }, 60_000)
    return () => { clearInterval(timer) }
  }, [])
  // Saved overrides never establish membership: only a successful gateway listing does.
  const all = sortModels(models.status === 'ready' ? models.entries : [], now)
  const shown = new Set(checked)
  const normalized = query.trim().toLocaleLowerCase()
  const entries = all.filter(model => `${model.name ?? ''} ${model.id}`.toLocaleLowerCase().includes(normalized)
    && (filter === 'all' || filter === 'new' && isNewModel(model, now)
      || filter === 'custom' && hasCapacityOverride(draft[model.id]) || filter === 'deprecated' && model.deprecated))
  const model = entries.find(entry => entry.id === selected) ?? entries[0]
  const customized = all.filter(entry => hasCapacityOverride(draft[entry.id])).length
  const filters = [
    ['all', 'filterAll', all.length],
    ['new', 'filterNew', all.filter(entry => isNewModel(entry, now)).length],
    ['custom', 'filterCustom', customized],
    ['deprecated', 'filterDeprecated', all.filter(entry => entry.deprecated).length],
  ] as const
  const write = (id: string, field: keyof OpencodeZenModelLimit, value: number | undefined): void => {
    const current = draft[id] === null ? { contextWindow: null, maxTokens: null } : draft[id] ?? {}
    onEdit({ ...draft, [id]: { ...current, [field]: value ?? null } })
  }
  const badges = (entry: ZenModel) => <>
    {isNewModel(entry, now) ? <span className={css.newBadge} title={say('newHint')}>NEW</span> : null}
    {entry.deprecated ? <Tag tone="warning">{say('deprecatedBadge')}</Tag> : null}
  </>
  return (
    <div className={css.limitsEditor}>
      <p className={css.sectionTitle}>{say('limitsLabel')}</p>
      <p className={css.hint}>{say('modelPickHint')}</p>
      <label className={css.visuallyHidden} htmlFor={`${idPrefix}-model-filter`}>{say('limitsFilterLabel')}</label>
      <input id={`${idPrefix}-model-filter`} className={css.input} type="search" autoComplete="off"
        placeholder={say('limitsFilterPlaceholder')} value={query} onChange={event => { setQuery(event.target.value) }} />
      <div className={css.filters} role="group" aria-label={say('filterLabel')}>
        {filters.map(([key, label, count]) => <button key={key} type="button" className={css.filter}
          aria-pressed={filter === key} onClick={() => { setFilter(key) }}>{t(label)} <span>{count}</span></button>)}
        <button type="button" className={`${css.filter} ${css.clearChecks}`}
          disabled={disabled || checkedCount === 0} onClick={onClearChecks}>{say('clearChecked')}</button>
      </div>
      {model ? (
        <div className={css.modelLayout}>
          <nav className={css.modelList} aria-label={say('modelsLabel')}>
            {entries.map(entry => <div key={entry.id} className={css.modelRow}>
              <label className={css.modelCheck}>
                <input type="checkbox" className={css.checkbox}
                  checked={shown.has(entry.id)} disabled={disabled}
                  aria-label={say('modelVisibleLabel', { name: entry.name ?? entry.id })}
                  onChange={event => { onToggleCheck(entry.id, event.target.checked) }} />
              </label>
              <button type="button" className={css.modelChoice}
                aria-pressed={entry.id === model.id} onClick={() => { setSelected(entry.id) }}>
                <span className={css.modelName}>{entry.name ?? entry.id} {badges(entry)}</span>
                <code className={css.limitsModelId} translate="no">{entry.id}</code>
                {isNewModel(entry, now) ? <span className={css.releaseDate}>{say('releasedOn', { date: entry.releaseDate })}</span> : null}
              </button>
            </div>)}
          </nav>
          <section className={css.modelDetails} aria-label={say('modelDetails')}>
            <div className={css.modelHeading}>
              <h3>{model.name ?? model.id}</h3>
              {badges(model)}
            </div>
            <code className={css.limitsModelId} translate="no">{model.id}</code>
            {model.deprecated ? <p className={css.hint}>{say('deprecatedHint')}</p> : null}
            <Capacity model={model} field="contextWindow" limit={draft[model.id]} t={t} say={say} disabled={disabled} idPrefix={idPrefix} onChange={write} />
            <Capacity model={model} field="maxTokens" limit={draft[model.id]} t={t} say={say} disabled={disabled} idPrefix={idPrefix} onChange={write} />
            {hasCapacityOverride(draft[model.id]) ? <button type="button" className={css.reset} disabled={disabled}
              onClick={() => { onEdit({ ...draft, [model.id]: null }) }}>{say('limitsResetModel')}</button> : null}
            {model.releaseDate ? <p className={css.hint}>{say('releaseSource', { date: model.releaseDate })}</p> : null}
            <p className={css.hint}>{say('limitsHint')}</p>
          </section>
        </div>
      ) : models.status === 'ready' && all.length > 0 ? <p className={css.hint}>{say('limitsNoMatches', { query })}</p> : null}
      <div className={css.head}>
        {models.status === 'ready'
          ? <span className={css.limitsSummary}>{say('limitsCheckedSummary', { count: checkedCount, total: all.length })}</span>
          : null}
        <span className={css.limitsSummary}>{say('limitsSummary', { count: customized })}</span>
        {Object.values(draft).some(hasCapacityOverride) ? <button type="button" className={css.reset} disabled={disabled}
          onClick={() => { onEdit(Object.fromEntries(Object.keys(draft).map(id => [id, null]))) }}>{say('limitsResetAll')}</button> : null}
      </div>
    </div>
  )
}

function Capacity({ model, field, limit, disabled, t, say, idPrefix, onChange }: {
  model: ZenModel
  field: keyof OpencodeZenModelLimit
  limit: OpencodeZenModelLimit | null | undefined
  disabled: boolean
  t: Translate
  say: (key: EditorCopyKey, params?: Record<string, unknown>) => string
  idPrefix: string
  onChange: (id: string, field: keyof OpencodeZenModelLimit, value: number | undefined) => void
}) {
  const id = `${idPrefix}-${field}-${encodeURIComponent(model.id)}`
  const defaultValue = model[field]
  return <div className={css.field}>
    <label className={css.label} htmlFor={id}>{say(field === 'contextWindow' ? 'limitsContext' : 'limitsOutput')}</label>
    <input id={id} className={css.input} type="number" min={1} step={1} inputMode="numeric"
      aria-label={say(field === 'contextWindow' ? 'limitsContextLabel' : 'limitsOutputLabel', { name: model.name ?? model.id })}
      aria-describedby={`${id}-default`} value={limit?.[field] ?? ''}
      placeholder={defaultValue === undefined ? say('capacityMissing') : String(defaultValue)} disabled={disabled}
      onChange={event => {
        const text = event.target.value.trim()
        const value = Number(text)
        if (text === '') onChange(model.id, field, undefined)
        else if (Number.isSafeInteger(value) && value > 0) onChange(model.id, field, value)
      }} />
    <span id={`${id}-default`} className={css.hint}>
      {say('capacityDefault', { value: defaultValue === undefined ? say('capacityMissing') : defaultValue.toLocaleString('en-US') })}
      {limit?.[field] != null ? ` · ${t('overridden')}` : ''}
    </span>
  </div>
}

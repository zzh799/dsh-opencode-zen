import { useEffect, useState } from 'react'
import { Tag } from '@deepseek-ai/dsh-client-ui-primitives'
import { isNewModel, sortModels, type ModelSort, type ZenModel } from '../models-contract.ts'
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
export function ModelEditor({ models, draft, checked, checkedCount, t, disabled, idPrefix = 'opencode-zen', copy, compact, sortOptions = ['default', 'release'], onEdit, onToggleCheck, onClearChecks }: {
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
  /** Go's list keeps only the name and monthly estimate; full metadata stays in the detail pane. */
  compact?: boolean
  /** Sort choices exposed by this plan's list. */
  sortOptions?: readonly ModelSort[]
  onEdit: (next: OpencodeZenModelLimits) => void
  onToggleCheck: (id: string, checked: boolean) => void
  onClearChecks: () => void
}) {
  const say = (key: EditorCopyKey, params?: Record<string, unknown>): string => t(copy?.[key] ?? key, params)
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<ModelSort>('default')
  const [selected, setSelected] = useState<string>()
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    const timer = setInterval(() => { setNow(Date.now()) }, 60_000)
    return () => { clearInterval(timer) }
  }, [])
  // Saved overrides never establish membership: only a successful gateway listing does.
  const all = sortModels(models.status === 'ready' ? models.entries : [], now, sort)
  const shown = new Set(checked)
  const normalized = query.trim().toLocaleLowerCase()
  const entries = all.filter(model => `${model.name ?? ''} ${model.id}`.toLocaleLowerCase().includes(normalized))
  const model = entries.find(entry => entry.id === selected) ?? entries[0]
  const customized = all.filter(entry => hasCapacityOverride(draft[entry.id])).length
  const sortLabels: Record<ModelSort, keyof typeof en> = {
    default: 'sortDefault', price: 'sortPrice', release: 'sortRelease', monthly: 'sortMonthly',
  }
  const write = (id: string, field: keyof OpencodeZenModelLimit, value: number | undefined): void => {
    const current = draft[id] === null ? { contextWindow: null, maxTokens: null } : draft[id] ?? {}
    onEdit({ ...draft, [id]: { ...current, [field]: value ?? null } })
  }
  const badges = (entry: ZenModel) => <>
    {isNewModel(entry, now) ? <span className={css.newBadge} title={say('newHint')}>NEW</span> : null}
    {entry.deprecated ? <Tag tone="warning">{say('deprecatedBadge')}</Tag> : null}
  </>
  const monthlyRequests = (entry: ZenModel): string | undefined => {
    if (entry.estimatedMonthlyRequests === undefined) return undefined
    if (entry.estimatedMonthlyRequests === null) return t('goMonthlyRequestsUnpublished')
    if (entry.estimatedMonthlyRequests === 'unlimited') return t('goMonthlyRequestsUnlimited')
    return t('goMonthlyRequests', { count: entry.estimatedMonthlyRequests.toLocaleString() })
  }
  const formatPrice = (value: number): string => {
    const digits = value > 0 && value < 0.01 ? 4 : 2
    return `$${value.toFixed(digits)}`
  }
  return (
    <div className={css.limitsEditor}>
      <p className={css.sectionTitle}>{say('limitsLabel')}</p>
      <p className={css.hint}>{say('modelPickHint')}</p>
      <label className={css.visuallyHidden} htmlFor={`${idPrefix}-model-filter`}>{say('limitsFilterLabel')}</label>
      <input id={`${idPrefix}-model-filter`} className={css.input} type="search" autoComplete="off"
        placeholder={say('limitsFilterPlaceholder')} value={query} onChange={event => { setQuery(event.target.value) }} />
      <div className={css.modelSortRow}>
        <label className={css.sortLabel} htmlFor={`${idPrefix}-model-sort`}>{say('sortBy')}</label>
        <select id={`${idPrefix}-model-sort`} className={css.sortSelect} value={sort}
          onChange={event => { setSort(event.target.value as ModelSort) }}>
          {sortOptions.map(option => <option key={option} value={option}>{t(sortLabels[option])}</option>)}
        </select>
        <button type="button" className={css.clearChecks}
          disabled={disabled || checkedCount === 0} onClick={onClearChecks}>{say('clearChecked')}</button>
      </div>
      {model ? (
        <div className={css.modelLayout}>
          <nav className={css.modelList} aria-label={say('modelsLabel')}>
            {entries.map(entry => <div key={entry.id} className={css.modelRow}>
              <label className={compact ? `${css.modelCheck} ${css.modelCheckCompact}` : css.modelCheck}>
                <input type="checkbox" className={css.checkbox}
                  checked={shown.has(entry.id)} disabled={disabled}
                  aria-label={say('modelVisibleLabel', { name: entry.name ?? entry.id })}
                  onChange={event => { onToggleCheck(entry.id, event.target.checked) }} />
              </label>
              <button type="button" className={css.modelChoice}
                aria-pressed={entry.id === model.id} onClick={() => { setSelected(entry.id) }}>
                {compact ? <span className={css.modelSummary}>
                  <span className={css.modelName}>{entry.name ?? entry.id}</span>
                  {monthlyRequests(entry) === undefined ? null : <span className={css.modelMonthlyRequests}>{monthlyRequests(entry)}</span>}
                </span> : <>
                  <span className={css.modelName}>{entry.name ?? entry.id} {badges(entry)}</span>
                  <code className={css.limitsModelId} translate="no">{entry.id}</code>
                  {isNewModel(entry, now) ? <span className={css.releaseDate}>{say('releasedOn', { date: entry.releaseDate })}</span> : null}
                  {entry.pricePer100m ? <span className={css.modelPrice}>{t('pricePer100m', {
                    source: formatPrice(entry.pricePer100m.source), actual: formatPrice(entry.pricePer100m.actual),
                  })}</span> : null}
                </>}
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

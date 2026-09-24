/**
 * The OpenCode settings section. One page serves both plans: the Zen
 * pay-as-you-go gateway, whose fields are the document's top-level ones, and
 * the Go subscription, whose fields live in the `go` block. Each panel leads
 * with its own switch and the key a user has to supply (stored write-only
 * through the credentials domain), then the models that gateway currently
 * serves; the credential references, the endpoints, and the adapter tuning
 * both plans share sit behind one collapsed disclosure.
 */

import { useEffect, useState } from 'react'
import type { InjectFace } from '@deepseek-ai/dsh-client-ui-slots'
import { Button, Switch, Tag } from '@deepseek-ai/dsh-client-ui-primitives'
import * as primitives from '@deepseek-ai/dsh-client-ui-primitives'
import type {
  GoUsageState,
  OpencodeGoPanelState,
  OpencodeZenModels,
  OpencodeZenPanelState,
  OpencodeZenSectionFace,
  OpencodeZenSectionState,
} from './section-controller.ts'
import { GoUsagePanel } from './GoUsagePanel.tsx'
import { ModelEditor } from './ModelEditor.tsx'
import { goEditorCopy, type en } from './locales.ts'
import css from './Section.module.css'

// 0.1.7 names icons by stroke weight; older hosts name them by pixel size.
const ChevronDown = (primitives as typeof primitives & {
  IconChevronDownOutlineRegular?: typeof primitives.IconChevronDownOutline14
}).IconChevronDownOutlineRegular ?? primitives.IconChevronDownOutline14

export type { OpencodeZenSectionState } from './section-controller.ts'

/** Section copy lookup, including the optional `{name}` template params. */
type SectionTranslate = (key: keyof typeof en, params?: Record<string, unknown>) => string

/** Injected dependencies of {@link OpencodeZenSection} (slot `inject`). */
export interface OpencodeZenSectionInjected extends OpencodeZenSectionFace {
  /** Section copy. */
  t: SectionTranslate
}

/** Props delivered by the slot outlet: the inject face spread flat. */
export type OpencodeZenSectionProps = Partial<InjectFace<OpencodeZenSectionInjected>>

interface ValueFieldProps {
  id: string
  label: string
  hint: string
  field: { text: string; overridden: boolean; invalid: boolean }
  invalidLabel: string
  overriddenLabel: string
  resetLabel: string
  disabled: boolean
  numeric?: boolean
  onEdit: (text: string) => void
  onReset: () => void
}

/** One staged value field: label, override badge with reset, control, and hint. */
function ValueField(props: ValueFieldProps) {
  const hintId = `${props.id}-hint`
  return (
    <div className={css.field}>
      <div className={css.head}>
        <label className={css.label} htmlFor={props.id}>{props.label}</label>
        {props.field.overridden
          ? (
            <span className={css.badges}>
              <Tag tone="neutral">{props.overriddenLabel}</Tag>
              <button
                type="button"
                className={css.reset}
                disabled={props.disabled}
                onClick={props.onReset}
              >
                {props.resetLabel}
              </button>
            </span>
          )
          : null}
      </div>
      <input
        id={props.id}
        name={props.id}
        autoComplete="off"
        aria-describedby={hintId}
        className={props.field.invalid ? css.inputInvalid : css.input}
        type={props.numeric === true ? 'number' : 'text'}
        {...props.numeric === true ? { inputMode: 'numeric' as const } : {}}
        {...props.field.invalid ? { 'aria-invalid': true } : {}}
        value={props.field.text}
        disabled={props.disabled}
        onChange={(event) => { props.onEdit(event.target.value) }}
      />
      <p id={hintId} className={props.field.invalid ? css.invalid : css.hint}>
        {props.field.invalid ? props.invalidLabel : props.hint}
      </p>
    </div>
  )
}

/**
 * A plan's model listing in the state the page last read.
 * @param props.models - the listing state the controller published.
 * @param props.copy - the wording that must differ between the two plans.
 * @returns the listing body: a progress line, the Host diagnostic, or an empty
 *   body once the capacity table can show the complete model list.
 */
function ModelsBody({ models, copy }: {
  models: OpencodeZenModels
  copy: { loading: string; failed: string; empty: string }
}) {
  if (models.status === 'failed') {
    return (
      <>
        <p className={css.failedNote} role="alert">{copy.failed}</p>
        <p className={css.hint}>{models.message}</p>
      </>
    )
  }
  if (models.status !== 'ready') return <p className={css.hint} role="status" aria-live="polite">{copy.loading}</p>
  if (models.count === 0) return <p className={css.hint}>{copy.empty}</p>
  return null
}

/** One plan's staged on/off switch. */
function EnableSwitch({ label, hint, on, disabled, onChange }: {
  label: string
  hint: string
  on: boolean
  disabled: boolean
  onChange: (next: boolean) => void
}) {
  return (
    <div className={css.field}>
      <div className={css.head}>
        <span className={css.label}>{label}</span>
        <Switch
          checked={on}
          label={label}
          // The settings document being read-only is what locks the switch;
          // the credential's own writability is unrelated to this field.
          disabled={disabled}
          // Staged like every other field: the Save button below is what
          // writes it, and what it writes is what the page shows.
          onChange={onChange}
        />
      </div>
      <p className={css.hint}>{hint}</p>
    </div>
  )
}

/**
 * One plan's write-only credential control.
 * @param props.id - DOM id of the input, which also names it on the wire.
 * @param props.writeField - the form field the edit stages under.
 * @returns the disclosure holding the input.
 */
function KeyControl({ id, label, hint, notWritableLabel, configured, configuredLabel, missingLabel, field, writable, onEdit }: {
  id: string
  label: string
  hint: string
  notWritableLabel: string
  configured: boolean
  configuredLabel: string
  missingLabel: string
  field: { text: string }
  writable: boolean
  onEdit: (text: string) => void
}) {
  return (
    <details className={css.keySection} open={!configured || field.text.length > 0}>
      <summary className={css.head}>
        <span className={css.label}>{label}</span>
        <span className={css.badges}>
          <Tag tone={configured ? 'success' : 'warning'}>
            {configured ? configuredLabel : missingLabel}
          </Tag>
        </span>
      </summary>
      <input
        id={id}
        aria-label={label}
        name={id}
        className={css.input}
        type="password"
        autoComplete="off"
        aria-describedby={`${id}-hint`}
        value={field.text}
        // The credentials domain accepts a key even when the settings document
        // itself is read-only; its own writability is what disables this
        // control - a key sourced from the environment cannot be written here.
        disabled={!writable}
        onChange={(event) => { onEdit(event.target.value) }}
      />
      <p id={`${id}-hint`} className={css.hint}>{writable ? hint : notWritableLabel}</p>
    </details>
  )
}

/** One plan's model listing header: its count and its refresh control. */
function ModelsHeader({ label, count, countLabel, refreshLabel, loading, onRefresh }: {
  label: string
  count: OpencodeZenModels
  countLabel: string
  refreshLabel: string
  loading: boolean
  onRefresh: () => void
}) {
  return (
    <div className={css.head}>
      <span className={css.label}>{label}</span>
      <span className={css.badges}>
        {count.status === 'ready' ? <Tag tone="neutral">{countLabel}</Tag> : null}
        <button type="button" className={css.reset} disabled={loading} onClick={onRefresh}>
          {refreshLabel}
        </button>
      </span>
    </div>
  )
}

/**
 * Render the OpenCode settings page.
 * @param props - locale copy, the page snapshot, and its form actions.
 * @returns the section.
 */
export function OpencodeZenSection(props: OpencodeZenSectionProps) {
  const {
    useOpencodeZen, edit, resetField, save, discard, loadModels, setModelChecked, clearModelChecks,
    loadGoModels, setGoModelChecked, clearGoModelChecks, loadUsage, t,
  } = props
  if (useOpencodeZen === undefined || edit === undefined || resetField === undefined
    || save === undefined || discard === undefined || loadModels === undefined
    || setModelChecked === undefined || clearModelChecks === undefined
    || loadGoModels === undefined || setGoModelChecked === undefined || clearGoModelChecks === undefined
    || loadUsage === undefined || t === undefined) return null
  return (
    <Loaded
      state={useOpencodeZen(snapshot => snapshot)}
      t={t}
      edit={edit}
      resetField={resetField}
      save={save}
      discard={discard}
      loadModels={loadModels}
      setModelChecked={setModelChecked}
      clearModelChecks={clearModelChecks}
      loadGoModels={loadGoModels}
      setGoModelChecked={setGoModelChecked}
      clearGoModelChecks={clearGoModelChecks}
      loadUsage={loadUsage}
    />
  )
}

/** Every action the loaded page calls, as the slot delivered them. */
type LoadedActions = Omit<OpencodeZenSectionInjected, 'hooks' | 'useOpencodeZen'>

/** The page once every injected seat is present. */
function Loaded(props: LoadedActions & { state: OpencodeZenSectionState }) {
  const { t, state, loadModels, loadGoModels, loadUsage, setModelChecked, setGoModelChecked } = props
  const [advanced, setAdvanced] = useState(false)
  // The shell mounts only the open section, so a mount is the page being
  // opened: read each listing once, let the buttons re-read them afterwards,
  // and ask the Go endpoint about the quota in the same breath.
  useEffect(() => {
    if (state.available && state.models.status === 'idle') loadModels()
  }, [state.available, state.models.status, loadModels])
  useEffect(() => {
    if (state.available && state.go.models.status === 'idle') loadGoModels()
  }, [state.available, state.go.models.status, loadGoModels])
  useEffect(() => {
    if (state.available && state.go.usage.status === 'idle') loadUsage()
  }, [state.available, state.go.usage.status, loadUsage])
  if (!state.available) {
    return <p className={css.intro}>{t('unavailable')}</p>
  }
  const disabled = !state.writable
  const fieldProps = {
    invalidLabel: t('invalidValue'),
    overriddenLabel: t('overridden'),
    resetLabel: t('reset'),
    disabled,
  }
  const advancedOverridden = state.apiKeyEnv.overridden || state.baseURL.overridden
    || state.go.apiKeyEnv.overridden || state.go.baseURL.overridden
    || state.refreshMinutes.overridden || state.streamIdleTimeoutMs.overridden
    || state.maxRequestImageBytes.overridden || state.requestImagePixelBudget.overridden
    || state.requestImageMaxBytes.overridden
  return (
    <div className={css.page}>
      <div className={css.pageBody}>
      <div className={css.pageTop}>
        <p className={css.intro}>{t('intro')}</p>
        <button
          type="button"
          className={css.advancedTrigger}
          aria-expanded={advanced}
          aria-controls="opencode-zen-advanced"
          onClick={() => { setAdvanced(!advanced) }}
        >
          <ChevronDown className={advanced ? css.chevronOpen : css.chevron} />
          <span className={css.label}>{t('advancedLabel')}</span>
          {advancedOverridden ? <Tag tone="neutral">{t('overridden')}</Tag> : null}
        </button>
      </div>
      <div className={advanced ? css.field : undefined}>
        {advanced
          ? (
            <div id="opencode-zen-advanced" className={css.advanced}>
              <p className={css.hint}>{t('advancedHint')}</p>
              <ValueField
                id="opencode-zen-api-key-env"
                label={t('apiKeyEnvLabel')}
                hint={t('apiKeyEnvHint')}
                field={state.apiKeyEnv}
                {...fieldProps}
                onEdit={(text) => { props.edit('apiKeyEnv', text) }}
                onReset={() => { props.resetField('apiKeyEnv') }}
              />
              <ValueField
                id="opencode-zen-base-url"
                label={t('baseURLLabel')}
                hint={t('baseURLHint')}
                field={state.baseURL}
                {...fieldProps}
                onEdit={(text) => { props.edit('baseURL', text) }}
                onReset={() => { props.resetField('baseURL') }}
              />
              <ValueField
                id="opencode-zen-go-api-key-env"
                label={t('goApiKeyEnvLabel')}
                hint={t('goApiKeyEnvHint')}
                field={state.go.apiKeyEnv}
                {...fieldProps}
                onEdit={(text) => { props.edit('go.apiKeyEnv', text) }}
                onReset={() => { props.resetField('go.apiKeyEnv') }}
              />
              <ValueField
                id="opencode-zen-go-base-url"
                label={t('goBaseURLLabel')}
                hint={t('goBaseURLHint')}
                field={state.go.baseURL}
                {...fieldProps}
                onEdit={(text) => { props.edit('go.baseURL', text) }}
                onReset={() => { props.resetField('go.baseURL') }}
              />
              <ValueField
                id="opencode-zen-refresh-minutes"
                label={t('refreshMinutesLabel')}
                hint={t('refreshMinutesHint')}
                field={state.refreshMinutes}
                numeric
                {...fieldProps}
                onEdit={(text) => { props.edit('refreshMinutes', text) }}
                onReset={() => { props.resetField('refreshMinutes') }}
              />
              <ValueField
                id="opencode-zen-stream-idle"
                label={t('streamIdleTimeoutMsLabel')}
                hint={t('streamIdleTimeoutMsHint')}
                field={state.streamIdleTimeoutMs}
                numeric
                {...fieldProps}
                onEdit={(text) => { props.edit('streamIdleTimeoutMs', text) }}
                onReset={() => { props.resetField('streamIdleTimeoutMs') }}
              />
              <ValueField
                id="opencode-zen-max-request-image-bytes"
                label={t('maxRequestImageBytesLabel')}
                hint={t('maxRequestImageBytesHint')}
                field={state.maxRequestImageBytes}
                numeric
                {...fieldProps}
                onEdit={(text) => { props.edit('maxRequestImageBytes', text) }}
                onReset={() => { props.resetField('maxRequestImageBytes') }}
              />
              <ValueField
                id="opencode-zen-image-pixel-budget"
                label={t('requestImagePixelBudgetLabel')}
                hint={t('requestImagePixelBudgetHint')}
                field={state.requestImagePixelBudget}
                numeric
                {...fieldProps}
                onEdit={(text) => { props.edit('requestImagePixelBudget', text) }}
                onReset={() => { props.resetField('requestImagePixelBudget') }}
              />
              <ValueField
                id="opencode-zen-image-max-bytes"
                label={t('requestImageMaxBytesLabel')}
                hint={t('requestImageMaxBytesHint')}
                field={state.requestImageMaxBytes}
                numeric
                {...fieldProps}
                onEdit={(text) => { props.edit('requestImageMaxBytes', text) }}
                onReset={() => { props.resetField('requestImageMaxBytes') }}
              />
            </div>
          )
          : null}
      </div>
      <section className={css.planPanel} aria-label={t('planZenTitle')}>
        <div className={css.planHead}>
          <h3 className={css.planTitle}>{t('planZenTitle')}</h3>
          <Tag tone="neutral">{t('planPayAsYouGo')}</Tag>
        </div>
        <EnableSwitch
          label={t('enabledLabel')}
          hint={state.enabled ? t('enabledHint') : t('enabledOff')}
          on={state.enabled}
          disabled={disabled}
          onChange={(next) => { props.edit('enabled', String(next)) }}
        />
        <KeyControl
          id="opencode-zen-key"
          label={t('keyLabel')}
          hint={t('keyHint')}
          notWritableLabel={t('keyNotWritable')}
          configured={state.apiKeyConfigured}
          configuredLabel={t('keyConfigured')}
          missingLabel={t('keyMissing')}
          field={state.apiKey}
          writable={state.apiKeyWritable}
          onEdit={(text) => { props.edit('apiKey', text) }}
        />
        <div className={css.field}>
          <ModelsHeader
            label={t('modelsLabel')}
            count={state.models}
            countLabel={t('modelsCount', { count: state.models.status === 'ready' ? state.models.count : 0 })}
            refreshLabel={t('modelsRefresh')}
            loading={state.models.status === 'loading'}
            onRefresh={loadModels}
          />
          <ModelsBody models={state.models} copy={{
            loading: t('modelsLoading'), failed: t('modelsFailed'), empty: t('modelsEmpty'),
          }} />
        </div>
        <div className={css.field}>
          <div className={css.head}>
            <span className={css.label}>{t('showDeprecatedLabel')}</span>
            <Switch checked={state.showDeprecatedModels} label={t('showDeprecatedLabel')}
              disabled={disabled} onChange={(next) => { props.edit('showDeprecatedModels', String(next)) }} />
          </div>
          <p className={css.hint}>{t('showDeprecatedHint')}</p>
          <ModelEditor models={state.models} draft={state.modelLimitDraft}
            checked={state.checkedModels} checkedCount={state.checkedCount}
            sortOptions={['default', 'price', 'release']}
            t={t} disabled={disabled || state.saving}
            onEdit={next => { props.edit('modelLimits', JSON.stringify(next)) }}
            onToggleCheck={setModelChecked} onClearChecks={props.clearModelChecks} />
        </div>
      </section>
      <GoPanel
        panel={state.go}
        t={t}
        disabled={disabled}
        saving={state.saving}
        onEdit={props.edit}
        onRefreshModels={loadGoModels}
        onToggleCheck={setGoModelChecked}
        onClearChecks={props.clearGoModelChecks}
        onRefreshUsage={loadUsage}
      />
      {disabled ? <p className={css.hint}>{t('readOnly')}</p> : null}
      </div>
      <div className={css.actions}>
        <Button variant="primary" size="md" disabled={disabled || !state.dirty || state.invalid || state.saving} onClick={props.save}>
          {state.saving ? t('saving') : t('save')}
        </Button>
        <Button variant="outline" size="md" disabled={disabled || !state.dirty || state.saving} onClick={props.discard}>
          {t('discard')}
        </Button>
        {state.failed ? <p className={css.failedNote}>{t('savedFailed')}</p> : null}
      </div>
    </div>
  )
}

/**
 * The Go subscription's panel. Its own copy keeps every landmark and control
 * name distinct from the Zen panel above it, which matters to assistive
 * technology and to anything reading this page's structure.
 */
function GoPanel({ panel, t, disabled, saving, onEdit, onRefreshModels, onToggleCheck, onClearChecks, onRefreshUsage }: {
  panel: OpencodeGoPanelState
  t: SectionTranslate
  disabled: boolean
  saving: boolean
  onEdit: (field: string, text: string) => void
  onRefreshModels: (force?: boolean) => void
  onToggleCheck: (id: string, checked: boolean) => void
  onClearChecks: () => void
  onRefreshUsage: () => void
}) {
  return (
    <section className={css.planPanel} aria-label={t('planGoTitle')}>
      <div className={css.planHead}>
        <h3 className={css.planTitle}>{t('planGoTitle')}</h3>
        <Tag tone="neutral">{t('planSubscription')}</Tag>
      </div>
      <p className={css.hint}>{t('goIntro')}</p>
      <EnableSwitch
        label={t('goEnabledLabel')}
        hint={panel.enabled ? t('goEnabledHint') : t('goEnabledOff')}
        on={panel.enabled}
        disabled={disabled}
        onChange={(next) => { onEdit('go.enabled', String(next)) }}
      />
      <KeyControl
        id="opencode-zen-go-key"
        label={t('goKeyLabel')}
        hint={t('goKeyHint')}
        notWritableLabel={t('goKeyNotWritable')}
        configured={panel.apiKeyConfigured}
        configuredLabel={t('goKeyConfigured')}
        missingLabel={t('goKeyMissing')}
        field={panel.apiKey}
        writable={panel.apiKeyWritable}
        onEdit={(text) => { onEdit('goApiKey', text) }}
      />
      <div className={css.field}>
        <ModelsHeader
          label={t('goModelsLabel')}
          count={panel.models}
          countLabel={t('modelsCount', { count: panel.models.status === 'ready' ? panel.models.count : 0 })}
          refreshLabel={t('goModelsRefresh')}
          loading={panel.models.status === 'loading'}
          onRefresh={() => { onRefreshModels(true) }}
        />
        <ModelsBody models={panel.models} copy={{
          loading: t('goModelsLoading'), failed: t('goModelsFailed'), empty: t('goModelsEmpty'),
        }} />
      </div>
      <div className={css.field}>
        <div className={css.head}>
          <span className={css.label}>{t('goQuotaLabel')}</span>
          <button type="button" className={css.reset} disabled={panel.usage.status === 'loading'} onClick={onRefreshUsage}>
            {t('goQuotaRefresh')}
          </button>
        </div>
        <p className={css.hint}>{t('goQuotaHint')}</p>
        <GoUsagePanel usage={panel.usage} t={t} />
      </div>
      <div className={css.field}>
        <div className={css.head}>
          <span className={css.label}>{t('goShowDeprecatedLabel')}</span>
          <Switch checked={panel.showDeprecatedModels} label={t('goShowDeprecatedLabel')}
            disabled={disabled} onChange={(next) => { onEdit('go.showDeprecatedModels', String(next)) }} />
        </div>
        <p className={css.hint}>{t('goShowDeprecatedHint')}</p>
        <ModelEditor models={panel.models} draft={panel.modelLimitDraft}
          checked={panel.checkedModels} checkedCount={panel.checkedCount}
          sortOptions={['default', 'release', 'monthly']}
          t={t} disabled={disabled || saving} idPrefix="opencode-go" copy={goEditorCopy} compact
          onEdit={next => { onEdit('go.modelLimits', JSON.stringify(next)) }}
          onToggleCheck={onToggleCheck} onClearChecks={onClearChecks} />
      </div>
    </section>
  )
}

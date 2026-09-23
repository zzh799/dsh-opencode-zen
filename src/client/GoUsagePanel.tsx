/**
 * The Go plan's quota, as the last probe of its usage endpoint reported it.
 *
 * The outcomes stay visually distinct because only one of them is a fact about
 * the account: a refusal reads as "not detected", everything else reads as
 * "unavailable right now", and neither wording claims the plan is unusable.
 */
import type { GoUsageState } from './section-controller.ts'
import type { en } from './locales.ts'
import css from './Section.module.css'

type Translate = (key: keyof typeof en, params?: Record<string, unknown>) => string

/** The endpoint's three quota windows, in the order the panel shows them. */
const WINDOWS = ['rolling', 'weekly', 'monthly'] as const

/**
 * Render the Go quota: the three windows, or the one line that says why they
 * are not on screen.
 * @param props.usage - what the host's last probe established.
 * @param props.t - section copy.
 * @returns the quota block.
 */
export function GoUsagePanel({ usage, t }: { usage: GoUsageState; t: Translate }) {
  if (usage.status === 'subscribed') {
    return (
      <div className={css.usage}>
        {WINDOWS.map(key => (
          <div className={css.usageWindow} key={key}>
            <div className={css.usageRow}>
              <span>{t(`usage_${key}`)}</span>
              <strong>{Math.round(usage.usage[key].percent)}%</strong>
            </div>
            <progress aria-label={t(`usage_${key}`)} max={100} value={Math.min(100, usage.usage[key].percent)} />
            <p className={css.hint}>
              {t('usageResets')} {new Date(usage.usage[key].resetsAt).toLocaleString()}
              {usage.usage[key].status === 'rate-limited' ? ` · ${t('usageLimited')}` : ''}
            </p>
          </div>
        ))}
      </div>
    )
  }
  const message = usage.status === 'loading' ? t('goQuotaLoading')
    : usage.status === 'idle' ? t('goQuotaIdle')
      : usage.status === 'not-subscribed' ? t('goQuotaNotSubscribed')
        // The host's own diagnostic stays out of the page: it can carry a
        // response body or socket detail that means nothing to the reader.
        : t('goQuotaUnknown')
  return <p className={css.hint} role="status" aria-live="polite">{message}</p>
}

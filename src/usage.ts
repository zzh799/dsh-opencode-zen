import type { Context } from '@deepseek-ai/cordis'
import { TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { attributionHeaders } from '@deepseek-ai/dsh-llm'
import { assertBaseURL } from './config.ts'
import { parseGoUsage, type GoUsageProbe } from './usage-contract.ts'

interface UsageOptions {
  baseURL: () => string
  resolveApiKey: () => Promise<string | undefined>
}

/** Account statistics are fetched on the Host; credentials never enter the browser. */
export class GoUsageService extends TypertRemoteService {
  constructor(ctx: Context, private readonly options: UsageOptions) {
    super(ctx, 'opencodeGoUsage')
  }

  /**
   * Probe the plan's usage endpoint once. The answer is informational: it
   * reports what the endpoint said, and it never gates a route, withdraws a
   * model or writes configuration. That separation is deliberate, because
   * whether a reader without the subscription is refused or silently billed
   * against the pay-as-you-go balance is not something this plugin can assume;
   * a wrong guess must not be able to close a working path.
   * @returns the classified outcome; this method never throws.
   */
  async read(): Promise<GoUsageProbe> {
    let baseURL: string
    try {
      baseURL = assertBaseURL(this.options.baseURL()).replace(/\/$/, '')
    } catch (error: unknown) {
      return { status: 'unknown', message: String(error) }
    }
    // A credential that will not resolve is an unknown, not a verdict: the
    // plugin has established nothing about the account.
    const key = await this.options.resolveApiKey().catch(() => undefined)
    if (key === undefined || key.length === 0) {
      return { status: 'unknown', message: 'no credential is configured for the Go plan' }
    }
    let response: Response
    try {
      response = await fetch(`${baseURL}/usage`, {
        headers: { ...attributionHeaders(), Authorization: `Bearer ${key}`, Accept: 'application/json' },
        signal: AbortSignal.timeout(10_000),
        redirect: 'error',
      })
    } catch (error: unknown) {
      return { status: 'unknown', message: String(error) }
    }
    if (response.status === 401 || response.status === 403) return { status: 'not-subscribed' }
    if (!response.ok) return { status: 'unknown', message: `OpenCode Go usage answered HTTP ${response.status}` }
    try {
      const body: unknown = await response.json()
      return { status: 'subscribed', usage: parseGoUsage(body && typeof body === 'object' ? (body as { usage?: unknown }).usage : undefined) }
    } catch (error: unknown) {
      return { status: 'unknown', message: String(error) }
    }
  }
}

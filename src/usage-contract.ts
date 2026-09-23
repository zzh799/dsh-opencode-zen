/**
 * The OpenCode Go subscription's account statistics, as the Host reports them
 * to the Web page. The endpoint answers three quota windows; the browser never
 * sees a credential, and never sees a raw error body either: the Host folds
 * every outcome into the probe union below.
 *
 * @module dsh-opencode-zen/usage-contract
 */
import type { RemoteResult, TypertRemoteContribution } from '@deepseek-ai/dsh-typert-protocol'

export interface UsageWindow {
  status: 'ok' | 'rate-limited'
  percent: number
  resetsAt: string
}

export interface GoUsage {
  rolling: UsageWindow
  weekly: UsageWindow
  monthly: UsageWindow
}

/**
 * What one probe of the usage endpoint established.
 *
 * `not-subscribed` is the only negative verdict, and it is reserved for a
 * definitive refusal (401/403). Everything else that went wrong (offline,
 * 5xx, a 404, an unreadable body) is `unknown`, because the plugin must never
 * turn a transient fault into a claim about the account.
 */
export type GoUsageProbe =
  | { status: 'subscribed'; usage: GoUsage }
  | { status: 'not-subscribed' }
  | { status: 'unknown'; message: string }

/** Reject missing statistics rather than turning unavailable data into zero. */
export function parseGoUsage(value: unknown): GoUsage {
  if (!value || typeof value !== 'object') throw new Error('Invalid OpenCode Go usage response')
  const source = value as Record<string, unknown>
  const result = {} as GoUsage
  for (const key of ['rolling', 'weekly', 'monthly'] as const) {
    const row = source[key] as Partial<UsageWindow> | undefined
    if (!row || (row.status !== 'ok' && row.status !== 'rate-limited')
      || typeof row.percent !== 'number' || !Number.isFinite(row.percent) || row.percent < 0
      || typeof row.resetsAt !== 'string' || !Number.isFinite(Date.parse(row.resetsAt))) {
      throw new Error('Invalid OpenCode Go usage response')
    }
    result[key] = { status: row.status, percent: row.percent, resetsAt: row.resetsAt }
  }
  return result
}

/** Validate one probe crossing the wire; the RPC codec runs this on both sides. */
export function parseGoUsageProbe(value: unknown): GoUsageProbe {
  if (!value || typeof value !== 'object') throw new Error('Invalid OpenCode Go usage probe')
  const probe = value as Record<string, unknown>
  if (probe.status === 'not-subscribed') return { status: 'not-subscribed' }
  if (probe.status === 'unknown') {
    if (typeof probe.message !== 'string') throw new Error('Invalid OpenCode Go usage probe')
    return { status: 'unknown', message: probe.message }
  }
  if (probe.status === 'subscribed') return { status: 'subscribed', usage: parseGoUsage(probe.usage) }
  throw new Error('Invalid OpenCode Go usage probe')
}

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface TypertRemoteNamespaceMap {
    opencodeGoUsage: { read(): Promise<RemoteResult<GoUsageProbe>> }
  }
}

// Released DSH uses schema; current source builds use a lazy create() codec.
const usageCodec = {
  mode: 'strict' as const, typeSymbol: 'dsh-opencode-zen#GoUsage',
  schema: { parse: parseGoUsageProbe }, create: () => ({ parse: parseGoUsageProbe }),
}

export const usageRemote: TypertRemoteContribution = {
  package: 'dsh-opencode-zen',
  descriptors: [{
    id: 'dsh-opencode-zen#opencodeGoUsage/read',
    service: 'opencodeGoUsage', namespace: 'opencodeGoUsage', method: 'read',
    invocation: { kind: 'direct' }, parameters: [],
    result: usageCodec,
  }],
}

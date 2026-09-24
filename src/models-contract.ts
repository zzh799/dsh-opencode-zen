/** Settings discovery includes lifecycle data that the host's generic model DTO omits. */
import type { RemoteResult, TypertRemoteContribution } from '@deepseek-ai/dsh-typert-protocol'

/**
 * One settings-page model row. Both plans share this shape: the listing
 * endpoint, the metadata source and the picker are the only things that
 * differ, and each is addressed by the remote namespace rather than by a
 * field on the row.
 */
export interface ZenModelPrice {
  /** Price per 100M tokens before the plan multiplier. */
  source: number
  /** Price per 100M tokens after the plan multiplier. */
  actual: number
}

export interface ZenModel {
  id: string
  name?: string
  contextWindow?: number
  maxTokens?: number
  deprecated?: boolean
  releaseDate?: string
  /** Zen-only price summary used by the settings list and price sort. */
  pricePer100m?: ZenModelPrice
  /**
   * Go documentation's estimated monthly request capacity. `undefined` means the
   * estimate has never loaded, while `null` means the table loaded without this
   * model; the settings page must not collapse those states into a fake zero.
   */
  estimatedMonthlyRequests?: number | 'unlimited' | null
}

export function validReleaseDate(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
    && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value
}

/** Calendar dates are supplied without a timezone; compare UTC dates consistently. */
export function isNewModel(model: ZenModel, now = Date.now()): boolean {
  if (model.deprecated || !validReleaseDate(model.releaseDate)) return false
  const days = Math.floor(now / 86_400_000) - Date.parse(model.releaseDate) / 86_400_000
  return days >= 0 && days < 7
}

export type ModelSort = 'default' | 'price' | 'release' | 'monthly'

/** Keep retired models below active rows for every explicit sort. */
function modelStatusRank(model: ZenModel): number {
  return model.deprecated ? 1 : 0
}

function modelName(model: ZenModel): string {
  return model.name ?? model.id
}

function monthlySortValue(model: ZenModel): number | undefined {
  if (model.estimatedMonthlyRequests === 'unlimited') return Number.NEGATIVE_INFINITY
  if (typeof model.estimatedMonthlyRequests === 'number') return -model.estimatedMonthlyRequests
  return undefined
}

export function sortModels(models: readonly ZenModel[], now = Date.now(), sort: ModelSort = 'default'): ZenModel[] {
  if (sort === 'default') {
    const rank = (model: ZenModel): number => model.deprecated ? 2 : isNewModel(model, now) ? 0 : 1
    return [...models].sort((a, b) => rank(a) - rank(b)
      || (isNewModel(a, now) && isNewModel(b, now) ? b.releaseDate!.localeCompare(a.releaseDate!) : 0))
  }
  return [...models].sort((a, b) => {
    const status = modelStatusRank(a) - modelStatusRank(b)
    if (status !== 0) return status
    if (sort === 'price') {
      // The plan's actual price is the user-facing comparison; source price remains display context.
      const left = a.pricePer100m?.actual
      const right = b.pricePer100m?.actual
      if (left === undefined && right !== undefined) return 1
      if (left !== undefined && right === undefined) return -1
      if (left !== right) return (left ?? 0) - (right ?? 0)
    } else if (sort === 'release') {
      const left = validReleaseDate(a.releaseDate) ? a.releaseDate : ''
      const right = validReleaseDate(b.releaseDate) ? b.releaseDate : ''
      if (left !== right) return right.localeCompare(left)
    } else if (sort === 'monthly') {
      const left = monthlySortValue(a)
      const right = monthlySortValue(b)
      if (left === undefined && right !== undefined) return 1
      if (left !== undefined && right === undefined) return -1
      if (left !== undefined && right !== undefined && left !== right) return left - right
    }
    return modelName(a).localeCompare(modelName(b))
  })
}

function parsePrice(value: unknown): ZenModelPrice {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Invalid model price')
  }
  const price = value as Record<string, unknown>
  if (typeof price.source !== 'number' || !Number.isFinite(price.source) || price.source < 0
    || typeof price.actual !== 'number' || !Number.isFinite(price.actual) || price.actual < 0) {
    throw new Error('Invalid model price')
  }
  return { source: price.source, actual: price.actual }
}

/**
 * Validate one plan's listing. The plan name only reaches the refusal text:
 * a malformed Go list must not read as a Zen problem on the settings page.
 * @param value - the decoded remote payload.
 * @param plan - the plan named in a refusal; the Zen plan by default.
 * @param includePrice - whether this plan's boundary carries the Zen price summary.
 * @returns the validated rows.
 */
export function parseZenModels(value: unknown, plan = 'Zen', includePrice = true): ZenModel[] {
  if (!Array.isArray(value)) throw new Error(`Invalid OpenCode ${plan} model list`)
  return value.map((entry: unknown) => {
    if (!entry || typeof entry !== 'object') throw new Error(`Invalid OpenCode ${plan} model`)
    const row = entry as Record<string, unknown>
    if (typeof row.id !== 'string' || !row.id) throw new Error(`Missing OpenCode ${plan} model id`)
    const model: ZenModel = { id: row.id }
    if (typeof row.name === 'string') model.name = row.name
    for (const key of ['contextWindow', 'maxTokens'] as const) {
      if (typeof row[key] === 'number' && Number.isSafeInteger(row[key]) && row[key] > 0) model[key] = row[key]
    }
    if (typeof row.deprecated === 'boolean') model.deprecated = row.deprecated
    if (validReleaseDate(row.releaseDate)) model.releaseDate = row.releaseDate
    if (includePrice && Object.hasOwn(row, 'pricePer100m')) model.pricePer100m = parsePrice(row.pricePer100m)
    return model
  })
}

function parseGoModels(value: unknown): ZenModel[] {
  const rows = value as readonly unknown[]
  return parseZenModels(value, 'Go', false).map((model, index) => {
    const row = rows[index] as Record<string, unknown>
    if (!Object.hasOwn(row, 'estimatedMonthlyRequests')) return model
    const estimate = row.estimatedMonthlyRequests
    if (estimate === null || estimate === 'unlimited'
      || (typeof estimate === 'number' && Number.isSafeInteger(estimate) && estimate > 0)) {
      return { ...model, estimatedMonthlyRequests: estimate }
    }
    throw new Error('Invalid OpenCode Go monthly request estimate')
  })
}

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface TypertRemoteNamespaceMap {
    opencodeZenModels: { read(): Promise<RemoteResult<readonly ZenModel[]>> }
    opencodeGoModels: {
      read(): Promise<RemoteResult<readonly ZenModel[]>>
      refresh(): Promise<RemoteResult<readonly ZenModel[]>>
    }
  }
}
const codec = { mode: 'strict' as const, typeSymbol: 'dsh-opencode-zen#ZenModels',
  schema: { parse: parseZenModels }, create: () => ({ parse: parseZenModels }) }
const goCodec = { mode: 'strict' as const, typeSymbol: 'dsh-opencode-zen#GoModels',
  schema: { parse: parseGoModels }, create: () => ({ parse: parseGoModels }) }
export const modelsRemote: TypertRemoteContribution = {
  package: 'dsh-opencode-zen',
  descriptors: [{ id: 'dsh-opencode-zen#opencodeZenModels/read', service: 'opencodeZenModels',
    namespace: 'opencodeZenModels', method: 'read', invocation: { kind: 'direct' }, parameters: [], result: codec }],
}
export const goModelsRemote: TypertRemoteContribution = {
  package: 'dsh-opencode-zen',
  descriptors: [
    { id: 'dsh-opencode-zen#opencodeGoModels/read', service: 'opencodeGoModels',
      namespace: 'opencodeGoModels', method: 'read', invocation: { kind: 'direct' }, parameters: [], result: goCodec },
    { id: 'dsh-opencode-zen#opencodeGoModels/refresh', service: 'opencodeGoModels',
      namespace: 'opencodeGoModels', method: 'refresh', invocation: { kind: 'direct' }, parameters: [], result: goCodec },
  ],
}

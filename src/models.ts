import type { Context } from '@deepseek-ai/cordis'
import { TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { attributionHeaders } from '@deepseek-ai/dsh-llm'
import { discoverSettingsModels, type OpencodeZenCatalog } from './catalog.ts'
import { readBoundedTextResponse } from './json-response.ts'
import type { ZenModel } from './models-contract.ts'

/** The English page is the only published Go table with stable, parseable English headers. */
export const GO_MONTHLY_REQUESTS_URL = 'https://opencode.ai/docs/en/go/'
const GO_MONTHLY_REQUESTS_TTL_MS = 24 * 60 * 60 * 1000
const GO_MONTHLY_REQUESTS_TIMEOUT_MS = 10_000
const GO_MONTHLY_REQUESTS_MAX_BYTES = 2 * 1024 * 1024

type GoMonthlyRequestEstimate = number | 'unlimited'

/** Uses the same gateway snapshot as the adapter, including models hidden from pickers. */
export class ZenModelsService extends TypertRemoteService {
  constructor(ctx: Context, private readonly options: { catalog: () => OpencodeZenCatalog }) {
    super(ctx, 'opencodeZenModels')
  }

  read(): Promise<readonly ZenModel[]> {
    return discoverSettingsModels(this.options.catalog(), true)
  }
}

/** The Go plan's listing, on its own namespace so the settings page can tell the plans apart. */
export class GoModelsService extends TypertRemoteService {
  private readonly context: Context
  private estimates: ReadonlyMap<string, GoMonthlyRequestEstimate> | undefined
  private estimatesCheckedAtMs: number | undefined
  private pendingEstimates: Promise<ReadonlyMap<string, GoMonthlyRequestEstimate> | undefined> | undefined

  constructor(ctx: Context, private readonly options: { catalog: () => OpencodeZenCatalog }) {
    super(ctx, 'opencodeGoModels')
    this.context = ctx
  }

  /**
   * Read the live model list and merge the public monthly estimates. Documentation
   * failures are deliberately non-fatal: a transient outage keeps the last table in
   * this process, and a first failure simply leaves the estimate absent.
   */
  read(): Promise<readonly ZenModel[]> {
    return this.readModels(false)
  }

  refresh(): Promise<readonly ZenModel[]> {
    return this.readModels(true)
  }

  private async readModels(force: boolean): Promise<readonly ZenModel[]> {
    const [models, estimates] = await Promise.all([
      discoverSettingsModels(this.options.catalog()),
      this.readEstimates(force),
    ])
    if (estimates === undefined) return models
    return models.map(model => {
      const estimate = estimates.get(goModelKey(model.name ?? '')) ?? estimates.get(goModelKey(model.id))
      return { ...model, estimatedMonthlyRequests: estimate ?? null }
    })
  }

  private readEstimates(force: boolean): Promise<ReadonlyMap<string, GoMonthlyRequestEstimate> | undefined> {
    if (!force && this.estimatesCheckedAtMs !== undefined
      && Date.now() - this.estimatesCheckedAtMs < GO_MONTHLY_REQUESTS_TTL_MS) {
      return Promise.resolve(this.estimates)
    }
    this.pendingEstimates ??= fetchGoMonthlyRequestEstimates()
      .then((estimates) => {
        this.estimates = estimates
        this.estimatesCheckedAtMs = Date.now()
        return estimates
      })
      .catch((error: unknown) => {
        this.context.logger.warn(`llm-opencode-zen: could not refresh Go monthly request estimates: ${String(error)}`)
        return this.estimates
      })
      .finally(() => {
        this.pendingEstimates = undefined
      })
    return this.pendingEstimates
  }
}

async function fetchGoMonthlyRequestEstimates(): Promise<ReadonlyMap<string, GoMonthlyRequestEstimate>> {
  const response = await fetch(GO_MONTHLY_REQUESTS_URL, {
    method: 'GET',
    cache: 'no-cache',
    headers: { accept: 'text/html', ...attributionHeaders() },
    signal: AbortSignal.timeout(GO_MONTHLY_REQUESTS_TIMEOUT_MS),
    redirect: 'error',
  })
  if (!response.ok) throw new Error(`${GO_MONTHLY_REQUESTS_URL} answered HTTP ${response.status}`)
  if (!response.headers.get('content-type')?.toLowerCase().startsWith('text/html')) {
    throw new Error(`${GO_MONTHLY_REQUESTS_URL} did not answer HTML`)
  }
  return parseGoMonthlyRequestEstimates(await readBoundedTextResponse(response, GO_MONTHLY_REQUESTS_MAX_BYTES))
}

const HTML_ENTITIES: Readonly<Record<string, string>> = {
  amp: '&', apos: "'", gt: '>', lt: '<', nbsp: ' ', quot: '"',
}

function decodeHTMLEntities(value: string): string {
  return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (entity, name: string) => {
    const key = name.toLowerCase()
    if (key.startsWith('#x')) return String.fromCodePoint(Number.parseInt(key.slice(2), 16))
    if (key.startsWith('#')) return String.fromCodePoint(Number.parseInt(key.slice(1), 10))
    return HTML_ENTITIES[key] ?? entity
  })
}

function htmlText(value: string): string {
  return decodeHTMLEntities(value
    .replace(/<br\s*\/?\s*>/gi, ' ')
    .replace(/<[^>]*>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim()
}

function rowCells(row: string): string[] {
  return [...row.matchAll(/<t[hd]\b[^>]*>([\s\S]*?)<\/t[hd]>/gi)].map(match => match[1])
}

function currentCellText(cell: string): string {
  // A temporary value is struck through and its replacement is emphasized.
  // Taking <strong> first prevents the old estimate from being concatenated
  // with the current one when the page uses <br> between them.
  const current = /<strong\b[^>]*>([\s\S]*?)<\/strong>/i.exec(cell)
  return htmlText(current?.[1] ?? cell.replace(/<del\b[^>]*>[\s\S]*?<\/del>/gi, ''))
}

function estimateText(value: string): GoMonthlyRequestEstimate {
  const text = currentCellText(value)
  if (text.toLowerCase() === 'unlimited') return 'unlimited'
  const digits = text.replace(/[\s,]/g, '')
  if (!/^\d+$/.test(digits)) throw new Error(`Invalid Go monthly request estimate: ${text}`)
  const estimate = Number(digits)
  if (!Number.isSafeInteger(estimate) || estimate <= 0) throw new Error(`Invalid Go monthly request estimate: ${text}`)
  return estimate
}

/** Match docs labels to catalog ids despite spacing, punctuation, and marketing suffixes. */
function goModelKey(value: string): string {
  return value.toLowerCase().replace(/\([^)]*\)/g, '').replace(/[^a-z0-9]+/g, '')
}

export function parseGoMonthlyRequestEstimates(html: string): ReadonlyMap<string, GoMonthlyRequestEstimate> {
  let selected: { header: string[]; rows: string[][] } | undefined
  for (const table of html.matchAll(/<table\b[^>]*>([\s\S]*?)<\/table>/gi)) {
    const rows = [...table[1].matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].map(row => rowCells(row[1]))
    const header = rows.find(cells => cells.map(htmlText).includes('requests per month'))
    if (header !== undefined) {
      selected = { header, rows }
      break
    }
  }
  if (selected === undefined) throw new Error('OpenCode Go documentation has no estimated monthly requests table')
  const monthIndex = selected.header.map(htmlText).indexOf('requests per month')
  const estimates = new Map<string, GoMonthlyRequestEstimate>()
  for (const cells of selected.rows) {
    if (cells === selected.header) continue
    if (cells.length !== selected.header.length || monthIndex < 0 || monthIndex >= cells.length) {
      throw new Error('OpenCode Go estimated requests table has an unexpected row shape')
    }
    const name = htmlText(cells[0].replace(/<small\b[^>]*>[\s\S]*?<\/small>/gi, ''))
    const key = goModelKey(name)
    if (key.length === 0) throw new Error('OpenCode Go estimated requests table has an unnamed model')
    const estimate = estimateText(cells[monthIndex])
    if (estimates.has(key)) throw new Error(`OpenCode Go estimated requests table repeats ${name}`)
    estimates.set(key, estimate)
  }
  if (estimates.size === 0) throw new Error('OpenCode Go estimated requests table is empty')
  return estimates
}

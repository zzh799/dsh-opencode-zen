import { createServer } from 'node:http'
import { afterEach, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Gateway from '@deepseek-ai/dsh-api-gateway'
import Registry from '@deepseek-ai/dsh-typert-registry'
import { registerZenRemotes } from '../src/remotes.ts'
import { GoUsageService } from '../src/usage.ts'
import { parseGoUsage, parseGoUsageProbe, type GoUsageProbe } from '../src/usage-contract.ts'

const window = { status: 'ok', percent: 10, resetsAt: '2026-09-21T00:00:00Z' }
const usage = { rolling: { ...window, percent: 0 }, weekly: window, monthly: { ...window, percent: 7 } }
/** Echoed by every non-200 answer: a body the browser must never see. */
const secretBody = 'secret response must not enter the UI'

const cleanups: Array<() => Promise<unknown>> = []
afterEach(async () => { for (const close of cleanups.splice(0).reverse()) await close() })

/** A usage endpoint whose status and body this test drives. */
async function usageServer(): Promise<{
  url: string
  requests: Array<{ url?: string; auth?: string }>
  setStatus: (status: number) => void
}> {
  const requests: Array<{ url?: string; auth?: string }> = []
  let status = 200
  const server = createServer((request, response) => {
    requests.push({ url: request.url, auth: request.headers.authorization })
    response.writeHead(status, { 'Content-Type': 'application/json' })
    response.end(JSON.stringify(status === 200 ? { usage } : { error: secretBody }))
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  cleanups.push(() => new Promise<void>(resolve => server.close(() => resolve())))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('missing address')
  return {
    url: `http://127.0.0.1:${address.port}/v1`,
    requests,
    setStatus: (next: number) => { status = next },
  }
}

/** Mount the service on a real Host RPC gateway, exactly as the plugin does. */
async function mountUsage(baseURL: () => string, resolveApiKey: () => Promise<string | undefined>): Promise<() => Promise<GoUsageProbe>> {
  const ctx = new Context()
  cleanups.push(() => ctx.fiber.dispose())
  await ctx.plugin(Registry)
  await ctx.plugin(Gateway)
  registerZenRemotes(ctx)
  await ctx.plugin(GoUsageService, { baseURL, resolveApiKey })
  return async () => {
    // The Host gateway hands back the business method's value; re-validating it
    // through the wire parser is what the browser half's codec does too.
    const value = await ctx.typertGateway.invoke({ namespace: 'opencodeGoUsage', method: 'read', args: {} })
    return parseGoUsageProbe(value)
  }
}

it('reports a subscription through the actual Host RPC gateway and follows credential changes', async () => {
  const server = await usageServer()
  let key: string | undefined = 'first-key'
  const read = await mountUsage(() => server.url, async () => key)

  expect(await read()).toEqual({ status: 'subscribed', usage })
  key = 'second-key'
  expect(await read()).toEqual({ status: 'subscribed', usage })
  expect(server.requests).toEqual([
    { url: '/v1/usage', auth: 'Bearer first-key' },
    { url: '/v1/usage', auth: 'Bearer second-key' },
  ])
})

it('reads a definitive refusal as no subscription, and every other failure as unknown', async () => {
  const server = await usageServer()
  const read = await mountUsage(() => server.url, async () => 'a-key')

  server.setStatus(401)
  expect(await read()).toEqual({ status: 'not-subscribed' })
  server.setStatus(403)
  expect(await read()).toEqual({ status: 'not-subscribed' })

  // A refusal that is not an entitlement verdict must not be reported as one.
  for (const status of [404, 429, 500, 503]) {
    server.setStatus(status)
    const probe = await read()
    expect(probe.status).toBe('unknown')
    expect(JSON.stringify(probe)).not.toContain(secretBody)
  }

  server.setStatus(200)
  expect(await read()).toEqual({ status: 'subscribed', usage })
})

it('answers unknown instead of throwing when it has nothing to probe with', async () => {
  // No credential configured.
  const noKey = await mountUsage(() => 'https://opencode.ai/zen/go/v1', async () => undefined)
  expect(await noKey()).toEqual({ status: 'unknown', message: 'no credential is configured for the Go plan' })

  // A credential resolver that refuses, as the plugin's does when nothing is set.
  const refusing = await mountUsage(() => 'https://opencode.ai/zen/go/v1', async () => { throw new Error('MISSING_CREDENTIAL') })
  const refusingProbe = await refusing()
  expect(refusingProbe.status).toBe('unknown')

  // Unreachable endpoint, and a base URL the schema would have refused anyway.
  const offline = await mountUsage(() => 'http://127.0.0.1:1/v1', async () => 'a-key')
  expect((await offline()).status).toBe('unknown')
  const malformed = await mountUsage(() => 'not-a-url', async () => 'a-key')
  expect((await malformed()).status).toBe('unknown')
})

it('keeps unavailable or malformed usage distinct from zero', () => {
  expect(parseGoUsage(usage).rolling.percent).toBe(0)
  for (const value of [null, {}, { ...usage, weekly: {} }, { ...usage, weekly: { ...window, percent: NaN } }, { ...usage, monthly: { ...window, resetsAt: 'never' } }]) {
    expect(() => parseGoUsage(value)).toThrow('Invalid OpenCode Go usage response')
  }
})

it('validates the probe union crossing the wire', () => {
  expect(parseGoUsageProbe({ status: 'not-subscribed' })).toEqual({ status: 'not-subscribed' })
  expect(parseGoUsageProbe({ status: 'unknown', message: 'offline' })).toEqual({ status: 'unknown', message: 'offline' })
  expect(parseGoUsageProbe({ status: 'subscribed', usage })).toEqual({ status: 'subscribed', usage })
  for (const value of [null, 'subscribed', {}, { status: 'unknown' }, { status: 'unknown', message: 7 }, { status: 'nope' }]) {
    expect(() => parseGoUsageProbe(value)).toThrow('Invalid OpenCode Go usage probe')
  }
  // A well-formed probe with statistics missing fails on the statistics, which
  // is what the endpoint's own body would be rejected for too.
  expect(() => parseGoUsageProbe({ status: 'subscribed' })).toThrow(/Invalid OpenCode Go usage/)
})

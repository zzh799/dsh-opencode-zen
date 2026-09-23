/** Exercise a tarball installed in a separate consumer through Cordis's real package resolver. */
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { resolve } from 'node:path'
import { createServer } from 'node:http'
import { once } from 'node:events'

const consumer = resolve(process.argv[2] ?? '.')
const require = createRequire(resolve(consumer, 'package.json'))
const entry = require.resolve('dsh-opencode-zen')
const fromPlugin = createRequire(entry)
const load = id => import(pathToFileURL(fromPlugin.resolve(id)).href)
const { Context } = await load('@deepseek-ai/cordis')
const { default: Loader } = await import(pathToFileURL(require.resolve('@deepseek-ai/cordis-plugin-loader')).href)
const { createUserMessage } = await load('@deepseek-ai/dsh-llm')
const requests = []
const server = createServer((request, response) => {
  request.resume()
  request.on('end', () => {
    requests.push({ path: request.url, headers: request.headers })
    if (request.url === '/models') {
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ data: [{ id: 'deepseek-v4.1-flash' }] }))
    } else if (request.url === '/go/models') {
      // The Go plan's own listing, so a shared catalog shows up immediately.
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ data: [{ id: 'glm-5.3' }] }))
    } else {
      response.writeHead(200, { 'content-type': 'text/event-stream' })
      for (const event of [
        { choices: [{ delta: { role: 'assistant', content: 'standalone-ok' }, index: 0, finish_reason: null }] },
        { choices: [{ delta: {}, index: 0, finish_reason: 'stop' }], usage: { prompt_tokens: 3, completion_tokens: 1 } },
      ]) response.write(`data: ${JSON.stringify(event)}\n\n`)
      response.end('data: [DONE]\n\n')
    }
  })
})
const ctx = new Context()
const previous = process.env.OPENCODE_ZEN_INSTALL_TEST_KEY
const previousGo = process.env.OPENCODE_GO_INSTALL_TEST_KEY
process.env.OPENCODE_ZEN_INSTALL_TEST_KEY = 'fixture-key'
process.env.OPENCODE_GO_INSTALL_TEST_KEY = 'go-fixture-key'
try {
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const origin = `http://127.0.0.1:${server.address().port}`
  ctx.baseUrl = pathToFileURL(resolve(consumer, 'package.json')).href
  await ctx.plugin(Loader)
  await ctx.loader.create({ name: '@deepseek-ai/dsh-llm' })
  const adapterId = await ctx.loader.create({
    name: 'dsh-opencode-zen',
    config: {
      apiKeyEnv: 'OPENCODE_ZEN_INSTALL_TEST_KEY', baseURL: origin, streamIdleTimeoutMs: 5000,
      // Both plans, each on its own credential, so the two routes are proved
      // to register, list and stream independently of one another.
      go: { enabled: true, baseURL: `${origin}/go`, apiKeyEnv: 'OPENCODE_GO_INSTALL_TEST_KEY' },
    },
  })
  await ctx.loader.await()
  const adapterEntry = ctx.loader.resolve(adapterId)
  assert.ok(adapterEntry.fiber, 'the installed adapter must mount')
  const providers = await ctx.llm.listProviders()
  assert.ok(providers.some(provider => provider.id === 'opencode-zen'), JSON.stringify(providers))
  assert.ok(providers.some(provider => provider.id === 'opencode-go'), JSON.stringify(providers))
  const models = await ctx.llm.listModels('opencode-zen')
  assert.ok(models.some(model => model.id === 'deepseek-v4.1-flash'))
  const goModels = await ctx.llm.listModels('opencode-go')
  assert.ok(goModels.some(model => model.id === 'glm-5.3'), JSON.stringify(goModels))
  for (const sessionId of ['standalone-session-a', 'standalone-session-a', 'standalone-session-b']) {
    const chunks = []
    for await (const chunk of ctx.llm.stream({ provider: 'opencode-zen', model: 'deepseek-v4.1-flash', messages: [createUserMessage({ content: [{ type: 'text', text: 'hello' }], source: { kind: 'plugin', plugin: 'installed-smoke' } })], sessionId })) chunks.push(chunk)
    assert.ok(chunks.some(chunk => chunk.type === 'text-delta' && chunk.text === 'standalone-ok'), JSON.stringify(chunks))
  }
  await ctx.llm.stream({ provider: 'opencode-go', model: 'glm-5.3', messages: [createUserMessage({ content: [{ type: 'text', text: 'hello' }], source: { kind: 'plugin', plugin: 'installed-smoke' } })], sessionId: 'go-session' }).next()
  const completions = requests.filter(request => request.path === '/chat/completions')
  assert.deepEqual(completions.map(request => request.headers['x-opencode-session']), ['standalone-session-a', 'standalone-session-a', 'standalone-session-b'])
  assert.ok(completions.every(request => request.headers['user-agent'].startsWith('deepseek-harness/')))
  assert.ok(completions.every(request => request.headers.authorization === 'Bearer fixture-key'))
  // The Go route streams on its own credential against its own endpoint.
  const goCompletions = requests.filter(request => request.path === '/go/chat/completions')
  assert.equal(goCompletions.length, 1)
  assert.equal(goCompletions[0].headers.authorization, 'Bearer go-fixture-key')
  assert.equal(goCompletions[0].headers['x-opencode-session'], 'go-session')
  await adapterEntry.fiber.dispose()
  const afterUnload = await ctx.llm.listProviders()
  assert.ok(!afterUnload.some(provider => provider.id === 'opencode-zen'))
  assert.ok(!afterUnload.some(provider => provider.id === 'opencode-go'))
  console.log('PASS: installed package resolution, both plans, catalogs, streamed text, session headers, attribution, authorization, unload')
} finally {
  await ctx.fiber.dispose()
  if (previous === undefined) delete process.env.OPENCODE_ZEN_INSTALL_TEST_KEY
  else process.env.OPENCODE_ZEN_INSTALL_TEST_KEY = previous
  if (previousGo === undefined) delete process.env.OPENCODE_GO_INSTALL_TEST_KEY
  else process.env.OPENCODE_GO_INSTALL_TEST_KEY = previousGo
  server.closeAllConnections()
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
}

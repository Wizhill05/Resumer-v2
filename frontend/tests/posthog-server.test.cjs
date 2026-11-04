const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const vm = require('node:vm')
const ts = require('typescript')

function load(environment, send) {
  const source = readFileSync(path.join(__dirname, '../lib/posthog-server.ts'), 'utf8')
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  const context = { exports: {}, require, AbortSignal, console: { warn() {} }, fetch: send,
    process: { env: { NEXT_PUBLIC_POSTHOG_KEY: 'test-key', VERCEL_ENV: environment } } }
  vm.runInNewContext(compiled, context)
  return context.exports
}

test('successful sign-in reports account identity and provider without credentials', async () => {
  const requests = []
  const api = load('production', async (url, options) => { requests.push({ url, body: JSON.parse(options.body) }); return { ok: true } })
  await api.captureSignIn(' Aryan@Example.test ', 'google')
  assert.equal(requests.length, 1)
  assert.equal(requests[0].body.event, 'user_signed_in')
  assert.equal(requests[0].body.properties.distinct_id, 'aryan@example.test')
  assert.equal(requests[0].body.properties.provider, 'google')
  assert.equal(requests[0].body.properties.is_signed_in, true)
  assert.ok(requests[0].body.uuid)
})

test('preview sign-ins and accounts without email do not send events', async () => {
  let sent = 0
  const send = async () => { sent++; return { ok: true } }
  await load('preview', send).captureSignIn('aryan@example.test', 'google')
  await load('production', send).captureSignIn(null, 'google')
  assert.equal(sent, 0)
})

test('PostHog outage does not fail authentication', async () => {
  await load('production', async () => { throw new Error('network failure') }).captureSignIn('aryan@example.test', 'google')
})

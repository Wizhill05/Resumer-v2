const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const vm = require('node:vm')
const ts = require('typescript')

function load(environment = 'production', pathname = '/') {
  const captures = []
  let config
  const sdk = {
    __loaded: false,
    init: (_key, options) => { config = options; sdk.__loaded = true },
    capture: (event, properties) => captures.push({ event, properties }),
    has_opted_out_capturing: () => false,
    get_distinct_id: () => 'guest-browser',
    get_session_id: () => 'browser-session',
  }
  const source = readFileSync(path.join(__dirname, '../lib/posthog.ts'), 'utf8')
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  const context = { exports: {}, URL, Set, window: { location: { pathname } },
    process: { env: { NEXT_PUBLIC_POSTHOG_KEY: 'test-key', NODE_ENV: 'production', NEXT_PUBLIC_VERCEL_ENV: environment } },
    require: (name) => { assert.equal(name, 'posthog-js'); return { default: sdk } },
  }
  vm.runInNewContext(compiled, context)
  return { api: context.exports, sdk, captures, config: () => config }
}

test('initializes once, protects private pages, and uses the dashboard host', () => {
  const instance = load('production', '/try')
  instance.api.initPostHog(); instance.api.initPostHog()
  assert.equal(instance.config().ui_host, 'https://us.posthog.com')
  assert.equal(instance.config().disable_session_recording, true)
  assert.equal(instance.config().session_recording.maskAllInputs, true)
})

test('preview activity and backend attribution are disabled', () => {
  const instance = load('preview')
  instance.api.initPostHog()
  instance.api.captureDownload('resume-1', 'editor')
  assert.equal(instance.config(), undefined)
  assert.equal(instance.api.generationAnalyticsContext(), undefined)
  assert.equal(instance.captures.length, 0)
})

test('page URLs keep campaign attribution and remove private queries and fragments', () => {
  const { api } = load()
  assert.equal(api.analyticsUrl('https://resumer.aryansingh.space/try?token=private&utm_source=github#private'),
    'https://resumer.aryansingh.space/try?utm_source=github')
})

test('support events are excluded and browser events are labelled production', () => {
  const instance = load('production', '/support/private')
  instance.api.initPostHog()
  assert.equal(instance.config().before_send({ properties: {} }), null)
  const publicInstance = load()
  publicInstance.api.initPostHog()
  const event = publicInstance.config().before_send({ properties: { $current_url: 'https://resumer.aryansingh.space/?code=secret', $set_once: { $initial_current_url: 'https://resumer.aryansingh.space/?token=secret' } } })
  assert.equal(event.properties.$current_url, 'https://resumer.aryansingh.space/')
  assert.equal(event.properties.environment, 'production')
  assert.equal(event.properties.$set_once.$initial_current_url, 'https://resumer.aryansingh.space/')
})

test('download clicks use one truthful event without resume content', () => {
  const instance = load()
  for (const source of ['guest', 'editor', 'history', 'remake']) instance.api.captureDownload('resume-1', source)
  assert.equal(instance.captures.length, 4)
  assert.ok(instance.captures.every(c => c.event === 'resume_download_clicked'))
  assert.deepEqual(Object.keys(instance.captures[0].properties), ['run_id', 'source', 'is_guest'])
})

test('opted-out browsers do not pass identity to background tracking', () => {
  const instance = load()
  instance.api.initPostHog()
  instance.sdk.has_opted_out_capturing = () => true
  assert.equal(instance.api.generationAnalyticsContext(), undefined)
})

function mountProvider(instance, session) {
  const source = readFileSync(path.join(__dirname, '../components/providers/PostHogProvider.tsx'), 'utf8')
  const compiled = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
  } }).outputText
  const jsx = (type, props) => typeof type === 'function' ? type(props) : null
  const context = { exports: {}, window: { origin: 'https://resumer.aryansingh.space' }, require: (name) => {
    if (name === '@/lib/posthog') return instance.api
    if (name === 'react') return { useEffect: effect => effect(), useRef: initial => ({ current: initial }), Suspense: () => null }
    if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx }
    if (name === 'next/navigation') return { usePathname: () => '/', useSearchParams: () => new URLSearchParams() }
    if (name === 'next-auth/react') return { useSession: () => session }
    throw new Error(name)
  } }
  vm.runInNewContext(compiled, context)
  context.exports.PostHogProvider({ children: null })
}

test('guest reloads preserve identity, login identifies, and logout resets once', () => {
  const instance = load()
  instance.api.initPostHog()
  let identity
  let resets = 0
  instance.sdk.get_property = () => identity
  instance.sdk.identify = value => { identity = value }
  instance.sdk.reset = () => { identity = undefined; resets++ }
  instance.sdk.set_config = () => {}
  instance.sdk.register = () => {}
  mountProvider(instance, { status: 'unauthenticated' })
  mountProvider(instance, { status: 'unauthenticated' })
  assert.equal(resets, 0)
  mountProvider(instance, { status: 'authenticated', data: { user: { email: ' Aryan@Example.test ' } } })
  assert.equal(identity, 'aryan@example.test')
  mountProvider(instance, { status: 'unauthenticated' })
  mountProvider(instance, { status: 'unauthenticated' })
  assert.equal(resets, 1)
})

test('pageviews record immediately and signed-in visits wait for authentication state', () => {
  const instance = load()
  instance.api.initPostHog()
  instance.sdk.get_property = () => undefined
  instance.sdk.set_config = () => {}
  instance.sdk.register = () => {}
  instance.sdk.identify = () => {}
  mountProvider(instance, { status: 'loading' })
  assert.equal(instance.captures[0].event, '$pageview')
  assert.equal(instance.captures[0].properties.authentication_status, 'loading')
  mountProvider(instance, { status: 'unauthenticated' })
  assert.equal(instance.captures.at(-1).properties.is_signed_in, false)
  mountProvider(instance, { status: 'authenticated', data: { user: { email: 'aryan@example.test' } } })
  assert.equal(instance.captures.at(-1).event, 'signed_in_visit')
  assert.equal(instance.captures.at(-1).properties.is_signed_in, true)
})

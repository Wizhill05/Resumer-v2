const assert = require("node:assert/strict")
const { readFileSync } = require("node:fs")
const path = require("node:path")
const test = require("node:test")
const vm = require("node:vm")
const ts = require("typescript")
const { z } = require("zod")

const source = readFileSync(path.join(__dirname, "../app/api/support/[[...path]]/route.ts"), "utf8")
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText

function handler(session) {
  const forwarded = []
  const context = {
    exports: {}, Headers, Response, URLSearchParams,
    process: { env: { BACKEND_INTERNAL_URL: "https://backend.example.test" } },
    fetch: async (url, options) => {
      forwarded.push({ url, options })
      return Response.json({ id: "test-issue", viewer_is_admin: true, messages: [] })
    },
    require: name => {
      if (name === "next/server") return { NextResponse: Response }
      if (name === "@/lib/auth") return { auth: async () => session }
      if (name === "@/lib/jwt") return { signBackendToken: async payload => {
        assert.equal(payload.email, "admin@example.test")
        assert.equal(payload.github_username, null)
        return "signed-admin-session"
      } }
      if (name === "zod") return { z }
      throw new Error(`Unexpected dependency ${name}`)
    }
  }
  vm.runInNewContext(compiled, context)
  return { route: context.exports, forwarded }
}

const issue = "00000000-0000-0000-0000-000000000001"
const request = search => ({ headers: new Headers(), nextUrl: { searchParams: new URLSearchParams(search) }, method: "GET" })

test("authenticated admin thread request accepts nullable non-GitHub session claims", async () => {
  const { route, forwarded } = handler({ user: { email: "admin@example.test", name: "Admin" }, provider: "google", githubUsername: null, githubAccessToken: null, token: { provider: "google", githubUsername: null, githubAccessToken: null } })
  const response = await route.GET(request(""), { params: Promise.resolve({ path: [issue] }) })
  assert.equal(response.status, 200)
  assert.equal((await response.json()).viewer_is_admin, true)
  assert.equal(forwarded[0].url, `https://backend.example.test/feedback/support/${issue}`)
  assert.equal(forwarded[0].options.headers.get("Authorization"), "Bearer signed-admin-session")
})

test("guest thread request forwards its scoped token without an authorization header", async () => {
  const { route, forwarded } = handler(null)
  const response = await route.GET(request("access_token=scoped-link&unrelated=ignored"), { params: Promise.resolve({ path: [issue] }) })
  assert.equal(response.status, 200)
  assert.equal(forwarded[0].options.headers.has("Authorization"), false)
  assert.equal(forwarded[0].url, `https://backend.example.test/feedback/support/${issue}?access_token=scoped-link`)
})

test("support proxy rejects paths outside the issue API", async () => {
  const { route, forwarded } = handler(null)
  const response = await route.GET(request(""), { params: Promise.resolve({ path: ["admin", "users"] }) })
  assert.equal(response.status, 404)
  assert.equal(forwarded.length, 0)
})

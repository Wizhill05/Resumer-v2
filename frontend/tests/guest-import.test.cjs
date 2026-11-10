const assert = require("node:assert/strict")
const { readFileSync } = require("node:fs")
const path = require("node:path")
const test = require("node:test")
const vm = require("node:vm")
const ts = require("typescript")

const source = readFileSync(path.join(__dirname, "../lib/guest-import.ts"), "utf8")
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText

function setup({ draft, account, claimed = 0, failPosts = false }) {
  const state = { draft, cleared: false, latestRunCleared: false, calls: [] }
  const storage = {
    loadGuestDraft: () => state.draft,
    clearGuestDraft: () => { state.cleared = true },
    saveGuestLatestRun: (v) => { if (v === null) state.latestRunCleared = true },
  }
  const json = (body, ok = true) => ({ ok, json: async () => body })
  const fetch = async (url, init = {}) => {
    const method = init.method || "GET"
    state.calls.push({ method, url, body: init.body ? JSON.parse(init.body) : undefined })
    if (url.endsWith("/claim-guest")) return json({ claimed })
    if (method === "GET" && url === "/api/backend/profile") return json(account.profile)
    if (method === "GET") return json(account[url.split("/").pop()] ?? [])
    return json({}, !(failPosts && method === "POST"))
  }
  const context = {
    exports: {}, fetch, Promise,
    require: (id) => (id === "@/lib/guest-storage" ? storage : require(id)),
  }
  vm.runInNewContext(compiled, context)
  return { mod: context.exports, state }
}

const draft = () => ({
  profile: { full_name: "Guest Name", email: "g@example.com", github_url: "https://github.com/g", skills: ["Python"], phone: "" },
  experiences: [{ role: "Eng", organization: "Acme", bullet_points: ["x"] }],
  projects: [{ name: "P1", description: "d" }, { name: "P2", description: "d" }],
  education: [], extracurriculars: [], updatedAt: "t",
})

test("new account: claims résumés, fills empty profile fields, copies sections", async () => {
  const { mod, state } = setup({ draft: draft(), claimed: 2, account: { profile: { full_name: "OAuth Name", email: null, skills: [] } } })
  const result = await mod.importGuestIntoAccount()
  assert.equal(result.claimed, 2)
  assert.equal(result.imported, true)
  assert.equal(result.ok, true)
  const put = state.calls.find((c) => c.method === "PUT")
  // Never overwrites what the account has (name); fills the blanks; skips blank guest values.
  assert.deepEqual(put.body, { email: "g@example.com", github_url: "https://github.com/g", skills: ["Python"] })
  const posts = state.calls.filter((c) => c.method === "POST" && !c.url.endsWith("claim-guest"))
  assert.deepEqual(posts.map((c) => c.url.split("/").pop()), ["experiences", "projects", "projects"])
  assert.equal(posts[2].body.sort_order, 1)
  assert.equal(state.cleared, true)
  assert.equal(state.latestRunCleared, true)
})

test("sections the account already has are not duplicated", async () => {
  const { mod, state } = setup({ draft: draft(), account: { profile: { full_name: "A", email: "a@x.io", github_url: "g", skills: ["Go"] }, experiences: [{ id: 1 }], projects: [{ id: 2 }] } })
  const result = await mod.importGuestIntoAccount()
  assert.equal(result.imported, false)
  assert.equal(state.calls.filter((c) => c.method !== "GET" && !c.url.endsWith("claim-guest")).length, 0)
  assert.equal(state.cleared, true)
})

test("a failed write keeps the draft so it can retry", async () => {
  const { mod, state } = setup({ draft: draft(), failPosts: true, account: { profile: {} } })
  const result = await mod.importGuestIntoAccount()
  assert.equal(result.ok, false)
  assert.equal(state.cleared, false)
})

test("no trial draft: still claims résumés, writes nothing", async () => {
  const empty = { profile: {}, experiences: [], projects: [], education: [], extracurriculars: [], updatedAt: "t" }
  const { mod, state } = setup({ draft: empty, claimed: 1, account: { profile: {} } })
  const result = await mod.importGuestIntoAccount()
  assert.deepEqual({ ...result }, { claimed: 1, imported: false, ok: true })
  assert.deepEqual(state.calls.map((c) => c.method + " " + c.url), ["POST /api/backend/generate/claim-guest"])
})

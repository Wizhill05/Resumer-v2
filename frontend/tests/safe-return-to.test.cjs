const assert = require("node:assert/strict")
const { readFileSync } = require("node:fs")
const path = require("node:path")
const test = require("node:test")
const vm = require("node:vm")
const ts = require("typescript")

const source = readFileSync(path.join(__dirname, "../lib/safe-return-to.ts"), "utf8")
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS }
}).outputText

const context = { exports: {}, require, URL }
vm.runInNewContext(compiled, context)
const { safeReturnTo } = context.exports

const requestUrl = "https://resumer.buzz/api/integrations/github/start?private=0"

test("allows plain relative paths", () => {
  assert.equal(safeReturnTo("/account", requestUrl), "/account")
  assert.equal(safeReturnTo("/dashboard?tab=projects", requestUrl), "/dashboard?tab=projects")
})

test("rejects backslash escapes and control characters", () => {
  assert.equal(safeReturnTo("/\\evil.com", requestUrl), "/account")
  assert.equal(safeReturnTo("/foo\nbar", requestUrl), "/account")
  assert.equal(safeReturnTo("/foo\x7fbar", requestUrl), "/account")
})

test("rejects absolute and protocol-relative URLs", () => {
  assert.equal(safeReturnTo("//evil.com", requestUrl), "/account")
  assert.equal(safeReturnTo("https://evil.com/", requestUrl), "/account")
  assert.equal(safeReturnTo("https://resumer.buzz/account", requestUrl), "/account")
})

test("returns pathname and search, not the raw input", () => {
  assert.equal(
    safeReturnTo("/account?next=%2Fapi%2Fintegrations%2Fgithub%2Fstart", requestUrl),
    "/account?next=%2Fapi%2Fintegrations%2Fgithub%2Fstart"
  )
  assert.equal(safeReturnTo("", requestUrl), "/account")
  assert.equal(safeReturnTo(null, requestUrl), "/account")
  assert.equal(safeReturnTo(undefined, requestUrl), "/account")
})

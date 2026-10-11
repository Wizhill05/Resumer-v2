import test from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";

test("SecuritySection component exists and satisfies requirements", () => {
  const filePath = path.join(process.cwd(), "components/landing/SecuritySection.tsx");
  assert.ok(fs.existsSync(filePath), "SecuritySection.tsx should exist");

  const content = fs.readFileSync(filePath, "utf-8");
  assert.ok(content.includes("export function SecuritySection"), "Exports SecuritySection");
  assert.ok(content.includes("Zero Model Training"), "Includes Zero Model Training guarantee");
  assert.ok(content.includes("Cloudflare R2") || content.includes("AES-256"), "Includes encrypted storage guarantee");
  assert.ok(content.includes("Purge") || content.includes("Deletion"), "Includes data deletion guarantee");
  assert.ok(content.includes("OAuth") || content.includes("Passwordless"), "Includes auth security guarantee");
});

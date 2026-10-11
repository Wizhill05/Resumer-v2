import test from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";

test("ResumeDiffShowcase component exists and satisfies requirements", () => {
  const filePath = path.join(process.cwd(), "components/landing/ResumeDiffShowcase.tsx");
  assert.ok(fs.existsSync(filePath), "ResumeDiffShowcase.tsx should exist");

  const content = fs.readFileSync(filePath, "utf-8");
  assert.ok(content.includes('"use client"'), "Is a client component");
  assert.ok(content.includes("export function ResumeDiffShowcase"), "Exports ResumeDiffShowcase");
  assert.ok(content.includes("Software Engineer"), "Includes Software Engineer persona");
  assert.ok(content.includes("Product Manager"), "Includes Product Manager persona");
  assert.ok(content.includes("DevOps"), "Includes DevOps persona");
  assert.ok(content.includes('role="tab"'), "Includes accessible tab roles");
  assert.ok(content.includes('role="tablist"'), "Includes accessible tablist role");
  assert.ok(content.includes("98%"), "Includes high match score indicator");
});

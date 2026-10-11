import test from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";

test("AtsCompatibilityMatrix component exists and satisfies requirements", () => {
  const filePath = path.join(process.cwd(), "components/landing/AtsCompatibilityMatrix.tsx");
  assert.ok(fs.existsSync(filePath), "AtsCompatibilityMatrix.tsx should exist");

  const content = fs.readFileSync(filePath, "utf-8");
  assert.ok(content.includes("export function AtsCompatibilityMatrix"), "Exports AtsCompatibilityMatrix");
  assert.ok(content.includes("Workday"), "Includes Workday ATS");
  assert.ok(content.includes("Greenhouse"), "Includes Greenhouse ATS");
  assert.ok(content.includes("Lever"), "Includes Lever ATS");
  assert.ok(content.includes("Ashby"), "Includes Ashby ATS");
  assert.ok(content.includes("WeasyPrint"), "Includes WeasyPrint technical engine note");
  assert.ok(content.includes("100%"), "Includes 100% parse rate badge");
});

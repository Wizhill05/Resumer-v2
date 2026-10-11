import test from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";

test("LandingMetricsBanner component exists and satisfies requirements", () => {
  const filePath = path.join(process.cwd(), "components/landing/LandingMetricsBanner.tsx");
  assert.ok(fs.existsSync(filePath), "LandingMetricsBanner.tsx should exist");

  const content = fs.readFileSync(filePath, "utf-8");
  assert.ok(content.includes("export function LandingMetricsBanner"), "Exports LandingMetricsBanner function");
  assert.ok(content.includes("94.8%"), "Includes 94.8% pass rate metric");
  assert.ok(content.includes("4.2s"), "Includes 4.2s latency metric");
  assert.ok(content.includes("12,400+"), "Includes 12,400+ generation metric");
  assert.ok(content.includes("3.2×"), "Includes 3.2x callback metric");
});

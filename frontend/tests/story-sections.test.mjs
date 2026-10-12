import test from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";

const landingDir = path.join(process.cwd(), "components/landing");

test("StoryOverture exists, is a server component, and frames the problem with gradient text", () => {
  const filePath = path.join(landingDir, "StoryOverture.tsx");
  assert.ok(fs.existsSync(filePath), "StoryOverture.tsx should exist");

  const content = fs.readFileSync(filePath, "utf-8");
  assert.ok(content.includes("export function StoryOverture"), "Exports StoryOverture");
  assert.ok(!content.includes('"use client"'), "Stays a server component (no interactivity)");
  assert.ok(/qualified/i.test(content), "States the reader is qualified");
  assert.ok(/never finds out|never reach|screening/i.test(content), "Names the screening failure");
  assert.ok(/hiring software|applicant tracking|reads/i.test(content), "Explains how Resumer helps");
  assert.ok(content.includes("bg-clip-text") && content.includes("text-transparent"), "Headline uses a gradient text treatment");
  assert.ok(!content.includes("story-glow"), "No background glow — plain canvas below the hero");
});

test("StoryJourney exists and tells the three-step story", () => {
  const filePath = path.join(landingDir, "StoryJourney.tsx");
  assert.ok(fs.existsSync(filePath), "StoryJourney.tsx should exist");

  const content = fs.readFileSync(filePath, "utf-8");
  assert.ok(content.includes("export function StoryJourney"), "Exports StoryJourney");
  assert.ok(!content.includes('"use client"'), "Stays a server component (no interactivity)");
  assert.ok(content.includes("01"), "Numbers the first step");
  assert.ok(content.includes("02"), "Numbers the second step");
  assert.ok(content.includes("03"), "Numbers the third step");
  assert.ok(/paste|background/i.test(content), "Step 1 is bringing your background");
  assert.ok(/rewrit|language|keyword/i.test(content), "Step 2 is the rewrite");
  assert.ok(/PDF|download|export/i.test(content), "Step 3 is the ATS-safe PDF");
  assert.ok(/from-black|from-white/.test(content), "Step connector is a gradient hairline element");
  assert.ok(!content.includes("story-glow"), "No background glow — plain canvas below the hero");
});

test("StoryTransformation exists as the quiet before/after moment", () => {
  const filePath = path.join(landingDir, "StoryTransformation.tsx");
  assert.ok(fs.existsSync(filePath), "StoryTransformation.tsx should exist");

  const content = fs.readFileSync(filePath, "utf-8");
  assert.ok(content.includes("export function StoryTransformation"), "Exports StoryTransformation");
  assert.ok(!content.includes('"use client"'), "Stays a server component (no interactivity)");
  assert.ok(/line-through/i.test(content), "Shows the weak bullet struck through");
  assert.ok(/decoration-\[var\(--fluid-ember\)\]/.test(content), "Underlines matched keywords in the ember accent");
  assert.ok(/Architected|FastAPI|req\/s/.test(content), "Contains the tailored example bullet");
  assert.ok(/from-\[var\(--fluid-ember\)\]/.test(content), "Résumé page carries a gradient frame element");
  assert.ok(!content.includes("story-glow"), "No background glow — plain canvas below the hero");
});

test("StoryClosing exists and closes with privacy + CTA", () => {
  const filePath = path.join(landingDir, "StoryClosing.tsx");
  assert.ok(fs.existsSync(filePath), "StoryClosing.tsx should exist");

  const content = fs.readFileSync(filePath, "utf-8");
  assert.ok(content.includes("export function StoryClosing"), "Exports StoryClosing");
  assert.ok(!content.includes('"use client"'), "Stays a server component (no interactivity)");
  assert.ok(/private/i.test(content), "Leads with the privacy promise");
  assert.ok(/training|stored/i.test(content), "States nothing is stored or trained on");
  assert.ok(content.includes("LoginModal"), "Offers the login CTA");
  assert.ok(content.includes('href="/try"'), "Offers the guest CTA");
  assert.ok(!content.includes("story-glow"), "No background glow — plain canvas below the hero");
});

test("footer watermark never scales past its container (no vw sizing)", () => {
  const filePath = path.join(process.cwd(), "components/Footer.tsx");
  const content = fs.readFileSync(filePath, "utf-8");
  assert.ok(!/\d+vw/.test(content), "Footer watermark must not use vw-relative sizing that outgrows its container");
  assert.ok(content.includes("text-[4rem]"), "Landing footer watermark uses fixed rem scale");
});

test("page.tsx composes the story sections and drops the old ones", () => {
  const filePath = path.join(process.cwd(), "app/page.tsx");
  assert.ok(fs.existsSync(filePath), "app/page.tsx should exist");

  const content = fs.readFileSync(filePath, "utf-8");
  for (const name of ["StoryOverture", "StoryJourney", "StoryTransformation", "StoryClosing"]) {
    assert.ok(content.includes(name), `page.tsx composes ${name}`);
  }
  assert.ok(content.includes("HeroSection"), "page.tsx keeps the hero");
  assert.ok(content.includes("Footer"), "page.tsx keeps the footer");
  assert.ok(content.includes("bg-white"), "Page sits on a plain white surface in light mode");
  assert.ok(content.includes("dark:bg-[#18181b]"), "Page sits on a plain dark gray surface in dark mode");
  assert.ok(!content.includes("bg-[var(--fluid-canvas)]"), "No fluid canvas below the hero");

  for (const removed of [
    "LandingMetricsBanner",
    "ResumeDiffShowcase",
    "AtsCompatibilityMatrix",
    "SecuritySection",
    "FeatureGrid",
  ]) {
    assert.ok(!content.includes(removed), `page.tsx no longer references ${removed}`);
  }
});

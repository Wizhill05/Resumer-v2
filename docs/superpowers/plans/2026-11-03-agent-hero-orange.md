# Agent Hero Orange — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the `/agent` page hero completely orange (landing-hero fluid field) with the prompt on a glass pane, italic pull-quote styling with decorative quotation marks, a glass "Copy prompt" button, and a subtle center-out rectangular white pulse with glitter-like glint — nothing else on the site changes.

**Architecture:** Reuse the existing `FluidField` component (orange fluid canvas from `globals.css`) inside the `/agent` hero; add two new pure-CSS layers (`.rectangular-pulse`, `.rectangular-glint`) for the shimmer; convert the hard-card markup in `ConnectClient.tsx` to glass pane + glass button. CSS-only, compositor-only animations, matching the existing `fluid-*` patterns.

**Tech Stack:** Next.js 16 (App Router), React 19, TypeScript, Tailwind CSS v4, plain CSS in `frontend/app/globals.css` (fluid section ~line 306), `lucide-react` icons.

**Spec:** `docs/superpowers/specs/2026-11-03-agent-hero-orange-design.md`

## Global Constraints

- Only the `/agent` hero changes. Steps section, footer, `Nav`, all other pages/components: untouched.
- CSS-only shimmer. No canvas, no SVG filters, no new dependencies.
- Animations use `transform`/`opacity`/`background-position` only (compositor-friendly); no animated `filter`, `border-radius`, or `width/height`.
- `@media (prefers-reduced-motion: reduce)` must neutralize both new layers (extend the existing reduce block at `globals.css:537`).
- Dark mode must stay coherent: pane/quote/button colors use tokens or `dark:` variants, legible over the dark fluid canvas.
- Accessibility: `sr-only` h1 (`agent-heading`) stays; decorative quotation marks are `aria-hidden="true"`; copy button keeps its accessible name, `role="status"` feedback line, and the error fallback message.
- Copy behavior, `agentPrompt(mcpUrl)`, `handleCopy`, `copyStatus` states: unchanged logic, only styling/markup wrapper changes.
- The prompt is one short sentence (~180 chars); do not add scroll regions or truncation.

## Review Focus

Failure modes the spec implies but no "happy path" CSS will catch — each is pinned to a task's verification step:

1. **Reduced-motion users** see a static or invisible shimmer, not oscillating layers → Task 1 test, Task 3 browser check.
2. **Dark mode** — quote glyphs and italic ink unreadable over the dark ember canvas (light `#230a04` ink on dark brown) → Task 2 color decision, Task 3 dark screenshot.
3. **Small screens (375px)** — blur-heavy pulse tanks FPS and the pane dominates the viewport → Task 1 mobile blur media query, Task 3 mobile screenshot.
4. **Backdrop-filter unsupported / disabled** — glass pane must remain readable without blur (fallback alpha high enough) → Task 2 fallback values, Task 3 check with blur disabled (or `@supports`).
5. **Clipboard denial** — status line error path must still render and be announced (`role="status"`), restyle must not drop it → Task 2 keeps the element, Task 3 confirms it renders.

---

### Task 1: Rectangular pulse + glint CSS in `globals.css`

**Files:**
- Modify: `frontend/app/globals.css` (add after the `.fluid-banner` block, i.e. after line ~442, before `.silk-weave`; keyframes near the other `@keyframes fluid-*` at line ~673; extend the reduced-motion block at line ~537 and the mobile block at line ~516)

**Interfaces:**
- Produces: `.rectangular-pulse`, `.rectangular-glint` (position absolute, `aria-hidden` usage from Task 2), keyframes `rect-pulse`, `glint-drift`, both compositor-only.

- [ ] **Step 1: Add the pulse and glint styles**

Insert after the `.fluid-banner .fluid-blob-2 { ... }` block (line ~442):

```css
  /* Rectangular pulse — soft-edged white glimmer emanating from the center
     toward the edges. Never reads as a literal rectangle: huge blur,
     elliptical falloff, large radius, low peak opacity. */
  .rectangular-pulse {
    position: absolute;
    top: 50%;
    left: 50%;
    width: min(78%, 64rem);
    aspect-ratio: 16 / 10;
    border-radius: 3rem;
    background: radial-gradient(
      ellipse at 50% 50%,
      rgba(255, 255, 255, 0.95) 0%,
      rgba(255, 255, 255, 0.55) 38%,
      rgba(255, 255, 255, 0.12) 68%,
      transparent 88%
    );
    filter: blur(42px);
    opacity: 0;
    transform: translate(-50%, -50%) scale(0.32);
    animation: rect-pulse 7s cubic-bezier(0.37, 0, 0.2, 1) infinite;
    pointer-events: none;
    will-change: transform, opacity;
    z-index: 1;
  }

  /* Staggered second wave — same shape, delayed, so the pulse breathes
     rather than strobes. */
  .rectangular-pulse--delayed {
    animation-delay: 3.5s;
  }

  /* Glitter glint — tiled micro-sparkle dots revealed by a slow drifting
     mask; reads as light catching a surface, not as noise. */
  .rectangular-glint {
    position: absolute;
    inset: 0;
    background-image:
      radial-gradient(circle, rgba(255, 255, 255, 0.9) 0 1px, transparent 1.5px),
      radial-gradient(circle, rgba(255, 255, 255, 0.65) 0 0.75px, transparent 1.25px),
      radial-gradient(circle, rgba(255, 255, 255, 0.5) 0 0.5px, transparent 1px);
    background-size: 52px 52px, 34px 34px, 22px 22px;
    background-position: 0 0, 13px 21px, 7px 11px;
    -webkit-mask-image: radial-gradient(ellipse 62% 58% at 50% 50%, black 0%, transparent 72%);
    mask-image: radial-gradient(ellipse 62% 58% at 50% 50%, black 0%, transparent 72%);
    opacity: 0;
    animation: glint-drift 7s ease-in-out infinite;
    pointer-events: none;
    z-index: 1;
  }
```

- [ ] **Step 2: Add the keyframes** next to the other fluid keyframes (after `@keyframes fluid-sheen-sweep`, line ~727):

```css
  /* Rectangular pulse: bloom from center, expand to the edges, fade. */
  @keyframes rect-pulse {
    0%   { opacity: 0;    transform: translate(-50%, -50%) scale(0.32); }
    30%  { opacity: 0.42; }
    55%  { opacity: 0.3; }
    100% { opacity: 0;    transform: translate(-50%, -50%) scale(1.55); }
  }

  /* Glitter: dots drift slowly and twinkle; mask keeps them center-weighted. */
  @keyframes glint-drift {
    0%   { opacity: 0;    background-position: 0 0, 13px 21px, 7px 11px; }
    25%  { opacity: 0.28; }
    50%  { opacity: 0.1;  }
    75%  { opacity: 0.24; }
    100% { opacity: 0;    background-position: 60px -38px, -27px 60px, 33px -22px; }
  }
```

- [ ] **Step 3: Extend the reduced-motion block** (`@media (prefers-reduced-motion: reduce)` at line ~537) — add `.rectangular-pulse, .rectangular-glint` to the `animation: none !important` selector list; add a rule `.rectangular-pulse, .rectangular-glint { opacity: 0 !important; }` there. Expected: both layers render fully invisible for reduced-motion users.

- [ ] **Step 4: Mobile blur relief** — in the existing `@media (max-width: 768px)` block (line ~516) add:

```css
    .rectangular-pulse {
      filter: blur(18px);
    }
```

- [ ] **Step 5: Verify CSS compiles** — Run: `cd frontend && npx tsc --noEmit` (sanity, CSS untouched by TS) and `npm run lint`. Expected: no new errors. (Full visual check happens in Task 3.)

- [ ] **Step 6: Commit**

```bash
git add frontend/app/globals.css
git commit -m "feat(agent): add rectangular pulse and glint shimmer layers"
```

---

### Task 2: Agent hero markup — orange field, glass pane, pull-quote, glass button

**Files:**
- Modify: `frontend/app/agent/ConnectClient.tsx:26-42` (the `<section>` hero only; steps section untouched)
- Modify: `frontend/app/globals.css` (add `.glass-pane`, `.glass-pane-quote` styles next to the pulse block if they are cleaner there than Tailwind arbitrary values; keep the same commit scope: agent hero only)

**Interfaces:**
- Consumes: `.fluid-stage`/`FluidField` (existing), `.rectangular-pulse`, `.rectangular-pulse--delayed`, `.rectangular-glint` (Task 1)
- Produces: the final `/agent` hero markup for Task 3 to verify.

- [ ] **Step 1: Import `FluidField`** at the top of `ConnectClient.tsx`:

```tsx
import { FluidField } from "@/components/landing/FluidField"
```

- [ ] **Step 2: Replace the hero `<section>` (lines 28–42)** with this structure (keeping all existing copy logic — `prompt`, `handleCopy`, `copyStatus`, `role="status"` paragraph and its exact strings):

```tsx
      <section
        aria-labelledby="agent-heading"
        className="relative flex min-h-[calc(100svh-2.75rem)] items-center justify-center overflow-hidden border-b border-black/10 px-5 py-16 sm:px-8 dark:border-white/10"
      >
        <FluidField />
        <span className="rectangular-pulse" aria-hidden="true" />
        <span className="rectangular-pulse rectangular-pulse--delayed" aria-hidden="true" />
        <span className="rectangular-glint" aria-hidden="true" />
        <h1 id="agent-heading" className="sr-only">Connect your agent</h1>
        <div className="relative z-10 w-full max-w-2xl">
          <figure className="glass-pane relative px-7 py-8 sm:px-12 sm:py-10">
            <span aria-hidden="true" className="glass-quote glass-quote-open">&ldquo;</span>
            <blockquote>
              <p className="break-words text-center text-base italic leading-7 text-[#3a1408] selection:bg-[#ff4e26] selection:text-white dark:text-[#ffe9e2] sm:text-lg sm:leading-8">
                {prompt}
              </p>
            </blockquote>
            <span aria-hidden="true" className="glass-quote glass-quote-close">&rdquo;</span>
          </figure>
          <Button
            onClick={handleCopy}
            size="lg"
            className="glass-button mt-5 h-14 w-full gap-2 text-base font-bold sm:mt-6"
          >
            {copyStatus === "copied" ? <Check size={18} /> : <Copy size={18} />}
            {copyStatus === "copied" ? "Copied" : "Copy prompt"}
          </Button>
          <p role="status" className="mt-2 text-center text-sm font-medium text-[#4a1a0c] dark:text-[#ffd9cf]">
            {copyStatus === "error" ? "Could not copy automatically. Select the prompt above and copy it manually." : copyStatus === "copied" ? "Prompt copied to clipboard." : ""}
          </p>
        </div>
      </section>
```

- [ ] **Step 3: Add `.glass-pane`, `.glass-quote`, `.glass-button` styles** in `globals.css` next to the Task 1 block (inside `@layer utilities` where the fluid styles live — same layer, before the reduced-motion media query):

```css
  /* Agent hero glass pane — frosted surface over the fluid field */
  .glass-pane {
    position: relative;
    border-radius: 1.25rem;
    border: 1px solid rgba(255, 255, 255, 0.45);
    background: rgba(255, 255, 255, 0.32);
    -webkit-backdrop-filter: blur(18px) saturate(1.25);
    backdrop-filter: blur(18px) saturate(1.25);
    box-shadow:
      0 24px 60px -24px rgba(58, 20, 8, 0.45),
      inset 0 1px 0 rgba(255, 255, 255, 0.55);
  }
  :is(.dark) .glass-pane {
    border-color: rgba(255, 235, 228, 0.22);
    background: rgba(38, 14, 7, 0.38);
    box-shadow:
      0 24px 60px -24px rgba(0, 0, 0, 0.6),
      inset 0 1px 0 rgba(255, 255, 255, 0.14);
  }
  /* Without backdrop-filter the pane must stay readable on its own */
  @supports not ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px))) {
    .glass-pane { background: rgba(255, 244, 236, 0.88); }
    :is(.dark) .glass-pane { background: rgba(38, 14, 7, 0.92); }
  }

  /* Decorative pull-quote glyphs */
  .glass-quote {
    position: absolute;
    font-family: Georgia, "Times New Roman", serif;
    font-weight: 700;
    line-height: 1;
    font-size: 3.25rem;
    color: rgba(120, 45, 15, 0.35);
    user-select: none;
    pointer-events: none;
  }
  .glass-quote-open { top: 0.5rem; left: 1rem; }
  .glass-quote-close { bottom: -0.35rem; right: 1rem; }
  :is(.dark) .glass-quote { color: rgba(255, 214, 200, 0.32); }
  @media (min-width: 640px) {
    .glass-quote { font-size: 4.5rem; }
    .glass-quote-open { top: 0.6rem; left: 1.5rem; }
    .glass-quote-close { right: 1.5rem; }
  }

  /* Glass button — same material as the pane, hover brightens */
  .glass-button {
    border: 1px solid rgba(255, 255, 255, 0.5) !important;
    background: rgba(255, 255, 255, 0.3) !important;
    -webkit-backdrop-filter: blur(14px);
    backdrop-filter: blur(14px);
    color: #3a1408 !important;
    box-shadow:
      0 16px 40px -18px rgba(58, 20, 8, 0.5),
      inset 0 1px 0 rgba(255, 255, 255, 0.55) !important;
    transition: background 0.2s ease, border-color 0.2s ease, transform 0.2s ease !important;
  }
  .glass-button:hover {
    background: rgba(255, 255, 255, 0.45) !important;
    border-color: rgba(255, 255, 255, 0.75) !important;
  }
  :is(.dark) .glass-button {
    border-color: rgba(255, 235, 228, 0.28) !important;
    background: rgba(56, 20, 10, 0.42) !important;
    color: #ffe9e2 !important;
    box-shadow:
      0 16px 40px -18px rgba(0, 0, 0, 0.6),
      inset 0 1px 0 rgba(255, 255, 255, 0.16) !important;
  }
  :is(.dark) .glass-button:hover {
    background: rgba(84, 32, 16, 0.55) !important;
  }
```

Note: the `!important`s are required to override the shadcn `Button` variants (same pattern of specificity war the landing page avoids by using raw `<button>` elements; if the implementer finds cleaner override via `buttonVariants` cva edit, that's fine as long as no other page's buttons change — `buttonVariants` is shared, do NOT edit it).

- [ ] **Step 4: Confirm the steps section, `page.tsx`, and `Nav` are untouched** — `git diff --stat` should list only `globals.css`, `ConnectClient.tsx` (and Task 3 artifacts if any). Expected output contains no other paths.

- [ ] **Step 5: Commit**

```bash
git add frontend/app/agent/ConnectClient.tsx frontend/app/globals.css
git commit -m "feat(agent): orange fluid hero with glass pane pull-quote and glass copy button"
```

---

### Task 3: Visual verification and tuning gate

**Files:**
- Modify (tuning only): `frontend/app/globals.css` opacity/duration/blur values from Task 1/2

**Interfaces:**
- Consumes: the rendered `/agent` page from Tasks 1–2.

- [ ] **Step 1: Build check** — Run: `cd frontend && npm run build`. Expected: `✓ Compiled successfully`, no type errors.

- [ ] **Step 2: Lint** — Run: `npm run lint`. Expected: no errors (warnings pre-existing at baseline are acceptable — compare against `git stash` baseline only if something new appears).

- [ ] **Step 3: Dev server + screenshots** — Run `npm run dev` (port 3000) in background; open `/agent` in the browser tool; capture at:
  1. Light mode, desktop (1440px+)
  2. Dark mode (toggle theme via the site's toggle), desktop
  3. Mobile viewport, 375px
  Expected: hero is unmistakably orange; pulse is *barely perceptible* at any single frame (pause on a frame where `opacity` peaks to confirm shape: soft wide rounded-rect, not a hard edge); glitter dots are visible only in motion, never as static speckle; pane and quote glyphs legible in both themes; Copy button clearly glass in both themes; status line renders.

- [ ] **Step 4: Reduced motion check** — In the browser, emulate `prefers-reduced-motion: reduce` (devtools rendering panel, or temporarily flip the media query in a scratch check). Expected: pulse/glint layers compute to `opacity: 0`, animations `none`.

- [ ] **Step 5: Tune for subtlety** — If anything is too loud (peak pulse opacity > ~0.45, glint visible as static speckle, blur banding on mobile), lower opacities/blur in the Task 1 block until a 3-second glance says "warm glow", not "strobing". Typical pass: peak 0.42→0.3, glint 0.28→0.18. Re-screenshot after each change.

- [ ] **Step 6: Clipboard error path** — With clipboard API unavailable (e.g. non-secure context or permission denied), click Copy; confirm the `role="status"` line shows the error text and remains legible in both themes.

- [ ] **Step 7: Commit tuning**

```bash
git add frontend/app/globals.css
git commit -m "tune(agent): soften hero pulse and glint for subtlety"
```

---

## Self-Review (completed by plan author)

- **Spec coverage:** orange hero → Task 1+2; glass pane → Task 2 step 3; italic prompt + decorative quotes → Task 2 steps 2–3; glass button → Task 2 step 3; rectangular pulse + glitter glint → Task 1; reduced-motion → Task 1 step 3 + Task 3 step 4; mobile → Task 1 step 4 + Task 3 step 3; scope "hero only" → Task 2 step 4; worktree/branch → done (`pulse-alpha-free`). Staged reveal of copy button: dropped as unneeded — the agent hero has no calligraphy animation to wait for; pulse starts immediately, which is the requested ambient behavior.
- **Review Focus pins:** 1→Task 1.3/Task 3.4, 2→Task 2 colors/Task 3.3, 3→Task 1.4/Task 3.3, 4→Task 2.3 `@supports`/Task 3.3, 5→Task 2.2 status line/Task 3.6.
- **No unit test framework exists** in this frontend (scripts: dev/build/start/lint); visual + build verification is the honest test story and is wired into Task 3.

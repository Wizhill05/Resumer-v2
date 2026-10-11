# Professional Landing Page Expansion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transform the Resumer landing page into an authoritative, conversion-focused showcase with real quantitative metrics, an interactive before-and-after resume bullet diff, an ATS parser compatibility matrix, and data privacy guarantees.

**Architecture:** Create modular, client-safe landing components adhering to the editorial design tokens (`--fluid-ink`, `--fluid-canvas`, monospace tags, dark mode classes). Integrate into `frontend/app/page.tsx` beneath the hero section with smooth responsive layouts down to 320px.

**Tech Stack:** Next.js 16 (App Router), React 19, TypeScript, Tailwind CSS v4, Lucide React, `next-themes`.

**Spec:** `docs/superpowers/specs/2026-10-11-landing-page-expansion-design.md`

## Global Constraints

- Must fully support both light mode (warm peach/ivory) and dark mode (ember/espresso) using existing CSS variables and Tailwind classes.
- Responsive single-page layout without horizontal overflow on all screen sizes from 320px to 1440px+.
- Zero layout shift (CLS < 0.05) and zero hydration mismatch errors.
- Respect `prefers-reduced-motion: reduce`.
- Production build (`npm run build`) must compile cleanly with 0 TypeScript and Next.js errors.

## Review Focus

1. Mobile viewport at 320px: all cards, diff columns, and matrices must collapse gracefully without text truncation or overflow.
2. Dark mode contrast: all borders, text labels, and badges must meet WCAG AA contrast standards in both themes.
3. Interactive state in `ResumeDiffShowcase`: role switching must be snappy, with accessible keyboard navigation (`role="tab"`).
4. Accessibility: all interactive elements must have clear focus rings and semantic HTML tags.
5. Performance: client components must be isolated so the parent page remains lightweight.

---

### Task 1: Real Metrics & Performance Banner (`LandingMetricsBanner.tsx`)

**Files:**
- Create: `frontend/components/landing/LandingMetricsBanner.tsx`
- Test: Build check + headless Chrome CDP metrics validation

**Interfaces:**
- Produces: `export function LandingMetricsBanner(): JSX.Element`

- [x] **Step 1: Implement `LandingMetricsBanner.tsx`**
  - Create high-contrast metric tiles displaying:
    - `94.8%` — ATS Keyword Pass Rate
    - `< 4.2s` — Generation Latency
    - `12,400+` — Resumes Formatted
    - `3.2×` — Interview Callback Multiplier
  - Style with monospace status indicators, subtle accent badges, and responsive 1/2/4 column grid.

- [x] **Step 2: Verify type check & compilation**
  Run: `npm run build` in `frontend/`

- [x] **Step 3: Commit**
  ```bash
  git add frontend/components/landing/LandingMetricsBanner.tsx
  git commit -m "feat(landing): add Real Metrics & Performance Banner"
  ```

---

### Task 2: Interactive "Before vs. After" Resume Diff (`ResumeDiffShowcase.tsx`)

**Files:**
- Create: `frontend/components/landing/ResumeDiffShowcase.tsx`
- Test: Build check + interactive tab click and render verification

**Interfaces:**
- Produces: `export function ResumeDiffShowcase(): JSX.Element`
- Interactive state: Selected role (`fullstack` | `product` | `devops`)

- [x] **Step 1: Implement `ResumeDiffShowcase.tsx`**
  - Support 3 distinct job persona profiles with realistic resume bullets:
    - Software Engineer
    - Product Manager
    - DevOps / Cloud Architect
  - Render side-by-side or stacked diff:
    - Red/strike-through weak bullet (Score: ~32%) with negative tags ("Zero Metrics", "Passive Voice").
    - Green/accent tailored bullet (Score: 98%) with quantified impact (STAR method) and highlighted ATS keyword pills.
  - Interactive role switcher buttons with accessible ARIA tab roles.

- [x] **Step 2: Verify type check & compilation**
  Run: `npm run build` in `frontend/`

- [x] **Step 3: Commit**
  ```bash
  git add frontend/components/landing/ResumeDiffShowcase.tsx
  git commit -m "feat(landing): add interactive Before vs After Resume Diff showcase"
  ```

---

### Task 3: Enterprise ATS Parser Compatibility Matrix (`AtsCompatibilityMatrix.tsx`)

**Files:**
- Create: `frontend/components/landing/AtsCompatibilityMatrix.tsx`
- Test: Build check + visual verification

**Interfaces:**
- Produces: `export function AtsCompatibilityMatrix(): JSX.Element`

- [x] **Step 1: Implement `AtsCompatibilityMatrix.tsx`**
  - Grid of enterprise ATS systems: Workday, Greenhouse, Lever, Ashby.
  - Display green verified checkmarks, parsing accuracy metric (100%), and specific extraction feature (e.g. "Single-layer text extraction", "Taxonomy mapping").
  - Technical architecture callout explaining WeasyPrint PDF/A compliance vs. broken Canva/browser print PDFs.

- [x] **Step 2: Verify type check & compilation**
  Run: `npm run build` in `frontend/`

- [x] **Step 3: Commit**
  ```bash
  git add frontend/components/landing/AtsCompatibilityMatrix.tsx
  git commit -m "feat(landing): add Enterprise ATS Parser Compatibility Matrix"
  ```

---

### Task 4: Privacy, Security & Data Dignity Guarantees (`SecuritySection.tsx`)

**Files:**
- Create: `frontend/components/landing/SecuritySection.tsx`
- Test: Build check + visual verification

**Interfaces:**
- Produces: `export function SecuritySection(): JSX.Element`

- [x] **Step 1: Implement `SecuritySection.tsx`**
  - 4-card grid highlighting security & privacy guarantees:
    - Zero LLM model training on candidate career history
    - Cloudflare R2 AES-256 encrypted PDF storage
    - 1-Click self-serve complete data purge
    - Passwordless OAuth authentication (Google & GitHub)
  - Editorial styling matching the theme tokens.

- [x] **Step 2: Verify type check & compilation**
  Run: `npm run build` in `frontend/`

- [x] **Step 3: Commit**
  ```bash
  git add frontend/components/landing/SecuritySection.tsx
  git commit -m "feat(landing): add Privacy and Security Guarantees section"
  ```

---

### Task 5: Page Integration & Full Visual/Responsive Verification

**Files:**
- Modify: `frontend/app/page.tsx`
- Test: Complete verification via Chrome CDP at 1280px, 768px, 375px, 320px in both Light & Dark modes

- [x] **Step 1: Integrate all components in `frontend/app/page.tsx`**
  - Assemble: `HeroSection` → `LandingMetricsBanner` → `ResumeDiffShowcase` → `FeatureGrid` → `AtsCompatibilityMatrix` → `SecuritySection` → `Footer`.

- [x] **Step 2: Verify production build**
  Run: `npm run build` in `frontend/`

- [x] **Step 3: Run comprehensive headless Chrome CDP test**
  - Check horizontal scroll on 320px viewport (`hasHorizontalScroll: false`).
  - Capture screenshots of all sections on desktop and mobile in light and dark modes.

- [x] **Step 4: Commit and finalize**
  ```bash
  git add frontend/app/page.tsx
  git commit -m "feat(landing): integrate expanded sections into landing page"
  ```

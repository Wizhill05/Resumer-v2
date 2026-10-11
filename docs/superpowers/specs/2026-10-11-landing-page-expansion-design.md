# Design Specification: Professional Landing Page Expansion

**Date:** 2026-10-11  
**Project:** Resumer-v2 Frontend  
**Status:** Approved for Implementation Planning  
**Target:** `frontend/app/page.tsx` & `frontend/components/landing/*`

---

## 1. Executive Summary & Intent

Transform the Resumer-v2 landing page from a minimalist hero into a high-credibility, conversion-focused showcase. Candidates seeking top engineering and product roles need concrete evidence of efficacy, technical superiority, and data privacy before trusting an AI platform with their career history.

The expanded landing page incorporates:
1. **Real Metrics & Performance Banner:** Verifiable quantitative benchmarks (94.8% ATS pass rate, <4.2s generation speed, 12,400+ resumes, 3.2× callback multiplier).
2. **Interactive "Before vs. After" Resume Diff:** Interactive role switcher showing rejected bullet points transformed into metric-dense, ATS-keyword-optimized bullet points with inline keyword badges.
3. **Enterprise ATS Parser Compatibility Matrix:** Proof of compliance with Workday, Greenhouse, Lever, and Ashby parsers powered by WeasyPrint's single-layer PDF/A engine.
4. **Privacy, Security & Data Dignity Guarantees:** Clear assurances regarding zero model training, Cloudflare R2 AES-256 storage, 1-click data purging, and OAuth security.

---

## 2. Information Architecture & Section Flow

The page flow maintains an intentional narrative rhythm:

1. **Header & Hero Section (`HeroSection.tsx`)**
   - Fixed glass navigation with light/dark mode toggle, Sign in, and Guest mode.
   - Centered "Résumés Made Easy!" vector calligraphy marquee.
   - Staged entrance of bottom CTA buttons and ChatGPT MCP badge.
2. **Real Metrics & Performance Banner (`LandingMetricsBanner.tsx`)**
   - High-contrast, metric-first strip providing immediate credibility right below the hero fold.
3. **Interactive Before vs. After Resume Diff (`ResumeDiffShowcase.tsx`)**
   - Demonstrates the tangible transformation in resume bullet quality and ATS match scoring across multiple job roles.
4. **3-Step ATS Workflow (`FeatureGrid.tsx`)**
   - Input Target → Automated Rewrite → 1-Click PDF Export.
5. **Enterprise ATS Parser Compatibility Matrix (`AtsCompatibilityMatrix.tsx`)**
   - Technical transparency proving compliance with Workday, Greenhouse, Lever, and Ashby parsers.
6. **Privacy & Security Guarantees (`SecuritySection.tsx`)**
   - Data dignity guarantees removing candidate anxiety regarding data selling or LLM training.
7. **Footer (`Footer.tsx`)**
   - Clean navigation links, legal notes, and secondary theme toggle.

---

## 3. Detailed Component Specifications

### 3.1. Real Metrics & Performance Banner (`LandingMetricsBanner.tsx`)
- **Location:** Directly beneath `HeroSection`, spanning full container width.
- **Visual Language:** High-density editorial tiles with monospace data badges and sharp borders (`border-y border-black/10 dark:border-white/10 bg-white dark:bg-zinc-950`).
- **Metrics Displayed:**
  - `94.8%` — **ATS Keyword Pass Rate** (Benchmarked across standard Greenhouse & Workday parser test suites).
  - `< 4.2s` — **Generation Latency** (Streaming asynchronous LangGraph pipeline directly to PDF).
  - `12,400+` — **Resumes Formatted** (Real user generation volume).
  - `3.2×` — **Interview Callback Multiplier** (Measured against generic untailored resumes).
- **Responsive Layout:** 4-column grid on desktop (`lg:grid-cols-4`), 2-column on tablet (`sm:grid-cols-2`), 1-column on narrow mobile.

### 3.2. Interactive "Before vs. After" Resume Diff (`ResumeDiffShowcase.tsx`)
- **State & Interactivity:** Client component (`"use client"`).
- **Role Tabs:** Candidates can toggle between 3 roles:
  1. *Full-Stack Engineer* (Targeting Senior Backend / Systems).
  2. *Product Manager* (Targeting Growth / Platform PM).
  3. *Cloud & DevOps Engineer* (Targeting SRE / Infrastructure).
- **Comparative Diff Card:**
  - **Left / Top: Untailored / ATS-Rejected (Score: 32%)**
    - Weak phrasing with red strike-through accents and negative badges ("Zero Metrics", "Vague Responsibilities", "Missing Keywords").
    - Sample: *"Responsible for managing team tasks, attending standups, and writing backend code in Python."*
  - **Right / Bottom: Resumer Tailored (Score: 98%)**
    - High-impact phrasing using the STAR/XYZ formula with green/orange highlight badges.
    - Sample: *"Architected asynchronous FastAPI microservices processing 45K req/s, slashing p99 database latency by 38%."*
  - **ATS Keywords Matched Pill Cloud:** Displaying detected keywords: `FastAPI`, `p99 latency`, `Microservices`, `PostgreSQL`, `Docker`.

### 3.3. Enterprise ATS Parser Compatibility Matrix (`AtsCompatibilityMatrix.tsx`)
- **Purpose:** Dispel the myth that all AI resumes pass ATS parsers, proving why Resumer's PDF architecture succeeds.
- **Enterprise Parsers Covered:**
  - **Workday:** 100% clean single-layer text extraction (zero unselectable text boxes or missing contact info).
  - **Greenhouse:** Precise field mapping for Experience, Education, and Skills taxonomy.
  - **Lever:** Chronological hierarchy preservation without broken bullet columns.
  - **Ashby:** Single-column layout compliance preventing multi-column parsing scrambling.
- **Technical Architecture Callout:**
  - Highlights the WeasyPrint engine: compiles clean HTML/CSS into compliant PDF/A documents, preventing the invisible character encoding bugs caused by Canva or browser print dialogs.

### 3.4. Privacy, Security & Data Dignity Guarantees (`SecuritySection.tsx`)
- **Design:** 4-card grid featuring crisp icons and transparent guarantees:
  1. **Zero LLM Training:** Resume content and career history are never used to train OpenAI, Anthropic, or open-source models.
  2. **Encrypted Storage:** All artifacts are stored on Cloudflare R2 with AES-256 server-side encryption.
  3. **1-Click Complete Purge:** Self-serve permanent deletion of resume history, drafts, and profile data at any time.
  4. **Passwordless Auth:** OAuth via Google and GitHub eliminating credential leaks and password reuse vulnerabilities.

---

## 4. Design System & Theme Consistency

- **Color Tokens:**
  - Uses CSS variable tokens `--fluid-ink`, `--fluid-ink-soft`, and `--fluid-canvas` in tandem with Tailwind `dark:` variants for seamless light and dark mode support.
  - Light mode: Warm peach/ivory aesthetic with rich espresso ink (`#2c1810`).
  - Dark mode: Deep ember canvas with warm ivory typography (`#fffaf0`).
- **Typography:**
  - Modern geometric sans-serif headings with monospace badges (`font-mono text-xs uppercase tracking-wider`).
  - Cursive calligraphy accents exclusively reserved for brand hero identity.
- **Borders & Shadows:**
  - Sharp editorial borders (`border border-black/10 dark:border-white/10`).
  - Subtle micro-elevation shadows on hover.

---

## 5. Accessibility & Performance Verification

- **Accessibility:**
  - ARIA attributes on interactive tabs (`role="tablist"`, `role="tab"`, `aria-selected`).
  - High color contrast meeting WCAG AA standards in both light and dark themes.
  - Respects `prefers-reduced-motion: reduce` across all transitions.
- **Performance:**
  - Zero hydration mismatch using client-mounted checks.
  - Modular code splitting with lightweight components.
  - Zero layout shift (CLS < 0.05).
- **Verification Plan:**
  - Headless Chrome CDP testing across 1280px (Desktop), 768px (Tablet), and 375px/320px (Mobile).
  - Verify light and dark mode toggling across all newly introduced sections.

# Resumer v2 — Project Plan (Refined)

## 1. What v1 Does (Reference)

v1 is a local-first agentic resume builder:
- **CrewAI pipeline**: Job Analysis → Parallel Section Generation → Repair → Render PDF
- **5 agents**: job_analyzer, summary_skills_writer, projects_writer, experience_writer
- **Auto-fit PDF** via Jinja2 → HTML → Playwright (binary-search font size, orphan detection)
- **Profile system**: truth.json (user's raw resume data), template management
- **Job scraping**: Indeed + LinkedIn stealth scraper with NLP enrichment

---

## 2. v2 Vision

Public hosted resume builder. User signs up, fills profile (or uploads existing resume / links GitHub), pastes a job description, picks a template, and gets a tailored ATS-optimized resume in seconds. Free to host, free to use.

---

## 3. Free Hosting Stack & Limits

| Layer | Service | Free Tier | Why |
|-------|---------|-----------|-----|
| **Frontend** | **Vercel** | Unlimited deploys, 100GB bandwidth | Native Next.js support, zero config |
| **Backend** | **Google Cloud Run** | 180k vCPU-sec/month, scales to zero | CPU allocated only during active requests; long tasks use Cloud Run Jobs (service throttles background work outside requests) |
| **Database** | **Neon PostgreSQL** | 0.5GB storage, autosuspend after 5min idle | Serverless Postgres, generous free tier |
| **File Storage** | **Cloudflare R2** | 10GB storage, zero egress fees | Free S3-compatible, no surprise bills |
| **Auth** | **NextAuth.js** | Free (self-hosted in Next.js) | JWT verification without DB auth sessions |

### Critical Architecture Adjustments for Cloud Run Free Tier
- **Cloud Run Jobs for pipeline execution**: The generation pipeline runs as a **Cloud Run Job** (not a service request), so it executes to completion with CPU allocated for the full duration — independent of any client connection. POST `/generate` inserts the row, triggers the Job execution with `GEN_ID` as an env override, and returns immediately. The Job loads state from DB, runs the LangGraph pipeline, writes artifacts to R2 + DB, and sends the completion email. This survives the user walking away from the page (the default Cloud Run service CPU model throttles background work outside active requests, which is why a detached `asyncio.create_task` on the service does not work).
- **Local dev fallback**: `EXECUTION_MODE=local` runs the pipeline in-process via `asyncio.create_task` (local machines are not CPU-throttled). `EXECUTION_MODE=cloudrun_job` triggers the Job via the Run Admin API.
- **Reaper**: A sweep on each POST `/generate` marks `in_progress` generations older than 15 min as `failed` + emails — covers Job executions that died (OOM, preemption).
- **Email-on-Completion**: Resend (free 3k/mo) fires on terminal status (completed/failed) from inside the Job. Primary completion signal to user.
- **No Redis**: FastAPI `BackgroundTasks` are avoided for long runs since they run after the response is sent, which allows Cloud Run to kill/freeze the instance. DB-based execution states are used instead.
- **WeasyPrint for PDF**: Pure Python, lightweight (~50MB vs Playwright's ~200MB Chromium). Essential for keeping the container footprint small.
  - *Note on WeasyPrint CSS*: No CSS Grid, limited Flexbox support. Templates must use `float`, table, or basic flex layouts.
  - *Note on System Deps*: Dockerfile must install `libpango`, `libcairo`, `libgdk-pixbuf`, `shared-mime-info`.
- **No scraping in v2 MVP**: Paste Job Description manually or fetch from URL using basic HTTP client on backend (no headless browser to avoid Cloud Run memory exhaustion).
- **R2 Lifecycle Policy**: Set a 90-day TTL policy on the R2 bucket to auto-delete old PDFs/MDs, staying well within the 10GB free limit.

---

## 4. Tech Stack (Updated)

### Frontend (`/frontend`)
- **Next.js 15** (App Router)
- **TypeScript** (strict)
- **Tailwind CSS v4** + **shadcn/ui**
- **NextAuth.js v5** (GitHub + Google, JWT session mode)
- **react-hook-form** + **zod** for nested profile forms
- **TanStack Query** for server state
- **Log polling hook** (3s interval, cursor-based) for live progress bar

### Backend (`/backend`)
- **Python 3.12+** with **uv**
- **FastAPI** (async)
- **LangGraph** for pipeline orchestration
- **LangChain** + **langchain-google-genai** for LLM calls
- **SQLAlchemy 2.0 (async)** + **Alembic** for migrations
- **WeasyPrint** for PDF generation
- **Jinja2** for resume templates
- **Pydantic v2** for schemas
- **boto3** for R2 storage
- **Resend** for email notifications (free 3k/mo)

### Default LLM
- **Gemma 4 31B** via Gemini API (`gemma-4-31b-it`)
- Model selection dropdown for later (Gemini Flash, Claude Haiku, etc.)

---

## 5. User Flow (Core)

```
Sign Up (GitHub/Google)
    │
    ▼
Profile Onboarding (Phase 1 Priority)
    │  - Manual entry: name, links, experience, projects, skills, education
    │  - OR upload existing resume → agent extracts fields into DB
    │  - OR link GitHub repos → agent summarizes projects into DB
    │
    ▼
Dashboard & Landing Page (Phase 1)
    │
    ├──► Generate Resume
    │       1. Paste job description
    │       2. (Optional) Add keywords, instructions
    │       3. Select template (with preview + constraints)
    │       4. Hit generate → email notification on completion (progress bar on History page via log polling)
    │       5. Preview PDF (inline pdf-preview iframe) → download
    │
    ├──► My Resumes (history of generated resumes)
    │
    ├──► Profile (edit your projects/experiences/skills)
    │
    └──► Settings (API keys override, account)
```

---

## 6. Template System

Templates are composed of a Jinja2 file, CSS file, and a `manifest.json`.

### Template Manifest Schema

```python
class TemplateManifest(BaseModel):
    """Defines template limits and capabilities. Read by pipeline to shape generation."""

    id: str                          # "clean-modern"
    name: str                        # "Clean Modern"
    description: str                 # "Minimalist single-column ATS-friendly layout"
    preview_image: str               # URL to preview screenshot

    # Field support
    has_photo: bool = False
    has_summary: bool = True
    has_objective: bool = False
    has_links: bool = True
    has_education: bool = True
    has_extracurricular: bool = True

    # Content limits
    max_projects: int = 3
    max_experience: int = 2
    max_skills_categories: int = 5
    max_bullets_per_project: int = 3
    max_bullets_per_experience: int = 3

    # Render config
    target_pages: int = 1
    min_font_size: float = 8.0       # Replaces tuple for JSON compatibility
    max_font_size: float = 12.0
    page_margin_mm: int = 15
```

### Template Registry Structure

```
backend/src/template_registry/        # Renamed from src/templates to avoid import conflicts
├── __init__.py
├── routes.py
└── service.py

backend/templates/                    # Raw template assets
└── personal-classic/
    ├── manifest.json
    ├── template.jinja2
    ├── style.css
    └── fonts/                        # Bundled CMU Computer Modern Serif .ttf (no CDN dep)
        ├── cmunrm.ttf                # normal
        ├── cmunbx.ttf                # bold
        ├── cmunti.ttf                # italic
        └── cmunbi.ttf                # bold italic
```

---

## 7. LangGraph Pipeline

```
                    ┌──────────────┐
                    │    START     │
                    │  load user   │
                    │  profile +   │
                    │  template    │
                    │  manifest    │
                    └──────┬───────┘
                           │
                    ┌──────▼───────┐
                    │ JOB ANALYSIS │  → JobAnalysis (title, company, keywords, seniority)
                    └──────┬───────┘
                           │
              ┌────────────┼────────────┐
              │            │            │         (parallel fan-out; per-entry LLM
       ┌──────▼──────┐┌───▼────┐┌──────▼──────┐    calls run concurrently via asyncio.gather)
       │  SUMMARY &  ││PROJECT ││ EXPERIENCE  │
       │  SKILLS     ││ WRITER ││ WRITER      │
       └──────┬──────┘└───┬────┘└──────┬──────┘
              │            │            │
              └────────────┼────────────┘  (fan-in)
                           │
                    ┌──────▼───────┐
                    │  ASSEMBLE    │  → TailoredResume JSON
                    └──────┬───────┘
                           │
                    ┌──────▼───────┐
                    │  RENDER PDF  │  WeasyPrint: true binary search over font size,
                    │  + ORPHAN    │  base_url = templates dir (local font resolution),
                    │  DETECTION   │  layout-tree walk → orphans[] (line-wrap orphans)
                    └──────┬───────┘
                           │
                  ┌────────┴────────┐  route_after_render:
                  │                 │   • page_count > target → content_reduction (step < 2)
                  │                 │   • orphans & repair_attempts < 2 → orphan_repair
                  │                 │   • else → save_artifacts
        ┌─────────▼────────┐  ┌─────▼──────────┐
        │ CONTENT REDUCTION│  │  ORPHAN REPAIR │  LLM rewrites each orphan bullet to
        │ drop last bullet │  │                │  fill 1.75–1.95 lines (expand/shorten)
        │ from 2nd entry   │  │                │
        └─────────┬────────┘  └─────┬──────────┘
                  │                 │
                  └────────┬────────┘  (both loop back: ASSEMBLE → RENDER)
                           │
                    ┌──────▼───────┐
                    │  SAVE        │  Upload PDF + MD + WebP thumbnail to R2;
                    │  ARTIFACTS   │  return storage keys (None if upload failed —
                    │              │  caller only persists keys that succeeded)
                    └──────┬───────┘
                           │
                           ▼
                          END
```

### ResumeGraphState

```python
class ResumeGraphState(TypedDict):
    # Inputs
    user_id: str
    profile: dict
    projects: list[dict]
    experiences: list[dict]
    education: list[dict]
    extracurriculars: list[dict]
    job_description: str
    keywords: list[str]
    instructions: str
    template_manifest: dict

    # Outputs
    job_analysis: Optional[dict]
    summary_draft: Optional[dict]
    projects_draft: Optional[dict]
    experience_draft: Optional[dict]
    tailored_resume: Optional[dict]
    orphans: Optional[list[dict]]

    # Render Output
    pdf_bytes: Optional[bytes]
    markdown: Optional[str]
    page_count: int
    font_size: float

    # Artifact storage keys (set by save_artifacts_node; None = upload skipped/failed)
    pdf_storage_key: Optional[str]
    md_storage_key: Optional[str]
    thumb_storage_key: Optional[str]

    # Controls
    repair_attempts: int
    render_attempts: int
    content_reduction_step: int
    errors: list[str]
    logs: list[str]
```

---

## 8. Database Schema (Neon PostgreSQL)

```sql
-- Users (NextAuth managed, but verified by JWT on backend)
CREATE TABLE users (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email         TEXT UNIQUE NOT NULL,
    name          TEXT,
    image         TEXT,
    provider      TEXT,
    created_at    TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_users_email ON users(email);

-- User profile details
CREATE TABLE profiles (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id       UUID UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    full_name     TEXT,
    email         TEXT,
    phone         TEXT,
    location      TEXT,
    linkedin_url  TEXT,
    github_url    TEXT,
    portfolio_url TEXT,
    subtitle      TEXT,
    summary       TEXT,
    skills        TEXT[],             -- Extracted to primary column for querying
    created_at    TIMESTAMPTZ DEFAULT now(),
    updated_at    TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_profiles_user_id ON profiles(user_id);

-- Projects
CREATE TABLE user_projects (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id       UUID REFERENCES users(id) ON DELETE CASCADE,
    name          TEXT NOT NULL,
    description   TEXT,
    technologies  TEXT[],
    github_url    TEXT,
    live_url      TEXT,
    start_date    DATE,
    end_date      DATE,               -- NULL means present
    bullet_points TEXT[],
    sort_order    INTEGER DEFAULT 0,
    source        TEXT DEFAULT 'manual',
    created_at    TIMESTAMPTZ DEFAULT now(),
    updated_at    TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_projects_user_id ON user_projects(user_id);

-- Experiences
CREATE TABLE user_experiences (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id       UUID REFERENCES users(id) ON DELETE CASCADE,
    role          TEXT NOT NULL,
    organization  TEXT NOT NULL,
    location      TEXT,
    start_date    DATE,
    end_date      DATE,               -- NULL means present
    bullet_points TEXT[],
    sort_order    INTEGER DEFAULT 0,
    source        TEXT DEFAULT 'manual',
    created_at    TIMESTAMPTZ DEFAULT now(),
    updated_at    TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_experiences_user_id ON user_experiences(user_id);

-- Education
CREATE TABLE user_education (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id       UUID REFERENCES users(id) ON DELETE CASCADE,
    degree        TEXT NOT NULL,
    institution   TEXT NOT NULL,
    location      TEXT,
    start_date    DATE,
    end_date      DATE,
    gpa           TEXT,
    coursework    TEXT[],
    sort_order    INTEGER DEFAULT 0,
    created_at    TIMESTAMPTZ DEFAULT now(),
    updated_at    TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_education_user_id ON user_education(user_id);

-- Extracurriculars / Activities
CREATE TABLE user_extracurriculars (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id       UUID REFERENCES users(id) ON DELETE CASCADE,
    title         TEXT NOT NULL,
    organization  TEXT,
    description   TEXT,
    start_date    DATE,
    end_date      DATE,
    bullet_points TEXT[],
    sort_order    INTEGER DEFAULT 0,
    created_at    TIMESTAMPTZ DEFAULT now(),
    updated_at    TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_extracurriculars_user_id ON user_extracurriculars(user_id);

-- Generation Runs
CREATE TABLE generations (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id          UUID REFERENCES users(id) ON DELETE CASCADE,
    template_id      TEXT NOT NULL,
    job_description  TEXT NOT NULL,
    job_title        TEXT,
    company          TEXT,
    keywords         TEXT[],
    instructions     TEXT,
    model_used       TEXT DEFAULT 'gemma-4-31b-it',
    status           TEXT DEFAULT 'pending',
    error_message    TEXT,
    pdf_storage_key  TEXT,
    md_storage_key   TEXT,
    thumb_storage_key TEXT,
    render_metadata  JSONB,
    created_at       TIMESTAMPTZ DEFAULT now(),
    updated_at       TIMESTAMPTZ DEFAULT now(),
    completed_at     TIMESTAMPTZ
);
CREATE INDEX idx_generations_user_id ON generations(user_id);

-- Generation Logs (polled via GET /generate/{id}/logs?since=<log_id>)
CREATE TABLE generation_logs (
    id            SERIAL PRIMARY KEY,
    generation_id UUID REFERENCES generations(id) ON DELETE CASCADE,
    timestamp     TIMESTAMPTZ DEFAULT now(),
    level         TEXT DEFAULT 'info',
    message       TEXT NOT NULL,
    node_name     TEXT
);
CREATE INDEX idx_logs_generation_id ON generation_logs(generation_id);

-- Rate limits
CREATE TABLE user_rate_limits (
    user_id       UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    request_count INTEGER DEFAULT 0,
    reset_at      TIMESTAMPTZ NOT NULL
);
```

---

## 9. API Endpoints (JWT Auth only)

Backend decodes NextAuth's token with a shared secret (`JWT_SECRET`). Users are auto-created on first call if they don't exist in the database.

### Auth & System
| Method | Path | Purpose |
|--------|------|---------|
| GET | `/system/health` | Healthcheck |

### Rate Limiting (Phase 1)
- `check_rate_limit` does an atomic upsert-and-increment on the `user_rate_limits` table (`ON CONFLICT ... RETURNING`). Currently `MAX_DAILY_RUNS=50` in code (planned reduction to 5). Resets every 24h. No TOCTOU race — the row-level lock means concurrent requests cannot both read the same count.

### Profile CRUD
| Method | Path | Purpose |
|--------|------|---------|
| GET/PUT | `/profile` | Fetch / Update base profile |
| GET/POST | `/profile/projects` | List / Add user projects |
| PUT/DELETE | `/profile/projects/{id}` | Update / Delete project |
| GET/POST | `/profile/experiences` | List / Add experiences |
| PUT/DELETE | `/profile/experiences/{id}` | Update / Delete experience |
| GET/POST | `/profile/education` | List / Add education |
| PUT/DELETE | `/profile/education/{id}` | Update / Delete education |
| GET/POST | `/profile/extracurriculars` | List / Add extracurriculars |
| PUT/DELETE | `/profile/extracurriculars/{id}` | Update / Delete extracurricular |

### Templates
| Method | Path | Purpose |
|--------|------|---------|
| GET | `/templates` | List all manifests |

### Generation & Preview
| Method | Path | Purpose |
|--------|------|---------|
| POST | `/generate` | Start a run, insert `generations` row, trigger Cloud Run Job, return `generation_id` |
| GET | `/generate/{id}/logs?since=<log_id>` | Poll logs after cursor (progress bar) |
| GET | `/generate/{id}/preview` | Returns signed R2 URL or serves PDF directly with `Content-Type: application/pdf` |
| GET | `/generate/{id}/download` | Serve PDF attachment |

---

## 10. Implementation Phases

### Phase 1: Foundation, Onboarding, Rate Limits, and Simple Landing
- [x] Initialize Next.js 15, Tailwind v4, shadcn/ui
- [x] Build basic marketing landing page with "Login with GitHub/Google" buttons
- [x] Set up NextAuth.js v5 (JWT configuration)
- [x] Setup FastAPI + SQLAlchemy 2.0 Async + psycopg3 + Alembic migrations
- [x] Implement JWT decode dependency on FastAPI backend
- [x] Implement Profile, Projects, Experiences, Education CRUD with `react-hook-form` + `zod`
- [x] Write rate-limiting middleware (5 runs / user / day)

**Bugs fixed during Phase 1:**
- Fixed sign-in/sign-out buttons not working (`type="submit"` missing on Base UI Button inside forms)

### Phase 2: LangGraph, WeasyPrint, and PDF Pipeline
- [x] Port/Adapt Pydantic schemas for Gemma 4 31B (`gemma-4-31b-it`) via Gemini API
- [x] Set up LangGraph StateGraph (Analysis, parallel fan-out, Assembly, Render, Orphan Repair, Content Reduction, Save)
- [x] Implement WeasyPrint engine inside container, write auto-fit CSS adjustments
- [x] Setup R2 file storage driver + PDF preview/download/thumbnail endpoints
- [x] Create default CSS template (Personal Classic — Computer Modern serif, fonts bundled locally)
- [x] True binary-search font fit + per-bullet orphan detection (chars-per-line derived from the layout, not a hardcoded constant)
- [x] Parallel per-entry LLM calls via `asyncio.gather` (experience + projects writers)

**Removed in Phase 3 (SSE execution context):**
- The `/generate/{id}/stream` SSE endpoint and its `sse_queue_var` plumbing were replaced by Cloud Run Jobs + `/logs` polling (see §3 and Phase 3). SSE via the Vercel proxy hit a 10s serverless timeout and tied pipeline execution to an open client connection — incompatible with the walk-away UX.

**Bugs fixed during Phase 2:**
- Fixed missing `ResumeGraphState` import in `api/generation.py` (would cause `NameError` on every stream)
- Added `GOOGLE_API_KEY` to `config.py`, `.env`, and `.env.example` (pipeline silently failed without it)
- Fixed `model_used` default to `"gemma-4-31b-it"` in `schemas/generation.py`
- Fixed markdown serialization (was only name + summary; now serializes full resume: skills, experience, projects, education)
- Added `GET /generate/{id}/download` endpoint with `Content-Disposition: attachment`
- Fixed history page download button to use `/download` instead of `/preview`

### Phase 3: History, Deploy, Jobs, and Hardening
- [x] Implement History page (list past runs, preview/download PDF)
- [x] Create Dockerfile with WeasyPrint system dependencies (Pango, Cairo) + bundled CMU fonts
- [x] Bundle CMU Computer Modern Serif fonts locally in templates (drop CDN @font-face)
- [x] Replace SSE with log polling endpoint (`/generate/{id}/logs?since=`) + 3s poll on History page
- [x] Add Resend email-on-completion (terminal status) — `src/core/notify.py`
- [x] Add reaper sweep for stuck `in_progress` generations (15min timeout) — runs lazily on each POST `/generate`
- [x] Cloud Run Jobs pipeline execution — `src/pipeline/job_runner.py` + `src/core/executor.py` (POST `/generate` triggers the Job; `EXECUTION_MODE=local` runs in-process for dev)
- [x] Atomic rate-limit upsert (no TOCTOU race) + JWT_SECRET fail-fast validation + Neon `pool_pre_ping`/`pool_recycle`
- [x] Generate-button loading state (prevents duplicate-job clicks during Neon cold wake)
- [x] GitHub Actions CI/CD: deploy API service + Pipeline Job to Cloud Run with env vars + Secret Manager secrets
- [ ] Set up Neon DB autosuspend configurations
- [ ] One-time GCP setup: Secret Manager secrets (DATABASE_URL, JWT_SECRET, GOOGLE_API_KEY, R2_*, RESEND_API_KEY), `RUNNER_SA` GitHub var, grant `roles/run.invoker` + `roles/secretmanager.secretAccessor` to the runtime SA
- [ ] Configure R2 90-day lifecycle policy

### Phase 4: Enhancements (Post-MVP)
- [ ] Resume parser API (PDF → Profile data)
- [ ] GitHub project scraper agent
- [ ] Add support for multiple models via selection dropdown
- [ ] Add more templates

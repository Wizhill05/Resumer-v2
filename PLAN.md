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
| **Backend** | **Google Cloud Run** | 180k vCPU-sec/month, scales to zero | Full CPU on requests, truly free when idle |
| **Database** | **Neon PostgreSQL** | 0.5GB storage, autosuspend after 5min idle | Serverless Postgres, generous free tier |
| **File Storage** | **Cloudflare R2** | 10GB storage, zero egress fees | Free S3-compatible, no surprise bills |
| **Auth** | **NextAuth.js** | Free (self-hosted in Next.js) | JWT verification without DB auth sessions |

### Critical Architecture Adjustments for Cloud Run Free Tier
- **SSE as Execution Context**: To prevent Cloud Run from freezing the CPU/container after sending an immediate HTTP response, the generation pipeline runs **synchronously inside the SSE request context**. The open connection keeps the instance active.
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
- **SSE hook** with reconnection logic + `Last-Event-ID` support

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
    │       4. Hit generate → watch live SSE terminal progress
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
├── clean-modern/
│   ├── manifest.json
│   ├── template.jinja2
│   └── style.css
└── ...
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
                    │ JOB ANALYSIS │  → JobAnalysis (cleaned JD, keywords, seniority)
                    └──────┬───────┘
                           │
              ┌────────────┼────────────┐
              │            │            │         (parallel fan-out)
       ┌──────▼──────┐┌───▼────┐┌──────▼──────┐
       │  SUMMARY &  ││PROJECT ││ EXPERIENCE  │
       │  SKILLS     ││SELECTOR││ WRITER      │
       └──────┬──────┘└───┬────┘└──────┬──────┘
              │            │            │
              └────────────┼────────────┘  (fan-in)
                           │
                    ┌──────▼───────┐
                    │   REPAIR     │─── missing skills? ──┐
                    │   CHECK      │                      │
                    └──────┬───────┘◄─────────────────────┘
                           │
                    ┌──────▼───────┐
                    │  ASSEMBLE    │  → TailoredResume JSON
                    └──────┬───────┘
                           │
                    ┌──────▼───────┐
                    │  RENDER PDF  │─── pages > target? ──┐
                    │ (WeasyPrint) │                      │
                    └──────┬───────┘◄─────────────────────┘
                           │              (shrink font, retry)
                    ┌──────▼───────┐
                    │  SAVE        │  → Upload PDF + MD to R2
                    │  ARTIFACTS   │  → Store refs in DB
                    └──────────────┘
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

    # Render Output
    pdf_bytes: Optional[bytes]
    markdown: Optional[str]
    page_count: int
    font_size: float

    # Controls & Logs
    repair_attempts: int
    render_attempts: int
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
    render_metadata  JSONB,
    created_at       TIMESTAMPTZ DEFAULT now(),
    updated_at       TIMESTAMPTZ DEFAULT now(),
    completed_at     TIMESTAMPTZ
);
CREATE INDEX idx_generations_user_id ON generations(user_id);

-- Generation Logs (SSE catchup support)
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
- Global middleware checks `user_rate_limits` table: max 5 generations per day per user (resets every 24h).

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

### Templates
| Method | Path | Purpose |
|--------|------|---------|
| GET | `/templates` | List all manifests |

### Generation & Preview
| Method | Path | Purpose |
|--------|------|---------|
| POST | `/generate` | Start a run, insert `generations` row, return `generation_id` |
| GET | `/generate/{id}/stream` | **SSE Endpoint** executing LangGraph run and streaming logs |
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

### Phase 2: LangGraph, WeasyPrint, and SSE Execution
- [x] Port/Adapt Pydantic schemas for Gemini 2.5 Flash (was labelled Gemma 4)
- [x] Set up LangGraph StateGraph (Analysis, Parallel Selection, Assembly, Render nodes)
- [x] Implement WeasyPrint engine inside container, write auto-fit CSS adjustments
- [x] Build `/generate/{id}/stream` SSE node execution context
- [x] Implement SSE log retrieval (load historical logs from DB on reconnect, then tail)
- [x] Setup R2 file storage driver + PDF preview endpoint
- [x] Create 2 default CSS templates (Clean Modern, Compact)

**Bugs fixed during Phase 2:**
- Fixed missing `ResumeGraphState` import in `api/generation.py` (would cause `NameError` on every stream)
- Added `GOOGLE_API_KEY` to `config.py`, `.env`, and `.env.example` (pipeline silently failed without it)
- Fixed `model_used` default to `"gemma-4-31b-it"` in `schemas/generation.py`
- Fixed markdown serialization (was only name + summary; now serializes full resume: skills, experience, projects, education)
- Added `GET /generate/{id}/download` endpoint with `Content-Disposition: attachment`
- Fixed history page download button to use `/download` instead of `/preview`

### Phase 3: History & Deploy
- [x] Implement History page (list past runs, preview/download PDF)
- [ ] Create Dockerfile with WeasyPrint system dependencies (Pango, Cairo)
- [ ] Set up GitHub Actions CI/CD to deploy to Google Cloud Run
- [ ] Set up Neon DB autosuspend configurations

### Phase 4: Enhancements (Post-MVP)
- [ ] Resume parser API (PDF → Profile data)
- [ ] GitHub project scraper agent
- [ ] Add support for multiple models via selection dropdown
- [ ] Add more templates

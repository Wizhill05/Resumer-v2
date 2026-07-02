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
| **Backend** | **Railway** | $5 credit/mo free, always-on service | Persistent process; no CPU throttling; no cold-start latency |
| **Database** | **Neon PostgreSQL** | 0.5GB storage, autosuspend after 5min idle | Serverless Postgres, generous free tier |
| **File Storage** | **Cloudflare R2** | 10GB storage, zero egress fees | Free S3-compatible, no surprise bills |
| **Auth** | **NextAuth.js** | Free (self-hosted in Next.js) | JWT verification without DB auth sessions |

### Architecture Notes for Railway
- **Always-on process**: Railway runs the FastAPI service as a persistent process. `asyncio.create_task` is safe for background pipeline execution — the process is never CPU-throttled or frozen between requests.
- **In-process pipeline**: POST `/generate` inserts the row, fires a detached `asyncio.create_task(run_generation(gen_id))`, and returns immediately. The task runs to completion in the background.
- **Local dev identical to prod**: `EXECUTION_MODE=local` is the only mode. No separate job infrastructure needed.
- **Reaper**: A sweep on each POST `/generate` marks `in_progress` generations older than 15 min as `failed` + emails — covers tasks that died (OOM, crash) without reaching a terminal status.
- **Email-on-Completion**: Resend (free 3k/mo) fires on terminal status (completed/failed) from inside the pipeline task. Primary completion signal to user.
- **No Redis**: DB-based execution states. The reaper is lazy (runs on each POST `/generate`) — zero extra infra.
- **WeasyPrint for PDF**: Pure Python, lightweight (~50MB vs Playwright's ~200MB Chromium). Essential for keeping the container footprint small.
  - *Note on WeasyPrint CSS*: No CSS Grid, limited Flexbox support. Templates must use `float`, table, or basic flex layouts.
  - *Note on System Deps*: Dockerfile must install `libpango`, `libcairo`, `libgdk-pixbuf`, `shared-mime-info`.
- **No scraping in v2 MVP**: Paste Job Description manually or fetch from URL using basic HTTP client on backend (no headless browser).
- **R2 Lifecycle Policy**: 90-day TTL rule applied idempotently on each container start (boto3 `put_bucket_lifecycle_configuration`). Auto-deletes old PDFs/MDs, staying within the 10GB free limit.

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
| POST | `/generate` | Start a run, insert `generations` row, fire in-process pipeline task, return `generation_id` |
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
- The `/generate/{id}/stream` SSE endpoint and its `sse_queue_var` plumbing were replaced by in-process asyncio tasks + `/logs` polling (see §3 and Phase 3). SSE via the Vercel proxy hit a 10s serverless timeout and tied pipeline execution to an open client connection — incompatible with the walk-away UX.

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
- [x] In-process pipeline execution via detached asyncio task — `src/pipeline/job_runner.py` + `src/core/executor.py` (POST `/generate` fires task; Railway keeps process alive so task completes reliably)
- [x] Atomic rate-limit upsert (no TOCTOU race) + JWT_SECRET fail-fast validation + Neon `pool_pre_ping`/`pool_recycle`
- [x] Generate-button loading state (prevents duplicate-job clicks during Neon cold wake)
- [x] GitHub Actions CI/CD: build and push Docker image; deploy to Railway via Railway CLI
- [x] Set up Neon DB autosuspend configurations
- [x] Configure R2 90-day lifecycle policy

### Phase 4: Guided Onboarding, Resume Import, and GitHub Project Autofill

Goal: first-time users should not face blank profile forms. They can upload old resumes and paste GitHub repo links; Resumer extracts structured profile data, stages it for review, deduplicates against existing data, then writes only accepted entries into the existing profile tables.

#### UX Flow

```
Sign Up
    |
    v
Onboarding Wizard
    |
    |-- Step 1: Import resume(s)
    |       - Upload one or more old resumes
    |       - Backend extracts text safely
    |       - LLM maps text into profile, experience, education, skills, projects
    |       - Duplicate projects/experiences are merged or skipped, not copied
    |       - User reviews staged results before saving
    |
    |-- Step 2: Add projects from GitHub
    |       - Paste one or more public GitHub repo URLs
    |       - Backend reads README, repo metadata, languages, and safe file tree
    |       - LLM creates project name, description, tech stack, resume bullets
    |       - Duplicate GitHub/project entries are merged or skipped
    |       - User reviews staged project before saving
    |
    |-- Step 3: Fill missing manual fields
    |       - Show only gaps: phone, portfolio, missing dates, weak bullets
    |
    v
Profile complete enough to generate resume
```

#### Product Principles

- Never silently overwrite user data.
- Never execute uploaded files or repository code.
- Imported data lands in a review screen first.
- Existing saved profile values win unless the user explicitly accepts a replacement.
- Multiple uploaded resumes may describe the same project, job, or school; imports must dedupe before insert.
- Every imported row stores `source`: `resume_import`, `github_import`, or `manual`.
- Show confidence and warnings for weak, missing, duplicate, or suspicious fields.
- Keep import cheap: one LLM extraction call per resume, one call per GitHub repo.

#### Backend: Resume Import

Add endpoints:

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/profile/import/resume` | Upload one resume file and return staged profile data |
| POST | `/profile/import/resumes` | Upload multiple resume files and return one deduped staged profile draft |
| POST | `/profile/import/apply` | Apply accepted staged data to profile tables |

Supported v1 file types:

- PDF only for MVP.
- Limit: 5MB per file.
- Max pages: 5 per file.
- Max files per import: 5.
- Reject scanned/image-only PDFs with clear message: `Could not read text from this PDF.`

Safe extraction pipeline:

1. Receive multipart upload.
2. Validate extension, MIME type, size, and page count.
3. Store only in memory or temp storage; delete temp file after extraction.
4. Extract text with a PDF text library only; do not execute macros, scripts, embedded files, links, or attachments.
5. Strip control characters, normalize whitespace, and cap prompt input length.
6. Treat all extracted text as untrusted prompt data; wrap it in delimiters and instruct the LLM to ignore any instructions inside the resume.
7. Call LLM with strict Pydantic output schema.
8. Run deterministic dedupe/merge against existing DB rows and other uploaded resumes.
9. Return staged data, duplicate matches, warnings, and suggested actions; do not persist final entries yet.
10. Frontend lets user accept, edit, merge, skip, or replace each section or row.
11. Apply accepted data using existing Profile/Projects/Experiences/Education CRUD logic.

Structured output schema:

```python
class ImportWarning(BaseModel):
    scope: str
    message: str


class DuplicateCandidate(BaseModel):
    imported_index: int
    existing_id: str | None = None
    existing_type: str
    confidence: float
    reason: str
    suggested_action: Literal["merge", "skip", "create"]


class ResumeImportDraft(BaseModel):
    profile: ProfileUpdate
    experiences: list[ExperienceCreate]
    projects: list[ProjectCreate]
    education: list[EducationCreate]
    extracurriculars: list[ExtracurricularCreate]
    duplicate_candidates: list[DuplicateCandidate]
    warnings: list[ImportWarning]
```

Merge and duplicate rules:

- Base profile: fill blank fields by default; never replace non-empty fields without explicit user action.
- Skills: union existing + imported, dedupe case-insensitive, normalize punctuation and casing.
- Experience duplicate key: normalized `role + organization`, overlapping date range, and similar bullet text.
- Project duplicate key: same `github_url`, normalized `name`, or high text similarity between descriptions/bullets.
- Education duplicate key: normalized `degree + institution`, with date overlap if present.
- Extracurricular duplicate key: normalized `title + organization`, with date overlap if present.
- If duplicate confidence is high, default action is `merge` or `skip`, never `create`.
- If duplicate confidence is medium, ask user in review UI.
- If duplicate confidence is low, allow create but show warning.
- Merging arrays appends only unique bullets/technologies/coursework; no repeated bullet text.
- Date conflicts surface to user instead of guessing.

#### Backend: Malicious or Random Upload Handling

Uploads are untrusted input, not documents to execute.

Required safeguards:

- Accept only `application/pdf` for MVP; reject all other MIME types even if extension is `.pdf`.
- Verify PDF header and parseability before extraction.
- Enforce hard size, page, text-length, and request-time limits.
- Never shell out to document converters for MVP.
- Never follow embedded links from PDFs.
- Never extract or run embedded files, JavaScript, attachments, or launch actions.
- Strip metadata before sending anything to the LLM unless explicitly needed.
- Use parser timeout and catch parser crashes as safe failures.
- Return generic parse errors to users; log safe diagnostics only.
- Rate-limit imports separately from resume generation.
- Virus scanning can be deferred for MVP if files are never persisted, but must be added before storing raw uploads in R2.
- If random content is uploaded, extraction should return low-confidence empty draft plus warning, not pollute the profile.

Prompt-injection defense:

- The resume text may contain instructions like `ignore previous instructions`. Treat it as data only.
- System prompt must say extracted resume text is untrusted and cannot change the task.
- Output must match schema; unknown fields are discarded.
- Do not let imported text set `source`, `user_id`, IDs, API paths, or internal flags.

#### Backend: GitHub Project Import

Add endpoints:

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/profile/import/github-project` | Parse one public GitHub repo URL into staged project |
| POST | `/profile/import/github-projects` | Batch import multiple public repo URLs |

Input:

```json
{
  "url": "https://github.com/owner/repo"
}
```

GitHub fetch strategy:

- Parse and validate only `github.com/{owner}/{repo}` URLs.
- Use GitHub REST API when possible:
  - `GET /repos/{owner}/{repo}`
  - `GET /repos/{owner}/{repo}/readme`
  - `GET /repos/{owner}/{repo}/languages`
  - `GET /repos/{owner}/{repo}/contents`
- Fallback to raw README URL only if API fails safely.
- MVP supports public repos only.
- Private repo import requires storing GitHub OAuth access token later; current auth does not appear to persist provider tokens.

Data sent to LLM:

- Repo name.
- Repo description.
- README text.
- Language breakdown.
- Top-level file tree.
- Dependency manifests when available: `package.json`, `pyproject.toml`, `requirements.txt`, `Cargo.toml`, `go.mod`, `pom.xml`.

Output:

```python
class GitHubProjectDraft(BaseModel):
    name: str
    description: str
    technologies: list[str]
    github_url: str
    live_url: str | None = None
    bullet_points: list[str]
    duplicate_candidates: list[DuplicateCandidate]
    warnings: list[ImportWarning]
```

Project bullet rules:

- 2-4 bullets.
- Resume-ready and specific.
- No fake metrics.
- If no measurable outcome exists, describe architecture, users, automation, performance, deployment, or integration without inventing numbers.
- Include tech stack only when evidence exists in README, languages, dependency files, or repo metadata.

GitHub security and limits:

- Allow only GitHub domains.
- Block localhost, private IPs, redirects to non-GitHub hosts, and arbitrary URL fetching to avoid SSRF.
- Timeout requests after 8 seconds.
- Cap README and manifest text before LLM calls.
- Never clone repositories or execute code in MVP.
- Never install dependencies.
- Only inspect text files returned by GitHub API.
- Cache repeated repo imports per user + repo URL later if needed.

#### Frontend: Onboarding Wizard

Add `/onboarding` route.

Wizard sections:

1. Welcome
2. Upload resume(s)
3. Review imported profile
4. Add GitHub projects
5. Resolve duplicates and conflicts
6. Fix missing fields
7. Finish and go dashboard

Profile page changes:

- Add `Import from resume` button near profile tabs.
- Add `Autofill from GitHub` button inside Projects section.
- Imported project opens the same ProjectForm in edit/review mode before save.
- Use TanStack Query mutations for import calls.
- Show loading states with concrete labels:
  - `Reading PDF`
  - `Extracting profile`
  - `Finding duplicates`
  - `Review results`
  - `Saving accepted data`

Dashboard change:

- If profile is incomplete, primary CTA becomes `Finish onboarding` instead of only `Profile Section`.
- Completion checklist uses existing profile/project/experience/education counts.

#### Database Changes

MVP can avoid new staging tables by returning draft JSON to frontend and applying accepted rows immediately.

Optional hardening table for later:

```sql
CREATE TABLE profile_imports (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    source TEXT NOT NULL,
    source_ref TEXT,
    draft JSONB NOT NULL,
    status TEXT DEFAULT 'pending',
    created_at TIMESTAMPTZ DEFAULT now(),
    applied_at TIMESTAMPTZ
);
```

Recommended MVP:

- No new table.
- Add no migration unless import history is needed.
- Reuse existing `source` columns for projects and experiences.
- Add `source` to education and extracurriculars later only if provenance is needed there too.

#### Implementation Tasks

- [ ] Add `src/services/resume_import.py` for PDF validation, safe text extraction, LLM structuring, and multi-resume dedupe.
- [ ] Add `src/services/github_import.py` for GitHub URL parsing, API fetch, README/tree/language extraction, and safe text caps.
- [ ] Add import schemas to `src/schemas/profile.py`.
- [ ] Add import routes under `src/api/profile.py` or new `src/api/imports.py`.
- [ ] Add deterministic duplicate detection helpers for projects, experiences, education, skills, and extracurriculars.
- [ ] Add LLM prompts that forbid invented dates, companies, degrees, links, user IDs, internal fields, and metrics.
- [ ] Add `/onboarding` frontend route.
- [ ] Add resume upload UI with staged review.
- [ ] Add GitHub autofill UI in `ProjectForm`.
- [ ] Add duplicate review UI with `merge`, `skip`, and `create new` actions.
- [ ] Add tests for PDF validation, random upload rejection, parser failure, prompt injection text, GitHub URL validation, SSRF prevention, and duplicate detection.

#### MVP Cut

Build first:

- PDF resume upload.
- Multiple resume upload with dedupe.
- Public GitHub repo import.
- Review-before-save UI.
- Fill blank profile fields only.
- Add or merge projects/experiences/education only after user confirms.

Defer:

- DOCX.
- Private GitHub repos.
- Import history table.
- Background import jobs.
- Raw upload persistence in R2.
- Multi-resume semantic merge beyond deterministic duplicate detection.
- Browser scraping of GitHub pages.

### Phase 5: Enhancements (Post-MVP)
- [ ] Add support for multiple models via selection dropdown
- [ ] Add more templates

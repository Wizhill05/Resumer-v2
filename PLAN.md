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

## 3. Free Hosting Stack

| Layer | Service | Free Tier | Why |
|-------|---------|-----------|-----|
| **Frontend** | **Vercel** | Unlimited deploys, 100GB bandwidth | Native Next.js support, zero config |
| **Backend** | **Google Cloud Run** | 180k vCPU-sec/month, real CPU when running, scales to zero | Full CPU on requests, ~6k generations/month free, perfect for bursty workloads |
| **Database** | **Neon PostgreSQL** | 0.5GB storage, autosuspend after 5min idle | Serverless Postgres, generous free tier, branching |
| **File Storage** | **Cloudflare R2** | 10GB storage, zero egress fees | Free S3-compatible, no surprise bills |
| **Auth** | **NextAuth.js** | Free (self-hosted in Next.js) | Runs on Vercel, no extra service |

### Why Google Cloud Run
- **Real CPU when handling requests** — not a starved 0.1 core 24/7
- **Scales to zero** — truly free when nobody using it
- 180k vCPU-sec/month ≈ ~6,000 resume generations free
- Cold start (~5-10s) irrelevant when generation takes 30-60s anyway
- Deploy via Docker + `gcloud` CLI (one-time setup)

### What we DROP to stay free
- **No Redis** — use FastAPI `BackgroundTasks` + DB-based state for generation runs
- **No Playwright for PDF** — use **WeasyPrint** (pure Python, ~50MB, no Chromium needed). WeasyPrint handles resume-level CSS perfectly.
- **No scraping in v2 MVP** — stealth scraping from datacenter IPs is unreliable + legally grey. Users paste JD manually. Can add scraping as self-hosted addon later.

---

## 4. Tech Stack (Updated)

### Frontend (`/frontend`)
- **Next.js 15** (App Router)
- **TypeScript** (strict)
- **Tailwind CSS v4** + **shadcn/ui**
- **NextAuth.js v5** (GitHub + Google)
- **TanStack Query** for server state
- **SSE** for real-time generation logs

### Backend (`/backend`)
- **Python 3.12+** with **uv**
- **FastAPI** (async)
- **LangGraph** for pipeline orchestration
- **LangChain** + **langchain-google-genai** for LLM calls
- **Neon PostgreSQL** via **psycopg3** (async) — raw SQL, no ORM
- **Alembic** for migrations
- **WeasyPrint** for PDF generation
- **Jinja2** for resume templates
- **Pydantic v2** for schemas
- **boto3** / **s3fs** for R2 storage

### Default LLM
- **Gemma 4** via Gemini API (`gemini/gemma-4`) — free tier available
- Model selection dropdown for later (Gemini Flash, GPT-4o-mini, Claude Haiku, etc.)

---

## 5. User Flow (Core, No Onboarding Details)

```
Sign Up (GitHub/Google)
    │
    ▼
Profile Setup (planned separately)
    │  - Manual entry: name, links, experience, projects, skills, education
    │  - OR upload existing resume → agent extracts fields
    │  - OR link GitHub repos → agent summarizes projects
    │
    ▼
Dashboard
    │
    ├──► Generate Resume
    │       1. Paste job description
    │       2. (Optional) Add keywords, instructions
    │       3. Select template (with preview + field docs)
    │       4. Hit generate → watch live progress
    │       5. Preview PDF → download
    │
    ├──► My Resumes (history of generated resumes)
    │
    ├──► Profile (edit your base info)
    │
    └──► Settings (account, model selection later)
```

---

## 6. Template System

Templates are first-class citizens. Each template = Jinja2 file + CSS file + **manifest**.

### Template Manifest Schema

```python
class TemplateManifest(BaseModel):
    """Defines what a template supports. The generation pipeline
    reads this to know how much content to generate."""

    id: str                          # "clean-modern"
    name: str                        # "Clean Modern"
    description: str                 # "Minimalist single-column ATS-friendly layout"
    preview_image: str               # URL to preview screenshot

    # Field support
    has_photo: bool = False          # Does template render a photo?
    has_summary: bool = True         # Professional summary section?
    has_objective: bool = False      # Objective line (rare, some templates)
    has_links: bool = True           # GitHub, LinkedIn, portfolio links
    has_education: bool = True
    has_extracurricular: bool = True

    # Content limits — pipeline generates EXACTLY this much
    max_projects: int = 3            # How many projects to select/write
    max_experience: int = 2          # How many work entries
    max_skills_categories: int = 5   # How many skill groups
    max_bullets_per_project: int = 3
    max_bullets_per_experience: int = 3

    # Render config
    target_pages: int = 1            # How many pages to fit into
    font_size_range: tuple[float, float] = (8.0, 12.0)   # For auto-fit
    line_height_range: tuple[float, float] = (1.15, 1.8)
    page_margin_mm: int = 15         # CSS @page margin
```

### How Pipeline Uses Manifest

```
1. User selects template → backend loads manifest
2. manifest.max_projects = 3 → projects_writer node generates exactly 3
3. manifest.has_photo = False → photo field omitted from render context
4. manifest.font_size_range → auto-fit binary search bounds
5. manifest.target_pages → page count validation after render
```

### Default Templates (ship with app)

| Template | Photo | Projects | Experience | Style |
|----------|-------|----------|------------|-------|
| **Clean Modern** | No | 3 | 2 | Single column, minimal, ATS-safe |
| **Two Column** | Yes | 2 | 2 | Sidebar for skills/links, main for content |
| **Academic** | No | 3 | 3 | Dense, suits research/grad roles |
| **Compact** | No | 2 | 2 | Tight spacing, max info per page |

### Template File Structure

```
backend/templates/
├── clean-modern/
│   ├── manifest.json         # TemplateManifest
│   ├── template.jinja2       # Jinja2 HTML template
│   ├── style.css             # Template-specific CSS
│   └── preview.png           # Screenshot for template picker
├── two-column/
│   ├── manifest.json
│   ├── template.jinja2
│   ├── style.css
│   └── preview.png
└── ...
```

---

## 7. LangGraph Pipeline (Updated)

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
                    │ JOB ANALYSIS │  → JobAnalysis (cleaned JD, skills, seniority)
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

### Key Change: PROJECT SELECTOR (not writer)

v1's projects_writer creates projects from scratch. v2 changes this:
- User already has projects in their profile (entered manually, parsed from resume, or analyzed from GitHub)
- **Project Selector** node picks the best N projects for the job (N = `manifest.max_projects`)
- Then rewrites their bullet points to emphasize skills relevant to the JD
- Does NOT invent new projects — selects from user's real ones

### State Schema (Updated)

```python
class ResumeGraphState(TypedDict):
    # Inputs
    user_id: str
    profile: dict                           # User's full profile data
    job_description: str
    keywords: list[str]                     # Optional user-specified keywords
    instructions: str                       # Optional user instructions to agent
    template_manifest: TemplateManifest     # What the template needs

    # Phase outputs
    job_analysis: Optional[JobAnalysis]
    summary_draft: Optional[SummarySkillsDraft]
    projects_draft: Optional[ProjectsDraft]
    experience_draft: Optional[ExperienceDraft]

    # Assembly
    tailored_resume: Optional[TailoredResume]

    # Render
    pdf_bytes: Optional[bytes]
    markdown: Optional[str]
    page_count: int
    font_size: float

    # Control
    repair_attempts: int
    render_attempts: int
    errors: list[str]
    logs: list[str]
```

---

## 8. Database Schema (Neon PostgreSQL)

```sql
-- Users (NextAuth managed, but we extend)
CREATE TABLE users (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email         TEXT UNIQUE NOT NULL,
    name          TEXT,
    image         TEXT,
    provider      TEXT,                -- 'github', 'google'
    created_at    TIMESTAMPTZ DEFAULT now()
);

-- NextAuth required tables (accounts, sessions, verification_tokens)
-- These are auto-created by @auth/pg-adapter

-- User profile data (the "truth" — their real resume info)
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
    summary       TEXT,                -- Raw professional summary
    data          JSONB NOT NULL,      -- Full structured profile (skills, education, etc.)
    created_at    TIMESTAMPTZ DEFAULT now(),
    updated_at    TIMESTAMPTZ DEFAULT now()
);

-- User's projects (manually added, parsed from resume, or from GitHub)
CREATE TABLE user_projects (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id       UUID REFERENCES users(id) ON DELETE CASCADE,
    name          TEXT NOT NULL,
    description   TEXT,                -- What the project does
    technologies  TEXT[],              -- Tech stack used
    github_url    TEXT,
    live_url      TEXT,
    start_date    TEXT,
    end_date      TEXT,
    bullet_points TEXT[],              -- Raw achievement bullets
    source        TEXT DEFAULT 'manual',  -- 'manual', 'resume_parse', 'github_import'
    raw_readme    TEXT,                -- If imported from GitHub, store README
    created_at    TIMESTAMPTZ DEFAULT now()
);

-- User's work experience
CREATE TABLE user_experiences (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id       UUID REFERENCES users(id) ON DELETE CASCADE,
    role          TEXT NOT NULL,
    organization  TEXT NOT NULL,
    location      TEXT,
    start_date    TEXT,
    end_date      TEXT,               -- NULL = present
    bullet_points TEXT[],
    source        TEXT DEFAULT 'manual',
    created_at    TIMESTAMPTZ DEFAULT now()
);

-- User's education
CREATE TABLE user_education (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id       UUID REFERENCES users(id) ON DELETE CASCADE,
    degree        TEXT NOT NULL,
    institution   TEXT NOT NULL,
    location      TEXT,
    start_date    TEXT,
    end_date      TEXT,
    gpa           TEXT,
    coursework    TEXT[],
    created_at    TIMESTAMPTZ DEFAULT now()
);

-- Generation runs
CREATE TABLE generations (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id          UUID REFERENCES users(id) ON DELETE CASCADE,
    template_id      TEXT NOT NULL,           -- Template slug (e.g., "clean-modern")
    job_description  TEXT NOT NULL,
    job_title        TEXT,                    -- Extracted by job_analysis node
    company          TEXT,                    -- Extracted by job_analysis node
    keywords         TEXT[],                  -- User-specified keywords
    instructions     TEXT,                    -- User instructions to agent
    model_used       TEXT DEFAULT 'gemma-4',
    status           TEXT DEFAULT 'pending',  -- pending, running, completed, failed
    error_message    TEXT,
    -- Intermediate outputs (stored as JSONB for debugging/history)
    job_analysis     JSONB,
    tailored_json    JSONB,
    -- Artifact references
    pdf_storage_key  TEXT,                    -- R2 key for final PDF
    md_storage_key   TEXT,                    -- R2 key for markdown
    render_metadata  JSONB,                   -- font_size, page_count, etc.
    --
    created_at       TIMESTAMPTZ DEFAULT now(),
    completed_at     TIMESTAMPTZ
);

-- Generation logs (for SSE streaming + history)
CREATE TABLE generation_logs (
    id            SERIAL PRIMARY KEY,
    generation_id UUID REFERENCES generations(id) ON DELETE CASCADE,
    timestamp     TIMESTAMPTZ DEFAULT now(),
    level         TEXT DEFAULT 'info',       -- info, warn, error, agent
    message       TEXT NOT NULL,
    node_name     TEXT                        -- Which LangGraph node emitted this
);
```

### Why Separate Tables Instead of One Big JSONB

v1 stored everything in `truth_json` JSONB blob. v2 splits into `user_projects`, `user_experiences`, `user_education` because:
- **Project selector** needs to query/filter projects efficiently
- Individual CRUD (add/edit/delete one project without touching everything)
- GitHub import creates project rows directly
- Resume parser creates rows directly
- Easier to build guided forms against

Profile `data` JSONB still exists as catch-all for skills, certifications, extra info that doesn't warrant its own table.

---

## 9. Backend Directory Structure (Updated)

```
backend/
├── pyproject.toml
├── alembic.ini
├── alembic/
│   ├── env.py
│   └── versions/
├── src/
│   ├── __init__.py
│   ├── config.py                  # pydantic-settings (DB URL, R2 creds, Gemini key)
│   ├── database.py                # psycopg3 async pool
│   ├── main.py                    # FastAPI app, CORS, lifespan
│   ├── dependencies.py            # get_db(), get_current_user()
│   │
│   ├── auth/
│   │   ├── routes.py              # POST /auth/verify-token (validate NextAuth JWT)
│   │   └── service.py             # JWT decode, user upsert
│   │
│   ├── profiles/
│   │   ├── routes.py              # GET/PUT /profile, CRUD /projects, /experiences, /education
│   │   ├── service.py             # DB queries
│   │   └── schemas.py             # ProfileResponse, ProjectCreate, ExperienceCreate, etc.
│   │
│   ├── generation/
│   │   ├── routes.py              # POST /generate, GET /status, GET /logs (SSE)
│   │   ├── service.py             # Launch BackgroundTask, manage state
│   │   ├── schemas.py             # ResumeGraphState, all Pydantic models
│   │   ├── graph.py               # LangGraph StateGraph definition
│   │   ├── nodes/
│   │   │   ├── job_analysis.py
│   │   │   ├── summary_skills.py
│   │   │   ├── project_selector.py  # Select best projects for JD
│   │   │   ├── experience.py
│   │   │   ├── repair.py
│   │   │   ├── assemble.py
│   │   │   └── render.py           # WeasyPrint PDF generation + auto-fit
│   │   └── prompts/
│   │       ├── job_analysis.py
│   │       ├── summary_skills.py
│   │       ├── project_selector.py
│   │       ├── experience.py
│   │       └── repair.py
│   │
│   ├── templates/
│   │   ├── routes.py              # GET /templates (list available), GET /templates/{id}/preview
│   │   ├── service.py             # Load manifest, render Jinja2
│   │   └── schemas.py             # TemplateManifest, TemplateListResponse
│   │
│   └── storage/
│       └── r2.py                  # Cloudflare R2 upload/download via boto3
│
├── templates/                     # Built-in resume templates
│   ├── clean-modern/
│   │   ├── manifest.json
│   │   ├── template.jinja2
│   │   ├── style.css
│   │   └── preview.png
│   ├── two-column/
│   │   └── ...
│   ├── academic/
│   │   └── ...
│   └── compact/
│       └── ...
│
└── tests/
```

---

## 10. Frontend Directory Structure (Updated)

```
frontend/
├── package.json
├── next.config.ts
├── tailwind.config.ts
├── .env.local
│
├── src/
│   ├── app/
│   │   ├── layout.tsx                  # Providers (auth, query client)
│   │   ├── page.tsx                    # Landing page (marketing)
│   │   ├── globals.css
│   │   │
│   │   ├── (auth)/
│   │   │   ├── login/page.tsx
│   │   │   └── signup/page.tsx
│   │   │
│   │   ├── (dashboard)/
│   │   │   ├── layout.tsx              # Sidebar + topbar (protected)
│   │   │   ├── page.tsx                # Dashboard home / quick generate
│   │   │   ├── generate/page.tsx       # Full generation page
│   │   │   ├── resumes/page.tsx        # Past generated resumes
│   │   │   ├── profile/page.tsx        # Edit profile, projects, experience
│   │   │   └── settings/page.tsx       # Account settings
│   │   │
│   │   └── api/auth/[...nextauth]/route.ts
│   │
│   ├── components/
│   │   ├── ui/                         # shadcn/ui
│   │   ├── layout/
│   │   │   ├── sidebar.tsx
│   │   │   └── topbar.tsx
│   │   ├── generate/
│   │   │   ├── job-input.tsx           # JD textarea + optional keywords/instructions
│   │   │   ├── template-picker.tsx     # Grid of template cards with previews
│   │   │   ├── live-terminal.tsx       # SSE log viewer
│   │   │   ├── pdf-preview.tsx
│   │   │   └── generate-button.tsx
│   │   └── profile/
│   │       ├── projects-list.tsx       # CRUD list of user projects
│   │       ├── experience-list.tsx
│   │       ├── education-list.tsx
│   │       └── personal-info-form.tsx
│   │
│   ├── lib/
│   │   ├── api.ts                      # Fetch wrapper with auth headers
│   │   ├── auth.ts                     # NextAuth config
│   │   └── utils.ts
│   │
│   └── types/
│       ├── resume.ts
│       └── api.ts
```

---

## 11. API Endpoints (Updated — Simpler)

All prefixed `/api/v1/`. Auth via Bearer JWT.

### Auth
| Method | Path | Purpose |
|--------|------|---------|
| POST | `/auth/verify` | Verify NextAuth JWT, return user |

### Profile
| Method | Path | Purpose |
|--------|------|---------|
| GET | `/profile` | Get current user's profile |
| PUT | `/profile` | Update personal info, skills, etc. |
| GET/POST | `/profile/projects` | List / add projects |
| PUT/DELETE | `/profile/projects/{id}` | Update / delete project |
| GET/POST | `/profile/experiences` | List / add experiences |
| PUT/DELETE | `/profile/experiences/{id}` | Update / delete experience |
| GET/POST | `/profile/education` | List / add education |
| PUT/DELETE | `/profile/education/{id}` | Update / delete education |
| POST | `/profile/import/resume` | Upload PDF/DOCX → parse into profile (later) |
| POST | `/profile/import/github` | Analyze GitHub repo → create project entry (later) |

### Templates
| Method | Path | Purpose |
|--------|------|---------|
| GET | `/templates` | List all templates with manifests |
| GET | `/templates/{id}/preview` | Get template preview image |

### Generation
| Method | Path | Purpose |
|--------|------|---------|
| POST | `/generate` | Start generation run |
| GET | `/generate/{id}/status` | Poll status |
| GET | `/generate/{id}/logs` | SSE stream of live logs |
| POST | `/generate/{id}/stop` | Cancel run |
| GET | `/generate/{id}/download` | Download final PDF |

### History
| Method | Path | Purpose |
|--------|------|---------|
| GET | `/resumes` | List past generations |
| GET | `/resumes/{id}` | Get generation detail |
| DELETE | `/resumes/{id}` | Delete generation + artifacts |

---

## 12. Implementation Phases

### Phase 1: Skeleton
- [ ] Init backend: uv, FastAPI, psycopg3, Alembic, Neon connection
- [ ] Init frontend: Next.js 15, Tailwind v4, shadcn/ui
- [ ] NextAuth setup (GitHub + Google providers)
- [ ] Auth flow: signup → login → protected dashboard layout
- [ ] Database migrations for all tables
- [ ] Basic profile CRUD API + frontend form

### Phase 2: Templates + Generation
- [ ] Create 2 default templates (clean-modern, compact) with manifests
- [ ] Port Pydantic schemas from v1
- [ ] Build LangGraph graph (all nodes)
- [ ] Port prompts from v1 tasks.yaml, adapt for Gemma 4
- [ ] WeasyPrint PDF rendering with auto-fit
- [ ] Generation API with SSE streaming
- [ ] Generation UI: JD input → template picker → live terminal → PDF preview
- [ ] R2 storage for artifacts

### Phase 3: Polish
- [ ] Resume history page
- [ ] Project/experience CRUD UI
- [ ] Error handling, loading states, toast notifications
- [ ] Landing page (marketing)
- [ ] Deploy: Vercel (frontend) + Cloud Run (backend) + Neon (DB) + R2 (storage)

### Phase 4: Later Enhancements (not in MVP)
- [ ] Resume upload → agent parses into profile
- [ ] GitHub import → agent analyzes repo
- [ ] Model selection dropdown
- [ ] More templates
- [ ] Scraping (self-hosted addon)
- [ ] Rate limiting / usage quotas

---

## 13. Environment Variables

### Backend (.env)
```
DATABASE_URL=postgresql+psycopg://user:pass@ep-xxx.us-east-2.aws.neon.tech/resumer?sslmode=require
GEMINI_API_KEY=...
R2_ENDPOINT=https://xxx.r2.cloudflarestorage.com
R2_ACCESS_KEY_ID=...
R2_SECRET_ACCESS_KEY=...
R2_BUCKET=resumer-artifacts
JWT_SECRET=...                    # Same as NEXTAUTH_SECRET
CORS_ORIGINS=https://resumer.vercel.app,http://localhost:3000
```

### Frontend (.env.local)
```
NEXT_PUBLIC_API_URL=http://localhost:8000/api/v1
NEXTAUTH_URL=http://localhost:3000
NEXTAUTH_SECRET=...
GITHUB_CLIENT_ID=...
GITHUB_CLIENT_SECRET=...
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
```

---

## 14. Key Design Decisions (Resolved)

| Decision | Choice | Reason |
|----------|--------|--------|
| API keys | **Your Gemini key only** (Gemma 4 free tier) | Student budget. Users don't need their own keys for MVP |
| Database access | **Raw SQL via psycopg3** | v1 used raw SQL, keep it simple. No ORM overhead |
| PDF engine | **WeasyPrint** | Pure Python, ~50MB, fits in Render 512MB. No Chromium needed |
| Scraping | **Dropped from MVP** | Datacenter IPs get blocked. Manual JD paste is fine |
| Background jobs | **FastAPI BackgroundTasks** | No Redis needed for MVP scale |
| File storage | **Cloudflare R2** | 10GB free, S3-compatible, zero egress |
| Default model | **Gemma 4 via Gemini API** | Free tier, good quality |

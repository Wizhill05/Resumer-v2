<div align="center">
  <h1>Resumer</h1>
  <p><strong>Modern AI resume builder for fast, role-matched resumes.</strong></p>
  <p>
    Build your profile once. Paste a job description. Generate clean, ATS-aware PDFs that feel tailored instead of templated.
  </p>
  <p>
    <a href="https://resumer.aryansingh.space"><strong>Live App</strong></a>
    <span> / </span>
    <a href="#features"><strong>Features</strong></a>
    <span> / </span>
    <a href="#tech-stack"><strong>Stack</strong></a>
    <span> / </span>
    <a href="#local-development"><strong>Run Locally</strong></a>
  </p>
  <p>
    <img alt="Live" src="https://img.shields.io/badge/Live-resumer.aryansingh.space-111827?style=for-the-badge" />
    <img alt="Next.js" src="https://img.shields.io/badge/Next.js-16-000000?style=for-the-badge&logo=nextdotjs" />
    <img alt="React" src="https://img.shields.io/badge/React-19-149eca?style=for-the-badge&logo=react&logoColor=white" />
    <img alt="FastAPI" src="https://img.shields.io/badge/FastAPI-0.138-009688?style=for-the-badge&logo=fastapi&logoColor=white" />
    <img alt="Docker" src="https://img.shields.io/badge/Docker-ready-2496ed?style=for-the-badge&logo=docker&logoColor=white" />
  </p>
  <br />
</div>

---

## Preview

Resumer is already deployed at **[resumer.aryansingh.space](https://resumer.aryansingh.space)**.

```text
Profile data + target job
        |
        v
AI resume generation pipeline
        |
        v
Template-aware resume content
        |
        v
Rendered PDF + saved history
```

## Why It Exists

Most resume tools either make you manually fight layout or produce generic AI text. Resumer keeps your real career material structured, then uses a job description to generate sharper first drafts with practical PDF output.

## Features

| Feature | Description |
| --- | --- |
| Profile memory | Save reusable education, experience, projects, skills, links, and extracurriculars. |
| Job-aware generation | Paste a job description and generate content around role signals. |
| Template constraints | Resume templates define supported sections and content splits. |
| PDF export | Backend renders final documents with Jinja2, CSS, and WeasyPrint. |
| Generation history | Track previous resumes, status, logs, artifacts, and downloads. |
| Auth | GitHub and Google login through NextAuth. |
| Object storage | Generated artifacts are stored through S3-compatible Cloudflare R2. |
| Docker deploy | Frontend and backend ship as containerized services. |

## Tech Stack

| Layer | Tools |
| --- | --- |
| Frontend | Next.js 16, React 19, TypeScript, Tailwind CSS v4, shadcn/ui |
| Forms and state | react-hook-form, Zod, TanStack Query |
| Auth | NextAuth.js v5, JWT sessions |
| Backend | FastAPI, Pydantic v2, SQLAlchemy async, Alembic |
| AI pipeline | LangGraph, LangChain, Google Gemini / Gemma API |
| Rendering | Jinja2 templates, WeasyPrint PDF renderer |
| Database | PostgreSQL |
| Storage | Cloudflare R2 or any S3-compatible bucket |
| Deployment | Docker, Railway, custom domain |

## Architecture

```text
Browser
  |
  | Next.js app
  v
Frontend container
  |
  | /api/backend proxy + JWT auth
  v
FastAPI backend container
  |
  | async SQLAlchemy
  v
PostgreSQL

FastAPI backend
  |
  | generation pipeline
  v
LangGraph + LLM
  |
  | render artifacts
  v
WeasyPrint + Cloudflare R2
```

## Project Structure

```text
Resumer-v2/
|-- frontend/
|   |-- app/                  # Next.js app router pages and API routes
|   |-- components/           # Navigation, auth modal, profile forms, UI pieces
|   |-- lib/                  # Auth, JWT, shared utilities
|   |-- Dockerfile            # Frontend container
|   `-- package.json          # pnpm scripts and dependencies
|-- backend/
|   |-- src/api/              # Profile, generation, system endpoints
|   |-- src/core/             # Config, auth, DB, storage, executor
|   |-- src/models/           # SQLAlchemy models
|   |-- src/pipeline/         # LangGraph generation flow
|   |-- src/schemas/          # Pydantic schemas
|   |-- templates/            # Resume templates and manifests
|   |-- Dockerfile            # Backend container
|   `-- pyproject.toml        # uv Python project config
|-- docker-compose.yml        # Local Docker orchestration
|-- PLAN.md                   # Product and architecture notes
`-- .github/workflows/        # GitHub workflow checks
```

## Local Development

### Requirements

| Tool | Version |
| --- | --- |
| Node.js | 20+ |
| pnpm | Latest stable |
| Python | 3.12+ |
| uv | Latest stable |
| PostgreSQL | Any recent version |
| Docker | Optional, recommended |

### Environment

Copy sample environment files:

```bash
cp frontend/.env.example frontend/.env
cp backend/.env.example backend/.env
```

Set these core values:

```env
NEXTAUTH_SECRET=use-the-same-secret-as-backend
JWT_SECRET=use-the-same-secret-as-frontend
DATABASE_URL=postgresql+psycopg://user:pass@localhost/resumer
GOOGLE_API_KEY=your-google-api-key
```

Frontend also needs OAuth credentials if you want login locally:

```env
GITHUB_CLIENT_ID=
GITHUB_CLIENT_SECRET=
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
```

### Run Frontend

```bash
cd frontend
pnpm install
pnpm dev
```

Open `http://localhost:3000`.

### Run Backend

```bash
cd backend
uv sync
uv run alembic upgrade head
uv run python main.py
```

Backend runs on `http://localhost:8000`.

## Docker

Run full stack locally:

```bash
docker compose up --build
```

| Service | Local URL |
| --- | --- |
| Frontend | `http://localhost:3000` |
| Backend | `http://localhost:48000` |

## Deployment

Current production deployment uses **Railway + Docker** with the live domain at **resumer.aryansingh.space**.

| Service | Deployment role |
| --- | --- |
| Frontend container | Serves Next.js production app. |
| Backend container | Serves FastAPI API and generation pipeline. |
| PostgreSQL | Stores users, profiles, generations, logs, and artifact metadata. |
| Cloudflare R2 | Stores generated PDFs and related files. |
| Custom domain | Points public traffic to the deployed Railway service. |

## Key Environment Variables

| Variable | Used by | Purpose |
| --- | --- | --- |
| `NEXTAUTH_SECRET` | Frontend | Signs NextAuth JWTs. |
| `NEXTAUTH_URL` | Frontend | Public app URL. |
| `NEXT_PUBLIC_API_URL` | Frontend | Public backend URL for browser calls. |
| `BACKEND_INTERNAL_URL` | Frontend | Internal service URL for Docker/Railway networking. |
| `DATABASE_URL` | Backend | PostgreSQL connection string. |
| `JWT_SECRET` | Backend | Verifies frontend auth tokens. |
| `GOOGLE_API_KEY` | Backend | LLM API key for generation. |
| `FRONTEND_URL` | Backend | CORS origin. |
| `R2_ENDPOINT_URL` | Backend | Cloudflare R2 endpoint. |
| `R2_ACCESS_KEY_ID` | Backend | R2 access key. |
| `R2_SECRET_ACCESS_KEY` | Backend | R2 secret key. |
| `R2_BUCKET_NAME` | Backend | Artifact bucket name. |
| `RESEND_API_KEY` | Backend | Optional completion email delivery. |

## API Highlights

| Endpoint | Purpose |
| --- | --- |
| `GET /profile` | Fetch or initialize profile. |
| `PUT /profile` | Update base profile data. |
| `GET /profile/projects` | List saved projects. |
| `GET /profile/experiences` | List saved experiences. |
| `POST /generate` | Start a resume generation run. |
| `GET /generate` | List generation history. |
| `GET /generate/{gen_id}` | Fetch generation status. |
| `GET /generate/{gen_id}/logs` | Poll generation logs. |

## Design Direction

Resumer uses a sharp editorial look rather than generic SaaS polish: warm background, heavy typography, high-contrast cards, minimal chrome, and direct product language. The UI keeps attention on one loop: profile, job, generated resume.

## Status

Production deployed and actively evolving. Main next improvements are richer templates, better generation observability, and smoother onboarding for first-time profiles.

## License

Distributed under the MIT License. See `LICENSE` for details.

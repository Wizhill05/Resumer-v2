<div align="center">
  <br />
  <h1>Resumer</h1>
  <p><strong>AI resume engine for sharp, role-matched first passes.</strong></p>
  <p>
    Build your profile once, paste a job description, choose a template, and generate clean ATS-aware resumes without fighting blank pages.
  </p>
  <p>
    <a href="#features"><strong>Features</strong></a> /
    <a href="#stack"><strong>Stack</strong></a> /
    <a href="#quick-start"><strong>Quick Start</strong></a> /
    <a href="#deployment"><strong>Deployment</strong></a>
  </p>
  <p>
    <img alt="Next.js" src="https://img.shields.io/badge/Next.js-16-black?style=for-the-badge&logo=nextdotjs" />
    <img alt="React" src="https://img.shields.io/badge/React-19-149eca?style=for-the-badge&logo=react&logoColor=white" />
    <img alt="FastAPI" src="https://img.shields.io/badge/FastAPI-0.138-009688?style=for-the-badge&logo=fastapi&logoColor=white" />
    <img alt="Python" src="https://img.shields.io/badge/Python-3.12-3776ab?style=for-the-badge&logo=python&logoColor=white" />
    <img alt="Tailwind" src="https://img.shields.io/badge/Tailwind-4-38bdf8?style=for-the-badge&logo=tailwindcss&logoColor=white" />
  </p>
  <br />
</div>

---

## Overview

Resumer is a hosted resume builder designed around one fast loop: structured profile data in, job-aware resume out. The app stores reusable career material, runs an LLM pipeline against a target job description, renders a PDF with template constraints, and keeps generation history for later download.

```text
Profile memory + job description
        |
        v
LangGraph generation pipeline
        |
        v
Template-aware content shaping
        |
        v
HTML / CSS render with WeasyPrint
        |
        v
PDF + markdown artifacts in object storage
```

## Features

| Area | What it does |
| --- | --- |
| Profile builder | Stores core info, education, experience, projects, skills, and extracurriculars. |
| Job-aware generation | Uses role context, keywords, and optional instructions to tailor resume content. |
| Template system | Jinja2 templates with manifests, content split rules, and render constraints. |
| PDF output | Generates clean downloadable PDFs with WeasyPrint. |
| Generation history | Tracks status, logs, artifacts, and previous resume runs. |
| Auth | NextAuth v5 with GitHub and Google providers. |
| Cloud-ready jobs | FastAPI service triggers Cloud Run Jobs for long-running pipeline work. |
| Storage | Saves generated artifacts to S3-compatible Cloudflare R2. |

## Stack

| Layer | Tech |
| --- | --- |
| Frontend | Next.js 16, React 19, TypeScript, Tailwind CSS v4, shadcn/ui |
| State + forms | TanStack Query, react-hook-form, Zod |
| Auth | NextAuth.js v5, JWT sessions |
| Backend | FastAPI, Pydantic v2, SQLAlchemy 2.0 async, Alembic |
| AI pipeline | LangGraph, LangChain, Google Gemini / Gemma models |
| Rendering | Jinja2, WeasyPrint, template manifests |
| Data | PostgreSQL, Cloudflare R2 |
| Deploy | Vercel frontend, Google Cloud Run backend + Cloud Run Job worker |

## Project Structure

```text
Resumer-v2/
|-- frontend/              # Next.js app router UI
|   |-- app/               # Pages, layouts, API routes
|   |-- components/        # UI + feature components
|   `-- lib/               # Auth, JWT, shared utilities
|-- backend/               # FastAPI service + pipeline worker
|   |-- src/api/           # Profile, generation, system routes
|   |-- src/core/          # Config, auth, storage, executor
|   |-- src/pipeline/      # LangGraph resume generation flow
|   |-- src/models/        # SQLAlchemy models
|   |-- src/schemas/       # Pydantic schemas
|   `-- templates/         # Resume templates
|-- docker-compose.yml     # Local full-stack containers
`-- PLAN.md                # Product and architecture notes
```

## Quick Start

### 1. Clone

```bash
git clone <repo-url>
cd Resumer-v2
```

### 2. Configure environment

```bash
cp frontend/.env.example frontend/.env
cp backend/.env.example backend/.env
```

Set matching auth secrets in both files:

```env
NEXTAUTH_SECRET=your-secret-here
JWT_SECRET=your-secret-here
```

Minimum backend values for local generation:

```env
DATABASE_URL=postgresql+psycopg://user:pass@localhost/resumer
GOOGLE_API_KEY=your-google-api-key
EXECUTION_MODE=local
```

### 3. Run frontend

```bash
cd frontend
pnpm install
pnpm dev
```

Frontend runs on `http://localhost:3000`.

### 4. Run backend

```bash
cd backend
uv sync
uv run alembic upgrade head
uv run python main.py
```

Backend runs on `http://localhost:8000`.

## Docker

Run both services with Docker Compose:

```bash
docker compose up --build
```

| Service | URL |
| --- | --- |
| Frontend | `http://localhost:3000` |
| Backend | `http://localhost:48000` |

## Environment Variables

### Frontend

| Variable | Purpose |
| --- | --- |
| `NEXTAUTH_SECRET` | NextAuth signing secret. Must match backend `JWT_SECRET`. |
| `NEXTAUTH_URL` | Public frontend URL. |
| `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` | GitHub OAuth provider. |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Google OAuth provider. |
| `NEXT_PUBLIC_API_URL` | Browser-visible backend URL. |

### Backend

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | PostgreSQL connection string. |
| `JWT_SECRET` | Token verification secret. Must match `NEXTAUTH_SECRET`. |
| `GOOGLE_API_KEY` | LLM provider API key. |
| `FRONTEND_URL` | Allowed CORS origin. |
| `R2_ENDPOINT_URL` | Cloudflare R2 S3-compatible endpoint. |
| `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` | R2 credentials. |
| `R2_BUCKET_NAME` | Artifact bucket name. |
| `RESEND_API_KEY` | Optional completion email delivery. |
| `EXECUTION_MODE` | `local` for dev, `cloudrun_job` for production worker execution. |

## Core Flow

1. User signs in with GitHub or Google.
2. User fills reusable profile data.
3. User pastes a job description and selects a resume template.
4. Backend validates profile depth and creates a generation row.
5. Pipeline analyzes the job, writes tailored sections, renders artifacts, and updates status.
6. User previews, downloads, or returns to previous generations.

## API Surface

| Route | Purpose |
| --- | --- |
| `GET /profile` | Fetch or create current user profile. |
| `PUT /profile` | Update base profile fields. |
| `GET /profile/projects` | List projects. |
| `GET /profile/experiences` | List experiences. |
| `POST /generate` | Start resume generation. |
| `GET /generate` | List generation history. |
| `GET /generate/{gen_id}` | Fetch generation status and metadata. |
| `GET /generate/{gen_id}/logs` | Poll generation logs. |

## Deployment

Production target is split by workload:

| Piece | Target |
| --- | --- |
| Frontend | Vercel |
| API service | Google Cloud Run service |
| Pipeline worker | Google Cloud Run Job |
| Database | Neon PostgreSQL or any hosted Postgres |
| Artifacts | Cloudflare R2 |
| Email | Resend |

The included GitHub Actions workflow deploys the backend image to Cloud Run, creates or updates the API service, and deploys the pipeline as a Cloud Run Job.

## Design Notes

Resumer avoids generic resume-builder bloat. Data entry stays structured, generation stays evidence-based, and templates declare their own constraints so the AI output fits the final document instead of producing unusable walls of text.

## License

No license file is included yet. Add one before publishing or accepting outside contributions.

# Agent Instructions - Resumer-v2

Welcome! This document provides context, rules, and guidelines for AI agents working on the Resumer-v2 project. Read this file at the start of every session to align with the project constraints and environment.

## 1. Project Context & Stack

Resumer-v2 is an AI-powered resume builder designed to generate tailored, ATS-aware resumes from a user profile and job description.

- **Frontend:** Next.js 16 (App Router), React 19, TypeScript, Tailwind CSS v4, shadcn/ui. Located in `/frontend`.
- **Backend:** FastAPI, Python 3.12+, SQLModel/SQLAlchemy (async), Alembic, Pydantic v2, WeasyPrint (PDF rendering), LangGraph/LangChain (AI pipeline). Located in `/backend`.
- **Database:** PostgreSQL.
- **Object Storage:** Cloudflare R2 (S3-compatible) for generated PDFs.

## 2. Deployment & Hosting

- **Frontend:** Hosted on **Vercel**.
- **Backend:** Hosted on **Railway** using a Docker container.
- **Database & Storage:** PostgreSQL database and Cloudflare R2 bucket.

## 3. Critical Constraints for AI Agents

To avoid environment lockups, permission errors, or unnecessary tool calls, follow these strict rules:

- **No Localhost Frontend Runs:** DO NOT attempt to start or run the frontend server (`pnpm dev`, `next dev`) on localhost inside the agent session. If the frontend needs to be running or tested, tell the user to start it manually in their own terminal.
- **Accessing the Old Project:**
  - The previous version of this project is located at `D:\Technical\Programming\AI\Resumer`.
  - **Rule:** You are allowed to inspect and read files from `D:\Technical\Programming\AI\Resumer` to check how things were implemented in the past.
  - **Constraint:** You **MUST NOT** access, search, or read from that path **unless the user explicitly instructs you to do so**. Treat it as restricted/hidden until requested.

## 4. Key Directories & Project Structure

- `frontend/`
  - `app/` - Next.js pages and API routes.
  - `components/` - UI components (forms, modals, layouts).
  - `lib/` - Shared utilities, auth/JWT helpers.
- `backend/`
  - `src/api/` - FastAPI routes.
  - `src/core/` - Settings, DB setup, auth, storage, execution context.
  - `src/models/` - Database tables (SQLAlchemy/SQLModel).
  - `src/pipeline/` - Resume generation flow (LangGraph).
  - `src/schemas/` - Pydantic validation schemas.
  - `templates/` - HTML/Jinja2 templates and layouts for PDF generation.
  - `alembic/` - Database migrations.

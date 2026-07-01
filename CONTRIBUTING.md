# Contributing to Resumer

Thank you for your interest in contributing to Resumer! This document outlines the guidelines and workflows for contributing to this project.

## Code of Conduct

By participating, you agree to uphold our [Code of Conduct](CODE_OF_CONDUCT.md). Please report any unacceptable behavior to **noreply@aryansingh.space**.

## Development Setup

The project is split into a Next.js `frontend` and a FastAPI `backend`. See the [README](README.md) for full instructions on setting up environment variables (`.env`).

### Frontend Setup

1. Navigate to frontend: `cd frontend`
2. Install dependencies: `pnpm install`
3. Run development server: `pnpm dev`
4. Run linter: `pnpm run lint`

### Backend Setup

1. Navigate to backend: `cd backend`
2. Sync dependencies: `uv sync`
3. Run database migrations: `uv run alembic upgrade head`
4. Run local server: `uv run python main.py`

## Git Workflow

1. Fork the repository and create your branch from `main`.
2. Name your branch descriptively: `feature/your-feature-name` or `bugfix/issue-description`.
3. If you've added code that should be tested, add tests.
4. Ensure your changes build locally via Docker or local runtime checks.
5. Submit a pull request.

## PR Guidelines

- Write clear, descriptive commit messages.
- Fill out the Pull Request template completely.
- Ensure all CI/CD build checks (Docker build checks) pass before requesting review.
- Avoid introducing unused dependencies.

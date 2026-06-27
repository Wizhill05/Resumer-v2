# Multi-stage build using uv for maximum speed and small footprint
FROM ghcr.io/astral-sh/uv:python3.12-bookworm-slim AS builder

ENV UV_COMPILE_BYTECODE=1
ENV UV_LINK_MODE=copy

WORKDIR /app

# Install system dependencies for weasyprint building
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

# Install python dependencies
COPY backend/pyproject.toml backend/uv.lock ./
RUN uv sync --frozen --no-install-project --no-dev

# Final runtime stage
FROM python:3.12-slim-bookworm

WORKDIR /app

# Copy virtual env from builder stage
COPY --from=builder /app/.venv /app/.venv
ENV PATH="/app/.venv/bin:$PATH"

# Install system libraries needed by WeasyPrint (Cairo, Pango, GdkPixbuf, etc.) and fonts
RUN apt-get update && apt-get install -y --no-install-recommends \
    libpango-1.0-0 \
    libpangoft2-1.0-0 \
    libcairo2 \
    libgdk-pixbuf-2.0-0 \
    shared-mime-info \
    fonts-open-sans \
    fonts-dejavu \
    fonts-liberation \
    && rm -rf /var/lib/apt/lists/*

# Copy application source code
COPY backend/src/ /app/src/
COPY backend/templates/ /app/templates/
COPY backend/alembic/ /app/alembic/
COPY backend/alembic.ini /app/alembic.ini
COPY backend/main.py /app/main.py

EXPOSE 8000

ENV PYTHONUNBUFFERED=1

CMD ["sh", "-c", "alembic upgrade head && uvicorn src.main:app --host 0.0.0.0 --port 8000"]

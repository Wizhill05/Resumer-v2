import uuid
from datetime import datetime
from typing import Any

from pydantic import BaseModel


class ContentSplitRequest(BaseModel):
    """The chosen project / experience distribution sent by the frontend."""
    projects: int
    experience: int


class GenerationCreate(BaseModel):
    template_id: str
    job_description: str
    job_title: str | None = None
    company: str | None = None
    keywords: list[str] | None = None
    instructions: str | None = None
    model_used: str = "gemma-4-31b-it"
    # Optional — backend falls back to template default when absent.
    content_split: ContentSplitRequest | None = None
    send_email: bool | None = None


class GenerationOut(BaseModel):
    id: uuid.UUID
    user_id: uuid.UUID
    template_id: str
    job_title: str | None
    company: str | None
    status: str
    model_used: str
    job_description: str
    created_at: datetime
    completed_at: datetime | None
    thumb_storage_key: str | None = None
    content_split: dict | None = None
    send_email: bool | None = None

    model_config = {"from_attributes": True}


# ── Editor schemas ─────────────────────────────────────────────────────────────


class EditorManifest(BaseModel):
    """Subset of template manifest exposed to the editor client."""
    min_font_size: float
    max_font_size: float
    target_pages: int
    page_margin_mm: float


class EditorProfileOut(BaseModel):
    """Profile contact block for the editor header display."""
    full_name: str | None = None
    email: str | None = None
    phone: str | None = None
    location: str | None = None
    linkedin_url: str | None = None
    github_url: str | None = None
    portfolio_url: str | None = None
    subtitle: str | None = None


class EditorPayload(BaseModel):
    """Response for GET /generate/{id}/editor."""
    id: uuid.UUID
    template_id: str
    job_title: str | None = None
    company: str | None = None
    status: str
    editor_revision: int
    profile: EditorProfileOut
    tailored_resume: dict[str, Any]
    font_size: float | None = None
    page_count: int | None = None
    fit_warning: bool = False
    manifest: EditorManifest


class RenderHtmlRequest(BaseModel):
    """Body for POST /generate/{id}/render-html (Jinja only, no WeasyPrint)."""
    resume: dict[str, Any]
    profile: dict[str, Any] | None = None
    font_size: float | None = None  # defaults to manifest max_font_size


class RenderHtmlResponse(BaseModel):
    html: str
    template_id: str


class RenderPdfPreviewResponse(BaseModel):
    """Authoritative, page-by-page editor preview rendered by WeasyPrint."""
    page_images: list[str]
    font_size: float
    page_count: int
    fit_warning: bool


class EditorSaveRequest(BaseModel):
    """Body for POST /generate/{id}/save."""
    resume: dict[str, Any]
    profile: dict[str, Any] | None = None
    expected_revision: int


class EditorSaveResponse(BaseModel):
    """Response for POST /generate/{id}/save."""
    editor_revision: int
    font_size: float
    page_count: int
    fit_warning: bool
    pdf_storage_key: str | None = None
    thumb_storage_key: str | None = None


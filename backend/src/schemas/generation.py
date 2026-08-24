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
    model_used: str = "poolside/laguna-xs-2.1:free"
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



# ── Orphan Detection Schemas ──────────────────────────────────────────────────


class OrphanItemOut(BaseModel):
    """Individual orphan or oversize bullet point analysis."""
    fix_type: str
    section: str
    text: str
    currentChars: int
    renderedLines: int
    charsPerLine: int
    targetCharsMin: int
    targetCharsMax: int
    charsToAddMin: int | None = None
    charsToAddMax: int | None = None
    suggestion: str


class OrphanDetectionRequest(BaseModel):
    """Optional body for POST /generate/{id}/detect-orphans (tests candidate JSON)."""
    resume: dict[str, Any] | None = None
    profile: dict[str, Any] | None = None
    font_size: float | None = None


class OrphanDetectionResponse(BaseModel):
    """Response for POST /generate/{id}/detect-orphans."""
    success: bool
    generation_id: str | None = None
    template_id: str
    font_size: float
    page_count: int
    target_pages: int
    fits_target: bool
    has_orphans: bool
    orphan_count: int
    orphans: list[OrphanItemOut] = []
    actionable_instructions_for_ai: str
    error: str | None = None

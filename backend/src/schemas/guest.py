import re

from pydantic import BaseModel, Field, field_validator

from src.schemas.generation import AnalyticsContext, ContentSplitRequest, CreativityMode
from src.schemas.profile import (
    EducationCreate,
    ExperienceCreate,
    ExtracurricularCreate,
    ProfileUpdate,
    ProjectCreate,
)


_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


class GuestGenerationCreate(BaseModel):
    analytics_context: AnalyticsContext | None = None
    template_id: str = "personal-classic"
    job_description: str
    keywords: list[str] | None = None
    instructions: str | None = None
    model_used: str = "unknown"
    content_split: ContentSplitRequest | None = None
    creativity_mode: CreativityMode = "proper"
    turnstile_token: str | None = None
    # Optional address to email the finished PDF to.
    notify_email: str | None = Field(default=None, max_length=254)
    profile: ProfileUpdate = ProfileUpdate()
    experiences: list[ExperienceCreate] = Field(default_factory=list)
    projects: list[ProjectCreate] = Field(default_factory=list)
    education: list[EducationCreate] = Field(default_factory=list)
    extracurriculars: list[ExtracurricularCreate] = Field(default_factory=list)


    @field_validator("notify_email")
    @classmethod
    def _check_notify_email(cls, value: str | None) -> str | None:
        if value is None:
            return None
        value = value.strip().lower()
        if not value:
            return None
        if not _EMAIL_RE.match(value):
            raise ValueError("Enter a valid email address, or leave it blank.")
        return value


class GuestGenerationOut(BaseModel):
    id: str
    template_id: str
    job_title: str | None = None
    company: str | None = None
    status: str
    model_used: str
    created_at: str
    completed_at: str | None = None
    content_split: dict | None = None
    creativity_mode: str | None = None
    error_message: str | None = None
    section_order: list[str] | None = None
    expires_at: str | None = None
    notify_email: str | None = None

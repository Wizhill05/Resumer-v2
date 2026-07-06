import ast
import re
import uuid
from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, Field, field_validator


# ── Cerebras coercion helpers ─────────────────────────────────────────────────
# Cerebras function-calling often returns list[str] as a plain comma-separated
# string and date fields as human strings like "Jan 2025".  These helpers
# normalise the values before Pydantic validation so both Cerebras and Google
# outputs parse cleanly.

def _coerce_str_to_list(v):
    """'React, Node.js, Python' or "['React', 'Node']" → real list."""
    if v is None:
        return v
    if isinstance(v, list):
        return v
    if isinstance(v, str):
        v = v.strip()
        if v.startswith("["):
            try:
                parsed = ast.literal_eval(v)
                if isinstance(parsed, list):
                    return [str(i) for i in parsed]
            except (ValueError, SyntaxError):
                pass
        return [s.strip() for s in v.split(",") if s.strip()]
    return v


_MONTH_FORMATS = ["%B %Y", "%b %Y", "%Y-%m-%d", "%Y-%m", "%m/%Y", "%m-%Y"]


def _coerce_str_to_date(v):
    """'Jan 2025' or 'June 2023' → date(2025, 1, 1)."""
    if v is None or isinstance(v, date):
        return v
    if isinstance(v, str):
        v = v.strip()
        if not v or v.lower() in ("present", "current", "now", "ongoing"):
            return None
        for fmt in _MONTH_FORMATS:
            try:
                return datetime.strptime(v, fmt).date()
            except ValueError:
                continue
        # Last resort: extract year only
        year_match = re.search(r"\b(19|20)\d{2}\b", v)
        if year_match:
            return date(int(year_match.group()), 1, 1)
    return v


# Profile
class ProfileUpdate(BaseModel):
    full_name: str | None = None
    email: str | None = None
    phone: str | None = None
    location: str | None = None
    linkedin_url: str | None = None
    github_url: str | None = None
    portfolio_url: str | None = None
    subtitle: str | None = None
    summary: str | None = None
    skills: list[str] | None = None

    @field_validator("skills", mode="before")
    @classmethod
    def coerce_skills(cls, v):
        return _coerce_str_to_list(v)


class ProfileOut(ProfileUpdate):
    id: uuid.UUID
    user_id: uuid.UUID
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


# Projects
class ProjectCreate(BaseModel):
    name: str
    description: str | None = None
    technologies: list[str] | None = None
    github_url: str | None = None
    live_url: str | None = None
    start_date: date | None = None
    end_date: date | None = None
    bullet_points: list[str] | None = None
    sort_order: int = 0

    @field_validator("technologies", "bullet_points", mode="before")
    @classmethod
    def coerce_lists(cls, v):
        return _coerce_str_to_list(v)

    @field_validator("start_date", "end_date", mode="before")
    @classmethod
    def coerce_dates(cls, v):
        return _coerce_str_to_date(v)


class ProjectUpdate(ProjectCreate):
    name: str | None = None


class ProjectOut(ProjectCreate):
    id: uuid.UUID
    user_id: uuid.UUID
    source: str
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


# Experiences
class ExperienceCreate(BaseModel):
    role: str
    organization: str
    location: str | None = None
    start_date: date | None = None
    end_date: date | None = None
    bullet_points: list[str] | None = None
    sort_order: int = 0

    @field_validator("bullet_points", mode="before")
    @classmethod
    def coerce_lists(cls, v):
        return _coerce_str_to_list(v)

    @field_validator("start_date", "end_date", mode="before")
    @classmethod
    def coerce_dates(cls, v):
        return _coerce_str_to_date(v)


class ExperienceUpdate(ExperienceCreate):
    role: str | None = None
    organization: str | None = None


class ExperienceOut(ExperienceCreate):
    id: uuid.UUID
    user_id: uuid.UUID
    source: str
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


# Education
class EducationCreate(BaseModel):
    degree: str
    institution: str
    location: str | None = None
    start_date: date | None = None
    end_date: date | None = None
    gpa: str | None = None
    coursework: list[str] | None = None
    sort_order: int = 0

    @field_validator("coursework", mode="before")
    @classmethod
    def coerce_lists(cls, v):
        return _coerce_str_to_list(v)

    @field_validator("start_date", "end_date", mode="before")
    @classmethod
    def coerce_dates(cls, v):
        return _coerce_str_to_date(v)


class EducationUpdate(EducationCreate):
    degree: str | None = None
    institution: str | None = None


class EducationOut(EducationCreate):
    id: uuid.UUID
    user_id: uuid.UUID
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


# Extracurriculars
class ExtracurricularCreate(BaseModel):
    title: str
    organization: str | None = None
    description: str | None = None
    start_date: date | None = None
    end_date: date | None = None
    bullet_points: list[str] | None = None
    sort_order: int = 0

    @field_validator("bullet_points", mode="before")
    @classmethod
    def coerce_lists(cls, v):
        return _coerce_str_to_list(v)

    @field_validator("start_date", "end_date", mode="before")
    @classmethod
    def coerce_dates(cls, v):
        return _coerce_str_to_date(v)


class ExtracurricularUpdate(ExtracurricularCreate):
    title: str | None = None


class ExtracurricularOut(ExtracurricularCreate):
    id: uuid.UUID
    user_id: uuid.UUID
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


# Imports
class ImportWarning(BaseModel):
    scope: str
    message: str


class DuplicateCandidate(BaseModel):
    imported_index: int
    imported_type: Literal["profile", "experience", "project", "education", "extracurricular", "skill"]
    existing_id: str | None = None
    existing_type: str
    confidence: float
    reason: str
    suggested_action: Literal["merge", "skip", "create"]


class ResumeImportDraft(BaseModel):
    profile: ProfileUpdate = ProfileUpdate()
    experiences: list[ExperienceCreate] = Field(default_factory=list)
    projects: list[ProjectCreate] = Field(default_factory=list)
    education: list[EducationCreate] = Field(default_factory=list)
    extracurriculars: list[ExtracurricularCreate] = Field(default_factory=list)
    duplicate_candidates: list[DuplicateCandidate] = Field(default_factory=list)
    warnings: list[ImportWarning] = Field(default_factory=list)


class GitHubProjectImportRequest(BaseModel):
    url: str


class GitHubProjectDraft(ProjectCreate):
    duplicate_candidates: list[DuplicateCandidate] = Field(default_factory=list)
    warnings: list[ImportWarning] = Field(default_factory=list)


class ImportApplyRequest(BaseModel):
    profile: ProfileUpdate | None = None
    experiences: list[ExperienceCreate] = Field(default_factory=list)
    projects: list[ProjectCreate] = Field(default_factory=list)
    education: list[EducationCreate] = Field(default_factory=list)
    extracurriculars: list[ExtracurricularCreate] = Field(default_factory=list)


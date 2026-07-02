import uuid
from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, Field


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


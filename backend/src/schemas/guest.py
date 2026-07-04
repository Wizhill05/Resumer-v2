from pydantic import BaseModel, Field

from src.schemas.generation import ContentSplitRequest
from src.schemas.profile import (
    EducationCreate,
    ExperienceCreate,
    ExtracurricularCreate,
    ProfileUpdate,
    ProjectCreate,
)


class GuestGenerationCreate(BaseModel):
    template_id: str = "personal-classic"
    job_description: str
    keywords: list[str] | None = None
    instructions: str | None = None
    model_used: str = "gemma-4-31b-it"
    content_split: ContentSplitRequest | None = None
    profile: ProfileUpdate = ProfileUpdate()
    experiences: list[ExperienceCreate] = Field(default_factory=list)
    projects: list[ProjectCreate] = Field(default_factory=list)
    education: list[EducationCreate] = Field(default_factory=list)
    extracurriculars: list[ExtracurricularCreate] = Field(default_factory=list)


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
    error_message: str | None = None

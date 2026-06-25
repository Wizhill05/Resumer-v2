import uuid
from datetime import date, datetime

from pydantic import BaseModel


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

